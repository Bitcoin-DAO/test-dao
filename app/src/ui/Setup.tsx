// Prepare the founding (protocol 3.5): basics, council, founders, publish and approve.
import { periodText, ruleValue } from './Proposals';
import { useEffect, useState } from 'preact/hooks';
import { publishSigned, sync, useApp } from '../app';
import { fmtSats, t } from '../i18n';
import { buildGenesis, isPlaceholder, PRACTICE_VOTE_DAYS, isPracticeVotes, settleThreshold } from '../core/config';
import { buildDescriptor, parseKeyOrigin } from '../core/descriptor';
import { KIND, sign, template } from '../core/events';
import { parseFounderCode, type FounderCode } from '../core/identity';
import { formatShortCode, shortCode } from '../core/shortcode';
import { hashJson, sha256Hex } from '../core/util';
import { store, type SetupState } from '../lib/store';
import { Header, ScanModal, ShortCode, errText, go } from './parts';
import { GenesisSummary } from './Founder';
import charterText from '@charter?raw';
import { cadenceOf } from '../core/time';

type Tab = 1 | 2 | 3 | 4;


export function Setup() {
  const app = useApp();
  const site = app.site!;
  const me = app.pending;
  const [s, setS] = useState<SetupState>();
  const [tab, setTab] = useState<Tab>(1);
  const [scan, setScan] = useState<'council' | 'founder'>();
  const [confirming, setConfirming] = useState<FounderCode>();
  const [remote, setRemote] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    store.getSetup(site.site).then(saved => {
      if (saved) return setS(settleThreshold(saved));
      const myKey = me?.hwKey ?? me?.treasury;
      if (!me?.council || !myKey) return;
      setS(settleThreshold({
        site: site.site,
        name: site.name,
        description: site.description,
        council: [{ name: me.name, key: me.pubkey, fingerprint: myKey.fingerprint, xpub: myKey.xpub, ...(me.hwKey ? { device: 'seedsigner' as const } : {}) }],
        founders: [],
        threshold: site.threshold,
      }));
    });
  }, [me?.pubkey]);

  useEffect(() => {
    if (!s?.genesisId || app.daoId) return;
    const id = setInterval(() => void sync(), 8000);
    return () => clearInterval(id);
  }, [s?.genesisId, app.daoId]);

  const save = (raw: SetupState) => {
    const next = settleThreshold(raw);
    setS(next);
    void store.setSetup(next);
  };

  if (app.daoId && !s?.genesisId) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('setup.alreadyFounded', { dao: site.name })}</p></main>
      </>
    );
  }
  if (!me?.council || !s) {
    return (
      <>
        <Header />
        <main>
          <p class="lead">{t('setup.notCouncil')}</p>
          <button type="button" class="btn primary" onClick={() => go('/founder')}>{t('join.founderSignup')}</button>
        </main>
      </>
    );
  }

  const locked = !!s.genesisId;
  const allKeys = new Set([...s.council.map(c => c.key), ...s.founders.map(f => f.key)]);

  const onScanned = (code: FounderCode) => {
    setScan(undefined);
    setMsg(undefined);
    if (allKeys.has(code.key)) return setMsg(t('scan.duplicate'));
    if (scan === 'council' && !code.council) return setMsg(t('scan.notCouncilCode'));
    // One SeedSigner may load several cards, but one card must not give two council seats.
    if (scan === 'council' && s.council.some(c => c.fingerprint === code.council!.fingerprint || c.xpub === code.council!.xpub)) return setMsg(t('setup.dupTreasuryKey', { fp: code.council!.fingerprint }));
    if (scan === 'council' && site.network === 'mainnet' && code.council!.device !== 'seedsigner') return setMsg(t('setup.mainnetDevice'));
    setRemote(false);
    setConfirming({ ...code, ...(scan === 'founder' ? { council: undefined } : {}) });
  };

  const accept = () => {
    const c = confirming!;
    setConfirming(undefined);
    if (c.council) save({ ...s, council: [...s.council, { name: c.name, key: c.key, fingerprint: c.council.fingerprint, xpub: c.council.xpub, ...(c.council.device ? { device: c.council.device } : {}) }] });
    else save({ ...s, founders: [...s.founders, { name: c.name, key: c.key, verified: remote ? 'remote' : 'in_person' }] });
  };

  const charterSha256 = sha256Hex(charterText);
  const liveDays = isPracticeVotes(site.rules.votingPeriodDays) ? 3 : site.rules.votingPeriodDays;
  const votingDays = s.votingPeriodDays ?? site.rules.votingPeriodDays;
  let genesis: ReturnType<typeof buildGenesis> | undefined;
  let buildErr: string | undefined;
  try {
    if (s.council.length >= Math.max(2, s.threshold)) {
      genesis = buildGenesis(site, {
        name: s.name.trim(),
        description: s.description.trim(),
        council: s.council.map(c => ({ label: c.name, identityKey: c.key, fingerprint: c.fingerprint, xpub: c.xpub, ...(c.device ? { device: c.device } : {}) })),
        founders: s.founders.map(f => ({ name: f.name, identityKey: f.key, verified: f.verified })),
        threshold: s.threshold,
        descriptor: buildDescriptor(s.threshold, s.council, site.network),
        charterSha256,
        votingPeriodDays: s.votingPeriodDays,
      });
    }
  } catch (e) {
    buildErr = errText(e);
  }
  const daoId = s.genesisJson ? hashJson(JSON.parse(s.genesisJson)) : genesis ? hashJson(genesis) : undefined;

  const publishGenesis = async () => {
    if (!genesis || !daoId) return;
    setMsg(undefined);
    if (!s.council.some(c => c.key === me.pubkey)) return setMsg(t('setup.youMustBeCouncil'));
    setBusy(true);
    try {
      const g = sign(template(KIND.genesis, daoId, genesis), me.secret);
      await publishSigned(g);
      const e = sign(template(KIND.endorse, daoId, { object: 'genesis', hash: daoId }, [['e', g.id]]), me.secret);
      await publishSigned(e);
      save({ ...s, genesisId: g.id, daoId, genesisJson: g.content });
      await sync();
    } catch (err) {
      setMsg(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const candidate = app.dao?.founded?.event.id === s.genesisId ? app.dao?.founded : app.dao?.pending.find(g => g.event.id === s.genesisId);

  const tabs = (
    <nav class="tabs">
      {([1, 2, 3, 4] as Tab[]).map(n => (
        <button type="button" class={tab === n ? 'on' : ''} onClick={() => setTab(n)}>{t(`setup.tab${n}` as 'setup.tab1')}</button>
      ))}
    </nav>
  );

  return (
    <>
      <Header sub={t('setup.subtitle', { name: me.name })} tabs={tabs} />
      <main>
        {tab === 1 && (
          <>
            <h1>{t('setup.basics')}</h1>
            <label class="field">{t('setup.daoName')}<input type="text" disabled={locked} value={s.name} onInput={e => save({ ...s, name: (e.target as HTMLInputElement).value })} /></label>
            <label class="field">{t('setup.purpose')}<input type="text" disabled={locked} value={s.description} onInput={e => save({ ...s, description: (e.target as HTMLInputElement).value })} /></label>
            <div class="card">
              <h3>{t('setup.addrNet')}</h3>
              <div class="kv"><span>{t('setup.address')}</span><span class="mono">{site.site.replace(/^https:\/\//, '')}</span></div>
              <div class="kv"><span>{t('setup.passkeyDomain')}</span><span class="mono">{site.passkeyDomain}</span></div>
              <div class="kv"><span>{t('setup.network')}</span><span>{site.network === 'mainnet' ? 'mainnet' : t('setup.networkTrial')}</span></div>
              <p class="warn">{t('setup.domainWarn')}</p>
            </div>
            <div class="card">
              <h3>{t('setup.rules')}</h3>
              {site.network !== 'mainnet' && !locked ? (
                // Testnet DAOs choose: practice (10-minute votes, to rehearse everything in a sitting) or live. Changed later by a rule-change vote.
                <fieldset class="stack" style="border:0;padding:0;margin:0;gap:6px">
                  <legend class="small" style="margin-bottom:4px">{t('setup.voting')}</legend>
                  <label class="check"><input type="radio" name="votes" checked={isPracticeVotes(votingDays)} onChange={() => save({ ...s, votingPeriodDays: PRACTICE_VOTE_DAYS })} />{t('setup.votesPractice')}</label>
                  <label class="check"><input type="radio" name="votes" checked={!isPracticeVotes(votingDays)} onChange={() => save({ ...s, votingPeriodDays: liveDays })} />{t('setup.votesLive', { period: periodText(liveDays) })}</label>
                  <span class="small">{t('setup.votesLater')}</span>
                </fieldset>
              ) : (
                <div class="kv"><span>{t('setup.voting')}</span><span>{periodText(votingDays)}</span></div>
              )}
              <div class="kv"><span>{t('setup.quorum')}</span><span>{t('setup.quorumVal', { q: site.rules.quorum })}</span></div>
              <div class="kv"><span>{t('setup.payouts')}</span><span>{cadenceOf(site.rules.payoutRound) === 'weekly' ? t('setup.weekly') : t('setup.monthly')}</span></div>
              <div class="kv"><span>{t('setup.maxFee')}</span><span>{site.rules.maxFeeRateSatVb} sat/vB</span></div>
          <div class="kv"><span>{t('fee.label')}</span><span>{ruleValue('feePolicy', site.rules.feePolicy)}</span></div>
              <div class="kv"><span>{t('setup.cap')}</span><span>{fmtSats(site.rules.treasuryCapSats)} sats</span></div>
              <div class="kv"><span>{t('setup.charter')}</span><span class="mono">{charterSha256.slice(0, 8)} …</span></div>
            </div>
            <button type="button" class="btn primary" onClick={() => setTab(2)}>{t('setup.nextCouncil')}</button>
          </>
        )}

        {tab === 2 && (
          <>
            <h1>{t('setup.council')}</h1>
            <p class="lead">{t('setup.councilIntro')}</p>
            <div class="row">
              <span>{t('setup.threshold')}</span>
              <span class="row" style="gap:8px">
                <button type="button" class="btn-head" style="color:var(--ink);border-color:var(--field)" disabled={locked || s.threshold <= 1} onClick={() => save({ ...s, threshold: s.threshold - 1, thresholdSet: true })}>−</button>
                <strong>{t('setup.of', { m: s.threshold, n: s.council.length })}</strong>
                <button type="button" class="btn-head" style="color:var(--ink);border-color:var(--field)" disabled={locked || s.threshold >= s.council.length} onClick={() => save({ ...s, threshold: s.threshold + 1, thresholdSet: true })}>+</button>
              </span>
            </div>
            {s.council.length > 0 && s.threshold >= s.council.length && <p class="warnbox">{t('setup.noSpare', { n: s.council.length })}</p>}
            <div class="card list">
              {new Set(s.council.map(c => c.device ?? 'phone')).size > 1 && <p class="warnbox">{t('setup.mixedKeys')}</p>}
              {s.council.map((c, i) => (
                <CouncilRow
                  c={c}
                  locked={locked}
                  isMe={c.key === me.pubkey}
                  onRemove={() => save({ ...s, council: s.council.filter((_, j) => j !== i) })}
                  onReplace={(fingerprint, xpub) => save({ ...s, council: s.council.map((x, j) => (j === i ? { ...x, fingerprint, xpub } : x)) })}
                />
              ))}
            </div>
            <p class="small">{t('setup.councilSize', { n: s.council.length })}</p>
            {!locked && <button type="button" class="btn secondary" onClick={() => setScan('council')}>{t('setup.scanCouncil')}</button>}
            <button type="button" class="btn primary" onClick={() => setTab(3)}>{t('setup.nextFounders')}</button>
          </>
        )}

        {tab === 3 && (
          <>
            <h1>{t('setup.founders')}</h1>
            <p class="lead">{t('setup.foundersIntro')}</p>
            {!locked && <button type="button" class="btn secondary" onClick={() => setScan('founder')}>{t('setup.scanFounder')}</button>}
            {s.founders.length > 0 && (
              <div class="card list">
                {s.founders.map((f, i) => (
                  <div class="row">
                    <div class="stack" style="gap:2px">
                      <strong>{f.name}</strong>
                      <span class="mono small">{formatShortCode(shortCode(f.key))}</span>
                    </div>
                    <span class="row" style="gap:8px">
                      <span class="ok" style="font-size:14px">{f.verified === 'remote' ? t('setup.remote') : t('setup.inPerson')}</span>
                      {!locked && <button type="button" class="btn link" style="min-height:32px;font-size:13px" onClick={() => save({ ...s, founders: s.founders.filter((_, j) => j !== i) })}>{t('setup.remove')}</button>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p class="small">{t('setup.councilAreFounders')}</p>
            <button type="button" class="btn primary" onClick={() => setTab(4)}>{t('setup.nextPublish')}</button>
          </>
        )}

        {tab === 4 && (
          <>
            <h1>{t('setup.publish')}</h1>
            {buildErr && <p class="warnbox">{buildErr}</p>}
            {!genesis && !locked && <p class="warnbox">{t('setup.councilNeed', { n: Math.max(2, s.threshold), missing: Math.max(2, s.threshold) - s.council.length })}</p>}
            {candidate ? (
              <div class="card"><h3>{t('setup.summary')}</h3><GenesisSummary g={candidate} /></div>
            ) : (
              genesis && daoId && (
                <div class="card">
                  <h3>{t('setup.summary')}</h3>
                  <GenesisSummary g={{ event: undefined as never, config: genesis, daoId, endorsers: [] }} />
                </div>
              )
            )}
            {!locked ? (
              <>
                <p class="small">{t('setup.publishNote')}</p>
                <button type="button" class="btn primary" disabled={!genesis || busy || isPlaceholder(s.name)} onClick={publishGenesis}>{t('setup.signPublish')}</button>
              </>
            ) : app.daoId === s.daoId ? (
              <div class="card">
                <h3>{t('setup.founded', { dao: s.name })}</h3>
                <p class="small">{t('setup.foundedText', { n: (app.dao?.members.length ?? 0) })}</p>
                <p class="small">{t('setup.foundedNext')}</p>
                <p class="mono" style="font-size:13px;overflow-wrap:anywhere">daoId: {s.daoId}</p>
                <button type="button" class="btn secondary" onClick={() => go('/founder')}>{t('fs.protect')} →</button>
              </div>
            ) : (
              <div class="card">
                <p class="ok">{t('setup.published')}</p>
                <strong>{t('setup.endorsements', { n: candidate?.endorsers.length ?? 1, m: s.threshold })}</strong>
                {candidate && (() => {
                  // Who has approved, and who is still to: the founders can see where the founding stands.
                  const by = new Set(candidate.endorsers.map(e => e.key));
                  const done = candidate.config.council.filter(c => by.has(c.identityKey)).map(c => c.label);
                  const todo = candidate.config.council.filter(c => !by.has(c.identityKey)).map(c => c.label);
                  return (
                    <>
                      {done.length > 0 && <p class="small">{t('setup.approvedBy', { names: done.join(', ') })}</p>}
                      {todo.length > 0 && <p class="small">{t('setup.notYetBy', { names: todo.join(', ') })}</p>}
                    </>
                  );
                })()}
                <p class="small">{t('setup.endorseHow', { dao: s.name })}</p>
                <p class="small">{t('setup.whatNext', { m: s.threshold })}</p>
              </div>
            )}
            {msg && <p class="warnbox">{msg}</p>}
          </>
        )}
        {msg && tab !== 4 && <p class="warnbox">{msg}</p>}
      </main>

      {scan && (
        <ScanModal
          title={scan === 'council' ? t('setup.scanCouncil') : t('setup.scanFounder')}
          parse={parseFounderCode}
          onResult={onScanned}
          onCancel={() => setScan(undefined)}
        />
      )}
      {confirming && (
        <div class="scanner" role="dialog" aria-modal="true">
          <h2>{t('scan.confirmTitle')}</h2>
          <p>{t('scan.confirmText', { name: confirming.name })}</p>
          <div class="card" style="color:var(--ink)"><strong>{confirming.name}</strong><ShortCode pubkey={confirming.key} /></div>
          {!confirming.council && (
            <label class="check"><input type="checkbox" checked={remote} onChange={e => setRemote((e.target as HTMLInputElement).checked)} />{t('scan.remote')}</label>
          )}
          <button type="button" class="btn primary" onClick={accept}>{t('scan.match')}</button>
          <button type="button" class="btn secondary" onClick={() => setConfirming(undefined)}>{t('scan.noMatch')}</button>
        </div>
      )}
    </>
  );
}

function CouncilRow(props: {
  c: { name: string; key: string; fingerprint: string; xpub: string; device?: 'seedsigner' };
  locked: boolean;
  isMe: boolean;
  onRemove: () => void;
  onReplace: (fingerprint: string, xpub: string) => void;
}) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const { c } = props;
  return (
    <div class="stack" style="gap:6px">
      <div class="row">
        <strong>{c.name}</strong>
        {!props.locked && !props.isMe && <button type="button" class="btn link" style="min-height:32px;font-size:13px" onClick={props.onRemove}>{t('setup.remove')}</button>}
      </div>
      <div class="kv small"><span>{t('setup.identity')}</span><span class="mono">{formatShortCode(shortCode(c.key))} ✓</span></div>
      <div class="kv small"><span>{t('setup.treasury')}</span><span><span class="mono">{c.fingerprint} ✓</span> <span class="chip">{c.device === 'seedsigner' ? t('setup.onDevice') : t('setup.onPhone')}</span></span></div>
      {!props.locked && (editing ? (
        <div class="stack" style="gap:6px">
          <span class="small">{t('setup.replaceTreasuryHint')}</span>
          <textarea value={text} onInput={e => (setText((e.target as HTMLTextAreaElement).value), setBad(false))} />
          {bad && <p class="error">{t('scan.invalid')}</p>}
          <button
            type="button"
            class="btn dark"
            onClick={() => {
              try {
                const k = parseKeyOrigin(text, app.site!.network);
                props.onReplace(k.fingerprint, k.xpub);
                setEditing(false);
              } catch {
                setBad(true);
              }
            }}
          >
            {t('scan.use')}
          </button>
        </div>
      ) : (
        <button type="button" class="btn link" style="min-height:32px;font-size:13px;align-self:flex-start" onClick={() => setEditing(true)}>{t('setup.replaceTreasury')}</button>
      ))}
    </div>
  );
}
