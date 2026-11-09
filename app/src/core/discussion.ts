// Discussion (protocol 4.5): idea → draft → discuss → proposal, one public thread per proposal.
// Drafts (dao.draft), posts (dao.post) and withdrawals (dao.withdraw) live on the DAO's relays like every
// other DAO event. The relay accepts them from any key; this module keeps only what members wrote, in the
// rules of section 4.5, and derives each draft's status from the events.
import { KIND, tagValue, type Event } from './events';
import { PROPOSAL_TYPES, type ProposalContent, type ProposalType, type ProposalView, type Rejected } from './state';
import { hashJson, parseJson } from './util';

/** A version card: a complete or partial snapshot of the proposal fields. An idea is a v1 with a title only. */
export interface DraftContent {
  version: number;
  title: string;
  summary?: string;
  type?: ProposalType;
  payload?: Record<string, any>;
  lang?: string;
}

export interface DraftVersion {
  n: number;
  event: Event;
  content: DraftContent;
}

export type ThreadStatus = 'open' | 'submitted' | 'withdrawn' | 'proposal';

export interface Thread {
  /** The draft's id (its v1 event), or a proposal's id for a proposal made without a draft. */
  id: string;
  kind: 'draft' | 'proposal';
  /** The author's person id. */
  author: string;
  title: string;
  versions: DraftVersion[];
  posts: Event[];
  status: ThreadStatus;
  /** The proposal this thread led to (or is about). */
  proposal?: ProposalView;
  /** The version the proposal was made from, and whether the proposal still says exactly that. */
  submitted?: { version: number; matches: boolean };
  withdrawn?: Event;
  created: number;
  lastActivity: number;
}

export interface Discussion {
  threads: Thread[]; // by last activity, newest first
  byId: Map<string, Thread>;
  /** The thread of a proposal: its draft's, or its own. */
  ofProposal: Map<string, Thread>;
}

export const POST_MAX = 2000;

