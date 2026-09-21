import {
  archiveContent,
  countPostsInRange,
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
import { nextWindowStart, type QueuedPost, type UpdateKind } from './types';

import { getGroupPosts, getPostComments } from '@/api/client';
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

export type CrawlPhase = 'updating' | 'catching-up' | 'backfilling';

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
  at = Date.now(),
) {
  await setUpdateState({
    group_id: groupId,
    kind,
    window_start: nextWindowStart(at),
    updated_at: at,
    last_window_start: window.start,
    last_window_end: window.end,
  });
}

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
): CrawlHandle {
  let stopped = false;

  void (async () => {
    const progress: CrawlProgress = {
      // Labelled from the start so the first frame does not claim to be doing
      // something the run has not begun.
      phase: update ? 'updating' : 'catching-up',
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
        onPage: (cursor: Cursor | undefined) => Promise<void>,
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

          const oldestOnPage = posts.reduce<string | undefined>(
            (oldest, post) =>
              post.created_at && (!oldest || post.created_at < oldest) ? post.created_at : oldest,
            undefined,
          );
          const newestOnPage = posts.reduce<string | undefined>(
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

          await onPage(cursor);
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
        onProgress({ ...progress });

        const outcome = await walk(
          undefined,
          undefined,
          async () => {
            await save();
          },
          update.start,
        );

        if (outcome === 'error' || outcome === 'stopped') return;
        if (outcome === 'stalled') {
          progress.finished = 'stalled';
          onProgress({ ...progress });
          return;
        }
        // Only a pass that reached the start of its window may claim it.
        // 'exhausted' counts: running out of feed above the window start means
        // there was nothing older to read, not that coverage is incomplete.
        if (outcome === 'window-covered' || outcome === 'exhausted') {
          await recordUpdate('posts', groupId, update);
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
export type CommentCrawlPhase = 'refreshing' | 'backlog';

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
        let removed = 0;
        if (post.fetched_at !== undefined) {
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
      ) => {
        progress.behind = 0;
        let base = 0;

        while (!stopped) {
          const window = await next(selfConsuming ? progress.behind : base);
          progress.windows += 1;

          if (window.length === 0) return true;
          base += window.length;

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
        progress.phase = 'refreshing';
        progress.outstandingAtStart = await countPostsInRange(update.start, update.end, groupId);
        progress.remaining = progress.outstandingAtStart;
        emit();

        const covered = await drain(
          (offset) => listPostsInRange(update.start, update.end, COMMENT_BATCH, groupId, offset),
          false,
        );

        if (!covered) {
          progress.finished = 'stopped';
          emit();
          return;
        }

        // Only a pass that reached the end of its window may claim it. A window
        // recorded after a stop would seal off the part that was never read.
        await recordUpdate('comments', groupId ?? '', update);
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
