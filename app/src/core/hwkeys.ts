// Hardware keys (SeedSigner): reading a key export, and the PSBT exchange, in the formats recorded in
// docs/seedsigner.md. Keys arrive as UR crypto-account (Sparrow export) or as key-origin text
// ("[fingerprint/48h/1h/0h/2h]tpub…"); PSBTs travel as UR crypto-psbt.
import { HDKey } from '@scure/bip32';
import { base64 } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import { txidOf } from './round';
import { BIP48_PATH, type Network } from './config';
import { VERSIONS, parseKeyOrigin, withChecksum, type TreasuryKey } from './descriptor';
import { cborDecode, cborEncode, UrEncoder, type Cbor } from './ur';
import { bytesToHex } from './util';

const TAG = { hdkey: 303, keypath: 304, coininfo: 305, wsh: 401, sh: 400, wpkh: 404, account: 311, psbt: 310 };

type CborMap = Map<number, Cbor>;
const untag = (v: Cbor, tag?: number): Cbor => {
  if (v && typeof v === 'object' && 'tag' in v && !(v instanceof Uint8Array) && !Array.isArray(v) && !(v instanceof Map)) {
    if (tag !== undefined && v.tag !== tag) throw new Error(`hwkey: expected tag ${tag}, got ${v.tag}`);
    return v.value;
  }
  return v;
};
const asMap = (v: Cbor): CborMap => {
  if (!(v instanceof Map)) throw new Error('hwkey: expected a map');
  return v;
};

export interface HwKey extends TreasuryKey {
  /** The path as the device states it, e.g. 48h/1h/0h/2h. */
  path: string;
  network: Network;
}

/** A crypto-hdkey (BCR-2020-007) as an extended public key for the network it states. */
function hdkeyToXpub(m: CborMap, fallbackNetwork: Network): { xpub: string; path: string; fingerprint?: string; network: Network } {
  const keyData = m.get(3) as Uint8Array;
  const chainCode = m.get(4) as Uint8Array;
  if (!(keyData instanceof Uint8Array) || keyData.length !== 33 || !(chainCode instanceof Uint8Array) || chainCode.length !== 32) throw new Error('hwkey: not a public key');
  const use = m.get(5) !== undefined ? asMap(untag(m.get(5)!, TAG.coininfo)) : undefined;
  const network: Network = use?.get(2) === 1 ? 'testnet4' : use?.get(2) === 0 ? 'mainnet' : fallbackNetwork;
  const origin = m.get(6) !== undefined ? asMap(untag(m.get(6)!, TAG.keypath)) : undefined;
  const comps = (origin?.get(1) as Cbor[] | undefined) ?? [];
  const steps: number[] = [];
  for (let i = 0; i < comps.length; i += 2) steps.push((comps[i] as number) + (comps[i + 1] ? 0x80000000 : 0));
  const path = steps.map(s => (s >= 0x80000000 ? `${s - 0x80000000}h` : `${s}`)).join('/');
  const fp = origin?.get(2) as number | undefined;
  const key = new HDKey({
    publicKey: keyData,
    chainCode,
    depth: (origin?.get(3) as number | undefined) ?? steps.length,
    index: steps[steps.length - 1] ?? 0,
    parentFingerprint: (m.get(8) as number | undefined) ?? 0,
    versions: VERSIONS[network],
  });
  return { xpub: key.publicExtendedKey, path, fingerprint: fp !== undefined ? fp.toString(16).padStart(8, '0') : undefined, network };
}

/**
 * The council key a SeedSigner exports for a multisig (Export Xpub → Multisig → Native Segwit → Sparrow),
 * as a completed UR (`crypto-account` or `crypto-hdkey`), or the same key typed as key-origin text.
 * Checked against the DAO's network and the multisig path m/48'/coin'/0'/2'.
 */
