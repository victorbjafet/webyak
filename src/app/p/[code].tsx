import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isPostId, useComments, usePost, usePostIdByCode } from '@/api/queries';
import type { PostOrComment } from '@/api/types';
import { GroupAvatar } from '@/components/group-avatar';
import { CommentComposer } from '@/components/post/comment-composer';
import { CommentItem } from '@/components/post/comment-item';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Spacing } from '@/constants/theme';
import { formatCount } from '@/lib/time';

export default function PostDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();

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
  const comments = useComments(postId);
  const [replyTo, setReplyTo] = useState<PostOrComment | null>(null);

  const startReply = useCallback((comment: PostOrComment) => setReplyTo(comment), []);
  const cancelReply = useCallback(() => setReplyTo(null), []);

  if ((post.isLoading || resolved.isLoading) && !cached) {
    return (
      <Screen title="Post" back>
        <LoadingState label="Loading post…" />
      </Screen>
    );
  }

  const current = post.data ?? cached;

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
            body="This looks like a Yik Yak share code, and their API has no way to look a post up by one — so it only opens if the post is already loaded somewhere in the app. Links shared from webyak carry the post id instead and open anywhere."
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

        {comments.data?.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onReply={current.comments_disabled ? undefined : startReply}
          />
        ))}
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
});
