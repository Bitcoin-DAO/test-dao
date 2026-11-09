// Joining after the founding (role "candidate") and a new key after losing everything (role "rekey").
import { useEffect, useState } from 'preact/hooks';
import { passkeyName, setState, sync, useApp } from '../app';
import { t } from '../i18n';
import { newSecret, pubkeyOf, type FounderCode } from '../core/identity';
import { proposalLabel } from '../core/state';
import { formatShortCode, shortCode } from '../core/shortcode';
import { parseJson } from '../core/util';
import { createPasskey, passkeysAvailable } from '../lib/passkey';
import { store, type PendingFounder } from '../lib/store';
import { Footer, Header, ProtectKey, PrintCard, Qr, ShortCode, errText, go, askConfirm } from './parts';
import { statusText } from './Proposals';

export function Candidate({ role }: { role: 'candidate' | 'rekey' }) {
  const app = useApp();
  const pending = app.pending;
  const [showCode, setShowCode] = useState(true);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void sync(), 8000);
    return () => clearInterval(id);
  }, [pending?.pubkey]);

  const title = role === 'candidate' ? t('cand.title') : t('lost.title');
  if (!app.daoId) return <><Header /><main><p class="lead">{t('join.notFounded', { dao: app.site!.name })}</p></main></>;

  // Finished: show the card.
  if (!pending && app.me && app.secret) {
    return (
      <>
        <Header sub={title} />
        <main>
          <h1>{role === 'candidate' ? t('cand.member', { dao: app.site!.name }) : t('lost.done')}</h1>
          <PrintCard council={app.me.council} />
          <button type="button" class="btn secondary" onClick={() => go('/')}>{t('nav.home')} →</button>
        </main>
        <Footer />
      </>
    );
  }
  if (!pending || pending.role === 'founder') return <NewKey role={role} />;

  const s = app.dao!;
  const person = s.personOf(pending.pubkey);
  const listed = s.members.some(m => m.person === person && (role === 'candidate' || m.key === pending.pubkey));
  const restart = async () => {
    if (!(await askConfirm(t('fs.restartConfirm'), t('fs.restart'), true))) return;
    await store.clearPending(app.site!.site);
    setState({ pending: undefined });
  };

  const verifies = s.verifies.filter(v => parseJson<any>(v.content).candidate_key === pending.pubkey);
  const proposal = [...s.proposals].reverse().find(p => p.content.type === 'add_member' && p.content.payload.candidate_key === pending.pubkey);
  const rekey = s.rekeys.find(r => r.newKey === pending.pubkey);
  const m = s.settings[s.settings.length - 1].content.threshold;
  const code: FounderCode = { t: 'btcdao-founder', v: 1, name: pending.name, key: pending.pubkey };

  return (
    <>
      <Header sub={title} />
      <main>
        {listed ? (
          <>
            <h1>{role === 'candidate' ? t('cand.member', { dao: app.site!.name }) : t('lost.done')}</h1>
            <ProtectKey />
          </>
        ) : (
          <>
            <h1>{role === 'candidate' ? t('cand.waitTitle') : t('lost.waitTitle')}</h1>
            {role === 'rekey' && <p class="lead">{t('lost.waitText')}</p>}
            <div class="card">
              <div class="kv"><span>{t('fs.yourCode')}</span><span class="mono"><ShortCodeText k={pending.pubkey} /></span></div>
              {role === 'candidate' ? (
                <>
                  <div class="kv"><span>{t('cand.verified')}</span><span>{verifies.length ? `${verifies.length} ✓` : t('cand.notYet')}</span></div>
                  <span class="small">{t('cand.verifyNeed')}</span>
                  <div class="kv">
                    <span>{t('cand.proposal')}</span>
                    <span>{proposal ? <a href={`#/p/${proposal.event.id}`}>{proposalLabel(app.site!.name, proposal.number)} · {statusText(proposal, s.now)}</a> : t('cand.notYet')}</span>
                  </div>
                  <div class="kv"><span>{t('cand.listed')}</span><span>{t('cand.notYet')}</span></div>
                  {proposal?.status === 'passed' && <p class="small">{t('cand.waitList')}</p>}
                  {proposal && ['rejected', 'no_quorum'].includes(proposal.status) && <p class="warn">{t('cand.rejected')}</p>}
                </>
              ) : (
                <>
                  <div class="kv"><span>{t('cn.rekeys')}</span><span>{rekey ? t('cn.approvals', { n: rekey.endorsers.length, m }) : t('cand.notYet')}</span></div>
                  {rekey?.needsSecondVerify && <span class="small">{t('cn.rekeyNeedsVerify')}</span>}
                  <div class="kv"><span>{t('cand.listed')}</span><span>{t('cand.notYet')}</span></div>
                  {rekey?.effectiveAt !== undefined && <p class="small">{t('cand.waitList')}</p>}
                  <p class="small">{t('lost.dontSignIn')}</p>
                </>
              )}
            </div>
            <button type="button" class="btn link" style="align-self:flex-start" onClick={() => setShowCode(!showCode)}>{showCode ? t('cand.hideCode') : t('cand.showCode')}</button>
            {showCode && (
              <div class="card" style="align-items:center">
                <Qr text={JSON.stringify(code)} size={260} label={pending.name} />
                <ShortCode pubkey={pending.pubkey} />
                <span class="small">{t('fs.shortCodeLabel')}</span>
                <CopyText text={JSON.stringify(code)} />
              </div>
            )}
            <p class="small">{t('fs.autoRefresh')}</p>
            <button type="button" class="btn link" onClick={restart}>{t('fs.restart')}</button>
          </>
        )}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
    </>
  );
}

