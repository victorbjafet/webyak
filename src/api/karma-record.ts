import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getUpdates } from './client';
import { karmaFromUpdates, queryKeys } from './queries';
import { useSession } from './session';

import { recordKarma } from '@/lib/karma-history';

/**
 * Samples karma for the history chart (src/lib/karma-history.ts) whenever it
 * is read, by anything: the boot-time groups query seeds it, and the You tab
 * and Alerts refresh it. This observer never fetches on its own (`enabled:
 * false`), so it adds no request. It only watches the cache.
 */
export function useRecordKarma() {
  const { userId } = useSession();
  const { data } = useQuery({
    queryKey: queryKeys.karma(),
    queryFn: async () => karmaFromUpdates(await getUpdates()),
    enabled: false,
  });
  const post = data?.post;
  const comment = data?.comment;

  useEffect(() => {
    if (!userId || typeof post !== 'number' || typeof comment !== 'number') return;
    void recordKarma(userId, post, comment);
  }, [userId, post, comment]);
}
