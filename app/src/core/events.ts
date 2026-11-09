// Event kinds and templates (protocol 1.1, 1.2, 2).
import { finalizeEvent, getEventHash, type Event, type EventTemplate } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1';
import { hexToBytes, jcs, nowSec } from './util';

export type { Event };

export const KIND = {
  genesis: 3570,
  endorse: 3571,
  roster: 3572,
  settings: 3573,
  proposal: 3574,
  confirm: 3575,
  vote: 3576,
  tally: 3577,
  verify: 3578,
  rekey: 3579,
  leave: 3580,
  round: 3581,
  sign: 3582,
  receipt: 3583,
  anchor: 3584,
  listing: 3585,
  keywrap: 3586,
  draft: 3587,
  post: 3588,
  withdraw: 3589,
  keystatus: 3590,
} as const;

export const ALL_KINDS = Object.values(KIND);

export const tagValue = (e: Event, name: string) => e.tags.find(t => t[0] === name)?.[1];
export const tagValues = (e: Event, name: string) => e.tags.filter(t => t[0] === name).map(t => t[1]);

export function template(kind: number, daoId: string, content: unknown, extra: string[][] = [], created_at = nowSec()): EventTemplate {
  return {
    kind,
    created_at,
    tags: [['D', daoId], ['v', '1'], ...extra],
    content: typeof content === 'string' ? content : jcs(content),
  };
}

export const sign = (t: EventTemplate, secretHex: string): Event => finalizeEvent(t, hexToBytes(secretHex));

/** Full check every time (nostr-tools caches its result on the object, which copies can carry). */
export const verified = (e: Event) => {
  try {
    if (typeof e.content !== 'string' || !Array.isArray(e.tags)) return false;
    return getEventHash(e) === e.id && schnorr.verify(e.sig, e.id, e.pubkey);
  } catch {
    return false;
  }
};

/** Sort by created_at, then id: the protocol's order everywhere. */
export const byTime = (a: Event, b: Event) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
