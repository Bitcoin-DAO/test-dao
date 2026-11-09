// Treasury balance, donation address and movements from the chain (protocol 6.4, 8.6).
// Two kinds of source, listed in the config's chainApi: an Esplora API (mempool.space style, the default)
// and a Blockbook server, written "blockbook:<address>". The app asks in Esplora's terms; Blockbook's
// answers are translated, so the rest of the app never sees the difference.
import type { Network } from './config';
import { treasuryAddress, type ParsedDescriptor } from './descriptor';
import type { Utxo } from './round';

/**
 * Unused addresses to check past the last used one. The app only ever shows the first unused address
 * (donations) and takes change in order, so used addresses stay contiguous and a short gap is enough.
 * Each extra address is one more request to a public API that slows down bursts.
 */
const GAP = 5;

interface AddrStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
  fee: number;
}

export interface Movement {
  txid: string;
  net: number; // sats, + in, − out
  fee: number;
  confirmed: boolean;
  time?: number;
}

export interface TreasuryView {
  balance: number; // confirmed + unconfirmed
  unconfirmed: number;
  donationAddress: string;
  donationIndex: number;
  changeIndex: number; // lowest unused change address
  movements: Movement[];
  utxos: Utxo[];
  /** Which source answered, for "Read from the blockchain … via …". */
  source?: string;
}

export type Fetcher = (url: string) => Promise<unknown>;

const TIMEOUT_MS = 30_000;
/** A whole treasury reading gives up after this, so a throttled API cannot keep the page loading for many minutes. */
const READ_BUDGET_MS = 2 * 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One request, given up after TIMEOUT_MS so a stalled request cannot hang the page. */
const defaultFetch: Fetcher = async url => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let r: Response;
    try {
      r = await fetch(url, { signal: ctl.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // "Failed to fetch" covers both a server that is down and one that answers without letting web pages
      // read the answer (no CORS header, often on a "too many requests" page). An opaque request tells them apart.
      const reachable = await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(10_000) }).then(() => true, () => false);
      throw new Error(reachable ? 'answers, but does not let this site read it (CORS or too many requests)' : 'cannot be reached (Failed to fetch)');
    }
    if (!r.ok) throw new Error(r.status === 429 ? '429 too many requests' : `${r.status}`);
    lastUpstream = r.headers.get('X-Gateway-Source') ?? undefined; // a chain gateway names the service behind it
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
};

/** The service behind a chain gateway for the latest answer, when the source is a gateway. */
let lastUpstream: string | undefined;
/** The source that gave the latest successful answer, for "Read from the blockchain … via …". */
let lastAnswer: { api: string; upstream?: string } | undefined;

