import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcast, sendToMissing, explorerOf, feePolicyOf, loadTreasury, pushPageOf, sourceLabel, sourceOf, suggestFee, txSeenBy, txStatus, type Fetcher } from './chain';
import { parseDescriptor, treasuryAddress } from './descriptor';

// UNO's practice treasury (2 of 2), as founded on 6 November 2026.
const DESC =
  'wsh(sortedmulti(2,[8c37eb1f/48h/1h/0h/2h]tpubDDyUsGt7EpEm4jD28eT4wfpzmp1AqhX9eTSx2Bt38EtoXkRfifsLRKEG7Ta3ybkf47cSfYfab4Nm3Fs7sWYwkbGDnBsJ2JnUDN4K8RmsrDv/<0;1>/*,[c0b17122/48h/1h/0h/2h]tpubDF7RfpXnri3KfwmUUe7K9hZoDmZt9KMSPHDBfdRKQeAWZLJdi86QSDPkTSv7uUXvTzDMJ3kzuBhnLtBPTFB7MbfA4LHs6vd2t4jZ9yDbMA9/<0;1>/*))#088sezad';
const d = parseDescriptor(DESC, 'testnet4');
const A0 = treasuryAddress(d, 'testnet4', 0, 0).address;
const A1 = treasuryAddress(d, 'testnet4', 0, 1).address;
const TXID = '490e04f094c3e5e3c370e305b4107ea15eb8656d408d336b83456f54a824f801';
const BB = 'https://blockbook.example';

/** A Blockbook server holding one confirmed 10,000-sat deposit to A0, in Blockbook's own answer format. */
const blockbook: Fetcher = async url => {
  const u = new URL(url);
  let m: RegExpMatchArray | null;
  if ((m = u.pathname.match(/^\/api\/v2\/address\/([^/]+)$/))) {
    const used = m[1] === A0;
    if (u.searchParams.get('details') === 'txs')
      return used
        ? {
            address: A0,
            transactions: [
              {
                txid: TXID,
                vin: [{ addresses: ['2N5SK7BFXGzefmMs9AHui2Y71fUh3uVVn2S'], value: '100000' }],
                vout: [
                  { addresses: ['tb1qrd5rzllu7k5eylyg3g2a7e9ptst5yjna6h2ljt'], value: '89013' },
                  { addresses: [A0], value: '10000' },
                ],
                fees: '987',
                confirmations: 65,
                blockHeight: 159356,
                blockTime: 1793953260,
              },
            ],
          }
        : { address: m[1], transactions: [] };
    return { address: m[1], balance: used ? '10000' : '0', unconfirmedBalance: '0', txs: used ? 1 : 0, unconfirmedTxs: 0 };
  }
  if ((m = u.pathname.match(/^\/api\/v2\/utxo\/([^/]+)$/))) return m[1] === A0 ? [{ txid: TXID, vout: 1, value: '10000', confirmations: 65 }] : [];
  if (u.pathname === `/api/v2/tx/${TXID}`) return { txid: TXID, confirmations: 65, blockHeight: 159356 };
  if (u.pathname === '/api/v2/estimatefee/2') return { result: '0.00002' };
  if (u.pathname === '/api') return { blockbook: { bestHeight: 159420 } };
  throw new Error(`404 ${url}`);
};

