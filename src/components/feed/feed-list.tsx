import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '../states';
import { ThemedText } from '../themed-text';
import { PostCard } from '../post/post-card';

import type { PostOrComment } from '@/api/types';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface FeedListProps {
  posts: PostOrComment[];
  isLoading: boolean;
  isRefetching?: boolean;
  error?: unknown;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  showGroup?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onRetry?: () => void;
  header?: React.ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
}

export function FeedList({
  posts,
  isLoading,
  isRefetching = false,
  error,
  hasNextPage = false,
  isFetchingNextPage = false,
  showGroup = false,
  onRefresh,
  onEndReached,
  onRetry,
  header,
  emptyTitle = 'Nothing here yet',
  emptyBody = 'Be the first to post.',
}: FeedListProps) {
  const theme = useTheme();
  const router = useRouter();

  const renderItem = useCallback(
    ({ item }: { item: PostOrComment }) => (
      <PostCard
        post={item}
        showGroup={showGroup}
        onPress={
          item.index_code
            ? () => router.push({ pathname: '/p/[code]', params: { code: item.index_code! } })
            : undefined
        }
      />
    ),
    [router, showGroup],
  );

  if (error && posts.length === 0) {
    return (
      <View style={styles.pad}>
        {header}
        <ErrorState error={error} onRetry={onRetry} title="Couldn't load this feed" />
      </View>
    );
  }

  if (isLoading && posts.length === 0) {
    return (
      <View style={styles.pad}>
        {header}
        <LoadingState label="Loading posts…" />
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={header ? <View style={styles.header}>{header}</View> : null}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onEndReachedThreshold={0.5}
      onEndReached={hasNextPage ? onEndReached : undefined}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={theme.textSecondary}
          />
        ) : undefined
      }
      ListEmptyComponent={<EmptyState title={emptyTitle} body={emptyBody} />}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : !hasNextPage && posts.length > 0 ? (
          <View style={styles.footer}>
            <ThemedText type="caption" themeColor="textTertiary">
              {`That's everything`}
            </ThemedText>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 0,
  },
  header: {
    paddingVertical: Spacing.three,
  },
  separator: {
    height: Spacing.two,
  },
  footer: {
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  pad: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
});
