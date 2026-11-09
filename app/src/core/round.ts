// Payout rounds (protocol 6.1-6.3): building the PSBT, checking it, partial signatures, finalising.
import { secp256k1 } from '@noble/curves/secp256k1';
import { base64 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { OutScript, Transaction, Address } from '@scure/btc-signer';
import type { Network } from './config';
import { BIP48_PATH } from './config';
import { VERSIONS, btcNetwork, treasuryAddress, type ParsedDescriptor } from './descriptor';
import { bytesToHex, hexToBytes } from './util';
import { sha256 } from '@noble/hashes/sha256';

/** The txid from the unsigned transaction (segwit: signatures do not change it). */
export const txidOf = (tx: Transaction) => bytesToHex(sha256(sha256(tx.unsignedTx)).reverse());

const addrCache = new Map<string, Map<string, { branch: 0 | 1; index: number }>>();
/** Treasury addresses (both branches, `lookahead` each) → where they are. Cached per descriptor. */
export function treasuryIndex(d: ParsedDescriptor, network: Network, lookahead = 100) {
  const k = `${network}|${d.threshold}|${d.keys.map(x => x.xpub).join(',')}|${lookahead}`;
  let m = addrCache.get(k);
  if (!m) {
    m = new Map();
    for (const branch of [0, 1] as const) for (let i = 0; i < lookahead; i++) m.set(treasuryAddress(d, network, branch, i).address, { branch, index: i });
    addrCache.set(k, m);
  }
  return m;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  address: string;
  branch: 0 | 1;
  index: number;
}

export interface RoundOutput {
  address: string;
  amount_sat: number;
}

export interface RoundContent {
  round: string; // YYYY-MM
  proposals: string[];
  psbt: string; // base64, version 0
  fee_rate_sat_vb: number;
  fee_sat: number;
}

const DUST = 546;
const SIG = 72; // DER signature plus sighash byte, upper bound used for estimates

const keyPath = (network: Network) => BIP48_PATH(network).split('/').map(p => (p.endsWith('h') ? Number(p.slice(0, -1)) + 0x80000000 : Number(p)));

function outScriptLen(address: string, network: Network): number {
  return OutScript.encode(Address(btcNetwork(network)).decode(address)).length;
}

/** Virtual size of a round spending `nIn` wsh(sortedmulti) inputs. */
export function estimateVsize(d: ParsedDescriptor, nIn: number, outputs: string[], network: Network): number {
  const witnessScriptLen = 3 + d.keys.length * 34; // OP_m, n×(push 33), OP_n, OP_CHECKMULTISIG
  const witness = 1 + 1 + d.threshold * (1 + SIG) + (witnessScriptLen < 253 ? 1 : 3) + witnessScriptLen;
  const base = 4 + 1 + nIn * 41 + 1 + outputs.reduce((s, a) => s + 8 + 1 + outScriptLen(a, network), 0) + 4;
  const weight = base * 4 + 2 + nIn * witness; // +2: segwit marker and flag
  return Math.ceil(weight / 4);
}

function inputFields(d: ParsedDescriptor, network: Network, u: Utxo) {
  const a = treasuryAddress(d, network, u.branch, u.index);
  const path = [...keyPath(network), u.branch, u.index];
  return {
    txid: hexToBytes(u.txid),
    index: u.vout,
    witnessUtxo: { script: OutScript.encode(Address(btcNetwork(network)).decode(a.address)), amount: BigInt(u.value) },
    witnessScript: hexToBytes(a.witnessScript),
    bip32Derivation: d.keys.map((k, i) => [a.pubkeys[i], { fingerprint: parseInt(k.fingerprint, 16), path }] as [Uint8Array, { fingerprint: number; path: number[] }]),
  };
}

export interface BuiltRound {
  psbt: string;
  fee: number;
  vsize: number;
  inputs: Utxo[];
  change?: { address: string; index: number; value: number };
}

/**
 * Build a round: pay `outputs` (or, with `sweepTo`, the whole of `utxos` to one address), largest
 * coins first, change to the change branch at `changeIndex`. Throws 'insufficient' when it cannot pay.
 */
export function buildRound(opts: {
  d: ParsedDescriptor;
  network: Network;
  utxos: Utxo[];
  outputs: RoundOutput[];
  feeRate: number;
  changeIndex: number;
  sweepTo?: string;
}): BuiltRound {
  const { d, network, feeRate } = opts;
  const coins = [...opts.utxos].sort((a, b) => b.value - a.value || (a.txid < b.txid ? -1 : 1));
  let chosen: Utxo[];
  let outputs: RoundOutput[];
  let change: BuiltRound['change'];
  let fee: number;
  let vsize: number;
  if (opts.sweepTo) {
    chosen = coins;
    vsize = estimateVsize(d, chosen.length, [opts.sweepTo], network);
    fee = Math.ceil(vsize * feeRate);
    const total = chosen.reduce((s, u) => s + u.value, 0);
    if (!chosen.length || total - fee <= DUST) throw new Error('insufficient');
    outputs = [{ address: opts.sweepTo, amount_sat: total - fee }];
  } else {
    const pay = opts.outputs.reduce((s, o) => s + o.amount_sat, 0);
    const changeAddr = treasuryAddress(d, network, 1, opts.changeIndex).address;
    chosen = [];
    let total = 0;
    for (const c of coins) {
      chosen.push(c);
      total += c.value;
      const withChange = Math.ceil(estimateVsize(d, chosen.length, [...opts.outputs.map(o => o.address), changeAddr], network) * feeRate);
      const without = Math.ceil(estimateVsize(d, chosen.length, opts.outputs.map(o => o.address), network) * feeRate);
      if (total >= pay + withChange + DUST + 1) break;
      if (total >= pay + without) break;
    }
    const withChangeVsize = estimateVsize(d, chosen.length, [...opts.outputs.map(o => o.address), changeAddr], network);
    const withoutVsize = estimateVsize(d, chosen.length, opts.outputs.map(o => o.address), network);
    if (total >= pay + Math.ceil(withChangeVsize * feeRate) + DUST + 1) {
      vsize = withChangeVsize;
      fee = Math.ceil(vsize * feeRate);
      change = { address: changeAddr, index: opts.changeIndex, value: total - pay - fee };
    } else if (total >= pay + Math.ceil(withoutVsize * feeRate)) {
      vsize = withoutVsize;
      fee = total - pay; // the small remainder goes to the fee
    } else throw new Error('insufficient');
    outputs = opts.outputs;
  }

  const tx = new Transaction({ allowUnknownOutputs: false });
  for (const u of chosen) tx.addInput(inputFields(d, network, u));
  for (const o of outputs) tx.addOutputAddress(o.address, BigInt(o.amount_sat), btcNetwork(network));
  if (change) {
    const a = treasuryAddress(d, network, 1, change.index);
    tx.addOutput({
      script: OutScript.encode(Address(btcNetwork(network)).decode(a.address)),
      amount: BigInt(change.value),
      witnessScript: hexToBytes(a.witnessScript),
      bip32Derivation: d.keys.map((k, i) => [a.pubkeys[i], { fingerprint: parseInt(k.fingerprint, 16), path: [...keyPath(network), 1, change!.index] }] as [Uint8Array, { fingerprint: number; path: number[] }]),
    });
  }
  return { psbt: base64.encode(tx.toPSBT(0)), fee, vsize, inputs: chosen, change };
}

export interface RoundInspection {
  txid: string;
  inputs: { txid: string; vout: number; value: number; address: string; branch?: 0 | 1; index?: number }[];
  outputs: { address: string; value: number; change?: number }[];
  fee: number;
  vsize: number;
  errors: string[];
}

/** Read a round's PSBT and check that its inputs and change belong to the treasury (protocol 6.1). */
export function inspectRound(psbtB64: string, d: ParsedDescriptor, network: Network, lookahead = 100): RoundInspection {
  const errors: string[] = [];
  const tx = Transaction.fromPSBT(base64.decode(psbtB64));
  const net = btcNetwork(network);
  const index = treasuryIndex(d, network, lookahead);
  const find = (addr: string) => index.get(addr);
  const inputs: RoundInspection['inputs'] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (!inp.witnessUtxo || !inp.txid) { errors.push(`input ${i}: no witness_utxo`); continue; }
    const address = Address(net).encode(OutScript.decode(inp.witnessUtxo.script as Uint8Array));
    const where = find(address);
    if (!where) errors.push(`input ${i}: not a treasury address`);
    else {
      const a = treasuryAddress(d, network, where.branch, where.index);
      if (!inp.witnessScript || bytesToHex(inp.witnessScript) !== a.witnessScript) errors.push(`input ${i}: witness_script`);
      if (!inp.bip32Derivation || inp.bip32Derivation.length !== d.keys.length) errors.push(`input ${i}: bip32_derivation`);
    }
    inputs.push({ txid: bytesToHex(inp.txid), vout: inp.index!, value: Number(inp.witnessUtxo.amount), address, ...where });
  }
  const outputs: RoundInspection['outputs'] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const address = tx.getOutputAddress(i, net)!;
    const where = find(address);
    if (where?.branch === 0) errors.push(`output ${i}: pays a treasury receive address`);
    if (where?.branch === 1) {
      const a = treasuryAddress(d, network, 1, where.index);
      if (!o.witnessScript || bytesToHex(o.witnessScript) !== a.witnessScript || !o.bip32Derivation || o.bip32Derivation.length !== d.keys.length) errors.push(`output ${i}: change without witness_script and bip32_derivation`);
    }
    outputs.push({ address, value: Number(o.amount), ...(where?.branch === 1 ? { change: where.index } : {}) });
  }
  if (outputs.filter(o => o.change !== undefined).length > 1) errors.push('more than one change output');
  const fee = inputs.reduce((s, x) => s + x.value, 0) - outputs.reduce((s, x) => s + x.value, 0);
  const vsize = estimateVsize(d, inputs.length, outputs.map(o => o.address), network);
  return { txid: txidOf(tx), inputs, outputs, fee, vsize, errors };
}

