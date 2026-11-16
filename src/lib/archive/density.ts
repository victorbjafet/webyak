import type { ArchiveQuery } from './query';
import type { ArchivedContent } from './types';

/**
 * Post density over time, for the chart beside archive search.
 *
 * Two counts per time bucket, taken in the same pass: records matching the
 * search, and the **baseline**, everything of the same kind. The baseline is
 * what makes a trend readable. A word used twice as often in a month when the
 * community posted twice as much hasn't trended at all, and only the share
 * shows that.
 *
 * Pure, so the bucketing can be checked without a browser. The scan itself is
 * `countDensity` in the store.
 */

export type DensityUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface DensityBucket {
  /** The bucket's first day, `YYYY-MM-DD` (UTC). */
  key: string;
  matching: number;
  all: number;
}

export interface DensityResult {
  unit: DensityUnit;
  /** ISO bounds that were counted. */
  start: string;
  end: string;
  /** Every bucket in the range, empty ones included, oldest first. */
  buckets: DensityBucket[];
  matching: number;
  all: number;
  /** What the baseline counts, for labels: "posts", "posts with replies"… */
  baseline: string;
  /** Records read, and how long it took: the honest cost of a refresh. */
  scanned: number;
  ms: number;
}

const DAY_MS = 86_400_000;

const UNITS: { unit: DensityUnit; approxMs: number }[] = [
  { unit: 'day', approxMs: DAY_MS },
  { unit: 'week', approxMs: 7 * DAY_MS },
  { unit: 'month', approxMs: 30.44 * DAY_MS },
  { unit: 'quarter', approxMs: 91.31 * DAY_MS },
  { unit: 'year', approxMs: 365.25 * DAY_MS },
];

/** The finest unit that fits the range into `maxBuckets` columns. */
export function chooseUnit(start: string, end: string, maxBuckets: number): DensityUnit {
  const span = Math.max(0, Date.parse(end) - Date.parse(start));
  for (const { unit, approxMs } of UNITS) if (span / approxMs < maxBuckets) return unit;
  return 'year';
}

/**
 * The first day of the bucket an ISO timestamp falls in. Weeks start on
 * Monday. Everything is UTC, the same as `created_at`, so a bucket can't move
 * by a day depending on where the chart is drawn.
 */
export function bucketStart(iso: string, unit: DensityUnit): string {
  switch (unit) {
    case 'day':
      return iso.slice(0, 10);
    case 'week': {
      const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      return date.toISOString().slice(0, 10);
    }
    case 'month':
      return `${iso.slice(0, 7)}-01`;
    case 'quarter': {
      const month = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) * 3 + 1;
      return `${iso.slice(0, 4)}-${String(month).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${iso.slice(0, 4)}-01-01`;
  }
}

/** The first day of the bucket after `key`. Stepping from the 1st never overflows a month. */
function nextBucket(key: string, unit: DensityUnit): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() + 1);
  else if (unit === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (unit === 'quarter') date.setUTCMonth(date.getUTCMonth() + 3);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

/** The last day a bucket covers, `YYYY-MM-DD`, for zooming into it. */
export function bucketEnd(key: string, unit: DensityUnit): string {
  const date = new Date(`${nextBucket(key, unit)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Every bucket from start to end, so a stretch with nothing still gets its column. */
export function bucketsBetween(start: string, end: string, unit: DensityUnit): string[] {
  const out: string[] = [];
  const last = bucketStart(end, unit);
  for (let key = bucketStart(start, unit); key <= last; key = nextBucket(key, unit)) out.push(key);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A bucket named for the readout: "Week of 2026-03-02", "Mar 2026", "Q1 2026". */
export function bucketLabel(key: string, unit: DensityUnit, short = false): string {
  const year = key.slice(0, 4);
  const month = MONTHS[Number(key.slice(5, 7)) - 1];
  switch (unit) {
    case 'day':
      return key;
    case 'week':
      return short ? key : `Week of ${key}`;
    case 'month':
      return `${month} ${year}`;
    case 'quarter':
      return `Q${Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1} ${year}`;
    case 'year':
      return year;
  }
}

/** A clean axis maximum at or above `value`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * power) return step * power;
  return 10 * power;
}

/**
 * Whether a record counts towards the baseline: the same kind as the search
 * asks for, ignoring its words and its narrower filters.
 *
 * - The type, and the community, are kept: comments against all posts is not a
 *   share of anything.
 * - Deleted records count once the search includes them, so `is:deleted` reads
 *   as the share of everything that was removed.
 * - A `thread:` search compares against **posts with replies**. A post with
 *   none has no thread to be missing, so "a third of threads missing" is the
 *   honest figure, not a third of all posts.
 */
export function inBaseline(record: ArchivedContent, query: ArchiveQuery): boolean {
  if (!query.deleted && record.deleted) return false;
  const type = query.thread ? 'post' : query.type;
  if (type && record.type !== type) return false;
  if (query.thread && !((record.comment_count ?? 0) > 0)) return false;
  if (query.group && !(record.group_name ?? '').toLowerCase().includes(query.group)) return false;
  return true;
}

/** What `inBaseline` counts, in words. */
export function baselineLabel(query: ArchiveQuery): string {
  const kind = query.thread
    ? 'posts with replies'
    : query.type === 'post'
      ? 'posts'
      : query.type === 'comment'
        ? 'comments'
        : 'posts and comments';
  return query.group ? `${kind} in ${query.group}` : kind;
}

/**
 * The search's words, which the store's own filter leaves to the token index.
 * Prefix-matched, as search matches them.
 */
export function matchesTerms(record: ArchivedContent, query: ArchiveQuery): boolean {
  for (const term of query.terms) {
    if (!record.tokens?.some((token) => token.startsWith(term))) return false;
  }
  return true;
}
