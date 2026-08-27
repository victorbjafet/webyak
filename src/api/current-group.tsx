import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { fetchUserGroups, indexGroups } from './groups';
import { useSession } from './session';
import type { Group } from './types';

import { cacheStorage } from '@/lib/storage';

const SELECTED_KEY = 'webyak.currentGroupId';

interface CurrentGroupValue {
  /** The communities this account belongs to. */
  groups: Group[];
  isLoading: boolean;
  current: Group | null;
  setCurrent(groupId: string): void;
}

const CurrentGroupContext = createContext<CurrentGroupValue | null>(null);

/**
 * Which community the home feed is showing.
 *
 * The list comes from `getUpdates().groups`, which is where offsides' GroupPicker
 * reads it. Note that is **not** a complete membership list — `/v1/users/me`
 * reported 4 memberships against 3 groups here — so treat it as "the ones the
 * API offers for switching", not "everything you belong to".
 */
export function CurrentGroupProvider({ children }: { children: React.ReactNode }) {
  const { status, primaryGroup } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const query = useQuery({
    queryKey: ['my-groups'],
    enabled: status === 'authenticated',
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const groups = await fetchUserGroups(primaryGroup?.id);
      // Seed the slug resolver while we have these — saves a lookup later.
      indexGroups(groups);
      return groups;
    },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await cacheStorage.getItem(SELECTED_KEY);
      if (cancelled) return;
      setSelectedId(stored);
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrent = useCallback((groupId: string) => {
    setSelectedId(groupId);
    void cacheStorage.setItem(SELECTED_KEY, groupId);
  }, []);

  const groups = useMemo(() => query.data ?? [], [query.data]);

  const current = useMemo(() => {
    if (!restored) return null;
    const chosen = selectedId ? groups.find((g) => g.id === selectedId) : undefined;
    if (chosen) return chosen;
    // Fall back to the account's primary group, then to whatever is first.
    const primary = primaryGroup?.id ? groups.find((g) => g.id === primaryGroup.id) : undefined;
    return primary ?? groups[0] ?? (primaryGroup as Group | null) ?? null;
  }, [restored, selectedId, groups, primaryGroup]);

  const value = useMemo<CurrentGroupValue>(
    () => ({ groups, isLoading: query.isLoading, current, setCurrent }),
    [groups, query.isLoading, current, setCurrent],
  );

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>;
}

export function useCurrentGroup() {
  const ctx = useContext(CurrentGroupContext);
  if (!ctx) throw new Error('useCurrentGroup must be used inside <CurrentGroupProvider>');
  return ctx;
}
