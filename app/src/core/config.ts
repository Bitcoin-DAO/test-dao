// The DAO config: the site's own file before founding, and the genesis config after.
export type Network = 'testnet4' | 'mainnet';

/** Every DAO goes through three stages, each its own DAO and build: practice and testnet are disposable. */
export type Stage = 'practice' | 'testnet' | 'mainnet';
export const stageOf = (c: { stage?: Stage; network: Network }): Stage => c.stage ?? (c.network === 'mainnet' ? 'mainnet' : 'testnet');
export function stageError(c: { stage?: Stage; network: Network }): string | undefined {
  const s = stageOf(c);
  if (s === 'mainnet' && c.network !== 'mainnet') return 'a mainnet DAO must be on mainnet';
  if (s !== 'mainnet' && c.network === 'mainnet') return `a ${s} DAO must be on testnet4`;
}

export interface CouncilEntry {
  label: string;
  identityKey: string; // hex x-only
  fingerprint: string; // 8 hex
  xpub: string; // tpub/xpub at m/48'/coin'/0'/2'
  /** Where the treasury key lives: a SeedSigner (and its SeedQR card), or absent for a trial key on a phone. */
  device?: 'seedsigner';
}

export interface Founder {
  name: string;
  identityKey: string;
  verified: 'in_person' | 'remote';
}

export interface Rules {
  votingPeriodDays: number;
  quorum: string;
  simpleMajority: string[];
  twoThirdsMajority: string[];
  payoutRound: string;
  timezone: string;
  lapseAfterRounds: number;
  maxFeeRateSatVb: number;
  /** How rounds choose their fee: "fast" (the next block, the default) or "economical" (about an hour). */
  feePolicy?: 'fast' | 'economical';
  treasuryCapSats: number;
  remoteVerification: Record<string, unknown>;
  minimumAge: number;
  /** Primary funding model, chosen after reading docs/funding-models.md. Informational only. */
  fundingModel?: 'grant' | 'production' | 'mutual' | 'revolving';
  /** Language of the binding charter text, as a language code ("en", "it"). English if unset. */
  charterLanguage?: string;
  charterSha256: string;
  [k: string]: unknown;
}

export interface DaoConfig {
  configVersion: number;
  stage?: Stage;
  name: string;
  description: string;
  languages: string[];
  network: Network;
  site: string;
  passkeyDomain: string;
  council: CouncilEntry[];
  founders: Founder[];
  threshold: number;
  descriptor: string;
  relays: string[];
  chainApi: string[];
  rules: Rules;
  /** Confirmations a round's transaction needs before the council publishes its receipt (3 if unset), so a reorg cannot leave a false receipt. */
  receiptConfirmations?: number;
  /**
   * Web pages where anyone can paste a signed transaction to broadcast it by hand ("Send it by hand").
   * Unset: each chain source's own page. A page here is never read by the app, so a service that only
   * works in a browser (no API access from web pages) can still be offered.
   */
  broadcastPages?: string[];
  /** Practice and testnet stages: the organisation's testnet4 wallet that funds them and gets the coins back at closing. */
  testnetTreasury?: { name: string; address: string };
  branding?: { logo: string | null; colours?: Record<string, string> };
}

/** The file the site is built with. `daoId` is added once the DAO is founded. */
export interface SiteConfig extends DaoConfig {
  daoId?: string;
}

/** Values in square brackets in the example config are placeholders. */
export const isPlaceholder = (s: unknown) => typeof s === 'string' && /^\[.*\]$|\[[^\]]+\]/.test(s);

/** Relays and chain APIs with placeholders are dropped. */
export function usable(urls: string[]): string[] {
  return urls.filter(u => !isPlaceholder(u));
}

export const BIP48_PATH = (network: Network) => (network === 'mainnet' ? "48h/0h/0h/2h" : "48h/1h/0h/2h");

/** The parts of the genesis config the setup page fills in; everything else comes from the site file. */
export function buildGenesis(site: SiteConfig, fill: {
  name: string;
  description: string;
  council: CouncilEntry[];
  founders: Founder[];
  threshold: number;
  descriptor: string;
  charterSha256: string;
  /** The vote length chosen at founding, if not the site file's. */
  votingPeriodDays?: number;
}): DaoConfig {
  const { daoId: _ignored, ...base } = site;
  return {
    ...base,
    name: fill.name,
    description: fill.description,
    council: fill.council,
    founders: fill.founders,
    threshold: fill.threshold,
    descriptor: fill.descriptor,
    relays: usable(site.relays),
    chainApi: usable(site.chainApi),
    rules: { ...site.rules, ...(fill.votingPeriodDays ? { votingPeriodDays: fill.votingPeriodDays } : {}), charterSha256: fill.charterSha256 },
  };
}

/** Practice votes last 10 minutes; anything under a day counts as practice. */
export const PRACTICE_VOTE_DAYS = 10 / 1440;
export const isPracticeVotes = (days: number) => days < 1;

/** The suggested threshold for a council of n: a majority, so one key can be lost (2 of 3, 3 of 5). */
export const suggestedThreshold = (n: number) => (n <= 2 ? Math.max(1, n) : Math.floor(n / 2) + 1);

/**
 * Founding setup: before publishing, the threshold follows the council actually added (not the
 * site file's placeholders) unless the founder set it by hand, and never exceeds the council.
 */
export function settleThreshold<S extends { council: unknown[]; threshold: number; thresholdSet?: boolean; genesisId?: string }>(s: S): S {
  if (s.genesisId) return s;
  const n = s.council.length;
  const threshold = s.thresholdSet ? Math.max(1, Math.min(s.threshold, n)) : suggestedThreshold(n);
  return threshold === s.threshold ? s : { ...s, threshold };
}