/** A short name for a source: its host, with the service behind it when the source is a chain gateway. */
export function sourceLabel(api: string, upstream?: string, all: string[] = []): string {
  const hostOf = (a: string) => explorerOf(a).replace(/^https?:\/\//, '').split('/')[0];
  const host = hostOf(api);
  if (upstream) return `${upstream} · ${host.split('.')[0]}`;
  // Two entries on one host (a chain gateway's Blockbook and Esplora paths): say which.
  const shared = all.some(a => a !== api && hostOf(a) === host);
  return shared ? `${host} (${sourceOf(api).kind === 'blockbook' ? 'Blockbook' : 'Esplora'})` : host;
}

/** A chain source from the config's chainApi: an Esplora API, or a Blockbook server written "blockbook:<address>". */
export interface Source {
  kind: 'esplora' | 'blockbook';
  base: string;
}

export function sourceOf(entry: string): Source {
  const m = entry.match(/^blockbook:(.+)$/i);
  return m ? { kind: 'blockbook', base: m[1].replace(/\/+$/, '') } : { kind: 'esplora', base: entry.replace(/\/+$/, '') };
}

/** The source's web explorer, for links to a transaction (`${explorerOf(e)}/tx/<txid>`). */
export function explorerOf(entry: string): string {
  const s = sourceOf(entry);
  return s.kind === 'blockbook' ? s.base : s.base.replace(/\/api$/, '');
}

/** The explorer page where anyone can paste a signed transaction to broadcast it. */
export function pushPageOf(entry: string): string {
  return sourceOf(entry).kind === 'blockbook' ? `${explorerOf(entry)}/sendtx` : `${explorerOf(entry)}/tx/push`;
}

/** The URL that answers one Esplora-style request, and how to turn its answer into Esplora's shape. */
interface Request {
  url: string;
  conv: (r: unknown) => unknown;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

interface BbTx {
  txid: string;
  vin?: { addresses?: string[]; value?: string }[];
  vout?: { addresses?: string[]; value?: string }[];
  fees?: string;
  confirmations?: number;
  blockHeight?: number;
  blockTime?: number;
}

const bbTx = (t: BbTx): EsploraTx => ({
  txid: t.txid,
  fee: num(t.fees),
  status: (t.confirmations ?? 0) > 0 ? { confirmed: true, block_height: t.blockHeight, block_time: t.blockTime } : { confirmed: false },
  vin: (t.vin ?? []).map(i => ({ prevout: { scriptpubkey_address: i.addresses?.[0], value: num(i.value) } })),
  vout: (t.vout ?? []).map(o => ({ scriptpubkey_address: o.addresses?.[0], value: num(o.value) })),
});

/** Blockbook's API v2 for each request the app makes (https://github.com/trezor/blockbook/blob/master/docs/api.md). */
function blockbookRequest(base: string, path: string): Request | undefined {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/address\/([^/]+)$/)))
    return {
      url: `${base}/api/v2/address/${m[1]}?details=basic`,
      conv: r => {
        const a = r as { balance?: string; unconfirmedBalance?: string; txs?: number; unconfirmedTxs?: number };
        return {
          chain_stats: { funded_txo_sum: num(a.balance), spent_txo_sum: 0, tx_count: num(a.txs) },
          mempool_stats: { funded_txo_sum: num(a.unconfirmedBalance), spent_txo_sum: 0, tx_count: num(a.unconfirmedTxs) },
        };
      },
    };
  if ((m = path.match(/^\/address\/([^/]+)\/txs$/)))
    return { url: `${base}/api/v2/address/${m[1]}?details=txs&pageSize=1000`, conv: r => ((r as { transactions?: BbTx[] }).transactions ?? []).map(bbTx) };
  if ((m = path.match(/^\/address\/([^/]+)\/utxo$/)))
    return { url: `${base}/api/v2/utxo/${m[1]}`, conv: r => (r as { txid: string; vout: number; value: string }[]).map(u => ({ txid: u.txid, vout: u.vout, value: num(u.value) })) };
  if ((m = path.match(/^\/tx\/([0-9a-f]{64})\/status$/))) {
    const id = m[1];
    return {
      url: `${base}/api/v2/tx/${id}`,
      conv: r => {
        const t = r as BbTx;
        if (t?.txid !== id) throw new Error(`${base}: transaction not known`);
        return (t.confirmations ?? 0) > 0 ? { confirmed: true, block_height: t.blockHeight, confirmations: t.confirmations } : { confirmed: false };
      },
    };
  }
  if (path === '/v1/fees/recommended')
    return {
      url: `${base}/api/v2/estimatefee/2`, // within two blocks: Bitcoin Core's shortest estimate
      conv: r => {
        const satVb = Math.ceil(num((r as { result?: string }).result) * 1e5); // BTC per kvB to sat per vB
        return { fastestFee: satVb, halfHourFee: satVb, hourFee: satVb, minimumFee: 1 };
      },
    };
  if (path === '/blocks/tip/height')
    return { url: `${base}/api`, conv: r => num((r as { blockbook?: { bestHeight?: number } }).blockbook?.bestHeight) || undefined };
  return undefined;
}

