import { archiveContent, getCrawlState, setCrawlState } from './store';

import { getGroupPosts } from '@/api/client';
import type { Cursor } from '@/api/types';

/**
 * Walks a community's `new` feed backwards, archiving as it goes.
 *
 * ## Rate limiting is the point, not an afterthought
 *
 * This is a private, reverse-engineered API being hit with a real personal
 * account, and PLAN §8 names an over-eager client as an **account risk** rather
 * than a performance one. A crawler is precisely the thing that gets an account
 * flagged, so the pacing here is deliberately slower than it needs to be:
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
 *
 * ## Resuming
 *
 * The cursor is persisted per community after every page, so a run that is
 * stopped, reloaded or interrupted picks up where it left off instead of
 * re-walking from the top. A community whose feed has been exhausted is marked,
 * so a later run starts fresh from the newest posts rather than immediately
 * hitting the end.
 */

/** Between pages. Slow on purpose — see above. */
const PAGE_DELAY_MS = 1500;
/** Randomised slice added to each delay, so requests aren't perfectly periodic. */
const JITTER_MS = 600;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 60_000;
/**
 * Consecutive all-duplicate pages before concluding this stretch is already
 * archived. Not 1 — a single overlapping page is normal when resuming.
 */
const DUPLICATE_PAGES_BEFORE_STOP = 3;

export interface CrawlProgress {
  pages: number;
  archived: number;
  duplicates: number;
  /** Set when the run ends by itself rather than being stopped. */
  finished?: 'exhausted' | 'all-duplicates';
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
    const progress: CrawlProgress = { pages: 0, archived: 0, duplicates: 0 };

    try {
      const saved = await getCrawlState(groupId);
      // A finished community restarts from the newest posts; anything else
      // resumes from where it stopped.
      let cursor: Cursor | undefined = saved?.exhausted ? undefined : saved?.cursor;
      progress.pages = saved?.pages ?? 0;
      progress.archived = saved?.archived ?? 0;

      let backoff = BACKOFF_START_MS;
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
            return;
          }
          // Transient: wait longer each time, but keep the run alive.
          progress.error = `Retrying after an error: ${
            error instanceof Error ? error.message : String(error)
          }`;
          onProgress({ ...progress });
          await sleep(backoff);
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
          continue;
        }

        const posts = page?.posts ?? [];
        if (posts.length === 0) {
          progress.finished = 'exhausted';
          await setCrawlState({
            group_id: groupId,
            group_name: groupName,
            cursor: undefined,
            exhausted: true,
            pages: progress.pages,
            archived: progress.archived,
            updated_at: Date.now(),
          });
          onProgress({ ...progress });
          return;
        }

        const { added } = await archiveContent(posts);
        progress.pages += 1;
        progress.archived += added;
        progress.duplicates += posts.length - added;
        progress.error = undefined;

        duplicatePages = added === 0 ? duplicatePages + 1 : 0;

        cursor = page?.cursor;
        await setCrawlState({
          group_id: groupId,
          group_name: groupName,
          cursor,
          exhausted: false,
          pages: progress.pages,
          archived: progress.archived,
          updated_at: Date.now(),
        });
        onProgress({ ...progress });

        // No cursor means the feed has no more pages to give.
        if (!cursor) {
          progress.finished = 'exhausted';
          await setCrawlState({
            group_id: groupId,
            group_name: groupName,
            cursor: undefined,
            exhausted: true,
            pages: progress.pages,
            archived: progress.archived,
            updated_at: Date.now(),
          });
          onProgress({ ...progress });
          return;
        }

        if (duplicatePages >= DUPLICATE_PAGES_BEFORE_STOP) {
          progress.finished = 'all-duplicates';
          onProgress({ ...progress });
          return;
        }

        await sleep(PAGE_DELAY_MS + Math.random() * JITTER_MS);
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
