// Uniform Resources (Blockchain Commons BCR-2020-005, -006, -012): the animated QR format SeedSigner and
// Sparrow use for PSBTs and keys. Written here rather than taken from a library so the app keeps its small,
// browser-only dependencies; checked against the reference JavaScript library and a real SeedSigner's output.
import { sha256 } from '@noble/hashes/sha256';

const WORDS = 'ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybragbrewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdatadaysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexiteyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegeargemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholyhopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugsjumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliarlimplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmissmonknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeckplaypluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofrubyruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxitenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovialvibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawnyellyogayurtzapszerozestzinczonezoom';
const word = (b: number) => WORDS.slice(b * 4, b * 4 + 4);
const MINIMAL = new Map<string, number>(Array.from({ length: 256 }, (_, b) => [word(b)[0] + word(b)[3], b]));

// CRC-32 (IEEE), as bytewords and fountain parts use it.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) (out.set(x, o), (o += x.length));
  return out;
};

/** Bytewords, minimal style: two letters per byte, with a CRC-32 appended. */
export function bytewordsEncode(data: Uint8Array): string {
  return Array.from(concat(data, u32(crc32(data))), b => word(b)[0] + word(b)[3]).join('');
}
export function bytewordsDecode(s: string): Uint8Array {
  const t = s.toLowerCase();
  if (t.length % 2 || t.length < 10) throw new Error('bytewords: bad length');
  const bytes = new Uint8Array(t.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const b = MINIMAL.get(t.slice(i * 2, i * 2 + 2));
    if (b === undefined) throw new Error('bytewords: unknown word');
    bytes[i] = b;
  }
  const body = bytes.slice(0, -4);
  const sum = bytes.slice(-4);
  if (crc32(body) !== ((sum[0] << 24) | (sum[1] << 16) | (sum[2] << 8) | sum[3]) >>> 0) throw new Error('bytewords: checksum');
  return body;
}

// ---- Minimal CBOR: what UR parts, crypto-psbt and crypto-account use (unsigned ints, bytes, text, arrays, maps, tags).
export type Cbor = number | Uint8Array | string | Cbor[] | Map<number, Cbor> | { tag: number; value: Cbor };

function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 65536) return new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
  return concat(new Uint8Array([(major << 5) | 26]), u32(n));
}
export function cborEncode(v: Cbor): Uint8Array {
  if (typeof v === 'number') return head(0, v);
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); return concat(head(3, b.length), b); }
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(cborEncode));
  if (v instanceof Map) return concat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cborEncode(k), cborEncode(x)]));
  return concat(head(6, v.tag), cborEncode(v.value));
}
export function cborDecode(data: Uint8Array): Cbor {
  let p = 0;
  const read = (): Cbor => {
    if (p >= data.length) throw new Error('cbor: truncated');
    const ib = data[p++];
    const major = ib >> 5;
    const info = ib & 31;
    let n: number;
    if (info < 24) n = info;
    else if (info === 24) n = data[p++];
    else if (info === 25) (n = (data[p] << 8) | data[p + 1]), (p += 2);
    else if (info === 26) (n = ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0), (p += 4);
    else if (info === 27 && major === 0) {
      let x = 0;
      for (let i = 0; i < 8; i++) x = x * 256 + data[p + i];
      p += 8;
      n = x;
    } else if (major === 7 && (info === 20 || info === 21)) return info === 21 ? 1 : 0; // false/true as 0/1
    else throw new Error('cbor: unsupported');
    if (major === 7) return n;
    switch (major) {
      case 0: return n;
      case 2: { const b = data.slice(p, p + n); p += n; if (b.length !== n) throw new Error('cbor: truncated'); return b; }
      case 3: { const b = data.slice(p, p + n); p += n; return new TextDecoder().decode(b); }
      case 4: return Array.from({ length: n }, read);
      case 5: { const m = new Map<number, Cbor>(); for (let i = 0; i < n; i++) { const k = read(); m.set(k as number, read()); } return m; }
      case 6: return { tag: n, value: read() };
      default: throw new Error('cbor: unsupported');
    }
  };
  const v = read();
  if (p !== data.length) throw new Error('cbor: trailing data');
  return v;
}

