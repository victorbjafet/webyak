import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  createComment,
  createPost,
  deletePostOrComment,
  setGroupMembership,
  setVote,
  updateProfile,
  type ProfileUpdate,
  voteOnPoll,
  type CreateCommentInput,
  type CreatePostInput,
} from './client';
import { joinGroupChat, sendDM, startDM } from './chats';
import { queryKeys } from './queries';
import { useSession } from './session';
import type { JoinChatIdentity, PostOrComment, VoteStatus } from './types';
import { toastError } from '@/lib/toast';

/* ------------------------------------------------------------------------ *
 * Cache surgery
 *
 * A single post is cached in several places at once: every feed page that
 * contains it (one per sort × period the user has opened), its own `['post']`
 * entry, the comment list it may appear in, and any profile feed. An optimistic
 * update has to reach all of them or the same post shows two different vote
 * counts on two screens — and it has to be able to put every one of them back.
 * ------------------------------------------------------------------------ */

type PostPatch = (post: PostOrComment) => PostOrComment;
type Snapshot = { key: readonly unknown[]; data: unknown }[];

/** Applies `patch` to matching posts in a list, descending into nested replies. */
function patchList(list: PostOrComment[], id: string, patch: PostPatch): PostOrComment[] {
  let changed = false;
  const next = list.map((item) => {
    let updated = item;
    if (item?.id === id) {
      updated = patch(item);
      changed = true;
    }
    // `getPostComments` returns a flat list whose entries also carry a `replies`
    // array, so the same comment is reachable twice. Both copies get patched;
    // after cache rehydration they are no longer the same object.
    if (updated.replies?.length) {
      const replies = patchList(updated.replies, id, patch);
      if (replies !== updated.replies) {
        updated = { ...updated, replies };
        changed = true;
      }
    }
    return updated;
  });
  return changed ? next : list;
}

type FeedCache = { pages?: { posts?: PostOrComment[]; cursor?: string }[]; pageParams?: unknown[] };

/**
 * Patches every cached copy of a post and returns what was there before, so the
 * caller can restore it if the request fails. Only queries that actually
 * changed are snapshotted — restoring untouched ones would clobber anything
 * that arrived in the meantime.
 */
export function patchPostEverywhere(
  client: QueryClient,
  id: string,
  patch: PostPatch,
): Snapshot {
  const snapshot: Snapshot = [];

  for (const [key, data] of client.getQueriesData<FeedCache>({ queryKey: ['feed'] })) {
    if (!data?.pages) continue;
    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page?.posts) return page;
      const posts = patchList(page.posts, id, patch);
      if (posts === page.posts) return page;
      changed = true;
      return { ...page, posts };
    });
    if (!changed) continue;
    snapshot.push({ key, data });
    client.setQueryData(key, { ...data, pages });
  }

  for (const [key, data] of client.getQueriesData<PostOrComment>({ queryKey: ['post'] })) {
    if (data?.id !== id) continue;
    snapshot.push({ key, data });
    client.setQueryData(key, patch(data));
  }

  for (const listKey of [['comments'], ['profile']]) {
    for (const [key, data] of client.getQueriesData<PostOrComment[]>({ queryKey: listKey })) {
      if (!Array.isArray(data)) continue;
      const next = patchList(data, id, patch);
      if (next === data) continue;
      snapshot.push({ key, data });
      client.setQueryData(key, next);
    }
  }

  return snapshot;
}

function restore(client: QueryClient, snapshot: Snapshot) {
  for (const { key, data } of snapshot) client.setQueryData(key, data);
}

/* ------------------------------------------------------------------------ *
 * Voting
 * ------------------------------------------------------------------------ */

/**
 * How much the score moves. Written as the difference between two signed
 * values so the awkward case falls out for free: flipping an upvote straight to
 * a downvote is worth 2, not 1.
 */
export function voteDelta(from: VoteStatus, to: VoteStatus): number {
  const value = (v: VoteStatus) => (v === 'upvote' ? 1 : v === 'downvote' ? -1 : 0);
  return value(to) - value(from);
}

/**
 * Optimistic vote on a post or comment.
 *
 * The delta is computed per cached copy from *that copy's* own status rather
 * than from one shared "before" value. Two caches can legitimately disagree —
 * a feed page may be minutes stale while the post screen is fresh — and
 * applying a delta locally keeps each one self-consistent instead of forcing
 * both to a number that is only right for one of them.
 */