export function readKeyExport(input: { type: string; cbor: Uint8Array } | string, network: Network): HwKey {
  if (typeof input === 'string') {
    const k = parseKeyOrigin(input, network);
    return { ...k, path: BIP48_PATH(network), network };
  }
  const v = cborDecode(input.cbor);
  let fingerprint: string | undefined;
  let found: ReturnType<typeof hdkeyToXpub> | undefined;
  if (input.type === 'crypto-account') {
    const m = asMap(untag(v, TAG.account));
    fingerprint = (m.get(1) as number).toString(16).padStart(8, '0');
    for (const d of (m.get(2) as Cbor[]) ?? []) {
      if (!d || typeof d !== 'object' || !('tag' in d) || (d as { tag: number }).tag !== TAG.wsh) continue; // native segwit multisig only
      found = hdkeyToXpub(asMap(untag(untag(d, TAG.wsh), TAG.hdkey)), network);
    }
    if (!found) throw new Error('hwkey: no native segwit multisig key in the export (choose Multisig → Native Segwit)');
  } else if (input.type === 'crypto-hdkey') {
    found = hdkeyToXpub(asMap(untag(v, TAG.hdkey)), network);
    fingerprint = found.fingerprint;
  } else throw new Error(`hwkey: a ${input.type} is not a key export`);
  if (!fingerprint) throw new Error('hwkey: the export has no master fingerprint');
  // The coin in the path tells the device's network (48h/0h… mainnet, 48h/1h… testnet), also when the
  // export does not state it (SeedSigner 0.8.6 on Mainnet leaves it out).
  const coin = found.path.split('/')[1];
  const pathNet: Network | undefined = coin === '0h' ? 'mainnet' : coin === '1h' ? 'testnet4' : undefined;
  if (found.network !== network || (pathNet && pathNet !== network)) throw new Error(network === 'mainnet' ? 'hw-net-testnet' : 'hw-net-mainnet');
  if (found.path !== BIP48_PATH(network)) throw new Error('hw-path');
  return { fingerprint, xpub: found.xpub, path: found.path, network };
}

/** A PSBT as an animated QR the SeedSigner scans (UR crypto-psbt). */
export const psbtEncoder = (psbtB64: string, maxFragment = 100) => new UrEncoder('crypto-psbt', cborEncode(base64.decode(psbtB64)), maxFragment);

/** A completed UR crypto-psbt (the signed PSBT shown by the SeedSigner) as base64. */
export function readPsbt(input: { type: string; cbor: Uint8Array }): string {
  if (input.type !== 'crypto-psbt') throw new Error(`hwkey: a ${input.type} is not a PSBT`);
  const v = cborDecode(input.cbor);
  if (!(v instanceof Uint8Array)) throw new Error('hwkey: not a PSBT');
  if (bytesToHex(v.slice(0, 5)) !== '70736274ff') throw new Error('hwkey: not a PSBT');
  return base64.encode(v);
}

/**
 * A SeedSigner returns a trimmed signed PSBT: the transaction and its signatures, without the input
 * details (witness_utxo, witness_script, key paths) the app put in. Put its signatures back into the
 * PSBT the app sent, after checking both are the same transaction.
 */
export function mergeSignatures(sentB64: string, returnedB64: string): string {
  const sent = Transaction.fromPSBT(base64.decode(sentB64));
  const back = Transaction.fromPSBT(base64.decode(returnedB64));
  if (txidOf(sent) !== txidOf(back) || sent.inputsLength !== back.inputsLength) throw new Error('hwkey: the signed transaction is not the one sent to the device');
  for (let i = 0; i < back.inputsLength; i++) {
    const sigs = back.getInput(i).partialSig;
    if (!sigs?.length) continue;
    const have = sent.getInput(i).partialSig ?? [];
    const merged = [...have];
    for (const [pk, sig] of sigs) if (!merged.some(([k]) => bytesToHex(k) === bytesToHex(pk))) merged.push([pk, sig]);
    sent.updateInput(i, { partialSig: merged }, true);
  }
  return base64.encode(sent.toPSBT(0));
}

/**
 * The treasury descriptor as the SeedSigner reads it (docs/seedsigner.md 2): receive branch only, /0/*.
 * The device still recognises change on /1/* as the wallet's own (checked: "Your change", verified).
 */
export const deviceDescriptor = (desc: string) => withChecksum(desc.replace(/#.*$/, '').replace(/\/<0;1>\/\*/g, '/0/*'));
