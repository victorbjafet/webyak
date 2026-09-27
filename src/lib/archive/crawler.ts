import {
  archiveContent,
  countPostsInRange,
  countUnseenInRange,
  listUnseenInRange,
  markPostsDeleted,
  getUpdateState,
  listQuotedTargets,
  countPostsNeedingComments,
  getCrawlState,
  getOldestArchived,
  listPostsInRange,
  listPostsNeedingComments,
  markCommentsFetched,
  markMissingCommentsDeleted,
  setCrawlState,
  setUpdateState,
} from './store';
import {
  nextWindowStart,
  resumeMatches,
  type QueuedPost,
  type UpdateKind,
  type UpdateState,
} from './types';

import { getGroupPosts, getPostComments, lookupPost, PostGone } from '@/api/client';
import type { Cursor } from '@/api/types';

/**
 * Walks a community's `new` feed, archiving as it goes.
 *
 * ## Two phases, because one frontier is not enough
 *
 * A crawler that only resumes from a saved cursor walks *backwards* forever. Run
 * it today, stop, run it next week, and it politely continues digging into 2024
 * while everything posted in the intervening week is never seen at all — the gap
 * between "newest archived" and "newest posted" only ever grows.
 *
 * So a run does two things, in this order:
 *
 * 1. **Catch up.** Start at the top of the feed with no cursor and walk back
 *    until several consecutive pages are entirely duplicates. That is the signal
 *    that we have reached content already held, which closes the gap since the
 *    last run. On a first run this terminates immediately into phase 2.
 * 2. **Backfill.** Resume from `tail_cursor` and keep going deeper, until the
 *    feed runs out.
 *
 * Head first on purpose: recent posts are the ones most likely to disappear
 * before the next run, so they are the ones worth securing first.
 *
 * ## Rate limiting is the point, not an afterthought
 *
 * This is a private, reverse-engineered API being hit with a real personal
 * account, and PLAN §8 names an over-eager client as an **account risk** rather
 * than a performance one. A crawler is precisely the thing that gets an account
 * flagged, so the pacing is deliberately slower than it needs to be:
 *
 * - a fixed delay between pages, jittered so the traffic is not a metronome
 * - a longer back-off after any failure, doubling up to a ceiling
 * - a hard stop on 401/429 rather than a retry — one means the session is gone,
 *   the other means we are already being told to slow down
 *
 * ## Why `recent` and not `hot`
 *
 * `hot` is re-ranked constantly, so paging it revisits the same posts and never
 * terminates. `recent` is chronological: the cursor keeps moving backwards
 * through time and eventually runs out, which is the only ordering where
 * "archive everything" is a finite job.
 */

/** Between pages. Slow on purpose — see above. */
const PAGE_DELAY_MS = 1500;
/** Randomised slice added to each delay, so requests aren't perfectly periodic. */
const JITTER_MS = 600;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 60_000;

/**
 * Consecutive all-duplicate pages before the **catch-up** phase concludes it has
 * met already-archived content. Not 1 — a single overlapping page is normal.
 */
const HEAD_DUPLICATE_PAGES = 3;

/**
 * Backfill does not stop on duplicates at all.
 *
 * Observed 2026-09-11: a run that "stalled" and gave up would, when simply
 * started again, push straight through and keep finding new posts. So a stretch
 * of unproductive pages is a **transient** condition, not the end of anything —
 * and stopping to ask for a manual restart was making the operator do by hand
 * what the loop should have done itself.
 *
 * What replaces it is a budget. A page counts as progress if it archived
 * something new **or** reached further back in time. Non-progress is tolerated,
 * with a longer pause once it persists, and only abandoned after the budget is
 * spent — at which point something really is wrong and asking for help is right.
 */
const PAGES_WITHOUT_PROGRESS_BEFORE_PAUSE = 5;
const PAGES_WITHOUT_PROGRESS_BEFORE_GIVING_UP = 40;

/** The longer wait once a pass looks stuck, escalating as it stays stuck. */
const STUCK_PAUSE_START_MS = 8000;
const STUCK_PAUSE_MAX_MS = 30_000;

export type CrawlPhase = 'updating' | 'verifying' | 'catching-up' | 'backfilling';

/** Candidates looked up per read of the queue. */
const VERIFY_BATCH = 100;

/** Progress of the deletion check — alongside a refresh, or on its own. */
export interface VerifyProgress {
  /**
   * Running alongside the walk, slice by slice, rather than over a whole
   * finished window. There is no total up front: absences are found as the
   * walk reaches them.
   */
  inline?: boolean;
  /** Standalone only: posts the pass did not see, counted when the check began. */
  candidates: number;
  checked: number;
  /** Looked up, not served: recorded as deleted. */
  gone: number;
  /** Looked up and served after all — a feed that skipped, now refreshed. */
  live: number;
  /** Could not be checked. Left as candidates for next time. */
  errors: number;
  /** Why the most recent one could not be checked. */
  lastError?: string;
  /**
   * Archived posts older than anything the feed still serves, left unchecked:
   * the walk never reached them, so their absence is evidence of nothing.
   */
  notReachable?: number;
}

/**
 * A slice of history to re-read.
 *
 * Refreshing is a **third kind of work**, distinct from the two frontiers: it
 * walks ground the archive already holds, on purpose, because a record is a
 * snapshot and snapshots go stale. Scores move, threads grow, posts come down.
 * See docs/ARCHIVE.md#refreshing-what-is-already-archived.
 */
export interface UpdateWindow {
  /** ISO. Inclusive. */
  start: string;
  /** ISO. Defaults to the moment the run starts. */
  end: string;
  /**
   * The end is "now" rather than a date someone chose. Part of the window's
   * identity for resuming — see `resumeMatches`.
   */
  openEnd?: boolean;
  /**
   * Look up posts the walk does not find, to catch deletions (posts only).
   * On unless turned off. Not part of the window's identity: changing it
   * between sessions just changes what the rest of the walk does.
   */
  checkDeletions?: boolean;
}

/**
 * Records that a refresh finished, leaving the start for the *next* one.
 *
 * Written only on a pass that actually completed its window — a stopped or
 * failed run must not claim coverage it does not have, or the gap it left is
 * sealed off permanently.
 */
