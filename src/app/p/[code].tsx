import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useCachedPostByCode, useComments, usePost } from '@/api/queries';
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

  // The API cannot resolve a share code (docs/API.md#blocker-1), so the UUID has
  // to come from a feed we've already loaded. Reached from a feed this always
  // hits; opened cold from a shared link it never will, until the Worker exists.
  const cached = useCachedPostByCode(code);
  const post = usePost(cached?.id);
  const comments = useComments(cached?.id);
  const [replyTo, setReplyTo] = useState<PostOrComment | null>(null);

  const startReply = useCallback((comment: PostOrComment) => setReplyTo(comment), []);
  const cancelReply = useCallback(() => setReplyTo(null), []);

  if (!cached) {
    return (
      <Screen title="Post" back>
        <EmptyState
          icon="link-outline"
          title="Can't open this link directly yet"
          body="Yik Yak's API has no way to look a post up by its share code, so shared links only work once the post has been seen in a feed. Opening it from a community works today."
        />
      </Screen>
    );
  }

  const current = post.data ?? cached;

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
