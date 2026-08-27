import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useCachedPostByCode, useComments, usePost } from '@/api/queries';
import { CommentItem } from '@/components/post/comment-item';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCount } from '@/lib/time';

export default function PostDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();

  // The API cannot resolve a share code (docs/API.md#blocker-1), so the UUID has
  // to come from a feed we've already loaded. Reached from a feed this always
  // hits; opened cold from a shared link it never will, until the Worker exists.
  const cached = useCachedPostByCode(code);
  const post = usePost(cached?.id);
  const comments = useComments(cached?.id);

  if (!cached) {
    return (
      <Screen title="Post">
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
    <Screen title="Post" subtitle={current.group?.name} scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PostCard post={current} />

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

        {comments.data?.map((comment) => <CommentItem key={comment.id} comment={comment} />)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  commentsHeader: {
    paddingTop: Spacing.three,
  },
});