async function recordUpdate(
  kind: UpdateKind,
  groupId: string,
  window: UpdateWindow,
  startedAt: number,
  coveredTo?: string,
  at = Date.now(),
) {
  const existing = await getUpdateState(kind, groupId);
  await setUpdateState({
    ...existing,
    group_id: groupId,
    kind,
    window_start: nextWindowStart(at),
    updated_at: at,
    last_window_start: window.start,
    last_window_end: window.end,
    last_started_at: startedAt,
    last_covered_to: coveredTo ?? window.start,
    // Completed, so any saved position is stale. Leaving it would make the next
    // run resume past ground it is supposed to re-cover.
    resume: undefined,
  });
}

/**
 * A saved position, but only if it belongs to the window being asked for.
 *
 * Resuming into a different range is worse than starting over: the run would
 * skip everything before the saved point and then claim the whole window.
 */
async function resumeFor(
  kind: UpdateKind,
  groupId: string,
  window: UpdateWindow,
): Promise<NonNullable<UpdateState['resume']> | undefined> {
  const state = await getUpdateState(kind, groupId);
  return resumeMatches(state?.resume, window) ? state?.resume : undefined;
}

/**
 * Saves where a refresh has got to, so stopping is not losing.
 *
 * Spreads the existing state rather than rebuilding it field by field — an
 * earlier version listed the fields it meant to keep, and silently dropped any
 * it did not name every time a page was saved.
 */
async function saveResume(
  kind: UpdateKind,
  groupId: string,
  window: UpdateWindow,
  startedAt: number,
  position: {
    cursor?: string;
    offset?: number;
    through?: string;
    checked_to?: string;
    frontier?: string;
  },
) {
  const existing = await getUpdateState(kind, groupId);
  await setUpdateState({
    ...existing,
    group_id: groupId,
    kind,
    // A resume must never move the watermark — only completing the window does
    // that. Keep whatever was there, or the window's own start, so an
    // interrupted first refresh does not invent coverage.
    window_start: existing?.window_start ?? window.start,
    updated_at: existing?.updated_at ?? Date.now(),
    resume: {
      window_start: window.start,
      window_end: window.end,
      open_end: window.openEnd,
      // The *first* session's start, carried through every resume: it is the
      // cutoff that decides what this window's pass has and has not seen.
      started_at: existing?.resume && resumeMatches(existing.resume, window)
        ? (existing.resume.started_at ?? startedAt)
        : startedAt,
      ...position,
      updated_at: Date.now(),
    },
  });
}

/**
 * Posts the feed ranks highest of all time, re-read regardless of age.
 *
 * A community's best posts keep collecting votes and replies long past the
 * point where everything else has gone quiet — they are linked, screenshotted
 * and resurfaced — so the date window that works for ordinary posts is exactly
 * wrong for them. This is a small, fixed sweep: one extra page or four, and it
 * covers the records most likely to be stale and most likely to be looked at.
 *
 * A floor rather than a limit — the check runs between pages, so a page that
 * crosses it is still taken whole. Stopping mid-page to hit a round number
 * would mean discarding posts already paid for.
 */
const TOP_SWEEP_POSTS = 100;

/**
 * Why a pass ended.
 *
 * `duplicates` used to be the only non-exhausted ending, and it was reported as
 * "caught up — everything from here back is already archived". That claim was
 * not supportable: a run that fetches the same pages repeatedly also produces
 * nothing but duplicates, and looks identical from the outside. The endings
 * below distinguish the cases instead of assuming the flattering one.
 */
export type CrawlEnding =
  /** The feed returned no cursor or no posts. Genuinely the end. */
  | 'exhausted'
  /** The catch-up pass met content already held. Expected, and its job done. */
  | 'duplicates'
  /** A refresh reached the start of its window. Its job done. */
  | 'window-covered'
  /** A standalone deletion check finished. */
  | 'verified'
  /** Budget spent without progress. Something is wrong; a human should look. */
  | 'stalled'
  | 'stopped'
  | 'error';

/**
 * What this run has done, and what the community has accumulated.
 *
 * **Split deliberately.** An earlier version seeded `pages` and `archived` from
 * the saved state while `duplicates` started at zero, so the panel mixed
 * lifetime and per-run figures in one row — "203 pages · 3.5k new · 432 held"
 * described three different time spans at once and made a stuck run look
 * productive. `run` is always this session; `total` is the community's history.
 */
export interface CrawlRunStats {
  startedAt: number;
  /** Pages successfully fetched and archived. */
  pages: number;
  /** HTTP requests, including retries — diverges from `pages` when things fail. */
  requests: number;
  /** Rows the archive had never seen. */
  archived: number;
  /** Rows already held, and re-seen (so scores and deletions refresh). */
  duplicates: number;
  /** Posts on this run carrying images or video, flagged for later download. */
  withMedia: number;
  /** Failed requests that were retried rather than fatal. */
  errors: number;
  /** Newest and oldest `created_at` this run has touched. */
  newestReached?: string;
  oldestReached?: string;
  /** When the last page landed, for a live rate. */
  lastPageAt?: number;
}

export interface CrawlProgress {
  phase: CrawlPhase;
  run: CrawlRunStats;
  /** Cumulative for this community, across every run. */
  total: { pages: number; archived: number };
  /** Oldest post already held when the run began. Crossing it means new history. */
  target?: string;
  /** True once the run reaches past `target`. */
  intoNewHistory?: boolean;
  /** Set while pushing through an unproductive stretch rather than giving up. */
  recovering?: boolean;
  /** The slice of history being re-read, when this run is refreshing. */
  window?: UpdateWindow;
  /** True once the refresh has covered its whole window. */
  windowCovered?: boolean;
  /** Posts re-read from the all-time top, regardless of age. */
  topSwept?: number;
  /** The deletion check, once it starts. */
  verify?: VerifyProgress;
  /** Where a resumed refresh picked up, when it did. */
  resumedFrom?: string;
  /** Consecutive pages that neither archived anything nor reached further back. */
  idlePages: number;
  /** The wait before the next request, so the pacing is visible rather than felt. */
  nextDelayMs: number;
  /** Truncated, for eyeballing whether paging is actually advancing. */
  cursor?: string;
  finished?: CrawlEnding;
  error?: string;
}

