import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGroupBySlug, useGroupFeed } from '@/api/queries';
import { useSession } from '@/api/session';
import type { FeedCategory } from '@/api/types';
import { FeedList } from '@/components/feed/feed-list';
import { SortTabs } from '@/components/feed/sort-tabs';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCount } from '@/lib/time';

function asCategory(value: string | undefined): FeedCategory {
  return value === 'recent' || value === 'top' ? value : 'hot';
}

export default function GroupFeedScreen() {
  const router = useRouter();
  const { slug, sort } = useLocalSearchParams<{ slug: string; sort?: string }>();
  const { primaryGroup } = useSession();

  const category = asCategory(sort);
  // `slug` arrives decoded from the router; the resolver normalizes further.
  const group = useGroupBySlug(slug, primaryGroup?.id);
  const feed = useGroupFeed(group.data?.id, category);

  const setSort = useCallback(
    (next: FeedCategory) => router.setParams({ sort: next }),
    [router],
  );

  if (group.isLoading) {
    return (
      <Screen title={slug ?? 'Group'}>
        <LoadingState label="Finding this community…" />
      </Screen>
    );
  }

  if (group.isError) {
    return (
      <Screen title={slug ?? 'Group'}>
        <ErrorState error={group.error} onRetry={() => group.refetch()} />
      </Screen>
    );
  }

  if (!group.data) {
    return (
      <Screen title={slug ?? 'Group'}>
        <EmptyState
          icon="search-outline"
          title="No such community"
          body={`Nothing matched "${slug}". It may be private, or the link may be wrong.`}
        />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      {group.data.description ? (
        <ThemedText type="small" themeColor="textSecondary">
          {group.data.description}
        </ThemedText>
      ) : null}
      {group.data.member_count ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {formatCount(group.data.member_count)} members
        </ThemedText>
      ) : null}
      <SortTabs value={category} onChange={setSort} />
    </View>
  );

  return (
    <Screen title={group.data.name} subtitle={`/g/${group.data.slug}`} scroll={false}>
      <FeedList
        posts={feed.posts}
        isLoading={feed.isLoading}
        isRefetching={feed.isRefetching}
        error={feed.error}
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        onRefresh={() => feed.refetch()}
        onEndReached={() => feed.fetchNextPage()}
        onRetry={() => feed.refetch()}
        header={header}
        emptyBody="No posts in this community yet."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
  },
});