const isStr = (x: unknown, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

export function draftSchemaError(c: DraftContent | undefined): string | undefined {
  if (!c || typeof c !== 'object') return 'not an object';
  if (!Number.isInteger(c.version) || c.version < 1) return 'version';
  if (!isStr(c.title, 80)) return 'title';
  if (c.summary !== undefined && (typeof c.summary !== 'string' || c.summary.length > 500)) return 'summary';
  if (c.type !== undefined && !PROPOSAL_TYPES.includes(c.type)) return 'type';
  if (c.payload !== undefined && (!c.payload || typeof c.payload !== 'object')) return 'payload';
  return undefined;
}

/** The proposal fields a version card fixes: a proposal made from it says exactly these. */
export const versionFields = (c: Pick<ProposalContent, 'type' | 'title' | 'summary' | 'payload'> | DraftContent) =>
  hashJson({ type: c.type ?? null, title: c.title, summary: c.summary ?? '', payload: c.payload ?? {} });

export interface DiscussionInput {
  events: Event[];
  proposals: ProposalView[];
  memberAt(key: string, t: number): boolean;
  personOf(key: string): string;
  rejected: Rejected[];
}

export function buildDiscussion({ events, proposals, memberAt, personOf, rejected }: DiscussionInput): Discussion {
  const ofKind = (k: number) => events.filter(e => e.kind === k).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  const byId = new Map<string, Thread>();
  const reject = (event: Event, reason: string) => rejected.push({ event, reason });

  // Drafts: a v1 opens a thread; later versions only from the same person, in order.
  const drafts = ofKind(KIND.draft);
  for (const e of drafts) {
    const c = parseJson<DraftContent>(e.content) ?? undefined;
    const err = draftSchemaError(c);
    if (err) { reject(e, `draft: ${err}`); continue; }
    if (!memberAt(e.pubkey, e.created_at)) { reject(e, 'draft: signer is not a member'); continue; }
    if (c!.version === 1 && !tagValue(e, 'e')) {
      byId.set(e.id, {
        id: e.id, kind: 'draft', author: personOf(e.pubkey), title: c!.title, versions: [{ n: 1, event: e, content: c! }], posts: [],
        status: 'open', created: e.created_at, lastActivity: e.created_at,
      });
    }
  }

  // Submissions: the first proposal by the draft's author that names it. It freezes the versions.
  const submittedAt = new Map<string, { at: number; proposal: ProposalView; version: number }>();
  for (const p of [...proposals].sort((a, b) => a.event.created_at - b.event.created_at)) {
    const ref = p.content.draft;
    const th = ref && byId.get(ref.id);
    if (!ref || !th || submittedAt.has(ref.id)) continue;
    if (personOf(p.event.pubkey) !== th.author) continue;
    submittedAt.set(ref.id, { at: p.event.created_at, proposal: p, version: ref.version });
  }

  const withdrawals = new Map<string, Event>();
  for (const e of ofKind(KIND.withdraw)) {
    const id = tagValue(e, 'e');
    const th = id ? byId.get(id) : undefined;
    if (!th) { reject(e, 'withdraw: no such draft'); continue; }
    if (personOf(e.pubkey) !== th.author) { reject(e, 'withdraw: not the author'); continue; }
    const sub = submittedAt.get(th.id);
    if (sub && e.created_at >= sub.at) { reject(e, 'withdraw: already submitted'); continue; }
    if (!withdrawals.has(th.id)) withdrawals.set(th.id, e);
  }

  for (const e of drafts) {
    const id = tagValue(e, 'e');
    if (!id) continue;
    const th = byId.get(id);
    const c = parseJson<DraftContent>(e.content) ?? undefined;
    if (!th || draftSchemaError(c)) { if (!th) reject(e, 'draft: no such draft'); continue; }
    if (!memberAt(e.pubkey, e.created_at)) continue; // rejected above
    if (personOf(e.pubkey) !== th.author) { reject(e, 'draft: only the author adds versions'); continue; }
    const sub = submittedAt.get(th.id);
    // Strictly after: a version and its submission can share a second (timestamps are whole seconds).
    if (sub && e.created_at > sub.at) { reject(e, 'draft: frozen, the proposal is open'); continue; }
    const w = withdrawals.get(th.id);
    if (w && e.created_at >= w.created_at) { reject(e, 'draft: withdrawn'); continue; }
    if (c!.version !== th.versions.length + 1) { reject(e, `draft: version ${c!.version} out of order`); continue; }
    th.versions.push({ n: c!.version, event: e, content: c! });
    th.title = c!.title;
  }

  // Proposals: a submitted draft's thread carries on through the vote; other proposals get their own.
  const ofProposal = new Map<string, Thread>();
  for (const p of proposals) {
    const ref = p.content.draft;
    const sub = ref ? submittedAt.get(ref.id) : undefined;
    if (ref && sub && sub.proposal === p) {
      const th = byId.get(ref.id)!;
      const v = th.versions.find(x => x.n === sub.version);
      th.status = 'submitted';
      th.proposal = p;
      th.submitted = { version: sub.version, matches: !!v && versionFields(v.content) === versionFields(p.content) };
      th.title = p.content.title;
      th.lastActivity = Math.max(th.lastActivity, p.event.created_at);
      ofProposal.set(p.event.id, th);
      continue;
    }
    const th: Thread = {
      id: p.event.id, kind: 'proposal', author: personOf(p.event.pubkey), title: p.content.title, versions: [], posts: [],
      status: 'proposal', proposal: p, created: p.event.created_at, lastActivity: p.event.created_at,
    };
    byId.set(th.id, th);
    ofProposal.set(p.event.id, th);
  }
  for (const [id, w] of withdrawals) {
    const th = byId.get(id)!;
    if (th.status === 'open') { th.status = 'withdrawn'; th.withdrawn = w; th.lastActivity = Math.max(th.lastActivity, w.created_at); }
  }
  for (const th of byId.values()) for (const v of th.versions) th.lastActivity = Math.max(th.lastActivity, v.event.created_at);

  // Posts: members only, plain text, to a draft or a proposal (a submitted draft's proposal id leads to the draft).
  for (const e of ofKind(KIND.post)) {
    const to = tagValue(e, 'e');
    const th = to ? byId.get(to) ?? ofProposal.get(to) : undefined;
    const c = parseJson<{ text?: string }>(e.content);
    if (!th) { reject(e, 'post: no such thread'); continue; }
    if (!c || !isStr(c.text, POST_MAX)) { reject(e, 'post: malformed'); continue; }
    if (!memberAt(e.pubkey, e.created_at)) { reject(e, 'post: signer is not a member'); continue; }
    // A withdrawn draft is closed: what was said stays, nothing new is added.
    if (th.withdrawn && e.created_at > th.withdrawn.created_at) { reject(e, 'post: the draft is withdrawn'); continue; }
    th.posts.push(e);
    th.lastActivity = Math.max(th.lastActivity, e.created_at);
  }

  const threads = [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  return { threads, byId, ofProposal };
}

/** The thread's entries in time order: version cards and posts interleaved. */
export function timeline(th: Thread): ({ kind: 'version'; v: DraftVersion } | { kind: 'post'; event: Event })[] {
  const items = [
    ...th.versions.map(v => ({ kind: 'version' as const, v, at: v.event.created_at, id: v.event.id })),
    ...th.posts.map(event => ({ kind: 'post' as const, event, at: event.created_at, id: event.id })),
  ].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return items.map(({ at: _at, id: _id, ...x }) => x as any);
}
