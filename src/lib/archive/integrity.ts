import type { ArchivedContent } from './types';

/**
 * Checks the archive for holes.
 *
 * ## Why a flat average is the wrong tool
 *
 * The obvious check — posts per day against the overall average — produces
 * confident nonsense on this data. Measured over a real 157k-post Virginia Tech
 * archive:
 *
 * | Period | Posts/day | vs median |
 * |---|---|---|
 * | June–July 2025 | ~80 | 28% |
 * | June–July 2026 | ~70–82 | 25% |
 * | September, both years | 487–604 | 170–210% |
 *
 * A university empties out over summer and fills in September. Both summers look
 * like catastrophic data loss against a flat average and neither is: the pattern
 * repeats a year apart, which is the signature of a real seasonal cycle rather
 * than a broken crawl.
 *
 * So every day is judged against its **local neighbourhood** — the median of the
 * surrounding weeks — not against the year. A genuine dropout is a day far below
 * days either side of it; a quiet July is not, because its neighbours are quiet
 * too.
 */

/** Days either side used as the comparison window. Wide enough to span a week's rhythm. */
const WINDOW_DAYS = 14;
/** A day below this share of its local median is suspicious. */
const GAP_THRESHOLD = 0.25;
/** Runs shorter than this are noise — a quiet Sunday is not a gap. */
const MIN_GAP_DAYS = 2;

export interface ArchiveGap {
  start: string;
  end: string;
  days: number;
  /** Posts actually archived across the run. */
  observed: number;
  /** What the surrounding weeks would predict. */
  expected: number;
}

export interface IntegrityReport {
  records: number;
  posts: number;
  comments: number;

  oldest?: string;
  newest?: string;
  spanDays: number;
  daysCovered: number;
  emptyDays: number;
  medianPerDay: number;
  meanPerDay: number;

  gaps: ArchiveGap[];
  /** Total posts the gaps appear to be missing, by local expectation. */
  estimatedMissing: number;

  /**
   * Whether the oldest edge stops abruptly or fades out.
   *
   * A crawl that ran out of history stops at full volume; one that was
   * interrupted or throttled thins out first. This is the difference between
   * "the server has no more" and "we didn't finish".
   */
  edge: {
    firstDayCount: number;
    firstWeekPerDay: number;
    /** First week at or near normal volume — a floor, not a fade. */
    abrupt: boolean;
  };

  structural: {
    missingCreatedAt: number;
    missingGroup: number;
    /** Records with no tokens: present in the archive, invisible to search. */
    untokenized: number;
    /** Comments whose parent post is not archived. */
    orphanComments: number;
    /** Two records sharing a share code — should never happen. */
    duplicateIndexCodes: number;
    /** Posts with replies whose threads have not been collected. */
    threadsUncollected: number;
    mediaPending: number;
  };