describe('chain sources', () => {
  it('reads a source entry: Esplora by default, Blockbook with its prefix', () => {
    expect(sourceOf('https://mempool.space/testnet4/api/')).toEqual({ kind: 'esplora', base: 'https://mempool.space/testnet4/api' });
    expect(sourceOf('blockbook:https://blockbook.tbtc.zelcore.io/')).toEqual({ kind: 'blockbook', base: 'https://blockbook.tbtc.zelcore.io' });
    expect(explorerOf('https://mempool.space/testnet4/api')).toBe('https://mempool.space/testnet4');
    expect(explorerOf('blockbook:https://blockbook.tbtc.zelcore.io')).toBe('https://blockbook.tbtc.zelcore.io');
    expect(pushPageOf('https://mempool.space/testnet4/api')).toBe('https://mempool.space/testnet4/tx/push');
    expect(pushPageOf('blockbook:https://blockbook.tbtc.zelcore.io')).toBe('https://blockbook.tbtc.zelcore.io/sendtx');
  });

  it('reads the treasury from Blockbook: balance, coins, movements, next donation address', async () => {
    const tr = await loadTreasury(d, 'testnet4', [`blockbook:${BB}`], blockbook);
    expect(tr.balance).toBe(10000);
    expect(tr.unconfirmed).toBe(0);
    expect(tr.donationAddress).toBe(A1);
    expect(tr.utxos).toEqual([{ txid: TXID, vout: 1, value: 10000, address: A0, branch: 0, index: 0 }]);
    expect(tr.movements).toEqual([{ txid: TXID, net: 10000, fee: 987, confirmed: true, time: 1793953260 }]);
  });

  it('falls back to Blockbook when the Esplora source does not answer', async () => {
    const f: Fetcher = async url => {
      if (url.startsWith('https://esplora.example')) throw new Error('Failed to fetch');
      return blockbook(url);
    };
    const tr = await loadTreasury(d, 'testnet4', ['https://esplora.example/api', `blockbook:${BB}`], f);
    expect(tr.balance).toBe(10000);
  });

  it('names every source and its own reason when none answers', async () => {
    const f: Fetcher = async url => {
      if (url.startsWith('https://esplora.example')) throw new Error('cannot be reached (Failed to fetch)');
      throw new Error('429 too many requests');
    };
    await expect(loadTreasury(d, 'testnet4', ['https://esplora.example/api', `blockbook:${BB}`], f)).rejects.toThrow(
      /esplora\.example: cannot be reached \(Failed to fetch\) · blockbook\.example: 429 too many requests|blockbook\.example: 429 too many requests · esplora\.example: cannot be reached/,
    );
  });

  it('turns Blockbook fee estimates and transaction status into the app\'s terms', async () => {
    // 0.00002 BTC/kvB = 2 sat/vB for the next block: fast adds a quarter (rounded up), economical takes it as it is.
    expect(await suggestFee([`blockbook:${BB}`], 'fast', blockbook)).toEqual({ rate: 3, next: 2 });
    expect(await suggestFee([`blockbook:${BB}`], 'economical', blockbook)).toEqual({ rate: 2, next: 2 });
    expect(await txStatus([`blockbook:${BB}`], TXID, blockbook)).toEqual({ confirmed: true, block_height: 159356, confirmations: 65 });
  });

  it('does not take an unknown transaction for one on the network', async () => {
    const other = 'ab'.repeat(32);
    // Blockbook answering with an error object, or with another transaction.
    const bbErr: Fetcher = async url => (url.includes(other) ? { error: `txid ${other} not found` } : blockbook(url));
    expect(await txStatus([`blockbook:${BB}`], other, bbErr)).toBeUndefined();
    // Esplora answering 200 with something that is not a status (a holding page read as JSON).
    expect(await txStatus(['https://esplora.example/api'], other, async () => ({ message: 'maintenance' }))).toBeUndefined();
    expect(await txStatus(['https://esplora.example/api'], other, async () => ({ confirmed: false }))).toEqual({ confirmed: false });
  });
});

