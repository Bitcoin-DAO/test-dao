// SeedSigner exchange: animated QR display and scanning (docs/seedsigner.md), and the QR test page.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../app';
import { t } from '../i18n';
import { startScanner, type Scanner } from '../lib/qr';
import { UrDecoder, type UrEncoder } from '../core/ur';
import { deviceDescriptor, mergeSignatures, psbtEncoder, readKeyExport, readPsbt, type HwKey } from '../core/hwkeys';
import type { Network } from '../core/config';
import { buildDescriptor, parseDescriptor, treasuryAddress } from '../core/descriptor';
import { buildRound, inspectRound, memberSignatures } from '../core/round';
import { sha256Hex } from '../core/util';
import { Address, Footer, Header, Qr, errText } from './parts';

/** An animated QR: shows the encoder's parts one after another, for as long as it is on screen. */
export function AnimatedQr({ encoder, fps = 4, size = 320 }: { encoder: () => UrEncoder; fps?: number; size?: number }) {
  const enc = useMemo(encoder, [encoder]);
  const [part, setPart] = useState(() => enc.nextPart());
  useEffect(() => {
    if (enc.single) return;
    const id = setInterval(() => setPart(enc.nextPart()), Math.round(1000 / fps));
    return () => clearInterval(id);
  }, [enc, fps]);
  return (
    <div class="stack" style={`align-items:center;gap:6px;width:100%;max-width:${size}px;align-self:center`}>
      <Qr text={part} size={size} ecc="L" label={t('hw.animatedQr')} />
      {!enc.single && <span class="small mono">{part.match(/\/(\d+-\d+)\//)?.[1]}</span>}
    </div>
  );
}

export type Scanned = { type: string; cbor: Uint8Array } | { text: string };

/**
 * Scan an animated (UR) or plain QR from a SeedSigner. Parts may arrive in any order; progress is shown.
 * Pasting the parts (one per line) or plain text works where there is no camera.
 */
export function UrScanModal(props: { title: string; onResult: (v: Scanned) => void; onCancel: () => void; plainOk?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [noCamera, setNoCamera] = useState(false);
  const [progress, setProgress] = useState<{ received: number; needed: number }>();
  const [pasted, setPasted] = useState('');
  const [bad, setBad] = useState<string>();
  const dec = useMemo(() => new UrDecoder(), []);
  const finish = (v: Scanned) => props.onResult(v);
  useEffect(() => {
    let s: Scanner | undefined;
    let done = false;
    const onText = (text: string) => {
      if (done) return;
      if (dec.receive(text)) {
        setProgress(dec.progress);
        if (dec.result) {
          done = true;
          s?.stop();
          finish({ type: dec.type!, cbor: dec.result });
        }
      } else if (props.plainOk && !/^ur:/i.test(text.trim())) {
        done = true;
        s?.stop();
        finish({ text: text.trim() });
      }
    };
    startScanner(video.current!, onText, 80)
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
    const lines = pasted.split(/\s+/).filter(Boolean);
    if (lines.some(l => /^ur:/i.test(l))) {
      for (const l of lines) dec.receive(l);
      setProgress(dec.progress);
      if (dec.result) return finish({ type: dec.type!, cbor: dec.result });
      return setBad(t('hw.needMore'));
    }
    if (props.plainOk && pasted.trim()) return finish({ text: pasted.trim() });
    setBad(t('scan.invalid'));
  };
  return (
    <div class="scanner" role="dialog" aria-modal="true">
      <h2>{props.title}</h2>
      {!noCamera ? <video ref={video} muted playsInline /> : <p>{t('scan.noCamera')}</p>}
      <p class="small" style="color:var(--head-sub)">{progress ? t('hw.progress', { n: progress.received, m: progress.needed }) : t('hw.scanHint')}</p>
      <label class="field">
        {t('hw.paste')}
        <textarea value={pasted} onInput={e => (setPasted((e.target as HTMLTextAreaElement).value), setBad(undefined))} />
      </label>
      {bad && <p class="warnbox">{bad}</p>}
      <button type="button" class="btn primary" disabled={!pasted.trim()} onClick={usePaste}>{t('scan.use')}</button>
      <button type="button" class="btn secondary" onClick={props.onCancel}>{t('scan.cancel')}</button>
    </div>
  );
}

// The three test SeedQR cards printed for TEST DAO (testnet4 only; docs/seedsigner.md).
const TEST_CARDS: HwKey[] = [
  { fingerprint: 'd3bdd580', xpub: 'tpubDFKVE4hAcCsmYyXX8mURCAE3smjoLhyqGH5CtJjgyhBBQR9VopPxmK24XsjmbG4XTvHoQo73WBRnC2aLuG5mbUPemuyvUBJUEeDMM5nyG8e', path: '48h/1h/0h/2h', network: 'testnet4' },
  { fingerprint: '49c2d730', xpub: 'tpubDFUxuLmA93bTzumuAt8nqakLsDcNXk5ZB2mwZv1SxwX7u6THfmvdqBRrrBdkmCeLfQPcs8Rx3kEYsAZFYvQjSeJ6V1Q6dMn7Z7TzJHswBXU', path: '48h/1h/0h/2h', network: 'testnet4' },
  { fingerprint: 'ec03225a', xpub: 'tpubDFCfvs2SLPX7J8JKkpaRQ6XKH2EksYsLNPAsucb9KDunGYemVrAm8VL4kNJ5Gm6icC3mBUinvirVXF5ZMatoCHuqmpAYKcmKUTLT7pMyXxE', path: '48h/1h/0h/2h', network: 'testnet4' },
];
const cardName = (fp: string) => ({ d3bdd580: 'A', '49c2d730': 'B', ec03225a: 'C' } as Record<string, string>)[fp];

/**
 * QR test page (#/qrtest): checks every exchange with a real SeedSigner before the app relies on it.
 * Nothing here is published or signed by the app; the test PSBT spends a coin that does not exist.
 */
export function QrTest() {
  const app = useApp();
  const network = app.site!.network;
  const [keys, setKeys] = useState<HwKey[]>([]);
  const [scan, setScan] = useState<'key' | 'psbt'>();
  const [msg, setMsg] = useState<string>();
  const [fps, setFps] = useState(4);
  const [frag, setFrag] = useState(100);
  const [descForm, setDescForm] = useState<'multipath' | 'receive'>('multipath');
  const [signed, setSigned] = useState<{ names: string[]; errors: string[] }>();

  const descriptor = keys.length >= 2 ? buildDescriptor(2, keys.slice(0, 3), network) : undefined;
  const shownDescriptor = descriptor && descForm === 'receive' ? receiveOnly(descriptor) : descriptor;
  const test = useMemo(() => {
    if (!descriptor) return undefined;
    const d = parseDescriptor(descriptor, network);
    const coin = treasuryAddress(d, network, 0, 0);
    const payTo = treasuryAddress(parseDescriptor(buildDescriptor(1, [TEST_CARDS[0]], network), network), network, 0, 7).address; // any address outside this wallet
    const built = buildRound({
      d, network, feeRate: 2, changeIndex: 0,
      utxos: [{ txid: sha256Hex(new TextEncoder().encode(descriptor)), vout: 0, value: 100_000, address: coin.address, branch: 0, index: 0 }],
      outputs: [{ address: payTo, amount_sat: 10_000 }],
    });
    (window as unknown as { __lastTestPsbt?: string }).__lastTestPsbt = built.psbt; // read by the end-to-end test
    return { d, psbt: built.psbt, payTo, change: built.change };
  }, [descriptor]);

  const onKey = (v: Scanned) => {
    setScan(undefined);
    setMsg(undefined);
    try {
      const k = readKeyExport('text' in v ? v.text : v, network);
      if (keys.some(x => x.fingerprint === k.fingerprint)) return setMsg(t('hw.dupKey', { fp: k.fingerprint }));
      setKeys([...keys, k]);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const onPsbt = (v: Scanned) => {
    setScan(undefined);
    setMsg(undefined);
    try {
      if ('text' in v) throw new Error(t('hw.notPsbt'));
      const psbt = mergeSignatures(test!.psbt, readPsbt(v));
      const ins = inspectRound(psbt, test!.d, network);
      const names = keys.filter(k => memberSignatures(psbt, test!.d, network, k, ins).size > 0).map(k => cardName(k.fingerprint) ?? k.fingerprint);
      setSigned({ names, errors: ins.errors });
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <>
      <Header sub={t('hw.testTitle')} />
      <main>
        <h1>{t('hw.testTitle')}</h1>
        <p class="small">{t('hw.testIntro')}</p>

        <section class="card">
          <h3>1 · {t('hw.step1')}</h3>
          <p class="small">{t('hw.step1Text')}</p>
          {keys.map(k => (
            <div class="kv"><span>{cardName(k.fingerprint) ? t('hw.card', { c: cardName(k.fingerprint) }) : t('hw.key')}</span><span class="mono">{k.fingerprint} · {k.path}</span></div>
          ))}
          {keys.length > 0 && <p class="small mono" style="overflow-wrap:anywhere">{keys[keys.length - 1].xpub}</p>}
          {keys.length < 3 && <button type="button" class="btn primary" onClick={() => setScan('key')}>{t('hw.scanKey')}</button>}
          {keys.length < 3 && network !== 'mainnet' && (
            <button type="button" class="btn link" onClick={() => setKeys([...keys, ...TEST_CARDS.filter(c => !keys.some(k => k.fingerprint === c.fingerprint))].slice(0, 3))}>{t('hw.useCards')}</button>
          )}
          {keys.length > 0 && <button type="button" class="btn link" onClick={() => (setKeys([]), setSigned(undefined))}>{t('hw.clear')}</button>}
        </section>

        {descriptor && (
          <section class="card">
            <h3>2 · {t('hw.step2')}</h3>
            <p class="small">{t('hw.step2Text')}</p>
            <div class="row" style="gap:8px;justify-content:flex-start">
              <button type="button" class={descForm === 'multipath' ? 'btn secondary' : 'btn link'} onClick={() => setDescForm('multipath')}>/&lt;0;1&gt;/*</button>
              <button type="button" class={descForm === 'receive' ? 'btn secondary' : 'btn link'} onClick={() => setDescForm('receive')}>/0/*</button>
            </div>
            <div style="align-self:center;width:100%;max-width:340px"><Qr text={shownDescriptor!} size={340} ecc="L" label={t('hw.step2')} /></div>
            <p class="small mono" style="overflow-wrap:anywhere">{shownDescriptor}</p>
          </section>
        )}

        {test && (
          <section class="card">
            <h3>3 · {t('hw.step3')}</h3>
            <p class="small">{t('hw.step3Text')}</p>
            <AnimatedQr key={`${fps}-${frag}`} encoder={useMemoEncoder(test.psbt, frag)} fps={fps} />
            <div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap">
              {[2, 4, 6].map(f => <button type="button" class={f === fps ? 'btn secondary' : 'btn link'} onClick={() => setFps(f)}>{t('hw.fps', { n: f })}</button>)}
              {[60, 100, 200].map(f => <button type="button" class={f === frag ? 'btn secondary' : 'btn link'} onClick={() => setFrag(f)}>{t('hw.frag', { n: f })}</button>)}
            </div>
            <p class="small">{t('hw.checkOnDevice')}</p>
            <span class="small">{t('hw.pays')}</span>
            <Address value={test.payTo} />
            <span class="small">{t('hw.payAmount')}</span>
          </section>
        )}

        {test && (
          <section class="card">
            <h3>4 · {t('hw.step4')}</h3>
            <p class="small">{t('hw.step4Text')}</p>
            <button type="button" class="btn primary" onClick={() => setScan('psbt')}>{t('hw.scanSigned')}</button>
            {signed && (signed.names.length ? <p class="ok">{t('hw.signedBy', { names: signed.names.join(', ') })}</p> : <p class="warnbox">{t('hw.noSig')}</p>)}
            {signed && signed.errors.length > 0 && <p class="warnbox">{signed.errors.join(' · ')}</p>}
          </section>
        )}

        {msg && <p class="warnbox">{msg}</p>}
      </main>
      {scan === 'key' && <UrScanModal title={t('hw.scanKey')} plainOk onResult={onKey} onCancel={() => setScan(undefined)} />}
      {scan === 'psbt' && <UrScanModal title={t('hw.scanSigned')} onResult={onPsbt} onCancel={() => setScan(undefined)} />}
      <Footer />
    </>
  );
}

const encoders = new Map<string, () => UrEncoder>();
/** One encoder factory per PSBT and fragment size, so the animation does not restart on every render. */
function useMemoEncoder(psbt: string, frag: number) {
  const k = `${psbt}:${frag}`;
  if (!encoders.has(k)) encoders.set(k, () => psbtEncoder(psbt, frag));
  return encoders.get(k)!;
}

const receiveOnly = deviceDescriptor;

/**
 * Signing a round with a SeedSigner (S7, S1): load the treasury wallet on the device, show the round's PSBT
 * as an animated QR, check the payments on the device, scan the signed PSBT back. Its signatures are put
 * back into the round's PSBT and checked against this member's key before they are published.
 */
export function SeedSignerSign(props: { psbt: string; descriptor: string; network: Network; fingerprint: string; onSigned: (psbtWithSigs: string) => Promise<void>; check: (psbt: string) => boolean }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const dd = deviceDescriptor(props.descriptor);
  const enc = useMemoEncoder(props.psbt, 100);
  const onResult = async (v: Scanned) => {
    setScan(false);
    setMsg(undefined);
    setBusy(true);
    try {
      if ('text' in v) throw new Error(t('hw.notPsbt'));
      let merged: string;
      try {
        merged = mergeSignatures(props.psbt, readPsbt(v));
      } catch {
        throw new Error(t('hw.notThisRound'));
      }
      if (!props.check(merged)) throw new Error(t('hw.notYourSig', { fp: props.fingerprint }));
      await props.onSigned(merged);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack" style="gap:12px">
      <p class="small">{t('hw.signIntro', { fp: props.fingerprint })}</p>
      <ol class="hwsteps">
        <li class={step === 1 ? 'on' : ''}>
          <strong>{t('hw.s1')}</strong>
          {step === 1 && (
            <>
              <p class="small">{t('hw.s1Text')}</p>
              <div style="align-self:center;width:100%;max-width:320px"><Qr text={dd} size={320} ecc="L" label={t('hw.s1')} /></div>
              <button type="button" class="btn secondary" onClick={() => setStep(2)}>{t('hw.s1Done')}</button>
            </>
          )}
        </li>
        <li class={step === 2 ? 'on' : ''}>
          <strong>{t('hw.s2')}</strong>
          {step === 2 && (
            <>
              <p class="small">{t('hw.s2Text')}</p>
              <AnimatedQr encoder={enc} fps={4} />
              <button type="button" class="btn secondary" onClick={() => setStep(3)}>{t('hw.s2Done')}</button>
              <button type="button" class="btn link" onClick={() => setStep(1)}>{t('hw.back')}</button>
            </>
          )}
        </li>
        <li class={step === 3 ? 'on' : ''}>
          <strong>{t('hw.s3')}</strong>
          {step === 3 && (
            <>
              <p class="small">{t('hw.s3Text')}</p>
              <button type="button" class="btn primary" disabled={busy} onClick={() => setScan(true)}>{t('hw.scanSigned')}</button>
              <button type="button" class="btn link" onClick={() => setStep(2)}>{t('hw.back')}</button>
            </>
          )}
        </li>
      </ol>
      {msg && <p class="warnbox">{msg}</p>}
      {scan && <UrScanModal title={t('hw.scanSigned')} onResult={onResult} onCancel={() => setScan(false)} />}
    </div>
  );
}
