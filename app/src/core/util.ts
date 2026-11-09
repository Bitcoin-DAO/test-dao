// Small shared helpers: hex, hashing, canonical JSON (RFC 8785).
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export { bytesToHex, hexToBytes, utf8ToBytes };

export const isHex = (s: unknown, len?: number): s is string =>
  typeof s === 'string' && /^[0-9a-f]*$/.test(s) && s.length % 2 === 0 && (len === undefined || s.length === len);

export const sha256Hex = (data: Uint8Array | string): string =>
  bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));

/** RFC 8785 JSON Canonicalization Scheme. */
export function jcs(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS: non-finite number');
    return JSON.stringify(value); // ES number serialisation is what JCS specifies
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort((a, b) => {
      // sort by UTF-16 code units
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const d = a.charCodeAt(i) - b.charCodeAt(i);
        if (d) return d;
      }
      return a.length - b.length;
    });
    return '{' + keys.map(k => JSON.stringify(k) + ':' + jcs(obj[k])).join(',') + '}';
  }
  throw new Error('JCS: unsupported value');
}

export const hashJson = (value: unknown): string => sha256Hex(jcs(value));

export function parseJson<T = unknown>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

export const nowSec = () => Math.floor(Date.now() / 1000);
