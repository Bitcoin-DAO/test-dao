import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { completeFounding, setLang, useApp } from '../app';
import { newCount } from './Discussion';
import { t } from '../i18n';
import { qrMatrix, startScanner, type Scanner } from '../lib/qr';
import { rpId } from '../lib/passkey';
import { isPracticeVotes, stageOf } from '../core/config';
import { cardPayload } from '../core/identity';
import { shortCode, formatShortCode } from '../core/shortcode';
import { fmtDate } from '../i18n';

export const go = (path: string) => {
  location.hash = '#' + path;
  window.scrollTo(0, 0);
};

export function errText(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if ((e as Error)?.name === 'NotAllowedError' || msg === 'passkey-cancelled') return t('error.cancelled');
  if (msg === 'hw-net-mainnet' || msg === 'hw-net-testnet' || msg === 'hw-path') return t(`error.${msg}` as 'error.hw-path');
  return t('error.generic', { msg });
}

export function Header(props: { sub?: string; tabs?: ComponentChildren }) {
  const app = useApp();
  const site = app.site;
  const signedIn = !!app.secret && !!app.me;
  const dev = site && !rpId(site.passkeyDomain).matches;
  // A testnet DAO in practice mode: its votes, as the rules stand now (or as the site file proposes before founding).
  const settings = app.dao?.settings;
  const votingDays = settings?.length ? settings[settings.length - 1].content.rules.votingPeriodDays : site?.rules.votingPeriodDays;
  const practiceVotes = votingDays !== undefined && isPracticeVotes(votingDays);
  return (
    <>
      <header class="top">
        <a href="#/" style="display:flex;flex-direction:column">
          <span class="name">{site?.name ?? 'btc-dao'}</span>
          <span class="sub">{props.sub ?? t('tagline')}</span>
        </a>
        <div class="actions">
          <button type="button" class="btn-head" aria-label={t('lang.switch')} onClick={() => setLang(app.lang === 'it' ? 'en' : 'it')}>
            {app.lang === 'it' ? 'IT · EN' : 'EN · IT'}
          </button>
          {app.daoId && (signedIn ? (
            <button type="button" class="btn-head solid" onClick={() => go('/profile')}>{app.me!.name}</button>
          ) : (
            <button type="button" class="btn-head solid" onClick={() => go('/join')}>{t('nav.signin')}</button>
          ))}
        </div>
      </header>
      {site && stageOf(site) === 'practice' && <div class="banner"><strong>{t('banner.practice')}</strong> {t('banner.practiceText')}</div>}
      {site && stageOf(site) === 'testnet' && (practiceVotes ? (
        <div class="banner"><strong>{t('banner.practiceMode')}</strong> {t('banner.practiceModeText')}</div>
      ) : (
        <div class="banner">{t('banner.trial')}</div>
      ))}
      {app.dao?.closed && (
        <div class="closedbar"><strong>{t('closed.title', { dao: site!.name })}</strong> {t('closed.text')}</div>
      )}
      {app.dao?.conflict && <div class="banner">{t('banner.conflict')}</div>}
      {dev && <div class="banner">{t('banner.devPasskey', { host: location.hostname, domain: site!.passkeyDomain })}</div>}
      {props.tabs}
    </>
  );
}

export function Footer() {
  const app = useApp();
  if (!app.daoId) return null;
  const s = app.dao;
  const unread = s ? s.discussion.threads.filter(th => newCount(th, app.daoId!, app.me?.person, s.personOf) > 0).length : 0;
  return (
    <nav class="footer">
      <a href="#/">{t('nav.home')}</a>
      <a href="#/proposals">{t('nav.proposals')}</a>
      <a href="#/discussion">{t('nav.discussion')}{unread > 0 && <span class="dot" aria-label={t('ds.unread', { n: unread })} />}</a>
      <a href="#/members">{t('nav.members')}</a>
      <a href="#/rules">{t('nav.rules')}</a>
      {app.isCouncil && app.secret && <a href="#/council">{t('nav.council')}</a>}
    </nav>
  );
}

export function Qr(props: { text: string; size?: number; label?: string; ecc?: 'L' | 'M' }) {
  const m = qrMatrix(props.text, props.ecc);
  const q = 4; // quiet zone
  return (
    <svg class="qr" role="img" aria-label={props.label} width={props.size ?? 240} height={props.size ?? 240} viewBox={`${-q} ${-q} ${m.size + 2 * q} ${m.size + 2 * q}`} shape-rendering="crispEdges">
      <rect x={-q} y={-q} width={m.size + 2 * q} height={m.size + 2 * q} fill="#fff" />
      <path d={m.path} fill="#000" />
    </svg>
  );
}

