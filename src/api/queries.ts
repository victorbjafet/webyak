import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { api, getGroupPosts } from './client';
import { mergeFeedPages, sanitizePosts } from './feed';
import { resolveGroupBySlug, type GroupRef } from './groups';
import type { Cursor, FeedCategory, PostOrComment, Profile, TopPeriod } from './types';

export const queryKeys = {
  groupBySlug: (slug: string) => ['group', 'slug', slug] as const,
  feed: (groupId: string, sort: FeedCategory, period?: TopPeriod) =>
    ['feed', groupId, sort, period ?? 'day'] as const,
  post: (postId: string) => ['post', postId] as const,
  comments: (postId: string) => ['comments', postId] as const,
  profile: (username: string) => ['profile', username] as const,
  userPosts: (username: string) => ['profile', username, 'posts'] as const,
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