const ShortCodeText = ({ k }: { k: string }) => <>{formatShortCode(shortCode(k))}</>;

function CopyText({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" class="btn secondary" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      } catch { /* ignore */ }
    }}>{ok ? t('home.copied') : t('fs.copyCode')}</button>
  );
}

function NewKey({ role }: { role: 'candidate' | 'rekey' }) {
  const app = useApp();
  const site = app.site!;
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(role === 'rekey');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setMsg(undefined);
    setBusy(true);
    try {
      const secret = newSecret();
      let credId: string | undefined;
      let prfSupported = false;
      if (passkeysAvailable()) {
        const c = await createPasskey({ passkeyDomain: site.passkeyDomain, rpName: site.name, userName: passkeyName(name.trim()) });
        credId = c.credId;
        prfSupported = c.prfSupported;
      }
      const p: PendingFounder = {
        site: site.site, role, name: name.trim(), secret, pubkey: pubkeyOf(secret), credId, prfSupported,
        council: false, createdAt: Math.floor(Date.now() / 1000),
      };
      await store.setPending(p);
      setState({ pending: p });
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header sub={role === 'candidate' ? t('cand.title') : t('lost.title')} />
      <main>
        <h1>{role === 'candidate' ? t('cand.title') : t('lost.title')}</h1>
        <p class="lead">{role === 'candidate' ? t('cand.intro') : t('lost.intro')}</p>
        {app.pending?.role === 'founder' && <p class="warnbox">{t('fs.restartConfirm')}</p>}
        <label class="field">
          {role === 'candidate' ? t('fs.name') : t('lost.name')}
          <input type="text" value={name} maxLength={40} autoComplete="off" placeholder="@nina" onInput={e => setName((e.target as HTMLInputElement).value)} />
          {role === 'candidate' && <span class="small" style="font-weight:400">{t('fs.nameHint')}</span>}
        </label>
        {role === 'candidate' && (
          <label class="check"><input type="checkbox" checked={adult} onChange={e => setAdult((e.target as HTMLInputElement).checked)} />{t('fs.age', { age: site.rules.minimumAge })}</label>
        )}
        {!passkeysAvailable() && <p class="warnbox">{t('error.noPasskeys')}</p>}
        <button type="button" class="btn primary" disabled={!name.trim() || !adult || busy} onClick={create}>{t('fs.create')}</button>
        {msg && <p class="warnbox">{msg}</p>}
      </main>
    </>
  );
}