/** As SeedSigner shows it: first and last 7 characters highlighted. */
export function Address({ value }: { value: string }) {
  return (
    <span class="addr">
      <b>{value.slice(0, 7)}</b> {value.slice(7, -7)} <b>{value.slice(-7)}</b>
    </span>
  );
}

export function Steps({ n }: { n: number }) {
  return (
    <div class="stack" style="gap:8px">
      <span class="small">{t('fs.step', { n })}</span>
      <div class="steps" aria-hidden="true">
        {[1, 2, 3, 4].map(i => <span class={i <= n ? 'on' : ''} />)}
      </div>
    </div>
  );
}

export function ShortCode({ pubkey }: { pubkey: string }) {
  return <div class="code">{formatShortCode(shortCode(pubkey))}</div>;
}

/** Camera scanner with a paste fallback. `parse` returns undefined to keep scanning. */
export function ScanModal<T>(props: { parse: (text: string) => T | undefined; onResult: (v: T) => void; onCancel: () => void; title?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [noCamera, setNoCamera] = useState(false);
  const [pasted, setPasted] = useState('');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let s: Scanner | undefined;
    let done = false;
    startScanner(video.current!, text => {
      if (done) return;
      const v = props.parse(text);
      if (v !== undefined) {
        done = true;
        s?.stop();
        props.onResult(v);
      }
    })
      .then(x => {
        s = x;
        if (done) x.stop();
      })
      .catch(() => setNoCamera(true));
    return () => {
      done = true;
      s?.stop();
    };
  }, []);
  const usePaste = () => {
    const v = props.parse(pasted);
    if (v === undefined) setBad(true);
    else props.onResult(v);
  };
  return (
    <div class="scanner" role="dialog" aria-modal="true">
      <h2>{props.title ?? t('scan.title')}</h2>
      {!noCamera ? <video ref={video} muted playsInline /> : <p>{t('scan.noCamera')}</p>}
      <p class="small" style="color:var(--head-sub)">{t('scan.hint')}</p>
      <label class="field">
        {t('scan.paste')}
        <textarea value={pasted} onInput={e => (setPasted((e.target as HTMLTextAreaElement).value), setBad(false))} />
      </label>
      {bad && <p class="warnbox">{t('scan.invalid')}</p>}
      <button type="button" class="btn primary" disabled={!pasted.trim()} onClick={usePaste}>{t('scan.use')}</button>
      <button type="button" class="btn secondary" onClick={props.onCancel}>{t('scan.cancel')}</button>
    </div>
  );
}

/** The printable identity card (protocol 1.7). Rendered off screen; shown only when printing. */
export function IdentityCardPrint(props: { daoId: string; secret: string; name: string; pubkey: string; council: boolean }) {
  const app = useApp();
  const host = new URL(app.site!.site).host;
  return (
    <div class="print-only">
      <div class="idcard">
        <Qr text={cardPayload(props.daoId, props.secret)} size={113} />
        <div class="txt">
          <span class="dao">{app.site!.name}</span>
          <span>{t('card.heading')}{props.council ? ` · ${t('card.councilBadge')}` : ''}</span>
          <span class="nm">{props.name}</span>
          <span class="sc">{formatShortCode(shortCode(props.pubkey))}</span>
          <span class="fine">{t('card.printed', { date: fmtDate(Math.floor(Date.now() / 1000)) })}</span>
          <span class="fine">{t('card.secret')}</span>
          <span class="fine">{t('card.fallback', { host })}</span>
        </div>
      </div>
    </div>
  );
}

export function PrintCard(props: { council: boolean }) {
  const app = useApp();
  if (!app.secret || !app.daoId || !app.me) return null;
  return (
    <div class="card">
      <h3>{t('card.title')}</h3>
      <p class="lead">{t('card.text')}</p>
      {props.council && <p class="warn">{t('card.council')}</p>}
      <button type="button" class="btn primary" onClick={() => window.print()}>{t('card.print')}</button>
      <p class="small">{t('card.printNote')}</p>
      <IdentityCardPrint daoId={app.daoId} secret={app.secret} name={app.me.name} pubkey={app.me.key} council={app.me.council} />
    </div>
  );
}

/** The app's own confirmation and question dialogs, in its language (the browser's name the site and look foreign). */
function dialog<T>(body: (done: (v: T) => void) => ComponentChildren): Promise<T> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const done = (v: T) => {
      render(null, host);
      host.remove();
      resolve(v);
    };
    render(<div class="dialog-back"><div class="dialog card" role="dialog" aria-modal="true">{body(done)}</div></div>, host);
  });
}

