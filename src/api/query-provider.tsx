import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from './client';

const ONE_MINUTE = 1000 * 60;
const ONE_HOUR = ONE_MINUTE * 60;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: ONE_MINUTE,
      gcTime: ONE_HOUR,
      retry(failureCount, error) {
        // An expired token will never succeed on retry, and rate limits should
        // not be hammered. Everything else gets two attempts.
        if (error instanceof ApiError && (error.status === 401 || error.status === 429)) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * The query cache is **working memory only**. Durability lives in the archive
 * (`src/lib/archive`), on IndexedDB.
 *
 * ## Why the persister was removed
 *
 * This used to be a `PersistQueryClientProvider` writing the whole dehydrated
 * cache to `localStorage` under one key, throttled every 2s. That was wrong in a
 * way that got worse as the app grew:
 *
 * - **It serialized everything.** Every feed page, all 19 chat threads with
 *   their full message arrays, the 4,237-group explore catalogue — one JSON
 *   string, rewritten every couple of seconds.
 * - **`localStorage` is ~5 MB**, and `storage.web.ts` catches quota errors and
 *   carries on, by design. So once the blob outgrew the quota, persistence
 *   simply stopped — with no error, no log, and no visible symptom beyond
 *   "nothing is ever cached after a reload".
 * - **It had no indexes**, so the one thing durability was needed for — finding
 *   a post by share code — still meant scanning.
 *
 * The archive replaces it properly: unbounded by comparison, indexed on
 * `index_code` so a share code is a lookup rather than a scan, and explicitly a
 * record rather than a cache, so nothing evicts it.
 *
 * Consequence worth knowing: a cold start now shows loading states where it
 * previously *might* have shown stale content. Given the persister had most
 * likely stopped working under quota, that is closer to a description of the
 * existing behaviour than a regression.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
