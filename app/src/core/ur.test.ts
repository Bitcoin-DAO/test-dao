// UR (animated QR) against the reference library and a real SeedSigner's output (docs/seedsigner.md).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { UREncoder, UR, URDecoder } from '@ngraveio/bc-ur';
import { bytewordsDecode, bytewordsEncode, cborDecode, cborEncode, UrDecoder, UrEncoder } from './ur';
import { psbtEncoder, readKeyExport, readPsbt } from './hwkeys';

const CARD_A = { fingerprint: 'd3bdd580', xpub: 'tpubDFKVE4hAcCsmYyXX8mURCAE3smjoLhyqGH5CtJjgyhBBQR9VopPxmK24XsjmbG4XTvHoQo73WBRnC2aLuG5mbUPemuyvUBJUEeDMM5nyG8e' };
const device = readFileSync(new URL('./fixtures/seedsigner-0.8.6-xpub-card-a.txt', import.meta.url), 'utf8').trim().split('\n');
const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 17) & 255);

describe('bytewords and CBOR', () => {
  it('round-trip, and refuse a damaged text', () => {
    const b = bytes(40);
    expect(bytewordsDecode(bytewordsEncode(b))).toEqual(b);
    const s = bytewordsEncode(b);
    expect(() => bytewordsDecode(s.slice(0, -2) + (s.endsWith('ae') ? 'ad' : 'ae'))).toThrow();
    const v = [3, 10, 1234, 4294967295, b, new Map([[1, 'x']])];
    expect(cborDecode(cborEncode(v as never))).toEqual(v);
  });
});

describe('fountain parts', () => {
  it('match the reference library part for part, plain and mixed', () => {
    for (const len of [20, 150, 1000]) {
      const msg = bytes(len, len);
      const ours = new UrEncoder('bytes', cborEncode(msg), 60);
      const ref = new UREncoder(new UR(Buffer.from(cborEncode(msg)), 'bytes'), 60, 0, 10);
      for (let i = 0; i < 40; i++) expect(ours.nextPart()).toBe(ref.nextPart().toUpperCase());
    }
  });

  it('decode the reference library\'s parts, from mixed parts alone', () => {
    const msg = cborEncode(bytes(700));
    const ref = new UREncoder(new UR(Buffer.from(msg), 'bytes'), 80, 0, 10);
    const parts = Array.from({ length: 60 }, () => ref.nextPart());
    const d = new UrDecoder();
    for (const p of parts.slice(ref.fragmentsLength)) { d.receive(p); if (d.result) break; } // skip every plain fragment
    expect(d.result).toEqual(msg);
  });

  it('our parts decode in the reference library, in any order', () => {
    const msg = cborEncode(bytes(500));
    const enc = new UrEncoder('bytes', msg, 50);
    const parts = Array.from({ length: 40 }, () => enc.nextPart()).reverse();
    const ref = new URDecoder();
    for (const p of parts) { ref.receivePart(p.toLowerCase()); if (ref.isComplete()) break; }
    expect(ref.isSuccess()).toBe(true);
    expect(new Uint8Array(ref.resultUR().cbor)).toEqual(msg);
  });

  it('ignores other texts and parts of another message', () => {
    const d = new UrDecoder();
    expect(d.receive('hello')).toBe(false);
    const a = new UrEncoder('bytes', cborEncode(bytes(300, 1)), 50);
    const b = new UrEncoder('bytes', cborEncode(bytes(300, 2)), 50);
    expect(d.receive(a.nextPart())).toBe(true);
    expect(d.receive(b.nextPart())).toBe(false);
  });
});

describe('a real SeedSigner (0.8.6) key export, card A', () => {
  it('decodes from any frames of the video, and reads as card A\'s key on testnet4', () => {
    for (const start of [0, 10, 30]) {
      const d = new UrDecoder();
      for (const p of device.slice(start)) { d.receive(p); if (d.result) break; }
      expect(d.type).toBe('crypto-account');
      expect(readKeyExport({ type: d.type!, cbor: d.result! }, 'testnet4')).toEqual({ ...CARD_A, path: '48h/1h/0h/2h', network: 'testnet4' });
    }
  });

  it('refuses it for a mainnet DAO', () => {
    const d = new UrDecoder();
    for (const p of device) { d.receive(p); if (d.result) break; }
    expect(() => readKeyExport({ type: d.type!, cbor: d.result! }, 'mainnet')).toThrow(/testnet4 key, but this DAO is on mainnet/);
  });

  it('accepts the same key typed as key-origin text', () => {
    expect(readKeyExport(`[d3bdd580/48h/1h/0h/2h]${CARD_A.xpub}`, 'testnet4')).toMatchObject(CARD_A);
  });
});

describe('PSBT exchange', () => {
  it('a PSBT goes out as crypto-psbt and comes back unchanged', () => {
    const psbt = Buffer.concat([Buffer.from('70736274ff', 'hex'), Buffer.from(bytes(400))]).toString('base64');
    const enc = psbtEncoder(psbt);
    const d = new UrDecoder();
    for (let i = 0; i < 50 && !d.result; i++) d.receive(enc.nextPart());
    expect(readPsbt({ type: d.type!, cbor: d.result! })).toBe(psbt);
  });
});
