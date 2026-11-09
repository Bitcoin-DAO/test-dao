// Relay access: query every configured relay, de-duplicate by id, publish to all.
import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { Event } from '../core/events';

let pool: SimplePool | undefined;
const getPool = () => (pool ??= new SimplePool());

export async function query(relays: string[], filter: Filter, maxWait = 5000): Promise<Event[]> {
  if (!relays.length) return [];
  return getPool().querySync(relays, filter, { maxWait });
}

export interface PublishResult {
  ok: string[];
  failed: { relay: string; reason: string }[];
}

export async function publish(relays: string[], event: Event): Promise<PublishResult> {
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: 8000 }));
  const out: PublishResult = { ok: [], failed: [] };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.ok.push(relays[i]);
    else out.failed.push({ relay: relays[i], reason: String((r.reason as Error)?.message ?? r.reason) });
  });
  return out;
}