export function useVote() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, next }: { id: string; next: VoteStatus }) => setVote(id, next),

    onMutate: ({ id, next }) => {
      const snapshot = patchPostEverywhere(client, id, (post) => ({
        ...post,
        vote_status: next,
        vote_total: (post.vote_total ?? 0) + voteDelta(post.vote_status ?? 'none', next),
      }));
      return { snapshot };
    },

    onError: (error, _vars, context) => {
      if (context?.snapshot) restore(client, context.snapshot);
      // Rolling back silently is its own bug: the score springs back with no
      // explanation and reads as the app losing the vote at random.
      toastError(error, "That vote didn't go through.");
    },
  });
}

/* ------------------------------------------------------------------------ *
 * Polls
 * ------------------------------------------------------------------------ */

/**
 * Optimistic poll vote.
 *
 * Not undoable — the API has no "change my answer", and `participated` gates the
 * UI back to read-only — so the optimistic update is the whole interaction as
 * far as the user sees it. Rollback still matters: without it a failed vote
 * leaves a permanently locked poll showing a choice that was never recorded.
 */
export function usePollVote() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ pollId, choiceIndex }: { pollId: string; choiceIndex: number; postId: string }) =>
      voteOnPoll(pollId, choiceIndex),

    onMutate: ({ postId, choiceIndex }) => {
      const snapshot = patchPostEverywhere(client, postId, (post) => {
        if (!post.poll) return post;
        return {
          ...post,
          poll: {
            ...post.poll,
            participated: true,
            choices: post.poll.choices.map((choice, index) =>
              index === choiceIndex
                ? { ...choice, selected: true, count: (choice.count ?? 0) + 1 }
                : { ...choice, selected: false },
            ),
          },
        };
      });
      return { snapshot };
    },

    onError: (error, _vars, context) => {
      if (context?.snapshot) restore(client, context.snapshot);
      toastError(error, "That poll vote didn't go through.");
    },
  });
}

/* ------------------------------------------------------------------------ *
 * Composing
 * ------------------------------------------------------------------------ */

export function useCreatePost() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) => createPost(input),
    onError: (error) => toastError(error, "That post didn't send."),
    onSuccess: () => {
      // No optimistic insert. A new post's placement depends on the server's
      // ranking, and guessing it wrong puts the post somewhere it will jump away
      // from on the next fetch. Refetching is slower and honest.
      void client.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useCreateComment() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCommentInput) => createComment(input),
    onError: (error) => toastError(error, "That comment didn't send."),
    onSuccess: (_comment, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.comments(input.parentPostId) });
      // The count is rendered from the post, which the comment list refetch
      // doesn't touch, so bump it here or the footer lags by one until something
      // else refetches the post.
      patchPostEverywhere(client, input.parentPostId, (post) => ({
        ...post,
        comment_count: (post.comment_count ?? 0) + 1,
      }));
    },
  });
}

/* ------------------------------------------------------------------------ *
 * Deleting
 * ------------------------------------------------------------------------ */

/** Removes a post or comment from every list that holds it. */
function dropEverywhere(client: QueryClient, id: string) {
  const drop = (list: PostOrComment[]): PostOrComment[] =>
    list
      .filter((item) => item?.id !== id)
      .map((item) =>
        item.replies?.length ? { ...item, replies: drop(item.replies) } : item,
      );

  for (const [key, data] of client.getQueriesData<FeedCache>({ queryKey: ['feed'] })) {
    if (!data?.pages) continue;
    client.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) =>
        page?.posts ? { ...page, posts: drop(page.posts) } : page,
      ),
    });
  }

  for (const listKey of [['comments'], ['profile']]) {
    for (const [key, data] of client.getQueriesData<PostOrComment[]>({ queryKey: listKey })) {
      if (Array.isArray(data)) client.setQueryData(key, drop(data));
    }
  }
}

export function useDeleteContent() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; parentPostId?: string }) => deletePostOrComment(id),
    onError: (error) => toastError(error, "That couldn't be deleted."),
    onSuccess: (_result, { id, parentPostId }) => {
      dropEverywhere(client, id);
      client.removeQueries({ queryKey: queryKeys.post(id) });
      if (parentPostId) {
        patchPostEverywhere(client, parentPostId, (post) => ({
          ...post,
          comment_count: Math.max(0, (post.comment_count ?? 1) - 1),
        }));
      }
    },
  });
}


/* ------------------------------------------------------------------------ *
 * Membership
 * ------------------------------------------------------------------------ */

