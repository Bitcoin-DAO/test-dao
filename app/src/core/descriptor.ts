// Treasury descriptor: wsh(sortedmulti(...)) with BIP-380 checksum, and address derivation.
import { HDKey } from '@scure/bip32';
import { NETWORK, TEST_NETWORK, sortedMultisig } from '@scure/btc-signer';
import { bytesToHex } from './util';
import type { Network } from './config';
import { BIP48_PATH } from './config';

export const VERSIONS = {
  mainnet: { private: 0x0488ade4, public: 0x0488b21e }, // xprv / xpub
  testnet4: { private: 0x04358394, public: 0x043587cf }, // tprv / tpub
};

export const btcNetwork = (n: Network) => (n === 'mainnet' ? NETWORK : TEST_NETWORK);

const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(c: bigint, val: number): bigint {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val);
  for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i];
  return c;
}

/** BIP-380 descriptor checksum (8 characters). */
export function descriptorChecksum(desc: string): string {
  let c = 1n;
  let cls = 0;
  let clscount = 0;
  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos < 0) throw new Error(`Descriptor: invalid character ${ch}`);
    c = polymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    if (++clscount === 3) {
      c = polymod(c, cls);
      cls = 0;
      clscount = 0;
    }
  }
  if (clscount > 0) c = polymod(c, cls);
  for (let j = 0; j < 8; j++) c = polymod(c, 0);
  c ^= 1n;
  let out = '';
  for (let j = 0; j < 8; j++) out += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - j))) & 31n)];
  return out;
}

export const withChecksum = (desc: string) => `${desc}#${descriptorChecksum(desc)}`;

export interface TreasuryKey {
  fingerprint: string; // 8 hex, of the master key
  xpub: string; // at m/48'/coin'/0'/2'
}

/** Parse "[fp/48h/1h/0h/2h]tpub..." (also accepts ' for hardened, and a trailing /<0;1>/* or /0/*). */
export function parseKeyOrigin(s: string, network: Network): TreasuryKey {
  const m = s.trim().match(/^\[([0-9a-fA-F]{8})\/([0-9hH'/]+)\]([1-9A-HJ-NP-Za-km-z]+)(\/.*)?$/);
  if (!m) throw new Error('key-origin');
  const path = m[2].replace(/['H]/g, 'h');
  if (path !== BIP48_PATH(network)) throw new Error('key-path');
  checkXpub(m[3], network);
  return { fingerprint: m[1].toLowerCase(), xpub: m[3] };
}

export function checkXpub(xpub: string, network: Network): HDKey {
  const key = HDKey.fromExtendedKey(xpub, VERSIONS[network]);
  if (key.depth !== 4) throw new Error('xpub-depth');
  return key;
}

export function buildDescriptor(threshold: number, keys: TreasuryKey[], network: Network): string {
  const path = BIP48_PATH(network);
  const parts = keys.map(k => `[${k.fingerprint}/${path}]${k.xpub}/<0;1>/*`);
  return withChecksum(`wsh(sortedmulti(${threshold},${parts.join(',')}))`);
}

export interface ParsedDescriptor {
  threshold: number;
  keys: TreasuryKey[];
}

export function parseDescriptor(desc: string, network: Network): ParsedDescriptor {
  const [body, sum] = desc.split('#');
  if (!sum || descriptorChecksum(body) !== sum) throw new Error('descriptor-checksum');
  const m = body.match(/^wsh\(sortedmulti\((\d+),(.*)\)\)$/);
  if (!m) throw new Error('descriptor-form');
  const keys = m[2].split(',').map(part => {
    const k = part.match(/^(\[[^\]]+\][1-9A-HJ-NP-Za-km-z]+)\/<0;1>\/\*$/);
    if (!k) throw new Error('descriptor-key');
    return parseKeyOrigin(k[1], network);
  });
  const threshold = Number(m[1]);
  if (!(threshold >= 1 && threshold <= keys.length)) throw new Error('descriptor-threshold');
  return { threshold, keys };
}

/** Treasury address at branch 0 (receive) or 1 (change), index i. */
export function treasuryAddress(d: ParsedDescriptor, network: Network, branch: 0 | 1, index: number) {
  const pubkeys = d.keys.map(k => {
    const child = HDKey.fromExtendedKey(k.xpub, VERSIONS[network]).deriveChild(branch).deriveChild(index);
    if (!child.publicKey) throw new Error('derive');
    return child.publicKey;
  });
  const pay = sortedMultisig(d.threshold, pubkeys, true, btcNetwork(network));
  return { address: pay.address as string, witnessScript: bytesToHex(pay.witnessScript!), pubkeys };
}