// ---- Fountain codes (BCR-2020-006): which fragments a part mixes. Must match the reference exactly.
class Xoshiro256 {
  private s: bigint[];
  constructor(seed: Uint8Array) {
    const d = sha256(seed);
    this.s = [0, 1, 2, 3].map(i => d.slice(i * 8, i * 8 + 8).reduce((v, b) => (v << 8n) | BigInt(b), 0n));
  }
  private next(): bigint {
    const M = (1n << 64n) - 1n;
    const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & M;
    const s = this.s;
    const result = (rotl((s[1] * 5n) & M, 7n) * 9n) & M;
    const t = (s[1] << 17n) & M;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }
  nextDouble(): number {
    return Number(this.next()) / 18446744073709551616;
  }
  nextInt(low: number, high: number): number {
    return Math.floor(this.nextDouble() * (high - low + 1)) + low;
  }
}

/** Vose's alias method, in the reference's exact order. */
function chooseDegree(seqLen: number, rng: Xoshiro256): number {
  const p = Array.from({ length: seqLen }, (_, i) => 1 / (i + 1));
  const sum = p.reduce((a, b) => a + b, 0);
  const P = p.map(x => (x * seqLen) / sum);
  const prob = new Array<number>(seqLen).fill(0);
  const alias = new Array<number>(seqLen).fill(0);
  const S: number[] = [];
  const L: number[] = [];
  for (let i = seqLen - 1; i >= 0; i--) (P[i] < 1 ? S : L).push(i);
  while (S.length && L.length) {
    const a = S.pop()!;
    const g = L.pop()!;
    prob[a] = P[a];
    alias[a] = g;
    P[g] = P[g] + P[a] - 1;
    (P[g] < 1 ? S : L).push(g);
  }
  while (L.length) prob[L.pop()!] = 1;
  while (S.length) prob[S.pop()!] = 1;
  const c = Math.floor(rng.nextDouble() * seqLen);
  return (rng.nextDouble() < prob[c] ? c : alias[c]) + 1;
}

export function chooseFragments(seqNum: number, seqLen: number, checksum: number): number[] {
  if (seqNum <= seqLen) return [seqNum - 1];
  const rng = new Xoshiro256(concat(u32(seqNum), u32(checksum)));
  const degree = chooseDegree(seqLen, rng);
  const remaining = Array.from({ length: seqLen }, (_, i) => i);
  const shuffled: number[] = [];
  while (remaining.length) shuffled.push(remaining.splice(rng.nextInt(0, remaining.length - 1), 1)[0]);
  return shuffled.slice(0, degree);
}

const xorInto = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };

/** An endless sequence of QR texts for one message: the plain fragments first, then mixed ones. */
export class UrEncoder {
  readonly seqLen: number;
  private fragments: Uint8Array[];
  private checksum: number;
  private seq = 0;
  constructor(readonly type: string, readonly message: Uint8Array, maxFragment = 100, minFragment = 10) {
    this.checksum = crc32(message);
    const maxCount = Math.ceil(message.length / minFragment);
    let len = message.length;
    for (let count = 1; count <= maxCount; count++) { len = Math.ceil(message.length / count); if (len <= maxFragment) break; }
    this.seqLen = Math.ceil(message.length / len);
    this.fragments = Array.from({ length: this.seqLen }, (_, i) => {
      const f = new Uint8Array(len);
      f.set(message.slice(i * len, (i + 1) * len));
      return f;
    });
  }
  get single(): boolean { return this.seqLen === 1; }
  nextPart(): string {
    if (this.single) return `ur:${this.type}/${bytewordsEncode(this.message)}`.toUpperCase();
    this.seq++;
    const mixed = new Uint8Array(this.fragments[0].length);
    for (const i of chooseFragments(this.seq, this.seqLen, this.checksum)) xorInto(mixed, this.fragments[i]);
    const part = cborEncode([this.seq, this.seqLen, this.message.length, this.checksum, mixed]);
    return `ur:${this.type}/${this.seq}-${this.seqLen}/${bytewordsEncode(part)}`.toUpperCase();
  }
}

