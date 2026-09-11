import { archiveContent, getCrawlState, setCrawlState } from './store';

import { getGroupPosts } from '@/api/client';
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
 * The same guard for **backfill**, but far looser. Everything past the tail
 * cursor should be unseen, so duplicates there are unexpected; this only exists
 * to stop a runaway if the feed re-serves content, and a low threshold would
 * abort a legitimate backfill that crosses a previously-archived stretch.
 */
const TAIL_DUPLICATE_PAGES = 15;

export type CrawlPhase = 'catching-up' | 'backfilling';

export interface CrawlProgress {
  phase: CrawlPhase;
  pages: number;
  archived: number;
  duplicates: number;
  /** Set when the run ends by itself rather than being stopped. */
  finished?: 'exhausted' | 'caught-up';
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
      pages: 0,
      archived: 0,
      duplicates: 0,
    };

    try {
      const saved = await getCrawlState(groupId);
      progress.pages = saved?.pages ?? 0;
      progress.archived = saved?.archived ?? 0;

      let backoff = BACKOFF_START_MS;

      /**
       * One pass over the feed from `start`, stopping when `duplicateLimit`
       * consecutive pages add nothing. Returns where it stopped and why, so the
       * caller decides what that means for the phase it is in.
       */
      const walk = async (
        start: Cursor | undefined,
        duplicateLimit: number,
        onPage: (cursor: Cursor | undefined) => Promise<void>,
      ): Promise<'exhausted' | 'duplicates' | 'stopped' | 'error'> => {
        let cursor = start;
        let duplicatePages = 0;

        while (!stopped) {
          let page;
          try {
            page = await getGroupPosts(groupId, 'recent', cursor);
            backoff = BACKOFF_START_MS;
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
          progress.pages += 1;
          progress.archived += added;
          progress.duplicates += posts.length - added;
          progress.error = undefined;

          duplicatePages = added === 0 ? duplicatePages + 1 : 0;
          cursor = page?.cursor;

          await onPage(cursor);
          onProgress({ ...progress });

          if (!cursor) return 'exhausted';
          if (duplicatePages >= duplicateLimit) return 'duplicates';

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
          pages: progress.pages,
          archived: progress.archived,
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
        progress.finished = 'caught-up';
        onProgress({ ...progress });
        return;
      }

      progress.phase = 'backfilling';
      onProgress({ ...progress });

      let tail = saved?.tail_cursor;
      const outcome = await walk(tail, TAIL_DUPLICATE_PAGES, async (cursor) => {
        tail = cursor;
        await save({ tail_cursor: cursor, tail_exhausted: false });
      });

      if (outcome === 'exhausted') {
        progress.finished = 'exhausted';
        await save({ tail_cursor: undefined, tail_exhausted: true });
        onProgress({ ...progress });
      } else if (outcome === 'duplicates') {
        progress.finished = 'caught-up';
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