export interface CrawlHandle {
  stop(): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a crawl. Returns a handle to stop it; progress arrives via callback.
 *
 * Not a promise-returning function on purpose — this runs for a long time, and
 * the caller needs to render progress and be able to interrupt, neither of which
 * a single awaited call gives you.
 */
export function startCrawl(
  groupId: string,
  groupName: string | undefined,
  onProgress: (progress: CrawlProgress) => void,
  /** When set, the run re-reads this window before extending the archive. */
  update?: UpdateWindow,
  options: {
    /**
     * Skip the walk entirely and only check `update` for deletions, against a
     * pass that has already finished. Everything that pass read has a
     * `last_seen_at` after `seenBefore`; anything in its window that does not
     * was never served to it.
     *
     * This is what lets a completed refresh — including one run before
     * deletions were detected at all — be checked without walking the feed
     * again.
     */
    verifyOnly?: { seenBefore: number; coveredTo?: string };
  } = {},
): CrawlHandle {
  let stopped = false;

  void (async () => {
    const progress: CrawlProgress = {
      // Labelled from the start so the first frame does not claim to be doing
      // something the run has not begun.
      phase: options.verifyOnly ? 'verifying' : update ? 'updating' : 'catching-up',
      window: update,
      run: {
        startedAt: Date.now(),
        pages: 0,
        requests: 0,
        archived: 0,
        duplicates: 0,
        withMedia: 0,
        errors: 0,
      },
      total: { pages: 0, archived: 0 },
      idlePages: 0,
      nextDelayMs: PAGE_DELAY_MS,
    };

    try {
      const saved = await getCrawlState(groupId);
      progress.total = { pages: saved?.pages ?? 0, archived: saved?.archived ?? 0 };
      // The line between "history we already hold" and "history we don't".
      // Duplicates above it are expected; below it they would be surprising.
      progress.target = await getOldestArchived(groupId);
      onProgress({ ...progress });

      let backoff = BACKOFF_START_MS;

      /**
       * One pass over the feed from `start`, stopping when `duplicateLimit`
       * consecutive pages add nothing. Returns where it stopped and why, so the
       * caller decides what that means for the phase it is in.
       */
      const walk = async (
        start: Cursor | undefined,
        /** Catch-up stops here; backfill passes `undefined` and never does. */
        stopAfterDuplicatePages: number | undefined,
        /** After each page, with the oldest in-order post it carried. */
        onPage: (cursor: Cursor | undefined, frontier: string | undefined) => Promise<void>,
        /** Refresh stops on a date instead: once the page is older than this. */
        stopWhenOlderThan?: string,
      ): Promise<CrawlEnding> => {
        let cursor = start;
        let duplicatePages = 0;
        /*
          Progress, not duplicates, is what this loop watches.

          Duplicate counting cannot tell "I already archived this stretch" apart
          from "the server keeps serving me the same stretch". Whether a page
          archived something new *or* reached further back in time can, and it is
          also the question actually being asked: is this run still getting
          anywhere?
        */
        let oldestOnPreviousPage: string | undefined;
        let pagesWithoutProgress = 0;
        let stuckPause = STUCK_PAUSE_START_MS;
        const seenCursors = new Set<string>();

        while (!stopped) {
          let page;
          progress.run.requests += 1;
          try {
            page = await getGroupPosts(groupId, 'recent', cursor);
            backoff = BACKOFF_START_MS;
          } catch (error) {
            progress.run.errors += 1;
            const status = (error as { status?: number })?.status;
            if (status === 401 || status === 429) {
              progress.error =
                status === 401
                  ? 'Session expired — sign in again before resuming.'
                  : 'Rate limited. Stopping rather than pushing harder.';
              onProgress({ ...progress });
              return 'error';
            }
            progress.error = `Retrying after an error: ${
              error instanceof Error ? error.message : String(error)
            }`;
            onProgress({ ...progress });
            await sleep(backoff);
            backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
            continue;
          }

          const posts = page?.posts ?? [];
          if (posts.length === 0) return 'exhausted';

          const { added } = await archiveContent(posts);
          progress.run.pages += 1;
          progress.run.archived += added;
          progress.run.duplicates += posts.length - added;
          progress.run.withMedia += posts.filter((post) => post.assets?.length).length;
          progress.run.lastPageAt = Date.now();
          progress.total.pages += 1;
          progress.total.archived += added;
          progress.error = undefined;

          /*
            How far back this page reached — measured on the posts that are
            actually in feed order.

            A pinned post sits at the top regardless of its age. Counting one
            would make a single page appear to leap back to whenever it was
            posted: a refresh would stop early and claim a window it never
            walked, the deletion check would treat everything in between as
            missing, and the backfill would think it had reached history it
            had not. Pinned posts are still archived like any other; they just
            do not say where the feed is.
          */
          const ordered = posts.filter((post) => !post.pinned);
          const oldestOnPage = ordered.reduce<string | undefined>(
            (oldest, post) =>
              post.created_at && (!oldest || post.created_at < oldest) ? post.created_at : oldest,
            undefined,
          );
          const newestOnPage = ordered.reduce<string | undefined>(
            (newest, post) =>
              post.created_at && (!newest || post.created_at > newest) ? post.created_at : newest,
            undefined,
          );
          if (oldestOnPage && (!progress.run.oldestReached || oldestOnPage < progress.run.oldestReached)) {
            progress.run.oldestReached = oldestOnPage;
          }
          if (newestOnPage && (!progress.run.newestReached || newestOnPage > progress.run.newestReached)) {
            progress.run.newestReached = newestOnPage;
          }
          if (
            progress.target &&
            progress.run.oldestReached &&
            progress.run.oldestReached < progress.target
          ) {
            progress.intoNewHistory = true;
          }

          const movedBackwards =
            !oldestOnPreviousPage || (oldestOnPage ? oldestOnPage < oldestOnPreviousPage : false);
          oldestOnPreviousPage =
            oldestOnPage && (!oldestOnPreviousPage || oldestOnPage < oldestOnPreviousPage)
              ? oldestOnPage
              : oldestOnPreviousPage;

          // Either kind of forward motion resets the budget.
          if (added > 0 || movedBackwards) {
            pagesWithoutProgress = 0;
            stuckPause = STUCK_PAUSE_START_MS;
            progress.recovering = false;
          } else {
            pagesWithoutProgress += 1;
          }
          progress.idlePages = pagesWithoutProgress;

          duplicatePages = added === 0 ? duplicatePages + 1 : 0;
          cursor = page?.cursor;
          // Enough to see it changing without putting an opaque token on screen.
          progress.cursor = cursor ? `${cursor.slice(0, 18)}…` : undefined;
          progress.nextDelayMs = PAGE_DELAY_MS;

          await onPage(cursor, oldestOnPage);
          onProgress({ ...progress });

          if (!cursor) return 'exhausted';

          /*
            A refresh walks by date, not by duplicates — duplicates are the
            *expected* result of re-reading, so they carry no signal here. The
            page's oldest post crossing the window's start is the only thing
            that means "done".
          */
          if (stopWhenOlderThan && oldestOnPage && oldestOnPage < stopWhenOlderThan) {
            return 'window-covered';
          }

          // Catch-up is *supposed* to end here: meeting known content is how it
          // knows the gap since the last run is closed.
          if (stopAfterDuplicatePages !== undefined && duplicatePages >= stopAfterDuplicatePages) {
            return 'duplicates';
          }

          if (pagesWithoutProgress >= PAGES_WITHOUT_PROGRESS_BEFORE_GIVING_UP) return 'stalled';

          /*
            A repeated cursor, or a run of pages going nowhere, used to end the
            pass. Both are now treated as transient — because empirically they
            are: the same crawl continued by hand pushes straight through. So
            wait longer and keep going, escalating the wait while it persists.
          */
          const looping = seenCursors.has(cursor);
          seenCursors.add(cursor);

          if (looping || pagesWithoutProgress >= PAGES_WITHOUT_PROGRESS_BEFORE_PAUSE) {
            progress.recovering = true;
            progress.nextDelayMs = stuckPause;
            onProgress({ ...progress });
            await sleep(stuckPause);
            stuckPause = Math.min(stuckPause * 2, STUCK_PAUSE_MAX_MS);
            continue;
          }

          await sleep(PAGE_DELAY_MS + Math.random() * JITTER_MS);
        }
        return 'stopped';
      };

      /**
       * Looks up every post in a time range that this pass did not see, and
       * records the ones Yik Yak no longer serves.
       *
       * Only a lookup by id can tell a deleted post from one the feed skipped
       * or one hidden from this account, so nothing is flagged on absence
       * alone. A post that comes back is archived as a fresh sighting instead —
       * the check doubles as a repair for anything the walk missed. One that
       * cannot be checked (a dropped connection, a 5xx) is left alone and
       * stepped past: it stays unseen, and a later check will find it again.
       *
       * The candidate set drains itself. Each lookup either moves a post's
       * `last_seen_at` past the cutoff or marks it deleted, and both remove it
       * from `listUnseenInRange` — so a check interrupted part-way needs no
       * position of its own to resume from.
       */
      const checkRange = async (
        lower: string,
        upper: string,
        lowerOpen: boolean,
        seenBefore: number,
        verify: VerifyProgress,
      ): Promise<'done' | 'stopped' | 'error'> => {
        /*
          An empty or inverted range is a normal event, not an error — and
          `IDBKeyRange.bound` **throws** on one, which would take the whole run
          down. It happens whenever a page is still newer than the window (a
          custom end date in the past), or the feed serves a post a place out
          of order so one page's oldest lands above the previous page's.
        */
        if (lower > upper || (lower === upper && lowerOpen)) return 'done';

        let skipped = 0;
        while (!stopped) {
          const batch = await listUnseenInRange(
            lower,
            upper,
            seenBefore,
            VERIFY_BATCH,
            groupId,
            skipped,
            lowerOpen,
          );
          if (batch.length === 0) return 'done';

          for (const candidate of batch) {
            if (stopped) return 'stopped';
            progress.run.requests += 1;
            try {
              const post = await lookupPost(candidate.id);
              await archiveContent([post]);
              verify.live += 1;
            } catch (error) {
              if (error instanceof PostGone) {
                await markPostsDeleted([candidate.id], 'missing');
                verify.gone += 1;
              } else {
                const status = (error as { status?: number })?.status;
                if (status === 401 || status === 429) {
                  progress.error =
                    status === 401
                      ? 'Session expired — sign in again before resuming.'
                      : 'Rate limited. Stopping rather than pushing harder.';
                  progress.verify = { ...verify };
                  onProgress({ ...progress });
                  return 'error';
                }
                verify.errors += 1;
                skipped += 1;
                // Not `progress.error`: the screen reads that as "the run has
                // stopped", and one unreachable post does not stop anything.
                verify.lastError = error instanceof Error ? error.message : String(error);
              }
            }
            verify.checked += 1;
            progress.run.lastPageAt = Date.now();
            progress.verify = { ...verify };
            onProgress({ ...progress });
            await sleep(PAGE_DELAY_MS + Math.random() * JITTER_MS);
          }
        }
        return 'stopped';
      };

      /**
       * Checks a whole finished window at once — the standalone check, for a
       * refresh that ran without checking, or that predates checking at all.
       */
      const verifyWindow = async (
        window: UpdateWindow,
        seenBefore: number,
        coveredTo?: string,
      ): Promise<'done' | 'stopped' | 'error'> => {
        progress.phase = 'verifying';
        // Never below where that pass actually reached: under it, absence is
        // posts that aged out of the feed, not posts that were removed.
        const lower = coveredTo && coveredTo > window.start ? coveredTo : window.start;
        const verify: VerifyProgress = {
          candidates: await countUnseenInRange(lower, window.end, seenBefore, groupId),
          checked: 0,
          gone: 0,
          live: 0,
          errors: 0,
        };
        progress.verify = { ...verify };
        onProgress({ ...progress });
        return checkRange(lower, window.end, false, seenBefore, verify);
      };

      /** Re-reads the all-time top posts. Small, fixed, and age-blind. */
      const sweepTop = async (): Promise<CrawlEnding> => {
        let cursor: Cursor | undefined;
        let seen = 0;

        while (!stopped && seen < TOP_SWEEP_POSTS) {
          progress.run.requests += 1;
          let page;
          try {
            page = await getGroupPosts(groupId, 'top', cursor, 'all_time');
          } catch (error) {
            const status = (error as { status?: number })?.status;
            if (status === 401 || status === 429) {
              progress.error =
                status === 401
                  ? 'Session expired — sign in again before resuming.'
                  : 'Rate limited. Stopping rather than pushing harder.';
              onProgress({ ...progress });
              return 'error';
            }
            // A failed top sweep is not worth ending the run over; the window
            // walk is the main event.
            progress.run.errors += 1;
            return 'duplicates';
          }

          const posts = page?.posts ?? [];
          if (posts.length === 0) break;

          const { added } = await archiveContent(posts);
          progress.run.pages += 1;
          progress.run.archived += added;
          progress.run.duplicates += posts.length - added;
          progress.run.lastPageAt = Date.now();
          seen += posts.length;
          progress.topSwept = seen;
          onProgress({ ...progress });

          cursor = page?.cursor;
          if (!cursor) break;
          await sleep(PAGE_DELAY_MS + Math.random() * JITTER_MS);
        }
        return stopped ? 'stopped' : 'duplicates';
      };

      const save = (patch: Partial<Awaited<ReturnType<typeof getCrawlState>>> = {}) =>
        setCrawlState({
          group_id: groupId,
          group_name: groupName,
          tail_cursor: saved?.tail_cursor,
          tail_exhausted: saved?.tail_exhausted,
          ...patch,
          pages: progress.total.pages,
          archived: progress.total.archived,
          updated_at: Date.now(),
        });

      /* ---- standalone deletion check ----------------------------------- */
      if (options.verifyOnly && update) {
        progress.window = update;
        const outcome = await verifyWindow(
          update,
          options.verifyOnly.seenBefore,
          options.verifyOnly.coveredTo,
        );
        if (outcome === 'done') {
          progress.finished = 'verified';
          progress.windowCovered = true;
        }
        onProgress({ ...progress });
        return;
      }

      /* ---- phase 0: refresh the window ---------------------------------- */
      /*
        Before anything is extended, what is already held is brought up to date.
        First on purpose: a refresh is the only phase with a *deadline* — the
        window ends at "now", and every minute spent backfilling first is a
        minute of new posts arriving behind it.

        This walk deliberately does not touch `tail_cursor`. It is re-reading
        ground the backfill has already passed, exactly like the catch-up pass,
        and letting it write the tail would throw away real depth.
      */
      if (update) {
        progress.phase = 'updating';
        progress.window = update;

        /*
          Top of all time first, and only a hundred posts of it.

          Those are the records most likely to still be moving and least likely
          to be inside any date window — a two-year-old post that still gets
          linked collects votes long after everything around it went quiet. It
          is a handful of requests, so it happens before the long walk rather
          than after, where a stop would always cut it off.
        */
        const topOutcome = await sweepTop();
        if (topOutcome === 'stopped' || topOutcome === 'error') return;

        const saved = await resumeFor('posts', groupId, update);
        progress.resumedFrom = saved?.through;
        // The cutoff for "seen by this pass". The first session's start when
        // resuming, or everything read before the pause would look unseen.
        const startedAt = saved?.started_at ?? progress.run.startedAt;
        const checking = update.checkDeletions !== false;

        /*
          ## Checking for deletions as the walk goes

          The feed runs newest to oldest, so after each page the walk has served
          every post newer than that page's oldest. Anything archived in the
          slice it just passed, that this pass did not see, is missing — and only
          those are looked up. Posts the pages served are confirmed twenty-four
          at a time by the pages themselves.

          The check trails the walk by **one page**. A post sitting exactly on a
          page boundary, or served a place out of order, turns up on the next
          page rather than this one; checking a slice only once the page after
          it has been read means those arrive before anyone asks whether they
          are missing. It costs nothing: the slice is checked one page later
          instead of now.

          Two positions are kept. `checkedTo`: everything in the window newer
          than it has been checked. `frontier`: the oldest post on the latest
          page, not yet settled. Both are saved with the walk's cursor, so a
          pause resumes the check exactly where it was. A resume from before
          this existed starts `checkedTo` at the window's end — which re-reads
          nothing, since everything the earlier session walked is already
          *seen*; only its genuine absences come up.
        */
        let checkedTo = checking ? (saved?.checked_to ?? update.end) : update.end;
        let frontier = saved?.frontier;
        const verify: VerifyProgress = {
          inline: true,
          candidates: 0,
          checked: 0,
          gone: 0,
          live: 0,
          errors: 0,
        };
        if (checking) progress.verify = { ...verify };
        onProgress({ ...progress });

        let checkOutcome: 'done' | 'stopped' | 'error' = 'done';

        const outcome = await walk(
          saved?.cursor,
          undefined,
          async (cursor, pageFrontier) => {
            await save();

            if (checking && frontier && checkOutcome === 'done') {
              // Settle the slice the *previous* page reached: (frontier, checkedTo].
              const settled = frontier;
              const result = await checkRange(settled, checkedTo, true, startedAt, verify);
              // Only ever downwards: a slice above the boundary was empty, and
              // moving the boundary up would re-open ground already checked.
              if (result === 'done') checkedTo = settled < checkedTo ? settled : checkedTo;
              else checkOutcome = result;
            }
            if (pageFrontier) frontier = pageFrontier;

            // Position saved per page: stopping a full re-scrape three days in
            // must not mean starting it again from the top.
            await saveResume('posts', groupId, update, startedAt, {
              cursor,
              through: progress.run.oldestReached,
              checked_to: checking ? checkedTo : undefined,
              frontier: checking ? frontier : undefined,
            });
          },
          update.start,
        );

        if (outcome === 'error' || outcome === 'stopped' || checkOutcome !== 'done') return;
        if (outcome === 'stalled') {
          progress.finished = 'stalled';
          onProgress({ ...progress });
          return;
        }
        // Only a pass that reached the start of its window may claim it.
        // 'exhausted' counts: running out of feed above the window start means
        // there was nothing older to read, not that coverage is incomplete.
        if (outcome === 'window-covered' || outcome === 'exhausted') {
          /*
            How far down the walk really reached. Past the window's start if it
            got there; otherwise only as far as the oldest post the feed still
            serves. Below that, absence means nothing — those posts have aged out
            of the feed, not been removed — so the check stops there, and says
            how many it left alone.
          */
          const coveredTo =
            outcome === 'window-covered'
              ? update.start
              : frontier && frontier > update.start
                ? frontier
                : update.start;

          if (checking) {
            // The last slice: everything between the final page and the bottom
            // of what was covered. Nothing is left to arrive a page late.
            const result = await checkRange(coveredTo, checkedTo, false, startedAt, verify);
            if (result !== 'done') return;
            if (coveredTo < checkedTo) checkedTo = coveredTo;

            if (coveredTo > update.start) {
              verify.notReachable = await countUnseenInRange(
                update.start,
                coveredTo,
                startedAt,
                groupId,
              );
              progress.verify = { ...verify };
              onProgress({ ...progress });
            }
          }

          await recordUpdate('posts', groupId, update, startedAt, coveredTo);
          progress.windowCovered = true;
          onProgress({ ...progress });
        }
        if (outcome === 'exhausted') {
          progress.finished = 'exhausted';
          await save({ tail_cursor: undefined, tail_exhausted: true });
          onProgress({ ...progress });
          return;
        }
      }

      /* ---- phase 1: catch up from the top ------------------------------- */
      // Skipped on a first run: with nothing archived, "walk until duplicates"
      // and "walk until exhausted" are the same walk, so phase 2 does it all.
      if (saved) {
        progress.phase = 'catching-up';
        onProgress({ ...progress });
        // The head pass must not move the tail frontier — it is walking a region
        // the backfill has already passed.
        const outcome = await walk(undefined, HEAD_DUPLICATE_PAGES, async () => {
          await save();
        });
        if (outcome === 'error' || outcome === 'stopped') return;
        if (outcome === 'stalled') {
          progress.finished = 'stalled';
          onProgress({ ...progress });
          return;
        }
        if (outcome === 'exhausted') {
          // The whole feed fits inside the catch-up pass; nothing left to dig.
          progress.finished = 'exhausted';
          await save({ tail_cursor: undefined, tail_exhausted: true });
          onProgress({ ...progress });
          return;
        }
      }

      /* ---- phase 2: backfill deeper ------------------------------------- */
      if (saved?.tail_exhausted) {
        progress.finished = 'exhausted';
        onProgress({ ...progress });
        return;
      }

      progress.phase = 'backfilling';
      onProgress({ ...progress });

      let tail = saved?.tail_cursor;
      // `undefined` — backfill never stops for duplicates. Crossing ground we
      // already hold is exactly how it reaches ground we don't.
      const outcome = await walk(tail, undefined, async (cursor) => {
        tail = cursor;
        await save({ tail_cursor: cursor, tail_exhausted: false });
      });

      if (outcome === 'exhausted') {
        progress.finished = 'exhausted';
        await save({ tail_cursor: undefined, tail_exhausted: true });
        onProgress({ ...progress });
      } else if (outcome !== 'stopped' && outcome !== 'error') {
        progress.finished = outcome;
        // Not marked exhausted: a loop or a stalled window is the *server's*
        // limit right now, not proof that history ends there. The cursor is kept
        // so a later run can try again from the same place.
        await save({ tail_cursor: tail, tail_exhausted: false });
        onProgress({ ...progress });
      }
    } catch (error) {
      progress.error = error instanceof Error ? error.message : String(error);
      onProgress({ ...progress });
    }
  })();

  return {
    stop() {
      stopped = true;
    },
  };
}

/* ------------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------------ */

/**
 * Fetches comment threads for archived posts.
 *
 * **A separate pass, because it is a different shape of job.** The feed crawler
 * pages a community: one request yields ~24 posts. Comments are per-post, so
 * collecting them is one request each — at 157k archived posts that is 157k
 * requests where the feed crawl took a few hundred. Running it inside the feed
 * crawl would have turned a twenty-minute job into a multi-day one, silently.
 *
 * So it is opt-in, separately paced, and works off the archive rather than the
 * network: it asks for posts flagged `needs_comments` (those with replies, not
 * yet collected), which keeps it resumable for free — a post is only cleared
 * once its thread is stored, so an interrupted run simply finds the same work
 * waiting.
 *
 * Posts with no replies are never requested at all, which removes most of the
 * corpus from the job before it starts.
 */
const COMMENT_DELAY_MS = 1200;
const COMMENT_JITTER_MS = 500;
/** How many outstanding posts to pull from the archive at a time. */
const COMMENT_BATCH = 250;

/**
 * ## Getting past a run of unreadable posts
 *
 * A post whose thread cannot be fetched stays flagged, which is what makes the
 * pass resumable. It also means unreadable posts **accumulate at the head of the
 * queue**: every readable post ahead of them gets cleared, they do not, so what
 * is left at the front is increasingly the ones that always fail. Every resume
 * then spends its first minutes re-failing the same posts in the same order.
 *
 * Rather than persist a "this one is bad" marker — which would be a second
 * source of truth about the queue, and wrong the moment a post becomes readable
 * again — the pass **finds the end of the bad stretch by probing**:
 *
 * 1. After `ERRORS_BEFORE_PROBE` consecutive failures, stop working forwards.
 * 2. Jump ahead by a stride, doubling each time, until a post reads cleanly.
 *    That brackets the boundary between a known-bad and a known-good position.
 * 3. Bisect the bracket to find where the bad stretch actually ends, and carry
 *    on from there.
 *
 * Cost goes from O(n) failed requests to O(log n) — a 500-post stretch takes
 * about 18 probes instead of 500 failures.
 *
 * **Skipping is safe because the flag is the queue.** Anything jumped over stays
 * flagged and is offered again on a later run, so a mis-placed boundary defers
 * work rather than losing it. That is also why the bisect does not need the
 * stretch to be perfectly contiguous: the predicate it searches is not
 * guaranteed monotonic, and the worst case of guessing wrong is a few posts
 * deferred to the next pass.
 *
 * Successful probes are not wasted — a thread read while bracketing is archived
 * and cleared like any other.
 */
const ERRORS_BEFORE_PROBE = 3;
const PROBE_STRIDE_START = 8;
const PROBE_STRIDE_MAX = 512;
/** A ceiling on bracketing, so a wholly unreadable window cannot loop. */
const MAX_PROBES_PER_RECOVERY = 24;

/** What the pass is doing right now — see the probing note above. */
export type CommentCrawlMode = 'working' | 'bracketing' | 'bisecting';

/**
 * Which queue the pass is draining.
 *
 * `refreshing` walks a **date window** of posts whose threads are already held;
 * `backlog` walks the `needs_comments` flag, as it always has. A run does the
 * refresh first and then falls through to the backlog, because the window ends
 * at "now" and everything spent elsewhere first widens it.
 */
export type CommentCrawlPhase = 'refreshing' | 'quoted' | 'backlog';

export interface CommentCrawlProgress {
  startedAt: number;
  mode: CommentCrawlMode;
  phase: CommentCrawlPhase;
  /** The slice being re-read, when refreshing. */
  window?: UpdateWindow;
  /** True once the refresh phase has covered its whole window. */
  windowCovered?: boolean;
  /** Threads re-read this run that were already held. */
  refreshed: number;
  /** Comments found on a re-read that the archive had never seen. */
  gained: number;
  /** Archived comments found missing from a re-read, flagged deleted. */
  removed: number;
  /** Re-read threads that came back byte-for-byte the same size and shape. */
  unchanged: number;
  /** Old posts pulled in because something in the window quotes them. */
  quotedFound?: number;
  /** Where a resumed pass picked up, when it did. */
  resumedFrom?: string;
  /** Threads fetched this run. */
  threads: number;
  /** Comment rows never seen before. */
  archived: number;
  /** Comment rows already held — scores and deletions refreshed. */
  duplicates: number;
  /** Threads that came back empty despite the post claiming replies. */
  empty: number;
  errors: number;
  /** Every HTTP request, including failures and probes. */
  requests: number;
  /** Consecutive failures right now — resets on any success. */
  errorStreak: number;
  /** Longest run of consecutive failures this run. */
  worstStreak: number;
  /** Requests spent locating the end of a bad stretch. */
  probes: number;
  /** Times the pass had to bracket and bisect its way out of one. */
  recoveries: number;
  /** Posts jumped over. They stay flagged for a later run. */
  skipped: number;
  /** Posts passed over without clearing — the offset into the flagged queue. */
  behind: number;
  /** Windows of flagged posts pulled from the archive. */
  windows: number;
  /** Outstanding threads when the run began, for a completion estimate. */
  outstandingAtStart: number;
  /** Still outstanding — recomputed at each batch boundary. */
  remaining: number;
  /** Comments seen in the most recent thread, for a sense of live movement. */
  lastThreadSize?: number;
  lastAt?: number;
  finished?: 'done' | 'stopped' | 'error';
  error?: string;
}

/**
 * Fetches comment threads for archived posts, optionally for one community.
 *
 * Scoped the same way the feed crawl is, and for the same reason: an archive
 * spanning several communities should be fillable one at a time, so a long job
 * can be aimed at what matters rather than being all-or-nothing.
 */
export function startCommentCrawl(
  onProgress: (progress: CommentCrawlProgress) => void,
  groupId?: string,
  /** When set, threads in this window are re-read before the backlog is worked. */
  update?: UpdateWindow,
): CrawlHandle {
  let stopped = false;

  void (async () => {
    const progress: CommentCrawlProgress = {
      startedAt: Date.now(),
      mode: 'working',
      phase: update ? 'refreshing' : 'backlog',
      window: update,
      refreshed: 0,
      gained: 0,
      removed: 0,
      unchanged: 0,
      threads: 0,
      archived: 0,
      duplicates: 0,
      empty: 0,
      errors: 0,
      requests: 0,
      errorStreak: 0,
      worstStreak: 0,
      probes: 0,
      recoveries: 0,
      skipped: 0,
      behind: 0,
      windows: 0,
      outstandingAtStart: 0,
      remaining: 0,
    };
    let backoff = BACKOFF_START_MS;
    const emit = () => onProgress({ ...progress });

    /** Thrown to unwind out of nested probing when the run must end now. */
    const HALT = Symbol('halt');

    /**
     * Fetches one thread. `true` if it was stored and the post cleared.
     *
     * Per-post failures are recorded and reported as `false` — a single
     * unreadable thread must not end a run over a hundred thousand posts. Only
     * 401 and 429 throw, because those are facts about the session rather than
     * about the post, and retrying either is how an account gets flagged.
     */
    const fetchThread = async (post: QueuedPost) => {
      progress.requests += 1;
      try {
        const comments = await getPostComments(post.id);
        const { added, updated } = await archiveContent(comments);

        /*
          The newest comment's timestamp, stored alongside the count.

          A thread that loses one comment and gains another has an identical
          count, so counting alone reports it unchanged and the new comment is
          never collected. A comment posted now sorts after every comment
          already seen, so the pair (count, newest) catches an addition, a
          removal, and one of each together.
        */
        const newest = comments.reduce<string | undefined>(
          (latest, comment) =>
            comment.created_at && (!latest || comment.created_at > latest)
              ? comment.created_at
              : latest,
          undefined,
        );

        /*
          A removal is recorded, never applied. A post gets that for free — the
          API returns a tombstone in its place — but a comment simply stops
          appearing, so the only way to notice is to compare the thread that came
          back against the one that is held.

          Only on a **re-read**: a first read has nothing archived that could
          have gone missing, and the check is a cursor walk per thread, which is
          not worth paying 180,000 times to learn nothing.
        */
        /*
          …and only when the thread came back **non-empty**.

          An empty thread where comments are held is almost never every comment
          being deleted one by one. It is the thread itself being gone — the post
          was removed — and diffing against it would mark every comment under a
          deleted post as individually deleted, filling `is:deleted` with
          hundreds of comments nobody removed. The post's own flag already says
          why they are unreachable. A thread that comes back with *some* of its
          comments missing is the real per-comment signal.
        */
        let removed = 0;
        if (post.fetched_at !== undefined && comments.length > 0) {
          removed = await markMissingCommentsDeleted(
            post.id,
            comments.map((comment) => comment.id),
          );
          progress.removed += removed;
          progress.refreshed += 1;
          if (added === 0 && removed === 0) progress.unchanged += 1;
          else progress.gained += added;
        }

        // Cleared even when the thread came back empty: the post claimed
        // replies and the server disagrees, and asking again every run
        // would loop on it forever. Recorded as what was actually stored, not
        // what the post claimed — those differ once a thread is moderated.
        await markCommentsFetched(post.id, comments.length, newest);

        progress.threads += 1;
        progress.archived += added;
        progress.duplicates += updated;
        progress.lastThreadSize = comments.length;
        if (comments.length === 0) progress.empty += 1;
        // Cheaper than re-counting the index every thread, and exact as long
        // as nothing else is clearing flags mid-run.
        progress.remaining = Math.max(0, progress.remaining - 1);
        progress.lastAt = Date.now();
        progress.error = undefined;
        progress.errorStreak = 0;
        backoff = BACKOFF_START_MS;
        return true;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 429) {
          progress.error =
            status === 401
              ? 'Session expired — sign in again before resuming.'
              : 'Rate limited. Stopping rather than pushing harder.';
          progress.finished = 'error';
          throw HALT;
        }
        progress.errors += 1;
        progress.errorStreak += 1;
        progress.worstStreak = Math.max(progress.worstStreak, progress.errorStreak);
        progress.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    };

    const pace = () => sleep(COMMENT_DELAY_MS + Math.random() * COMMENT_JITTER_MS);

    try {
      /**
       * Works a queue to the end, or until stopped. Returns whether it finished.
       *
       * Both phases share this — and, more to the point, share the skip-ahead
       * recovery. A window of unreadable posts is not a property of the
       * `needs_comments` queue; it is a property of *those posts*, so a refresh
       * walking the same posts by date hits exactly the same wall and needs
       * exactly the same way out.
       */
      const drain = async (
        next: (offset: number) => Promise<QueuedPost[]>,
        /**
         * Whether reading a row removes it from the queue.
         *
         * The backlog is **self-consuming**: clearing `needs_comments` takes the
         * post out of the index, so the next window naturally starts after the
         * work just done, and the only offset needed is the count of rows left
         * behind unread.
         *
         * A date range is not. Re-reading a post does not move it out of the
         * window, so asking again from the same offset returns the same rows —
         * forever. The refresh phase therefore walks a position that advances by
         * every row handled, read or not.
         */
        selfConsuming: boolean,
        /** Where to pick up, for a queue that survives being stopped. */
        startAt = 0,
        /** Called at each window boundary so a stop loses at most one window. */
        checkpoint?: (offset: number) => Promise<void>,
      ) => {
        progress.behind = 0;
        let base = startAt;

        while (!stopped) {
          const window = await next(selfConsuming ? progress.behind : base);
          progress.windows += 1;

          if (window.length === 0) return true;
          base += window.length;
          await checkpoint?.(base);

          let j = 0;
          while (j < window.length && !stopped) {
            const ok = await fetchThread(window[j]);
            emit();

            if (ok) {
              j += 1;
              await pace();
              continue;
            }

            // Failed: it stays in the queue, so the offset has to move past it.
            progress.behind += 1;
            j += 1;

            if (progress.errorStreak < ERRORS_BEFORE_PROBE) {
              await sleep(backoff);
              backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
              emit();
              continue;
            }

            j = await recover(window, j);
            emit();
          }
        }
        return false;
      };

      /* ---- phase 1: refresh the window ---------------------------------- */
      if (update) {
        const scope = groupId ?? '';
        progress.phase = 'refreshing';
        progress.outstandingAtStart = await countPostsInRange(update.start, update.end, groupId);
        progress.remaining = progress.outstandingAtStart;

        const saved = await resumeFor('comments', scope, update);
        progress.resumedFrom = saved?.offset ? String(saved.offset) : undefined;
        const startedAt = saved?.started_at ?? progress.startedAt;
        emit();

        const covered = await drain(
          (offset) => listPostsInRange(update.start, update.end, COMMENT_BATCH, groupId, offset),
          false,
          saved?.offset ?? 0,
          (offset) => saveResume('comments', scope, update, startedAt, { offset }),
        );

        if (!covered) {
          progress.finished = 'stopped';
          emit();
          return;
        }

        /*
          Then the posts those quote.

          A quote-repost is evidence of renewed attention on something old: it
          has been resurfaced, so it is collecting replies again at an age where
          nothing else is. Its own date puts it outside the window, so this is
          the only pass that will ever go back for it.
        */
        progress.phase = 'quoted';
        emit();

        const quoted = await listQuotedTargets(update.start, update.end, groupId);
        progress.quotedFound = quoted.length;
        emit();

        if (quoted.length > 0) {
          let served = false;
          const finishedQuoted = await drain(
            () => {
              if (served) return Promise.resolve([]);
              served = true;
              return Promise.resolve(quoted);
            },
            false,
          );
          if (!finishedQuoted) {
            progress.finished = 'stopped';
            emit();
            return;
          }
        }

        // Only a pass that reached the end of its window may claim it. A window
        // recorded after a stop would seal off the part that was never read.
        await recordUpdate('comments', scope, update, startedAt);
        progress.windowCovered = true;
        emit();
      }

      /* ---- phase 2: the outstanding backlog ----------------------------- */
      progress.phase = 'backlog';
      progress.outstandingAtStart = await countPostsNeedingComments(groupId);
      progress.remaining = progress.outstandingAtStart;
      emit();

      const finished = await drain(
        (offset) => listPostsNeedingComments(COMMENT_BATCH, groupId, offset),
        true,
      );

      progress.remaining = progress.behind;
      progress.finished = finished ? 'done' : 'stopped';
      emit();
    } catch (error) {
      if (error !== HALT) {
        progress.error = error instanceof Error ? error.message : String(error);
        progress.finished = 'error';
      }
      progress.mode = 'working';
      emit();
    }

    /**
     * Finds the end of a run of unreadable posts, and returns where to resume.
     *
     * `from` is the first position not yet examined; `from - 1` is known bad.
     * Bracket by jumping ahead with a doubling stride until something reads,
     * then bisect the bracket. Everything left unread in between stays flagged
     * and comes back on a later run, which is what makes guessing the boundary
     * an acceptable thing to do at all.
     */
    async function recover(window: QueuedPost[], from: number): Promise<number> {
      progress.recoveries += 1;
      let attempted = 0;
      let cleared = 0;

      /** Accounts for a span [from, through] and returns the resume position. */
      const settle = (through: number) => {
        const span = through - from + 1;
        // Everything in the span that was not cleared is still flagged.
        progress.behind += Math.max(0, span - cleared);
        // "Skipped" is narrower than that: positions never even tried.
        progress.skipped += Math.max(0, span - attempted);
        progress.mode = 'working';
        return through + 1;
      };

      const last = window.length - 1;
      if (from > last) return from;

      progress.mode = 'bracketing';
      emit();

      let lo = from - 1; // known bad
      let hi = -1; // first known good, once found
      let stride = PROBE_STRIDE_START;

      while (progress.probes < MAX_PROBES_PER_RECOVERY * progress.recoveries) {
        if (stopped) return settle(lo);
        // Clamped rather than overshooting: probing the far end turns "the rest
        // of this window is unknown" into "the rest of this window is bad", on
        // evidence, so skipping it is a measurement and not a guess.
        const probe = Math.min(lo + stride, last);
        progress.probes += 1;
        attempted += 1;

        const ok = await fetchThread(window[probe]);
        if (ok) cleared += 1;
        emit();
        await pace();

        if (ok) {
          hi = probe;
          break;
        }
        if (probe === last) return settle(last);
        lo = probe;
        stride = Math.min(stride * 2, PROBE_STRIDE_MAX);
      }

      // Bracketing gave up: skip what is left of the window rather than grind.
      if (hi < 0) return settle(last);

      progress.mode = 'bisecting';
      emit();

      while (hi - lo > 1) {
        if (stopped) break;
        const mid = Math.floor((lo + hi) / 2);
        progress.probes += 1;
        attempted += 1;

        const ok = await fetchThread(window[mid]);
        if (ok) cleared += 1;
        emit();
        await pace();

        if (ok) hi = mid;
        else lo = mid;
      }

      return settle(hi);
    }
  })();

  return {
    stop() {
      stopped = true;
    },
  };
}