export interface UrProgress { type?: string; done: boolean; received: number; needed: number }

/** Collects parts in any order (plain or mixed) until the message is complete. */
export class UrDecoder {
  type?: string;
  result?: Uint8Array;
  error?: string;
  private seqLen = 0;
  private messageLen = 0;
  private checksum = 0;
  private simple = new Map<number, Uint8Array>();
  private mixed: { idx: number[]; data: Uint8Array }[] = [];
  private seen = new Set<string>();

  /** Feed one scanned text. Returns false if it is not a UR part of the message being collected. */
  receive(text: string): boolean {
    if (this.result) return true;
    const m = text.trim().toLowerCase().match(/^ur:([a-z0-9-]+)\/(?:(\d+)-(\d+)\/)?([a-z]+)$/);
    if (!m) return false;
    const [, type, seqS, lenS, body] = m;
    if (this.type && type !== this.type) return false;
    let bytes: Uint8Array;
    try { bytes = bytewordsDecode(body); } catch { return false; }
    this.type = type;
    if (!seqS) { this.result = bytes; return true; }
    let part: Cbor;
    try { part = cborDecode(bytes); } catch { return false; }
    if (!Array.isArray(part) || part.length !== 5) return false;
    const [seq, seqLen, messageLen, checksum, data] = part as [number, number, number, number, Uint8Array];
    if (seq !== Number(seqS) || seqLen !== Number(lenS)) return false;
    if (!this.seqLen) Object.assign(this, { seqLen, messageLen, checksum });
    else if (seqLen !== this.seqLen || messageLen !== this.messageLen || checksum !== this.checksum) return false;
    if (this.seen.has(seqS)) return true;
    this.seen.add(seqS);
    this.add(chooseFragments(seq, seqLen, checksum), data.slice());
    if (this.simple.size === this.seqLen) {
      const all = concat(...Array.from({ length: this.seqLen }, (_, i) => this.simple.get(i)!)).slice(0, this.messageLen);
      if (crc32(all) === this.checksum) this.result = all;
      else this.error = 'checksum';
    }
    return true;
  }
  private add(idx: number[], data: Uint8Array) {
    const queue = [{ idx, data }];
    while (queue.length) {
      let { idx, data } = queue.shift()!;
      // Reduce by what is known.
      for (const i of idx.filter(i => this.simple.has(i))) { xorInto(data, this.simple.get(i)!); idx = idx.filter(x => x !== i); }
      if (!idx.length) continue;
      if (idx.length === 1) {
        if (this.simple.has(idx[0])) continue;
        this.simple.set(idx[0], data);
        // Reduce stored mixed parts by the new fragment.
        const keep: typeof this.mixed = [];
        for (const mx of this.mixed) {
          if (mx.idx.includes(idx[0])) queue.push(mx); else keep.push(mx);
        }
        this.mixed = keep;
      } else {
        const key = [...idx].sort((a, b) => a - b).join(',');
        if (!this.mixed.some(x => [...x.idx].sort((a, b) => a - b).join(',') === key)) {
          // A mixed part that is a superset of another by one fragment gives that fragment.
          this.mixed.push({ idx, data });
        }
      }
    }
  }
  get progress(): UrProgress {
    return { type: this.type, done: !!this.result, received: this.result ? this.seqLen || 1 : this.simple.size, needed: this.seqLen || 1 };
  }
}
