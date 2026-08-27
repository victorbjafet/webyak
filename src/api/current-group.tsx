import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { fetchUserGroups, indexGroups } from './groups';
import { useSession } from './session';
import type { Group } from './types';

import { cacheStorage } from '@/lib/storage';

/**
 * The whole selected group is persisted, not just its id.
 *
 * Storing an id means every read is a lookup that can miss — a stale id, a group
 * that dropped out of `getUpdates`, an id field that isn't what we assumed — and
 * a missed lookup falls back silently to the primary group, which looks exactly
 * like "selecting a community does nothing". Storing the object removes the
 * lookup, so a selection cannot fail to take effect.
 */
const SELECTED_KEY = 'webyak.currentGroup';

interface CurrentGroupValue {
  /** The communities this account belongs to. */
  groups: Group[];
  isLoading: boolean;
  current: Group | null;
  setCurrent(group: Group): void;
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
  const [selected, setSelected] = useState<Group | null>(null);
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
      const raw = await cacheStorage.getItem(SELECTED_KEY);
      if (cancelled) return;
      if (raw) {
        try {
          setSelected(JSON.parse(raw) as Group);
        } catch {
          /* corrupt entry — fall through to the default */
        }
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrent = useCallback((group: Group) => {
    setSelected(group);
    void cacheStorage.setItem(SELECTED_KEY, JSON.stringify(group));
  }, []);

  const groups = useMemo(() => query.data ?? [], [query.data]);

  const current = useMemo(() => {
    // The selection wins outright — no lookup, so nothing to miss.
    if (selected) return selected;
    if (!restored) return null;
    const primary = primaryGroup?.id ? groups.find((g) => g.id === primaryGroup.id) : undefined;
    return primary ?? groups[0] ?? (primaryGroup as Group | null) ?? null;
  }, [restored, selected, groups, primaryGroup]);

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
