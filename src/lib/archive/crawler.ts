import {
  archiveContent,
  countPostsNeedingComments,
  getCrawlState,
  getOldestArchived,
  listPostsNeedingComments,
  markCommentsFetched,
  setCrawlState,
} from './store';

import { api, getGroupPosts } from '@/api/client';
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

export type CrawlPhase = 'catching-up' | 'backfilling';

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
): CrawlHandle {
  let stopped = false;

  void (async () => {
    const progress: CrawlProgress = {
      phase: 'catching-up',
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

export interface CommentCrawlProgress {
  startedAt: number;
  /** Threads fetched this run. */
  threads: number;
  /** Comment rows never seen before. */
  archived: number;
  /** Comment rows already held — scores and deletions refreshed. */
  duplicates: number;
  /** Threads that came back empty despite the post claiming replies. */
  empty: number;
  errors: number;
  /** Outstanding threads when the run began, for a completion estimate. */
  outstandingAtStart: number;
  /** Still outstanding — recomputed at each batch boundary. */
  remaining: number;
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
): CrawlHandle {
  let stopped = false;

  void (async () => {
    const progress: CommentCrawlProgress = {
      startedAt: Date.now(),
      threads: 0,
      archived: 0,
      duplicates: 0,
      empty: 0,
      errors: 0,
      outstandingAtStart: 0,
      remaining: 0,
    };
    let backoff = BACKOFF_START_MS;

    try {
      progress.outstandingAtStart = await countPostsNeedingComments(groupId);
      progress.remaining = progress.outstandingAtStart;
      onProgress({ ...progress });

      while (!stopped) {
        const batch = await listPostsNeedingComments(COMMENT_BATCH, groupId);

        if (batch.length === 0) {
          progress.remaining = 0;
          progress.finished = 'done';
          onProgress({ ...progress });
          return;
        }

        for (const post of batch) {
          if (stopped) {
            progress.finished = 'stopped';
            onProgress({ ...progress });
            return;
          }

          try {
            const comments = (await api.getPostComments(post.id)) as unknown as { id?: string }[];
            const { added, updated } = await archiveContent(
              comments as Parameters<typeof archiveContent>[0],
            );
            // Cleared even when the thread came back empty: the post claimed
            // replies and the server disagrees, and asking again every run
            // would loop on it forever.
            await markCommentsFetched(post.id, post.comment_count);

            progress.threads += 1;
            progress.archived += added;
            progress.duplicates += updated;
            if (comments.length === 0) progress.empty += 1;
            // Cheaper than re-counting the index every thread, and exact as long
            // as nothing else is clearing flags mid-run.
            progress.remaining = Math.max(0, progress.remaining - 1);
            progress.lastAt = Date.now();
            progress.error = undefined;
            backoff = BACKOFF_START_MS;
          } catch (error) {
            const status = (error as { status?: number })?.status;
            if (status === 401 || status === 429) {
              progress.error =
                status === 401
                  ? 'Session expired — sign in again before resuming.'
                  : 'Rate limited. Stopping rather than pushing harder.';
              progress.finished = 'error';
              onProgress({ ...progress });
              return;
            }
            // A single unreadable thread — deleted, or private — must not end a
            // run over a hundred thousand posts. Note it and move on; the post
            // stays flagged and will be retried on a later run.
            progress.errors += 1;
            progress.error = error instanceof Error ? error.message : String(error);
            onProgress({ ...progress });
            await sleep(backoff);
            backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
            continue;
          }

          onProgress({ ...progress });
          await sleep(COMMENT_DELAY_MS + Math.random() * COMMENT_JITTER_MS);
        }
      }
      progress.finished = 'stopped';
      onProgress({ ...progress });
    } catch (error) {
      progress.error = error instanceof Error ? error.message : String(error);
      progress.finished = 'error';
      onProgress({ ...progress });
    }
  })();

  return {
    stop() {
      stopped = true;
    },
  };
}
