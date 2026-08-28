import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useCurrentGroup } from '@/api/current-group';
import { groupDisplayName, isForYouFeed } from '@/api/groups';
import { useGroupFeed } from '@/api/queries';
import type { FeedFilter, TopPeriod } from '@/api/types';
import { FeedList } from '@/components/feed/feed-list';
import { LeaderboardButton } from '@/components/feed/leaderboard-button';
import { FOR_YOU_TABS, SortTabs } from '@/components/feed/sort-tabs';
import { GroupAvatar } from '@/components/group-avatar';
import { Screen } from '@/components/screen';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';

export default function HomeScreen() {
  const router = useRouter();
  const { current } = useCurrentGroup();
  // For You defaults to unread, matching the official app. Unread is ours, not
  // the API's — see docs/API.md#unread-is-ours-not-theirs.
  const [sort, setSort] = useState<FeedFilter>('unread');
  const [period, setPeriod] = useState<TopPeriod>('day');

  const forYou = isForYouFeed(current);
  // Neither `top` (unsupported on the combined feed) nor `unread` (a For You
  // affordance) survives switching to a community, so a stale selection is
  // corrected rather than sent.
  const effectiveSort: FeedFilter = forYou
    ? sort === 'top'
      ? 'unread'
      : sort
    : sort === 'unread'
      ? 'hot'
      : sort;
  const feed = useGroupFeed(current?.id, effectiveSort, period);

  if (!current?.id) {
    return (
      <Screen title="Home">
        <EmptyState
          icon="compass-outline"
          title="No community yet"
          body="Join one in Explore and it'll show up here and in the switcher."
          action={<Button label="Browse communities" onPress={() => router.push('/explore')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={groupDisplayName(current)}
      leading={
        <GroupAvatar
          group={current}
          name={groupDisplayName(current)}
          iconUrl={current.icon_url}
          color={current.color}
          size={30}
        />
      }
      action={
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <LeaderboardButton />
        </View>
      }
      headerBelow={
        <SortTabs
          value={effectiveSort}
          onChange={setSort}
          period={period}
          onPeriodChange={setPeriod}
          categories={forYou ? FOR_YOU_TABS : undefined}
        />
      }
      scroll={false}>
      <FeedList
        // Yik Yak labels every post with its community, even inside that
        // community's own feed. Redundant there, but it is the parity behaviour
        // and it makes the For You feed legible.
        showGroup
        emptyTitle={effectiveSort === 'unread' ? "You're all caught up" : 'Nothing here yet'}
        emptyBody={
          effectiveSort === 'unread'
            ? 'Every post in your communities has been seen on this device. Switch to Hot to see them again.'
            : 'Be the first to post.'
        }
        posts={feed.posts}
        isLoading={feed.isLoading}
        isRefetching={feed.isRefetching}
        error={feed.error}
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        onRefresh={() => feed.refetch()}
        onEndReached={() => feed.fetchNextPage()}
        onRetry={() => feed.refetch()}
      />
    </Screen>
  );
}
