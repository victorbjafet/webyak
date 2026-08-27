import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import type { Group } from './types';

/**
 * The minimum needed to look an icon up. Deliberately structural rather than
 * `Group`: the slug resolver hands back a narrower `GroupRef`, and widening it
 * with a cast would be claiming fields we don't have.
 */
export interface GroupIconSubject {
  id?: string;
  name?: string;
  icon_url?: string;
}

/**
 * Community icons, fetched from an endpoint that actually has them.
 *
 * Settled by probe on 2026-08-27. The same group is reachable four ways and
 * they do not return the same fields:
 *
 * | Endpoint | `icon_url` |
 * |---|---|
 * | `getUpdates().groups` — *what the app renders* | key absent for some groups |
 * | `GET /v1/groups/<id>` | key absent for the same ones |
 * | `/v1/groups/explore/search?term=` | present |
 * | explore list | present on all 4237 groups |
 *
 * So "community icons don't render" was never a rendering problem: the objects
 * the app draws from simply have no URL in them. Virginia Tech and Home come
 * back without the key, while Class of 2029 comes back *with* it — which is why
 * this looked intermittent and got blamed on the image pipeline.
 *
 * The lookup goes through search rather than the explore list because the list
 * is 4237 entries; searching by name and matching on **id** is a small request.
 * Matching on id matters — a term like "Home" returns plenty of groups that are
 * not the one asked for.
 */
async function fetchGroupIcon(group: GroupIconSubject): Promise<string | null> {
  if (group.icon_url) return group.icon_url;
  if (!group.name) return null;

  const json = await request<{ groups?: Group[] }>(
    `/v1/groups/explore/search?term=${encodeURIComponent(group.name)}`,
  );
  const match = json.groups?.find((g) => g.id === group.id);
  return match?.icon_url ?? null;
}

/**
 * Resolves a group's icon, caching hard — icons effectively never change, and
 * this is a second request for something the first one should have included.
 *
 * Returns `null` rather than retrying for groups that genuinely have no icon,
 * such as the synthetic "Home" feed.
 */
export function useGroupIcon(group: GroupIconSubject | null | undefined) {
  return useQuery({
    queryKey: ['group-icon', group?.id ?? ''],
    enabled: Boolean(group?.id) && !group?.icon_url,
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: () => fetchGroupIcon(group as GroupIconSubject),
  });
}