export function askConfirm(text: string, yes = t('dlg.ok'), danger = false): Promise<boolean> {
  return dialog<boolean>(done => (
    <>
      <p>{text}</p>
      <button type="button" class={danger ? 'btn danger' : 'btn primary'} onClick={() => done(true)}>{yes}</button>
      <button type="button" class="btn secondary" onClick={() => done(false)}>{t('dlg.cancel')}</button>
    </>
  ));
}

export function askText(text: string): Promise<string | null> {
  let value = '';
  return dialog<string | null>(done => (
    <>
      <label class="field">{text}<textarea onInput={e => (value = (e.target as HTMLTextAreaElement).value)} /></label>
      <button type="button" class="btn primary" onClick={() => done(value.trim() || null)}>{t('dlg.ok')}</button>
      <button type="button" class="btn secondary" onClick={() => done(null)}>{t('dlg.cancel')}</button>
    </>
  ));
}

/** A council page opened by someone else: say so, and if they are signed out, offer the ways back in. */
export function CouncilOnly() {
  const app = useApp();
  return (
    <>
      <Header />
      <main>
        <p class="lead">{t('cn.notCouncil')}</p>
        {!app.secret && (
          <>
            <button type="button" class="btn primary" onClick={() => go('/join')}>{t('nav.signin')}</button>
            <button type="button" class="btn link" onClick={() => go('/restore')}>{t('join.restore')}</button>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

/**
 * The last step of a sign-up, key replacement or founding: protect the key with the passkey made at sign-up.
 * If that passkey cannot be used (the phone says it has none: deleted, or saved to another account), the key
 * is still on this phone, so it can be protected with a new passkey instead.
 */
export function ProtectKey() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [failed, setFailed] = useState(false);
  const run = async (fresh: boolean) => {
    setErr(undefined);
    setBusy(true);
    try {
      await completeFounding(fresh);
    } catch (e) {
      setErr(errText(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p class="lead">{t('fs.protectText')}</p>
      <button type="button" class="btn primary" disabled={busy} onClick={() => run(false)}>{t('fs.protect')}</button>
      {err && <p class="warnbox">{err}</p>}
      {failed && (
        <div class="card">
          <p class="small">{t('fs.noPasskey')}</p>
          <button type="button" class="btn secondary" disabled={busy} onClick={() => run(true)}>{t('fs.newPasskey')}</button>
        </div>
      )}
    </>
  );
}

/** Three different word positions (1–12), in order, so the check asks for words from the whole list. */
export function checkPositions(rand: () => number = Math.random): number[] {
  const picks = new Set<number>();
  while (picks.size < 3) picks.add(1 + Math.floor(rand() * 12));
  return [...picks].sort((a, b) => a - b);
}

/**
 * Trial stages: the council member writes down the treasury key's 12 words and types three of them back.
 * The words are the only copy of the key outside the phone; the identity card does not carry it
 * (UNO DAO, 9 Nov 2026: a council member's key was lost with the phone's data).
 */
export function WordsCheck({ mnemonic, onDone }: { mnemonic: string; onDone: () => Promise<void> | void }) {
  const words = mnemonic.split(' ');
  const [stage, setStage] = useState<'show' | 'check'>('show');
  const [asked] = useState(() => checkPositions());
  const [typed, setTyped] = useState<string[]>(['', '', '']);
  const [err, setErr] = useState(false);
  const check = async () => {
    const ok = asked.every((pos, i) => typed[i].trim().toLowerCase() === words[pos - 1]);
    setErr(!ok);
    if (ok) await onDone();
  };
  return (
    <div class="card">
      <h3>{t('words.title')}</h3>
      <p class="warn">{t('words.why')}</p>
      {stage === 'show' ? (
        <>
          <ol class="words">{words.map(w => <li class="mono">{w}</li>)}</ol>
          <p class="small">{t('words.how')}</p>
          <button type="button" class="btn primary" onClick={() => setStage('check')}>{t('words.written')}</button>
        </>
      ) : (
        <>
          <p class="small">{t('words.checkText')}</p>
          {asked.map((pos, i) => (
            <label class="field">
              {t('words.word', { n: pos })}
              <input type="text" class="mono" autoComplete="off" spellcheck={false} autoCapitalize="none" value={typed[i]}
                onInput={e => setTyped(typed.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))} />
            </label>
          ))}
          {err && <p class="error">{t('words.wrong')}</p>}
          <button type="button" class="btn primary" disabled={typed.some(x => !x.trim())} onClick={check}>{t('words.check')}</button>
          <button type="button" class="btn link" onClick={() => { setStage('show'); setErr(false); }}>{t('words.showAgain')}</button>
        </>
      )}
    </div>
  );
}