function requestFor(entry: string, path: string): Request | undefined {
  const s = sourceOf(entry);
  return s.kind === 'blockbook' ? blockbookRequest(s.base, path) : { url: s.base + path, conv: r => r };
}

/** When each source last failed: a source that failed recently is asked last, so one slow source does not slow every request. */
const failedAt = new Map<string, number>();
const DEMOTE_MS = 5 * 60_000;

function inOrder(apis: string[]): string[] {
  const recent = (a: string) => Date.now() - (failedAt.get(a) ?? 0) < DEMOTE_MS;
  return [...apis.filter(a => !recent(a)), ...apis.filter(recent)];
}

/**
 * Ask the sources in turn: each one once, then (on the real network) twice more after a pause.
 * Public APIs throttle bursts; a refusal reaches the page only as "Failed to fetch", a slowdown as a timeout.
 */
async function get<T>(apis: string[], path: string, f: Fetcher, until = Infinity): Promise<T> {
  const live = f === defaultFetch;
  let last: unknown;
  const why = new Map<string, string>(); // each source's latest failure, for the message
  for (let attempt = 0; attempt < (live ? 3 : 1); attempt++) {
    if (attempt > 0) await sleep(attempt === 1 ? 2000 : 5000);
    for (const api of inOrder(apis)) {
      if (Date.now() > until) throw new Error(`no complete answer in ${READ_BUDGET_MS / 60_000} min`);
      const req = requestFor(api, path);
      if (!req) continue;
      try {
        lastUpstream = undefined;
        const r = req.conv(await f(req.url)) as T;
        failedAt.delete(api);
        lastAnswer = { api, upstream: lastUpstream };
        return r;
      } catch (e) {
        last = e;
        failedAt.set(api, Date.now());
        why.set(api, e instanceof Error ? (e.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : e.message) : String(e));
      }
    }
  }
  const msg = why.size
    ? [...why].map(([api, m]) => `${explorerOf(api).replace(/^https?:\/\//, '').split('/')[0]}: ${m}`).join(' · ')
    : last instanceof Error ? last.message : 'no chain API';
  throw new Error(`${path.replace(/\/[0-9a-z]{20,}/gi, '/…')}: ${msg}`);
}

export async function loadTreasury(d: ParsedDescriptor, network: Network, apis: string[], f: Fetcher = defaultFetch): Promise<TreasuryView> {
  let balance = 0;
  let unconfirmed = 0;
  const used: string[] = [];
  const where = new Map<string, { branch: 0 | 1; index: number }>();
  let donationAddress = '';
  let donationIndex = -1;
  let changeIndex = -1;

  // One address at a time on the real network, with a short pause: public APIs slow down bursts until requests time out.
  const live = f === defaultFetch;
  const until = live ? Date.now() + READ_BUDGET_MS : Infinity;
  const BATCH = live ? 1 : 5;
  for (const branch of [0, 1] as const) {
    let gap = 0;
    for (let i = 0; gap < GAP; i += BATCH) {
      if (live && (i > 0 || branch > 0)) await sleep(250);
      const batch = Array.from({ length: BATCH }, (_, k) => treasuryAddress(d, network, branch, i + k).address);
      const stats = await Promise.all(
        batch.map(a => get<{ chain_stats: AddrStats; mempool_stats: AddrStats }>(apis, `/address/${a}`, f, until)),
      );
      stats.forEach((s, k) => {
        const txs = s.chain_stats.tx_count + s.mempool_stats.tx_count;
        if (txs === 0) {
          gap++;
          if (branch === 0 && donationIndex < 0) {
            donationIndex = i + k;
            donationAddress = batch[k];
          }
          if (branch === 1 && changeIndex < 0) changeIndex = i + k;
          return;
        }
        gap = 0;
        used.push(batch[k]);
        where.set(batch[k], { branch, index: i + k });
        balance += s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum;
        const mem = s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum;
        balance += mem;
        unconfirmed += mem;
      });
    }
  }

  const mine = new Set(used);
  const txs = new Map<string, EsploraTx>();
  for (const a of used) for (const tx of await get<EsploraTx[]>(apis, `/address/${a}/txs`, f, until)) txs.set(tx.txid, tx);
  const movements: Movement[] = [...txs.values()]
    .map(tx => {
      const out = tx.vout.filter(o => o.scriptpubkey_address && mine.has(o.scriptpubkey_address)).reduce((s, o) => s + o.value, 0);
      const inp = tx.vin.filter(i => i.prevout?.scriptpubkey_address && mine.has(i.prevout.scriptpubkey_address)).reduce((s, i) => s + i.prevout!.value, 0);
      return { txid: tx.txid, net: out - inp, fee: tx.fee, confirmed: tx.status.confirmed, time: tx.status.block_time };
    })
    .sort((a, b) => (b.time ?? 4e9) - (a.time ?? 4e9)); // unconfirmed first

  const utxos: Utxo[] = [];
  for (const a of used) {
    for (const u of await get<{ txid: string; vout: number; value: number }[]>(apis, `/address/${a}/utxo`, f, until)) {
      utxos.push({ txid: u.txid, vout: u.vout, value: u.value, address: a, ...where.get(a)! });
    }
  }

  const by = lastAnswer;
  return { balance, unconfirmed, donationAddress, donationIndex, changeIndex, movements, utxos, source: by ? sourceLabel(by.api, by.upstream) : undefined };
}