/** Child public key of a council treasury key at branch/index. */
function childKey(xpub: string, network: Network, branch: number, index: number): Uint8Array {
  return HDKey.fromExtendedKey(xpub, VERSIONS[network]).deriveChild(branch).deriveChild(index).publicKey!;
}

/**
 * Valid partial signatures in a PSBT made by one council member's treasury key: input index → pubkey hex.
 * A signature counts only if it verifies against that member's own key for the input's path.
 */
export function memberSignatures(psbtB64: string, d: ParsedDescriptor, network: Network, member: { xpub: string }, round: RoundInspection): Map<number, string> {
  const out = new Map<number, string>();
  const tx = Transaction.fromPSBT(base64.decode(psbtB64));
  if (txidOf(tx) !== round.txid) return out;
  for (let i = 0; i < tx.inputsLength; i++) {
    const r = round.inputs[i];
    if (r?.branch === undefined) continue;
    const inp = tx.getInput(i);
    const mine = childKey(member.xpub, network, r.branch, r.index!);
    const sig = inp.partialSig?.find(([pk]) => bytesToHex(pk as Uint8Array) === bytesToHex(mine))?.[1] as Uint8Array | undefined;
    if (!sig || sig[sig.length - 1] !== 0x01) continue; // SIGHASH_ALL only
    const a = treasuryAddress(d, network, r.branch, r.index!);
    const hash = tx.preimageWitnessV0(i, hexToBytes(a.witnessScript), 0x01, BigInt(r.value));
    try {
      if (secp256k1.verify(sig.slice(0, -1), hash, mine, { format: 'der', lowS: true } as never)) out.set(i, bytesToHex(mine));
    } catch {
      /* invalid encoding */
    }
  }
  return out;
}

/** Sign every input with a test treasury key (trial only). */
export function signWithMnemonicKey(psbtB64: string, master: HDKey): string {
  const tx = Transaction.fromPSBT(base64.decode(psbtB64));
  for (let i = 0; i < tx.inputsLength; i++) tx.signIdx(master as never, i, [0x01]);
  return base64.encode(tx.toPSBT(0));
}

/** Combine signed PSBTs, finalise, and return the raw transaction hex and its id. */
export function finalizeRound(psbts: string[]): { hex: string; txid: string } {
  const [first, ...rest] = psbts.map(p => Transaction.fromPSBT(base64.decode(p)));
  for (const t of rest) first.combine(t);
  first.finalize();
  return { hex: bytesToHex(first.extract()), txid: first.id };
}

export const masterFromSeed = (seed: Uint8Array, network: Network) => HDKey.fromMasterSeed(seed, VERSIONS[network]);
