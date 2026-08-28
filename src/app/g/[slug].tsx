import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGroupBySlug, useGroupFeed } from '@/api/queries';
import { useSession } from '@/api/session';
import type { FeedCategory, FeedFilter, TopPeriod } from '@/api/types';
import { FeedList } from '@/components/feed/feed-list';
import { LeaderboardButton } from '@/components/feed/leaderboard-button';
import { SortTabs } from '@/components/feed/sort-tabs';
import { JoinButton } from '@/components/explore/join-button';
import { GroupAvatar } from '@/components/group-avatar';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCount } from '@/lib/time';

function asCategory(value: string | undefined): FeedCategory {
  return value === 'recent' || value === 'top' ? value : 'hot';
}

function asPeriod(value: string | undefined): TopPeriod {
  return value === 'week' || value === 'all_time' ? value : 'day';
}

export default function GroupFeedScreen() {
  const router = useRouter();
  const { slug, sort, period } = useLocalSearchParams<{
    slug: string;
    sort?: string;
    period?: string;
  }>();
  const { primaryGroup } = useSession();

  const category = asCategory(sort);
  const window = asPeriod(period);
  // `slug` arrives decoded from the router; the resolver normalizes further.
  const group = useGroupBySlug(slug, primaryGroup?.id);
  const feed = useGroupFeed(group.data?.id, category, window);

  const setSort = useCallback(
    // A community feed has no unread tab, so anything else lands on hot.
    (next: FeedFilter) => router.setParams({ sort: next === 'unread' ? 'hot' : next }),
    [router],
  );
  const setPeriod = useCallback(
    (next: TopPeriod) => router.setParams({ period: next }),
    [router],
  );

  if (group.isLoading) {
    return (
      <Screen title={slug ?? 'Group'} back>
        <LoadingState label="Finding this community…" />
      </Screen>
    );
  }

  if (group.isError) {
    return (
      <Screen title={slug ?? 'Group'} back>
        <ErrorState error={group.error} onRetry={() => group.refetch()} />
      </Screen>
    );
  }

  if (!group.data) {
    return (
      <Screen title={slug ?? 'Group'} back>
        <EmptyState
          icon="search-outline"
          title="No such community"
          body={`Nothing matched "${slug}". It may be private, or the link may be wrong.`}
        />
      </Screen>
    );
  }

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.metaRow}>
        {group.data.member_count ? (
          <ThemedText type="caption" themeColor="textTertiary">
            {formatCount(group.data.member_count)} members
          </ThemedText>
        ) : null}
        <View style={styles.spacer} />
        {group.data.id ? (
          <JoinButton
            groupId={group.data.id}
            name={group.data.name}
            isMember={group.data.membership_type === 'member'}
            canJoin={group.data.can_join !== false}
          />
        ) : null}
      </View>

      {group.data.description ? (
        <ThemedText type="small" themeColor="textSecondary">
          {group.data.description}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <Screen
      title={group.data.name}
      leading={
        <GroupAvatar
          group={group.data}
          name={group.data.name}
          iconUrl={group.data.icon_url}
          color={group.data.color}
          size={30}
        />
      }
      action={<LeaderboardButton />}
      headerBelow={
        <SortTabs value={category} onChange={setSort} period={window} onPeriodChange={setPeriod} />
      }
      back
      scroll={false}>
      <FeedList
        // Parity: Yik Yak labels posts with their community even here.
        showGroup
        posts={feed.posts}
        isLoading={feed.isLoading}
        isRefetching={feed.isRefetching}
        error={feed.error}
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        onRefresh={() => feed.refetch()}
        onEndReached={() => feed.fetchNextPage()}
        onRetry={() => feed.refetch()}
        header={listHeader}
        emptyBody="No posts in this community yet."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
});