/** How a DAO chooses its rounds' fee, set in its rules ("fast" unless changed by a rule-change vote). */
export type FeePolicy = 'fast' | 'economical';
export const feePolicyOf = (rules: { [k: string]: unknown }): FeePolicy => (rules.feePolicy === 'economical' ? 'economical' : 'fast');

export interface FeeSuggestion {
  /** The rate to use, in sat/vB, before the DAO's cap. */
  rate: number;
  /** The network's rate for the next block now. */
  next: number;
}

/**
 * The rate for a round. Fast: aim for the next block, with a quarter more as headroom for the hours or
 * days the council may take to sign, and never under 2 sat/vB. Economical: the network's rate for
 * confirmation within about an hour.
 */
export async function suggestFee(apis: string[], policy: FeePolicy, f: Fetcher = defaultFetch): Promise<FeeSuggestion> {
  const r = await get<{ fastestFee?: number; halfHourFee?: number; hourFee?: number; economyFee?: number; minimumFee?: number }>(apis, '/v1/fees/recommended', f);
  const next = Math.max(1, r.fastestFee || r.halfHourFee || r.hourFee || 1);
  const rate = policy === 'fast' ? Math.max(2, Math.ceil(next * 1.25)) : Math.max(1, r.hourFee || r.economyFee || r.minimumFee || 1);
  return { rate, next };
}

/** The latest block's height. */
export async function tipHeight(apis: string[], f: Fetcher = defaultFetch): Promise<number> {
  const h = await get<number | undefined>(apis, '/blocks/tip/height', f);
  if (!h || !Number.isFinite(h)) throw new Error('no chain tip');
  return h;
}

export interface Broadcast {
  txid: string;
  /** The first source that accepted the transaction, as written in `chainApi`. */
  source: string;
  /** Every source that accepted it ("already known" counts). */
  accepted: string[];
  /** Sources that refused it, with their reasons. */
  refused: { source: string; reason: string }[];
  /** What a chain gateway reported for the services behind it. */
  behind: string[];
}

/** A source answering that it already has the transaction has accepted it. */
const ALREADY = /already|txn-already|known|exists|in block ?chain/i;

/**
 * Send a signed transaction to every source at once, so it reaches several nodes, and report what each said.
 * A source has accepted only when it answers with the transaction's own id (or says it already has it):
 * an unstable service can answer 200 with a holding page, and that must not read as "broadcast".
 */
