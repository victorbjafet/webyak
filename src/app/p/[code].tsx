import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isPostId, useCachedPostByCode, useComments, usePost } from '@/api/queries';
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

    An id is what our own share links carry, and it works cold — `getPost` is
    UUID-keyed, so nothing has to be resolved. A code is what a yikyak.com link
    carries, and the API cannot resolve one (docs/API.md#blocker-1), so those
    only open if the post is already cached.

    That asymmetry is the whole reason share links switched to ids: the code was
    never required, it was a URL-shape choice that happened to be unresolvable.
  */
  const direct = isPostId(code) ? code : undefined;
  const cached = useCachedPostByCode(direct ? '' : code);
  const postId = direct ?? cached?.id;

  const post = usePost(postId);
  const comments = useComments(postId);
  const [replyTo, setReplyTo] = useState<PostOrComment | null>(null);

  const startReply = useCallback((comment: PostOrComment) => setReplyTo(comment), []);
  const cancelReply = useCallback(() => setReplyTo(null), []);

  if (!postId) {
    return (
      <Screen title="Post" back>
        <EmptyState
          icon="link-outline"
          title="Can't open this share code"
          body="This is a Yik Yak share code, and their API has no way to look a post up by one — so it only opens if the post is already loaded somewhere in the app. Links shared from webyak carry the post id instead and always work."
        />
      </Screen>
    );
  }

  if (post.isLoading && !cached) {
    return (
      <Screen title="Post" back>
        <LoadingState label="Loading post…" />
      </Screen>
    );
  }

  const current = post.data ?? cached;
  if (!current) {
    return (
      <Screen title="Post" back>
        <ErrorState
          error={post.error}
          onRetry={() => post.refetch()}
          title="Couldn't load this post"
        />
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
