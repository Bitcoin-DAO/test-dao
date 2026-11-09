// New proposal (protocol 4.1). New members go through the sponsor flow instead.
import { useState } from 'preact/hooks';
import { signAndPublish, useApp } from '../app';
import { fmtSats, t } from '../i18n';
import { KIND } from '../core/events';
import { DUST, proposalSchemaError, validAddress, type Output, type ProposalContent, type ProposalType } from '../core/state';
import type { DraftContent } from '../core/discussion';
import { cadenceOf } from '../core/time';
import { Footer, Header, errText, go } from './parts';
import { EDITABLE_RULES, periodText, ruleLabel, ruleValue, typeLabel } from './Proposals';
import { PRACTICE_VOTE_DAYS } from '../core/config';
import { feePolicyOf } from '../core/chain';

const TYPES: ProposalType[] = ['payout', 'statement', 'remove_member', 'change_rules', 'close'];

/** The form's fields from a draft version (protocol 4.5.1), so a new version starts from the latest one. */
function fieldsOf(c?: DraftContent) {
  const p = c?.payload ?? {};
  const out = (p.outputs as Output[] | undefined)?.[0];
  const change = (p.changes as { path: string; to: unknown }[] | undefined)?.[0];
  return {
    type: (c?.type ?? 'payout') as ProposalType,
    title: c?.title ?? '',
    summary: c?.summary ?? '',
    recipient: (p.recipient as string) ?? '',
    address: (c?.type === 'close' ? (p.destination as string) : out?.address) ?? '',
    amount: out?.amount_sat ? String(out.amount_sat) : '',
    forMember: out?.member ?? '',
    member: (p.member_key as string) ?? '',
    reason: (p.reason as string) ?? '',
    rule: (change?.path?.replace(/^rules\./, '') ?? 'votingPeriodDays') as (typeof EDITABLE_RULES)[number],
    value: change?.to !== undefined && change?.to !== null ? String(change.to) : '',
  };
}