  ms: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  const start = Date.parse(`${a}T00:00:00.000Z`);
  const end = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Builds the report from records streamed in one at a time.
 *
 * Takes a feeder rather than an array so the caller can walk an IndexedDB cursor
 * without materialising 157,000 objects at once — and so this stays a pure
 * function that can be tested against an exported file.
 */
export function analyseArchive(
  forEach: (visit: (record: ArchivedContent) => void) => Promise<void>,
): Promise<IntegrityReport> {
  const startedAt = Date.now();

  const perDay = new Map<string, number>();
  const postIds = new Set<string>();
  const commentParents: string[] = [];
  const indexCodes = new Set<string>();

  let records = 0;
  let posts = 0;
  let comments = 0;
  let oldest: string | undefined;
  let newest: string | undefined;
  const structural = {
    missingCreatedAt: 0,
    missingGroup: 0,
    untokenized: 0,
    orphanComments: 0,
    duplicateIndexCodes: 0,
    threadsUncollected: 0,
    mediaPending: 0,
  };

  return forEach((record) => {
    records += 1;
    if (record.type === 'comment') {
      comments += 1;
      if (record.parent_post_id) commentParents.push(record.parent_post_id);
    } else {
      posts += 1;
      postIds.add(record.id);
    }

    if (!record.created_at) {
      structural.missingCreatedAt += 1;
    } else {
      const key = dayKey(record.created_at);
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
      if (!oldest || record.created_at < oldest) oldest = record.created_at;
      if (!newest || record.created_at > newest) newest = record.created_at;
    }

    if (!record.group_id) structural.missingGroup += 1;
    if (!record.tokens || record.tokens.length === 0) structural.untokenized += 1;
    if (record.needs_comments) structural.threadsUncollected += 1;
    if (record.media_pending) structural.mediaPending += 1;

    if (record.index_code) {
      if (indexCodes.has(record.index_code)) structural.duplicateIndexCodes += 1;
      else indexCodes.add(record.index_code);
    }
  }).then(() => {
    // Orphans are resolved after the walk, since a comment can arrive before its
    // parent does.
    for (const parent of commentParents) {
      if (!postIds.has(parent)) structural.orphanComments += 1;
    }

    if (!oldest || !newest) {
      return {
        records,
        posts,
        comments,
        spanDays: 0,
        daysCovered: 0,
        emptyDays: 0,
        medianPerDay: 0,
        meanPerDay: 0,
        gaps: [],
        estimatedMissing: 0,
        edge: { firstDayCount: 0, firstWeekPerDay: 0, abrupt: false },
        structural,
        ms: Date.now() - startedAt,
      };
    }

    const first = dayKey(oldest);
    const last = dayKey(newest);
    const spanDays = daysBetween(first, last) + 1;

    const counts: number[] = [];
    for (let i = 0; i < spanDays; i += 1) counts.push(perDay.get(addDays(first, i)) ?? 0);

    const covered = counts.filter((c) => c > 0);
    const medianPerDay = median(covered);
    const meanPerDay = covered.length ? covered.reduce((a, b) => a + b, 0) / covered.length : 0;

    /*
      Local expectation for each day: the median of the surrounding weeks,
      excluding the day itself so a zero cannot drag down its own baseline.
      This is what survives summer — a quiet July day sits among other quiet
      July days, so its local median is quiet too.
    */
    const gaps: ArchiveGap[] = [];
    let estimatedMissing = 0;
    let runStart: number | null = null;
    let runExpected = 0;
    let runObserved = 0;

    const localMedian = (index: number) => {
      const window: number[] = [];
      for (let i = index - WINDOW_DAYS; i <= index + WINDOW_DAYS; i += 1) {
        if (i === index || i < 0 || i >= counts.length) continue;
        window.push(counts[i]);
      }
      return median(window);
    };

    const closeRun = (endIndex: number) => {
      if (runStart === null) return;
      const days = endIndex - runStart + 1;
      if (days >= MIN_GAP_DAYS) {
        gaps.push({
          start: addDays(first, runStart),
          end: addDays(first, endIndex),
          days,
          observed: runObserved,
          expected: Math.round(runExpected),
        });
        estimatedMissing += Math.max(0, Math.round(runExpected - runObserved));
      }
      runStart = null;
      runExpected = 0;
      runObserved = 0;
    };

    for (let i = 0; i < counts.length; i += 1) {
      const expected = localMedian(i);
      const suspicious = expected > 0 && counts[i] < expected * GAP_THRESHOLD;
      if (suspicious) {
        if (runStart === null) runStart = i;
        runExpected += expected;
        runObserved += counts[i];
      } else {
        closeRun(i - 1);
      }
    }
    closeRun(counts.length - 1);

    // Edge: full volume at the oldest day means the crawl hit a floor rather
    // than petering out.
    const firstWeek = counts.slice(0, 7);
    const firstWeekPerDay = firstWeek.length
      ? firstWeek.reduce((a, b) => a + b, 0) / firstWeek.length
      : 0;

    return {
      records,
      posts,
      comments,
      oldest,
      newest,
      spanDays,
      daysCovered: covered.length,
      emptyDays: spanDays - covered.length,
      medianPerDay,
      meanPerDay,
      gaps: gaps.sort((a, b) => b.expected - b.observed - (a.expected - a.observed)),
      estimatedMissing,
      edge: {
        firstDayCount: counts[0] ?? 0,
        firstWeekPerDay,
        abrupt: medianPerDay > 0 && firstWeekPerDay >= medianPerDay * 0.5,
      },
      structural,
      ms: Date.now() - startedAt,
    };
  });
}