describe('fees and depth', () => {
  const esplora = (fees: Record<string, number>, tip = 159460, height = 159459): Fetcher => async url => {
    if (url.endsWith('/v1/fees/recommended')) return fees;
    if (url.endsWith('/blocks/tip/height')) return tip;
    if (url.endsWith('/status')) return { confirmed: true, block_height: height };
    throw new Error(`404 ${url}`);
  };
  const ES = 'https://esplora.example/api';

  it('fast aims for the next block with a quarter more, never under 2; economical takes the hour rate', async () => {
    expect(await suggestFee([ES], 'fast', esplora({ fastestFee: 1, halfHourFee: 1, hourFee: 1 }))).toEqual({ rate: 2, next: 1 });
    expect(await suggestFee([ES], 'fast', esplora({ fastestFee: 12, halfHourFee: 8, hourFee: 5 }))).toEqual({ rate: 15, next: 12 });
    expect(await suggestFee([ES], 'economical', esplora({ fastestFee: 12, halfHourFee: 8, hourFee: 5 }))).toEqual({ rate: 5, next: 12 });
  });

  it('reads the policy from the rules: fast unless the members chose economical', () => {
    expect(feePolicyOf({})).toBe('fast');
    expect(feePolicyOf({ feePolicy: 'economical' })).toBe('economical');
    expect(feePolicyOf({ feePolicy: 'nonsense' })).toBe('fast');
  });

  it('counts confirmations from the chain tip when the source gives only a height', async () => {
    expect(await txStatus([ES], TXID, esplora({}, 159461, 159459))).toEqual({ confirmed: true, block_height: 159459, confirmations: 3 });
    expect(await txStatus([ES], TXID, esplora({}, 159459, 159459))).toEqual({ confirmed: true, block_height: 159459, confirmations: 1 });
  });

  it('says which sources know a transaction', async () => {
    const f: Fetcher = async url => {
      if (url.startsWith('https://esplora.example')) return { confirmed: false };
      throw new Error('400');
    };
    expect(await txSeenBy([ES, `blockbook:${BB}`], TXID, f)).toEqual([ES]);
  });

  it('names a source by its host, and the service behind a gateway', () => {
    expect(sourceLabel('https://mempool.space/testnet4/api')).toBe('mempool.space');
    const all = ['blockbook:https://gw.example/bb', 'https://gw.example/esplora/api', 'https://mempool.space/testnet4/api'];
    expect(all.map(a => sourceLabel(a, undefined, all))).toEqual(['gw.example (Blockbook)', 'gw.example (Esplora)', 'mempool.space']);
    expect(sourceLabel('blockbook:https://btc-dao-gateway.btcdao.workers.dev/bb', 'blockbook.tbtc.zelcore.io')).toBe('blockbook.tbtc.zelcore.io · btc-dao-gateway');
  });
});

describe('broadcast', () => {
  afterEach(() => vi.unstubAllGlobals());
  const txid = 'cd'.repeat(32);
  const answer = (body: string, ok = true, headers: Record<string, string> = {}) => Promise.resolve(new Response(body, { status: ok ? 200 : 400, headers }));

  it('sends to every source at once and reports what each said', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(url);
      if (url.startsWith('https://esplora.example')) return answer('<html>Service temporarily unavailable</html>');
      return answer(JSON.stringify({ result: txid }), true, { 'X-Gateway-Broadcast': 'bb.example: accepted · es.example: min relay fee not met' });
    });
    const sent = await broadcast(['https://esplora.example/api', `blockbook:${BB}`], '00', txid);
    expect(sent).toEqual({
      txid,
      source: `blockbook:${BB}`,
      accepted: [`blockbook:${BB}`],
      refused: [{ source: 'https://esplora.example/api', reason: 'unexpected answer' }],
      behind: ['bb.example: accepted', 'es.example: min relay fee not met'],
    });
    expect(seen.sort()).toEqual([`${BB}/api/v2/sendtx/`, 'https://esplora.example/api/tx'].sort());
  });

  it('sends again only to the sources that do not know an unconfirmed transaction', async () => {
    const posted: string[] = [];
    vi.stubGlobal('fetch', (url: string) => { posted.push(url); return answer(txid); });
    const knows = (api: string): Fetcher => async url => (url.startsWith(api) ? { confirmed: false } : Promise.reject(new Error('404')));
    const A = 'https://a.example/api', B = 'https://b.example/api';
    expect(await sendToMissing([A, B], '00', txid, knows(A))).toEqual([B]);
    expect(posted).toEqual([`${B}/tx`]);
    posted.length = 0;
    const none: Fetcher = async () => Promise.reject(new Error('404'));
    expect(await sendToMissing([A, B], '00', txid, none)).toEqual([]); // nobody has it: left to the ordinary rebroadcast
    const all: Fetcher = async () => ({ confirmed: false });
    expect(await sendToMissing([A, B], '00', txid, all)).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('counts "already known" as accepted', async () => {
    vi.stubGlobal('fetch', () => answer('sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}', false));
    const sent = await broadcast(['https://esplora.example/api'], '00', txid);
    expect(sent.accepted).toEqual(['https://esplora.example/api']);
  });

  it('fails with every source\'s reason when none accepts', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      url.includes('sendtx') ? answer(JSON.stringify({ error: { message: 'min relay fee not met' } }), false) : Promise.reject(new TypeError('Failed to fetch')));
    await expect(broadcast([`blockbook:${BB}`, 'https://esplora.example/api'], '00', txid)).rejects.toThrow(
      /blockbook\.example: min relay fee not met · esplora\.example: Failed to fetch/,
    );
  });
});
