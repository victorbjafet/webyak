import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { api, getGroupPosts, getUpdates, getUserContent } from './client';
import { mergeFeedPages, sanitizePosts } from './feed';
import { fetchExploreGroups, resolveGroupBySlug, searchGroups, type GroupRef } from './groups';
import type {
  Cursor,
  FeedCategory,
  Group,
  MyIdentity,
  PostOrComment,
  Profile,
  TopPeriod,
} from './types';

export const queryKeys = {
  groupBySlug: (slug: string) => ['group', 'slug', slug] as const,
  feed: (groupId: string, sort: FeedCategory, period?: TopPeriod) =>
    ['feed', groupId, sort, period ?? 'day'] as const,
  post: (postId: string) => ['post', postId] as const,
  comments: (postId: string) => ['comments', postId] as const,
  profile: (username: string) => ['profile', username] as const,
  userPosts: (username: string) => ['profile', username, 'posts'] as const,
  explore: () => ['explore', 'groups'] as const,
  groupSearch: (term: string) => ['explore', 'search', term] as const,
  myContent: (kind: 'posts' | 'comments') => ['me', kind] as const,
  myIdentity: () => ['me', 'identity'] as const,
};

/** Resolve a URL slug to a group. Layered — see src/api/groups.ts. */
export function useGroupBySlug(slug: string | undefined, primaryGroupId?: string) {
  return useQuery({
    queryKey: queryKeys.groupBySlug(slug ?? ''),
    enabled: Boolean(slug),
    staleTime: 1000 * 60 * 60, // slugs don't move
    queryFn: async (): Promise<GroupRef | null> =>
      slug ? resolveGroupBySlug(slug, primaryGroupId) : null,
  });
}

/**
 * Cursor-paginated feed.
 *
 * `sanitizePosts` runs per page and `mergeFeedPages` again across the join,
 * because the endpoint returns id-less entries and can repeat a post between
 * pages — see docs/OFFSIDES.md.
 */
export function useGroupFeed(
  groupId: string | undefined,
  sort: FeedCategory,
  period: TopPeriod = 'day',
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.feed(groupId ?? '', sort, period),
    enabled: Boolean(groupId),
    initialPageParam: undefined as Cursor | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await getGroupPosts(groupId as string, sort, pageParam, period);
      return { posts: sanitizePosts(page?.posts), cursor: page?.cursor };
    },
    getNextPageParam: (last) => {
      // Stop on a missing cursor or an empty page, otherwise this loops forever.
      if (!last?.cursor || last.posts.length === 0) return undefined;
      return last.cursor;
    },
  });

  return {
    ...query,
    posts: query.data ? mergeFeedPages(query.data.pages) : [],
  };
}

export function useUserProfile(username: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profile(username ?? ''),
    enabled: Boolean(username),
    queryFn: async () => (await api.getUserProfile(username as string)) as unknown as Profile,
  });
}

export function useUserPosts(username: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userPosts(username ?? ''),
    enabled: Boolean(username),
    queryFn: async () =>
      sanitizePosts((await api.getUserPosts(username as string)) as unknown as PostOrComment[]),
  });
}

export function usePost(postId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.post(postId ?? ''),
    enabled: Boolean(postId),
    queryFn: async () => (await api.getPost(postId as string)) as unknown as PostOrComment,
  });
}

export function useComments(postId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.comments(postId ?? ''),
    enabled: Boolean(postId),
    queryFn: async () =>
      (await api.getPostComments(postId as string)) as unknown as PostOrComment[],
  });
}

/**
 * Find a post's UUID from its share code by scanning what's already cached.
 *
 * The API cannot resolve a share code (docs/API.md#blocker-1), so `/p/<code>`
 * relies on the post having been seen in a feed. This is what makes in-app
 * navigation work; a cold-loaded shared link finds nothing and the screen says
 * so rather than spinning.
 */
export function findCachedPostByCode(client: QueryClient, code: string): PostOrComment | null {
  if (!code) return null;

  for (const [, data] of client.getQueriesData({ queryKey: ['feed'] })) {
    const pages = (data as { pages?: { posts?: PostOrComment[] }[] } | undefined)?.pages;
    if (!pages) continue;
    for (const page of pages) {
      const hit = page.posts?.find((p) => p.index_code === code);
      if (hit) return hit;
    }
  }

  for (const [, data] of client.getQueriesData({ queryKey: ['post'] })) {
    const post = data as PostOrComment | undefined;
    if (post?.index_code === code) return post;
  }

  return null;
}

export function useCachedPostByCode(code: string | undefined) {
  const client = useQueryClient();
  return code ? findCachedPostByCode(client, code) : null;
}


/**
 * The full explore catalogue — every joinable community.
 *
 * One request returns the lot (4,237 groups as of 2026-08-27), so it is fetched
 * once and cached hard rather than paged. That is a big response to hold, but
 * the endpoint offers no cursor and the alternative is refetching it for every
 * keystroke of client-side filtering.
 */
export function useExploreGroups() {
  return useQuery({
    queryKey: queryKeys.explore(),
    staleTime: 1000 * 60 * 30,
    queryFn: fetchExploreGroups,
  });
}

/**
 * Server-side group search. Only runs on two or more characters — a one-letter
 * term matches a large fraction of 4,000 groups and is not worth a request.
 */
export function useGroupSearch(term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: queryKeys.groupSearch(trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 1000 * 60 * 5,
    queryFn: () => searchGroups(trimmed),
  });
}

/** Your own posts or comments, via the URL-patched `getUserContent`. */
export function useMyContent(kind: 'posts' | 'comments') {
  return useQuery({
    queryKey: queryKeys.myContent(kind),
    queryFn: async () => sanitizePosts(await getUserContent(kind)),
  });
}

export type { Group };


/**
 * Your own username, bio and icon.
 *
 * From `getUpdates().user`, not `/v1/users/me` — the latter returns ids,
 * memberships and email domains but no username or bio, which is the whole
 * point of this query.
 */
export function useMyIdentity() {
  return useQuery({
    queryKey: queryKeys.myIdentity(),
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<MyIdentity> => {
      const updates = await getUpdates();
      return (updates?.user ?? {}) as MyIdentity;
    },
  });
}
