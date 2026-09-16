import { useQuery } from '@tanstack/react-query';

import { api } from './client';
import { queryKeys } from './queries';
import type { Profile } from './types';

/**
 * A username's profile photo, for avatars outside the profile screen.
 *
 * ## Why this needs a request at all
 *
 * A post's `identity` carries `name`, `posted_with_username`,
 * `conversation_icon` and `is_following` — and **no photo**. The photo lives at
 * `icon_url` on the *profile*, which is
 * `…/v1/assets/profile?user_id=<uuid>&asset_id=<uuid>`: two ids the post payload
 * does not contain, so there is nothing to construct it from locally. The only
 * way to a photo is a profile lookup
 * (docs/API.md#profile-photos-icon_url-and-the-bearer-was-breaking-it).
 *
 * ## Why that is affordable
 *
 * It **shares `queryKeys.profile`** with the profile screen rather than owning a
 * key of its own. That is the whole trick: the lookup is the same request the
 * screen already makes, so opening a profile makes every avatar for that author
 * free, and the reverse. Within a feed, twenty posts by one author are one
 * request, because TanStack dedupes by key.
 *
 * The cost is bounded by **distinct named authors on screen**, not by posts.
 * Most posts are anonymous and ask for nothing, and a community has a small
 * recurring cast of people who post under a name.
 *
 * Cached for an hour and never retried. A profile photo changing is not
 * time-critical, and a username with no profile — deleted, renamed, or simply
 * unreachable — must fail once and stay quiet rather than re-asking for every
 * post it wrote.
 */
export function useAuthorPhoto(username: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.profile(username ?? ''),
    enabled: Boolean(username) && enabled,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: false,
    // Avatars are decoration. Re-fetching them when a window regains focus would
    // spend requests on a private API to change nothing on screen.
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: async () => (await api.getUserProfile(username as string)) as unknown as Profile,
  });

  // `image_url` is the fallback the profile screen also accepts: sidechat.js's
  // typedef says an icon is emoji + color, and it has been wrong before.
  return query.data?.icon_url ?? query.data?.image_url ?? undefined;
}
