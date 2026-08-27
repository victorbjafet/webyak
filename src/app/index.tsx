import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useCurrentGroup } from '@/api/current-group';
import { useGroupFeed } from '@/api/queries';
import type { FeedCategory, TopPeriod } from '@/api/types';
import { FeedList } from '@/components/feed/feed-list';
import { LeaderboardButton } from '@/components/feed/leaderboard-button';
import { SortTabs } from '@/components/feed/sort-tabs';
import { GroupAvatar } from '@/components/group-avatar';
import { Screen } from '@/components/screen';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';

export default function HomeScreen() {
  const router = useRouter();
  const { current } = useCurrentGroup();
  const [sort, setSort] = useState<FeedCategory>('hot');
  const [period, setPeriod] = useState<TopPeriod>('day');

  const feed = useGroupFeed(current?.id, sort, period);

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
      title={current.name}
      leading={
        <GroupAvatar
          name={current.name}
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
        <SortTabs value={sort} onChange={setSort} period={period} onPeriodChange={setPeriod} />
      }
      scroll={false}>
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
      />
    </Screen>
  );
}
