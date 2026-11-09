// Short code read aloud at onboarding (protocol 1.6).
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes } from '@noble/hashes/utils';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** First 40 bits of sha256(pubkey bytes), Crockford base32: 8 characters. */
export function shortCode(pubkeyHex: string): string {
  const h = sha256(hexToBytes(pubkeyHex));
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(h[i]);
  let out = '';
  for (let i = 7; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

/** Shown as XXXX · XXXX. */
export const formatShortCode = (code: string) => `${code.slice(0, 4)} · ${code.slice(4)}`;