/** New proposal, or with `draftId` a new version of a discussion draft (same fields, nothing required but the title). */
export function NewProposal({ draftId }: { draftId?: string } = {}) {
  const app = useApp();
  const s = app.dao!;
  const network = app.site!.network;
  const thread = draftId ? s.discussion.byId.get(draftId) : undefined;
  const latest = thread?.versions[thread.versions.length - 1];
  const [init] = useState(() => fieldsOf(latest?.content));
  const [type, setType] = useState<ProposalType>(init.type);
  const returnTo = s.founded!.config.testnetTreasury ?? app.site!.testnetTreasury;
  const returnOk = !!returnTo && validAddress(returnTo.address, network);
  const [title, setTitle] = useState(init.title);
  const [summary, setSummary] = useState(init.summary);
  const [link, setLink] = useState('');
  const [recipient, setRecipient] = useState(init.recipient);
  const [address, setAddress] = useState(init.address);
  const [amount, setAmount] = useState(init.amount);
  const [iAm, setIAm] = useState(false);
  const [member, setMember] = useState(init.member);
  const [forMember, setForMember] = useState(init.forMember);
  const [reason, setReason] = useState(init.reason);
  const [rule, setRule] = useState<(typeof EDITABLE_RULES)[number]>(init.rule);
  const [value, setValue] = useState(init.value);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (s.closed) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('closed.text')}</p></main>
        <Footer />
      </>
    );
  }
  if (draftId && (!thread || thread.kind !== 'draft' || thread.status !== 'open' || thread.author !== app.me?.person)) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('ds.notYours')}</p></main>
        <Footer />
      </>
    );
  }
  if (!app.me || !app.secret) {
    return (
      <>
        <Header />
        <main>
          <p class="lead">{t('np.signIn')}</p>
          <button type="button" class="btn primary" onClick={() => go('/join')}>{t('nav.signin')}</button>
        </main>
      </>
    );
  }

  const addr = address.trim();
  const addrError = addr && (!validAddress(addr, network) ? t('np.addressBad', { network }) : s.isTreasuryAddress(addr) ? t('np.addressTreasury') : undefined);
  const amt = Number(amount);
  const amtError = amount && !(Number.isInteger(amt) && amt > DUST) ? t('np.amountBad', { dust: DUST }) : undefined;
  const stored = s.rules?.[rule];
  // A rule missing from older settings shows its default; the change records what is actually stored.
  const current = rule === 'feePolicy' ? feePolicyOf(s.rules ?? {}) : stored;
  const parsedValue = (() => {
    if (rule === 'payoutRound') return value === 'weekly' || value === 'monthly' ? value : undefined;
    if (rule === 'feePolicy') return value === 'fast' || value === 'economical' ? value : undefined;
    if (rule === 'quorum') return /^\d+\/\d+$/.test(value.trim()) ? value.trim() : undefined;
    const n = Number(value);
    return value.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  let payload: Record<string, unknown> = {};
  if (type === 'payout') payload = { recipient: recipient.trim(), outputs: [{ address: addr, amount_sat: amt, ...(forMember ? { member: forMember } : {}) }] };
  if (type === 'remove_member') payload = { member_key: member, reason: reason.trim() };
  if (type === 'change_rules') payload = { changes: [{ path: `rules.${rule}`, from: stored ?? null, to: parsedValue }] };
  if (type === 'close') payload = { destination: addr };
  const content: ProposalContent = {
    type, title: title.trim(), summary: summary.trim(), lang: app.lang, payload,
    ...(link.trim() ? { link: { url: link.trim() } } : {}),
  };
  const schemaErr = proposalSchemaError(content, network);
  // Say what still stops publishing, instead of a silently disabled button.
  const FIELD: Record<string, Parameters<typeof t>[0]> = {
    title: 'np.titleField', summary: 'np.summary', recipient: 'np.recipient', address: type === 'close' ? 'np.destination' : 'np.address',
    amount: 'np.amount', link: 'np.link', member_key: 'np.member', reason: 'np.reason', destination: 'np.destination',
  };
  const missing = schemaErr
    ? (FIELD[schemaErr] ? t(FIELD[schemaErr]) : schemaErr)
    : type === 'change_rules' && parsedValue === undefined ? t('np.newValue') : undefined;
  const ok = !schemaErr && !addrError && !amtError && !(type === 'change_rules' && (parsedValue === undefined || parsedValue === current || (rule === 'payoutRound' && parsedValue === cadenceOf(current))));

  // A draft version may be partial: only the title is required, and wrong values are still flagged.
  const draftOk = !!title.trim() && !addrError && !amtError;
  const nextVersion = (thread?.versions.length ?? 0) + 1;

  const publish = async () => {
    setMsg(undefined);
    setBusy(true);
    try {
      if (draftId) {
        const draft: DraftContent = { version: nextVersion, title: title.trim(), summary: summary.trim(), type, payload, lang: app.lang };
        await signAndPublish(KIND.draft, draft, [['e', draftId]]);
        go(`/d/${draftId}`);
        return;
      }
      const { event } = await signAndPublish(KIND.proposal, content);
      if (iAm && !(type === 'payout' && payee && payeeStanding?.address === addr) && (type === 'payout' || type === 'close')) await signAndPublish(KIND.confirm, { address: addr }, [['e', event.id]]);
      go(`/p/${event.id}`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const removable = s.members.filter(m => !m.council && m.key !== app.me!.key);
  const payee = s.members.find(m => m.key === forMember);
  const payeeStanding = payee ? s.standingAt(payee.key, s.now) : undefined;
  const chooseMember = (key: string) => {
    setForMember(key);
    const st = key ? s.standingAt(key, s.now) : undefined;
    const m = s.members.find(x => x.key === key);
    if (st) setAddress(st.address);
    if (m && !recipient.trim()) setRecipient(m.name);
  };

  return (
    <>
      <Header />
      <main>
        <h1>{draftId ? t('ds.newVersion', { n: nextVersion }) : t('np.title')}</h1>
        {draftId && <p class="small">{t('ds.versionHint')}</p>}
        <label class="field">
          {t('np.type')}
          <select value={type} onChange={e => {
            const v = (e.target as HTMLSelectElement).value as ProposalType;
            setType(v);
            if (v === 'close' && returnOk && !address.trim()) setAddress(returnTo!.address);
          }} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
            {TYPES.map(x => <option value={x}>{typeLabel(x)}</option>)}
          </select>
        </label>
        <p class="small">{t('np.sponsorHint')}</p>
        <label class="field">{t('np.titleField')}<input type="text" maxLength={80} value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field">
          {t('np.summary')}
          <textarea maxLength={500} value={summary} style="font-family:inherit;font-size:16px" onInput={e => setSummary((e.target as HTMLTextAreaElement).value)} />
          <span class="small" style="font-weight:400">{t('np.summaryHint')} {summary.length}/500</span>
        </label>
        {!draftId && <label class="field">{t('np.link')}<input type="text" inputMode="url" placeholder="https://" value={link} onInput={e => setLink((e.target as HTMLInputElement).value)} /></label>}

        {type === 'payout' && (
          <div class="card">
            <label class="field">
              {t('np.forMember')}
              <select value={forMember} onChange={e => chooseMember((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                <option value="">—</option>
                {s.members.map(m => <option value={m.key}>{m.name}</option>)}
              </select>
            </label>
            <label class="field">{t('np.recipient')}<input type="text" maxLength={80} value={recipient} onInput={e => setRecipient((e.target as HTMLInputElement).value)} /></label>
            <label class="field">{t('np.address')}<input type="text" class="mono" autoComplete="off" spellcheck={false} value={address} onInput={e => setAddress((e.target as HTMLInputElement).value)} /></label>
            {addrError && <p class="error">{addrError}</p>}
            {payee && addr && !addrError && (
              payeeStanding?.address === addr ? <p class="ok">{t('np.standingUsed', { name: payee.name })}</p>
                : <p class="small">{t(payeeStanding ? 'np.standingOther' : 'np.noStanding', { name: payee.name })}</p>
            )}
            <label class="field">{t('np.amount')}<input type="text" inputMode="numeric" value={amount} onInput={e => setAmount((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} /></label>
            {amount && !amtError && <span class="small">{fmtSats(amt)} sats</span>}
            {amtError && <p class="error">{amtError}</p>}
            {!draftId && !(payee && payeeStanding?.address === addr) && (
              <>
                <label class="check"><input type="checkbox" checked={iAm} onChange={e => setIAm((e.target as HTMLInputElement).checked)} />{t('np.iAmRecipient')}</label>
                {!iAm && <p class="small">{t('np.recipientLater')}</p>}
              </>
            )}
          </div>
        )}

        {type === 'remove_member' && (
          <div class="card">
            <label class="field">
              {t('np.member')}
              <select value={member} onChange={e => setMember((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                <option value="">—</option>
                {removable.map(m => <option value={m.key}>{m.name}</option>)}
              </select>
            </label>
            <label class="field">{t('np.reason')}<input type="text" value={reason} onInput={e => setReason((e.target as HTMLInputElement).value)} /></label>
          </div>
        )}

        {type === 'change_rules' && (
          <div class="card">
            <label class="field">
              {t('np.rule')}
              <select value={rule} onChange={e => (setRule((e.target as HTMLSelectElement).value as typeof rule), setValue(''))} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                {EDITABLE_RULES.map(r => <option value={r}>{ruleLabel(r)}</option>)}
              </select>
            </label>
            <span class="small">{t('np.current', { v: ruleValue(rule, current) })}</span>
            {rule === 'votingPeriodDays' ? (
              // Vote length as members think of it: practice minutes or whole days.
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  {[PRACTICE_VOTE_DAYS, 1, 3, 7].map(d => <option value={String(d)}>{periodText(d)}</option>)}
                </select>
              </label>
            ) : rule === 'feePolicy' ? (
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  <option value="fast">{t('fee.fast')}</option>
                  <option value="economical">{t('fee.economical')}</option>
                </select>
              </label>
            ) : rule === 'payoutRound' ? (
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  <option value="monthly">{t('setup.monthly')}</option>
                  <option value="weekly">{t('setup.weekly')}</option>
                </select>
              </label>
            ) : (
              <label class="field">{t('np.newValue')}<input type="text" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)} /></label>
            )}
          </div>
        )}

        {type === 'close' && (
          <div class="card">
            <p class="warn">{t('np.closeWarn')}</p>
            {returnOk && <p class="note">{t('np.returnNote', { name: returnTo!.name })}</p>}
            <label class="field">{t('np.destination')}<input type="text" class="mono" autoComplete="off" spellcheck={false} value={address} onInput={e => setAddress((e.target as HTMLInputElement).value)} /></label>
            {addrError && <p class="error">{addrError}</p>}
            {!draftId && <label class="check"><input type="checkbox" checked={iAm} onChange={e => setIAm((e.target as HTMLInputElement).checked)} />{t('np.iAmRecipient')}</label>}
          </div>
        )}

        {draftId ? (
          <>
            <button type="button" class="btn primary" disabled={!draftOk || busy} onClick={publish}>{t('ds.publishVersion', { n: nextVersion })}</button>
            {missing && <p class="small">{t('ds.stillMissing', { what: missing })}</p>}
          </>
        ) : (
          <>
            <button type="button" class="btn primary" disabled={!ok || busy} onClick={publish}>{t('np.publish')}</button>
            {!ok && missing && <p class="small">{t('np.missing', { what: missing })}</p>}
          </>
        )}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      <Footer />
    </>
  );
}
