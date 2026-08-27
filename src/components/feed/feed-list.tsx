import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '../states';
import { ThemedText } from '../themed-text';
import { PostCard } from '../post/post-card';

import type { PostOrComment } from '@/api/types';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How many rows either side of the viewport count as "about to be seen". */
const PRELOAD_MARGIN = 2;

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

  // Which rows are on screen, widened by PRELOAD_MARGIN so a video has started
  // buffering by the time it scrolls into view rather than when play is pressed.
  const [preloadRange, setPreloadRange] = useState({ start: 0, end: PRELOAD_MARGIN });
  // FlatList rejects a changing onViewableItemsChanged, so both of these must
  // keep a stable identity. `setPreloadRange` is already stable, which lets the
  // callback hold no dependencies.
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 10 }), []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const indices = viewableItems
        .map((v) => v.index)
        .filter((i): i is number => typeof i === 'number');
      if (indices.length === 0) return;
      setPreloadRange({
        start: Math.min(...indices) - PRELOAD_MARGIN,
        end: Math.max(...indices) + PRELOAD_MARGIN,
      });
    },
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PostOrComment; index: number }) => (
      <PostCard
        post={item}
        showGroup={showGroup}
        preload={index >= preloadRange.start && index <= preloadRange.end}
        onPress={
          item.index_code
            ? () => router.push({ pathname: '/p/[code]', params: { code: item.index_code! } })
            : undefined
        }
      />
    ),
    [router, showGroup, preloadRange],
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
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
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
