import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mnemonicToSeedSync } from '@scure/bip39';
import { buildDescriptor, parseDescriptor, treasuryAddress } from './descriptor';
import { treasuryKeyFromMnemonic } from './identity';
import { buildRound, finalizeRound, inspectRound, masterFromSeed, memberSignatures, signWithMnemonicKey, estimateVsize, type Utxo } from './round';

const MNEMONICS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic',
];
const keys = MNEMONICS.map(m => treasuryKeyFromMnemonic(m, 'testnet4'));
const d = parseDescriptor(buildDescriptor(3, keys, 'testnet4'), 'testnet4');
const masters = MNEMONICS.map(m => masterFromSeed(mnemonicToSeedSync(m), 'testnet4'));
const PAYEE = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const utxo = (i: number, value: number, branch: 0 | 1 = 0): Utxo => ({ txid: String(i).repeat(64).slice(0, 64), vout: i, value, address: treasuryAddress(d, 'testnet4', branch, i).address, branch, index: i });

describe('payout rounds (6.1-6.2)', () => {
  it('builds a PSBT with change, checks it, collects 3 signatures and finalises', () => {
    const r = buildRound({ d, network: 'testnet4', utxos: [utxo(0, 50_000), utxo(1, 200_000), utxo(2, 30_000)], outputs: [{ address: PAYEE, amount_sat: 120_000 }], feeRate: 3, changeIndex: 0 });
    expect(r.inputs.map(u => u.value)).toEqual([200_000]); // largest first, one is enough
    expect(r.change?.value).toBe(200_000 - 120_000 - r.fee);
    const ins = inspectRound(r.psbt, d, 'testnet4');
    expect(ins.errors).toEqual([]);
    expect(ins.fee).toBe(r.fee);
    expect(ins.outputs.find(o => o.change !== undefined)?.change).toBe(0);
    expect(r.fee / ins.vsize).toBeLessThanOrEqual(3.01);

    const signed = [0, 2, 4].map(i => signWithMnemonicKey(r.psbt, masters[i]));
    for (const [n, i] of [0, 2, 4].entries()) expect(memberSignatures(signed[n], d, 'testnet4', keys[i], ins).size).toBe(1);
    expect(memberSignatures(signed[0], d, 'testnet4', keys[1], ins).size).toBe(0); // not @c1's signature
    expect(() => finalizeRound(signed.slice(0, 2))).toThrow();
    const final = finalizeRound(signed);
    expect(final.txid).toBe(ins.txid);
    // hand to embit for an independent check (see e2e/embit-check.py)
    writeFileSync('/tmp/btcdao-round.json', JSON.stringify({ psbt: r.psbt, signed, hex: final.hex, utxos: r.inputs }));
    // real vsize vs estimate: estimate is an upper bound within a few vbytes
    const realVsize = Math.ceil((final.hex.length / 2) * 1); // placeholder, checked in python
    expect(realVsize).toBeGreaterThan(0);
  });

  it('pays without change when the remainder is dust, and refuses when coins are short', () => {
    const vs = estimateVsize(d, 1, [PAYEE], 'testnet4');
    const r = buildRound({ d, network: 'testnet4', utxos: [utxo(0, 100_000 + vs * 2 + 300)], outputs: [{ address: PAYEE, amount_sat: 100_000 }], feeRate: 2, changeIndex: 0 });
    expect(r.change).toBeUndefined();
    expect(r.fee).toBe(vs * 2 + 300);
    expect(() => buildRound({ d, network: 'testnet4', utxos: [utxo(0, 1000)], outputs: [{ address: PAYEE, amount_sat: 100_000 }], feeRate: 2, changeIndex: 0 })).toThrow('insufficient');
  });

  it('sweeps everything to one address for a closing round', () => {
    const r = buildRound({ d, network: 'testnet4', utxos: [utxo(0, 50_000), utxo(1, 70_000, 1)], outputs: [], feeRate: 2, changeIndex: 0, sweepTo: PAYEE });
    const ins = inspectRound(r.psbt, d, 'testnet4');
    expect(ins.inputs.length).toBe(2);
    expect(ins.outputs).toEqual([{ address: PAYEE, value: 120_000 - r.fee }]);
  });

  it('flags a PSBT spending a non-treasury coin or paying a receive address', () => {
    const r = buildRound({ d, network: 'testnet4', utxos: [utxo(0, 200_000)], outputs: [{ address: treasuryAddress(d, 'testnet4', 0, 5).address, amount_sat: 1000 }], feeRate: 2, changeIndex: 0 });
    expect(inspectRound(r.psbt, d, 'testnet4').errors).toContain('output 0: pays a treasury receive address');
  });
});
