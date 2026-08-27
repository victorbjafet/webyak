import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { ApiError } from './client';

import { cacheStorage } from '@/lib/storage';

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: ONE_MINUTE,
      // Must be >= the persister's maxAge or restored entries are dropped
      // immediately on rehydrate.
      gcTime: ONE_DAY,
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

const persister = createAsyncStoragePersister({
  storage: cacheStorage,
  key: 'webyak.queryCache',
  throttleTime: 2000,
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: ONE_DAY,
        // Bump when the shape of cached data changes so stale entries are
        // discarded rather than deserialized into the wrong types.
        buster: 'v1',
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === 'success',
        },
      }}>
      {children}
    </PersistQueryClientProvider>
  );
}
