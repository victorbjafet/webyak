import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PostGone } from '@/api/client';
import {
  isPostId,
  useArchivedCopies,
  useArchivedPost,
  useComments,
  usePost,
  usePostIdByCode,
} from '@/api/queries';
import type { PostOrComment } from '@/api/types';
import { ArchivedPost } from '@/components/archive/archived-post';
import { GroupAvatar } from '@/components/group-avatar';
import { CommentComposer } from '@/components/post/comment-composer';
import { CommentItem } from '@/components/post/comment-item';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { isTombstoneText } from '@/lib/archive/types';
import { formatCount } from '@/lib/time';
import { showToast } from '@/lib/toast';
import { WORKER_URL } from '@/lib/worker';

export default function PostDetailScreen() {
  const { code, comment: focusId } = useLocalSearchParams<{ code: string; comment?: string }>();
  const router = useRouter();
  const theme = useTheme();

  /*
    `/p/<id>` takes either a post **id** or a share **code**.

    An id works cold — `getPost` is UUID-keyed, so nothing has to be resolved. A
    share code cannot be resolved by the API at all (docs/API.md#blocker-1), so
    those only open if the post is already cached.

    **The param is handed straight to `getPost` rather than format-checked
    first.** A previous version gated on a UUID regex and refused anything that
    didn't match — which rejected a real id in practice and showed the
    share-code error for a link that would have loaded fine. Asking the server
    is cheaper and more reliable than predicting what it accepts: a share code
    just fails the request, and that failure is a case already handled.
  */
  const resolved = usePostIdByCode(code);
  const cached = resolved.post;

  /*
    Resolution order, without ever format-checking the param:

    1. If the archive or the live cache knows this code, use the id it gives.
    2. Otherwise, once that lookup has *settled*, hand the param to `getPost`
       raw — an id resolves, a share code fails into the explanatory state.

    Waiting for the lookup to settle is what avoids firing a request that is
    already known to be wrong: handing a share code straight to `getPost` would
    fail, then succeed a moment later once the archive answered.
  */
  const postId = resolved.postId ?? (resolved.isLoading ? undefined : code);

  const post = usePost(postId);

  /*
    When the live post is unavailable, the archive is the fallback — and the
    reason it is unavailable decides what the screen says.

    `PostGone` means Yik Yak was asked for this post by id and does not serve
    it: it has been deleted. Anything else (a dropped connection, a server
    error) says nothing about the post, so the archived copy is shown as a
    stand-in rather than as a verdict.
  */
  const gone = post.error instanceof PostGone;
  const archived = useArchivedPost(postId, post.isError);
  // A deleted post has no live thread to load; its thread comes from the archive.
  const comments = useComments(gone ? undefined : postId);
  // Placeholders in the live thread whose words the archive may have kept.
  const placeholderIds = (comments.data ?? [])
    .filter((comment) => isTombstoneText(comment.text))
    .map((comment) => comment.id);
  const copies = useArchivedCopies(postId, placeholderIds);
  const [replyTo, setReplyTo] = useState<PostOrComment | null>(null);

  const startReply = useCallback((comment: PostOrComment) => setReplyTo(comment), []);
  const cancelReply = useCallback(() => setReplyTo(null), []);

  /*
    `?comment=<id>` opens the thread at that comment: an alert about a comment
    lands on it, not at the top of a long thread. The comment is scrolled to
    once, when it is first laid out, and stays tinted so it can be found again
    after scrolling away. A later refetch doesn't scroll again, since the
    reader may have moved on by then.
  */
  const scrollRef = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotion();
  const scrolledTo = useRef<string | null>(null);
  const focusComment = useCallback(
    (event: LayoutChangeEvent) => {
      if (!focusId || scrolledTo.current === focusId) return;
      scrolledTo.current = focusId;
      const y = Math.max(0, event.nativeEvent.layout.y - Spacing.five);
      scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
    },
    [focusId, reduceMotion],
  );
  const focusMissing =
    Boolean(focusId) && comments.isSuccess && !comments.data.some((c) => c.id === focusId);
  useEffect(() => {
    if (focusMissing) showToast('That comment is no longer in the thread.');
  }, [focusMissing]);

  if ((post.isLoading || resolved.isLoading) && !cached) {
    return (
      <Screen title="Post" back>
        <LoadingState label="Loading post…" />
      </Screen>
    );
  }

  // A post confirmed gone is never rendered from a stale cache as if it were
  // live — the feed that cached it had no way of knowing it would be removed.
  const current = gone ? undefined : (post.data ?? cached);

  if (!current && post.isError && archived.isLoading) {
    return (
      <Screen title="Post" back>
        <LoadingState label="Looking in the archive…" />
      </Screen>
    );
  }

  if (!current && archived.data) {
    const record = archived.data.record;
    return (
      <Screen title={record.group_name ?? 'Post'} back scroll={false}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ArchivedPost
            record={record}
            thread={archived.data.thread}
            reason={gone ? 'gone' : 'offline'}
            error={post.error}
            onRetry={() => post.refetch()}
          />
        </ScrollView>
      </Screen>
    );
  }

  if (!current && gone && isPostId(postId)) {
    return (
      <Screen title="Post" back>
        <EmptyState
          icon="trash-outline"
          title="This post is no longer on Yik Yak"
          body="It was deleted by its author or removed by moderation, and it was never archived on this device — so there is no copy to show."
        />
      </Screen>
    );
  }

  if (!current) {
    // Only now is the format worth mentioning — and only to explain *why* it
    // failed, never to decide whether to try.
    return (
      <Screen title="Post" back>
        {isPostId(postId) ? (
          <ErrorState
            error={post.error}
            onRetry={() => post.refetch()}
            title="Couldn't load this post"
          />
        ) : (
          <EmptyState
            icon="link-outline"
            title="Can't open this share code"
            body={
              WORKER_URL
                ? "This looks like a Yik Yak share code. Their API can't look a post up by one, and webyak's worker couldn't find it on the public Yik Yak site either, which may only serve posts from public communities. Links shared from webyak carry the post id instead and open anywhere."
                : "This looks like a Yik Yak share code, and their API has no way to look a post up by one — so it only opens if the post is already loaded somewhere in the app. Links shared from webyak carry the post id instead and open anywhere."
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title={current.group?.name ?? 'Post'}
      leading={
        <GroupAvatar
          group={current.group}
          name={current.group?.name}
          iconUrl={current.group?.icon_url}
          color={current.group?.color}
          size={30}
        />
      }
      back
      scroll={false}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <PostCard
          post={current}
          // Same rule as a feed: the community is the header, and an anonymous
          // post gets no author row at all.
          showGroup
          // Deleting the post this screen *is* leaves it showing content that
          // no longer exists — the caches it reads from have already dropped it.
          onDeleted={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />

        {/*
          Directly under the post, not after the comment list. At the bottom it
          sits behind however many replies a thread has, so commenting on a busy
          post means scrolling past everything first. Replying to a specific
          comment still works from here because the composer focuses itself,
          which brings it into view on its own.
        */}
        <CommentComposer post={current} replyTo={replyTo} onCancelReply={cancelReply} />

        <View style={styles.commentsHeader}>
          <ThemedText type="heading">
            {current.comment_count ? `${formatCount(current.comment_count)} comments` : 'Comments'}
          </ThemedText>
        </View>

        {comments.isLoading ? <LoadingState label="Loading comments…" /> : null}

        {comments.isError ? (
          <ErrorState
            error={comments.error}
            onRetry={() => comments.refetch()}
            title="Couldn't load comments"
          />
        ) : null}

        {comments.data?.length === 0 ? (
          <EmptyState icon="chatbubble-outline" title="No comments yet" body="Be the first." />
        ) : null}

        {comments.data?.map((comment) =>
          comment.id === focusId ? (
            <View
              key={comment.id}
              onLayout={focusComment}
              style={[styles.focused, { backgroundColor: theme.brandMuted }]}>
              <CommentItem
                comment={comment}
                onReply={current.comments_disabled ? undefined : startReply}
                archived={copies.data?.[comment.id]}
              />
            </View>
          ) : (
            <CommentItem
              key={comment.id}
              comment={comment}
              onReply={current.comments_disabled ? undefined : startReply}
              archived={copies.data?.[comment.id]}
            />
          ),
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    // Full-width scroller, centred content — see the note in screen.tsx.
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  commentsHeader: {
    paddingTop: Spacing.three,
  },
  // The comment a link or an alert pointed at. The negative margin keeps its
  // text in line with the rest of the thread while the tint reaches past it.
  focused: {
    borderRadius: Radius.md,
    marginHorizontal: -Spacing.two,
    paddingHorizontal: Spacing.two,
  },
});
