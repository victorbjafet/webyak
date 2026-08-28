import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  api,
  getGroupPosts,
  getSavedPosts,
  getUpdates,
  getUpvotedPosts,
  getUserContent,
} from './client';
import { mergeFeedPages, sanitizePosts } from './feed';
import { fetchExploreGroups, resolveGroupBySlug, searchGroups, type GroupRef } from './groups';
import { getDMThread, getDMThreads, getGroupChats, getJoinedGroupChats } from './chats';
import { hasSeenPost, useSeenVersion } from '@/lib/seen-posts';
import type {
  Cursor,
  FeedCategory,
  FeedFilter,
  Group,
  Karma,
  MyIdentity,
  PostOrComment,
  Profile,
  TopPeriod,
} from './types';

/** Keep pulling pages until the unread list could plausibly fill a screen. */
const UNREAD_MIN_VISIBLE = 8;

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
  karma: () => ['me', 'karma'] as const,
  saved: () => ['me', 'saved'] as const,
  upvoted: () => ['me', 'upvoted'] as const,
  dmThreads: () => ['chats', 'threads'] as const,
  dmThread: (id: string) => ['chats', 'thread', id] as const,
  groupChats: () => ['chats', 'explore'] as const,
  joinedGroupChats: () => ['chats', 'joined'] as const,
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
  filter: FeedFilter,
  period: TopPeriod = 'day',
) {
  // `unread` is not a category the API accepts — it rejects it outright — so it
  // rides on `hot` and is applied here. Same underlying query key as plain hot,
  // deliberately: both views want the same pages, and giving them separate keys
  // would double the requests to show the same posts.
  const unread = filter === 'unread';
  const sort: FeedCategory = unread ? 'hot' : filter;

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

  // Re-render when the seen set changes, so a post read on the post screen
  // disappears from the unread list on the way back.
  const seenVersion = useSeenVersion();

  const merged = useMemo(
    () => (query.data ? mergeFeedPages(query.data.pages) : []),
    [query.data],
  );

  const posts = useMemo(() => {
    if (!unread) return merged;
    // `seenVersion` is the dependency that matters; `merged` alone would go
    // stale the moment something is marked read.
    void seenVersion;
    return merged.filter((post) => !hasSeenPost(post.id));
  }, [merged, unread, seenVersion]);

  /**
   * Filtering client-side means a page of 24 can collapse to nothing once
   * you've read it, leaving a blank screen with more pages sitting behind it.
   * Pull the next page automatically while the visible result is too short to
   * fill a viewport — bounded by `hasNextPage`, so it stops at the end rather
   * than looping.
   */
  useEffect(() => {
    if (!unread) return;
    if (posts.length >= UNREAD_MIN_VISIBLE) return;
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [unread, posts.length, query]);

  return { ...query, posts };
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


/**
 * Yakarma — the total, and the per-community breakdown.
 *
 * One request: `getUpdates()` carries `karma` with `{post, comment, groups}`, so
 * the breakdown does not need a call per community.
 */
export function useKarma() {
  return useQuery({
    queryKey: queryKeys.karma(),
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<Karma> => {
      const updates = await getUpdates();
      return ((updates as { karma?: Karma })?.karma ?? {}) as Karma;
    },
  });
}

/** Posts you've upvoted. `/v1/posts/upvoted` — a path, not a `type` value. */
export function useUpvotedPosts() {
  return useQuery({
    queryKey: queryKeys.upvoted(),
    queryFn: async () => sanitizePosts((await getUpvotedPosts())?.posts),
  });
}

/** Saved posts. Read-only — no write path for saving exists (docs/API.md). */
export function useSavedPosts() {
  return useQuery({
    queryKey: queryKeys.saved(),
    queryFn: async () => sanitizePosts((await getSavedPosts())?.posts),
  });
}


/* ------------------------------------------------------------------------ *
 * Messaging (Phase 6)
 *
 * There is no push channel and no websocket in this API, so "live" means
 * polling. The intervals below are deliberately unhurried: this is a private
 * API hit with a real account, and a chatty client is an account-risk decision
 * as much as a performance one (PLAN §8). An open thread polls faster than a
 * list nobody is reading.
 * ------------------------------------------------------------------------ */

/**
 * How often an open thread checks for new messages.
 *
 * 5s, matching offsides — which polls this exact API at that rate and has done
 * for a long time, so it is a measured tolerance rather than a guess. My first
 * pass used 12s out of caution about request rates (PLAN §8); that was being
 * careful about the wrong thing, since 12s is a noticeably laggy chat and the
 * conservative number was not buying safety anyone had established.
 */
const THREAD_POLL_MS = 5_000;
/** The list only needs to notice a new conversation, not every keystroke. */
const THREAD_LIST_POLL_MS = 60_000;

export function useDMThreads(poll = true) {
  return useQuery({
    queryKey: queryKeys.dmThreads(),
    queryFn: getDMThreads,
    refetchInterval: poll ? THREAD_LIST_POLL_MS : false,
  });
}

export function useDMThread(chatId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dmThread(chatId ?? ''),
    enabled: Boolean(chatId),
    queryFn: () => getDMThread(chatId as string),
    refetchInterval: THREAD_POLL_MS,
    // Only while the tab is visible. Polling a background tab burns requests
    // against a private API for messages nobody is looking at.
    refetchIntervalInBackground: false,
  });
}

/**
 * Group chats you're already in.
 *
 * Read from `getUpdates().chats`, because `/v1/chats` returns DM threads only.
 * This is a **lead, not a confirmed shape** — the key exists in the updates
 * payload but its contents have never been inspected, so the messaging probe
 * dumps it. Degrades to an empty list if the guess is wrong.
 */
export function useJoinedGroupChats() {
  return useQuery({
    queryKey: queryKeys.joinedGroupChats(),
    staleTime: 1000 * 60 * 2,
    queryFn: getJoinedGroupChats,
  });
}

/** Joinable school group chats. Cached — the list changes slowly. */
export function useGroupChats() {
  return useQuery({
    queryKey: queryKeys.groupChats(),
    staleTime: 1000 * 60 * 10,
    queryFn: getGroupChats,
  });
}