/**
 * Join or leave a community, optimistically.
 *
 * Both cached copies matter: the explore catalogue (where the button lives) and
 * any search results showing the same group. They are separate query keys
 * holding separate objects, so a join that only patched one would leave the
 * button showing the opposite state on the other screen.
 *
 * The user's own group list is invalidated rather than patched — joining
 * changes what the switcher and the home feed show, and the server decides the
 * order.
 */
export function useGroupMembership() {
  const client = useQueryClient();

  const patchMembership = (id: string, member: boolean): Snapshot => {
    const snapshot: Snapshot = [];
    for (const [key, data] of client.getQueriesData<{ id: string; membership_type?: string }[]>({
      queryKey: ['explore'],
    })) {
      if (!Array.isArray(data)) continue;
      if (!data.some((g) => g?.id === id)) continue;
      snapshot.push({ key, data });
      client.setQueryData(
        key,
        data.map((g) =>
          g?.id === id ? { ...g, membership_type: member ? 'member' : 'non_member' } : g,
        ),
      );
    }
    return snapshot;
  };

  return useMutation({
    mutationFn: ({ groupId, join }: { groupId: string; join: boolean }) =>
      setGroupMembership(groupId, join),

    onMutate: ({ groupId, join }) => ({ snapshot: patchMembership(groupId, join) }),

    onError: (error, { join }, context) => {
      if (context?.snapshot) restore(client, context.snapshot);
      toastError(error, join ? "Couldn't join that community." : "Couldn't leave that community.");
    },

    onSuccess: () => {
      // The switcher, the home feed and the slug resolver all read the user's
      // groups; only the server knows the resulting list.
      void client.invalidateQueries({ queryKey: ['my-groups'] });
      void client.invalidateQueries({ queryKey: ['group', 'slug'] });
    },
  });
}


/* ------------------------------------------------------------------------ *
 * Your profile
 * ------------------------------------------------------------------------ */

/**
 * Username, bio and icon.
 *
 * Not optimistic. A username claim can be rejected by the server after the
 * availability check passed — someone else can take it in between — so showing
 * it as applied and then reverting would be worse than waiting. Every affected
 * cache is invalidated on success instead: the identity itself, and any profile
 * page or post already rendering the old name.
 */
export function useUpdateProfile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, update }: { userId: string; update: ProfileUpdate }) =>
      updateProfile(userId, update),
    onError: (error) => toastError(error, "Couldn't save those changes."),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.myIdentity() });
      void client.invalidateQueries({ queryKey: ['profile'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}


/* ------------------------------------------------------------------------ *
 * Messaging
 * ------------------------------------------------------------------------ */

/**
 * Sends into an existing thread.
 *
 * Not optimistic. A DM that appears and then vanishes is materially worse than
 * one that takes a moment: the sender has no way to know whether it arrived,
 * and unlike a vote there is no visible counter to reconcile against. The
 * thread is refetched on success instead, which is a round trip the poll would
 * have made anyway.
 */
export function useSendDM() {
  const client = useQueryClient();
  // `client_id` is the device id, not a per-message key — see the note in
  // chats.ts. offsides sends a stable hashed hardware id; ours is the random
  // UUID minted at first launch and persisted with the session.
  const { deviceId } = useSession();

  return useMutation({
    mutationFn: ({ chatId, text, anonymous }: { chatId: string; text: string; anonymous?: boolean }) =>
      sendDM(chatId, text, deviceId ?? '', anonymous),
    onError: (error) => toastError(error, "That message didn't send."),
    onSuccess: (_result, { chatId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.dmThread(chatId) });
      void client.invalidateQueries({ queryKey: queryKeys.dmThreads() });
    },
  });
}

/** Opens a new thread from a post or comment. */
export function useStartDM() {
  const client = useQueryClient();
  const { deviceId } = useSession();

  return useMutation({
    mutationFn: ({
      text,
      postId,
      anonymous,
    }: {
      text: string;
      postId: string;
      anonymous?: boolean;
    }) => startDM(text, postId, deviceId ?? '', anonymous),
    onError: (error) => toastError(error, "That message couldn't be sent."),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.dmThreads() });
    },
  });
}

export function useJoinGroupChat() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ chatId, identity }: { chatId: string; identity: JoinChatIdentity }) =>
      joinGroupChat(chatId, identity),
    onError: (error) => toastError(error, "Couldn't join that chat."),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.groupChats() });
      void client.invalidateQueries({ queryKey: queryKeys.dmThreads() });
    },
  });
}