export async function broadcast(apis: string[], hex: string, txid: string): Promise<Broadcast> {
  const tries = apis.map(async api => {
    const s = sourceOf(api);
    let gateway: string | null = null;
    let ok = false;
    let reason = '';
    try {
      if (s.kind === 'blockbook') {
        const r = await fetch(`${s.base}/api/v2/sendtx/`, { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } });
        gateway = r.headers.get('X-Gateway-Broadcast');
        const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string | { message?: string } };
        reason = typeof j.error === 'string' ? j.error : (j.error?.message ?? `${r.status}`);
        ok = (r.ok && j.result?.trim() === txid) || ALREADY.test(reason);
      } else {
        const r = await fetch(s.base + '/tx', { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } });
        gateway = r.headers.get('X-Gateway-Broadcast');
        const text = (await r.text()).trim();
        reason = r.ok ? (text === txid ? '' : 'unexpected answer') : text.slice(0, 200) || `${r.status}`;
        ok = (r.ok && text === txid) || ALREADY.test(reason);
      }
    } catch (e) {
      reason = (e as Error).message || String(e);
    }
    if (!ok) failedAt.set(api, Date.now());
    return { api, ok, reason, gateway };
  });
  const results = await Promise.all(tries);
  const accepted = results.filter(x => x.ok).map(x => x.api);
  const refused = results.filter(x => !x.ok).map(x => ({ source: x.api, reason: x.reason }));
  // " | " from the gateway; older gateways sent " · ", which arrives as "Â·" (headers are read as Latin-1).
  const behind = results.flatMap(x => (x.gateway ? x.gateway.split(/\s+(?:\||·|Â·)\s+/) : []));
  if (!accepted.length) throw new Error(refused.map(x => `${sourceLabel(x.source)}: ${x.reason}`).join(' · ') || 'no chain API');
  return { txid, source: accepted[0], accepted, refused, behind: [...new Set(behind)] };
}

export interface TxStatus {
  confirmed: boolean;
  block_height?: number;
  /** Blocks on top of it, its own included: 1 just after it is mined. */
  confirmations?: number;
}

/** Where the transaction stands, or undefined when no source knows it (or none answers properly). */
export async function txStatus(apis: string[], txid: string, f: Fetcher = defaultFetch): Promise<TxStatus | undefined> {
  try {
    const st = await get<TxStatus>(apis, `/tx/${txid}/status`, f);
    // Only a real status counts: anything else (an error object, a holding page) means "not known".
    if (!st || typeof st.confirmed !== 'boolean') return undefined;
    if (!st.confirmed) return { confirmed: false };
    let confirmations = st.confirmations;
    if (confirmations === undefined && st.block_height) {
      try {
        confirmations = Math.max(1, (await tipHeight(apis, f)) - st.block_height + 1);
      } catch {
        /* unknown depth: treated as not deep enough */
      }
    }
    return { confirmed: true, block_height: st.block_height, confirmations };
  } catch {
    return undefined;
  }
}

/** Which sources know the transaction, asked all at once (for "On the network: seen by …"). */
export async function txSeenBy(apis: string[], txid: string, f: Fetcher = defaultFetch): Promise<string[]> {
  const seen = await Promise.all(apis.map(async api => ((await txStatus([api], txid, f)) ? api : undefined)));
  return seen.filter((x): x is string => !!x);
}

/**
 * Send a transaction again to the sources that do not know it yet, if at least one does and it is not
 * confirmed. Returns the sources that accepted it now (empty: nothing to do, or none accepted).
 */
export async function sendToMissing(apis: string[], hex: string, txid: string, f: Fetcher = defaultFetch): Promise<string[]> {
  const seen = new Set(await txSeenBy(apis, txid, f));
  const missing = apis.filter(a => !seen.has(a));
  if (!seen.size || !missing.length) return [];
  const st = await txStatus([...seen], txid, f);
  if (st?.confirmed) return [];
  try {
    return (await broadcast(missing, hex, txid)).accepted;
  } catch {
    return [];
  }
}

/** The source of the latest successful answer. */
export const lastSource = () => lastAnswer;
