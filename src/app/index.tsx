import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGroupFeed } from '@/api/queries';
import { useSession } from '@/api/session';
import type { FeedCategory } from '@/api/types';
import { FeedList } from '@/components/feed/feed-list';
import { SortTabs } from '@/components/feed/sort-tabs';
import { Screen } from '@/components/screen';
import { EmptyState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { primaryGroup } = useSession();
  const [sort, setSort] = useState<FeedCategory>('hot');

  const feed = useGroupFeed(primaryGroup?.id, sort);
  const openGroup = useCallback(() => {
    if (primaryGroup) {
      const slug = primaryGroup.index_name || primaryGroup.analytics_name;
      if (slug) router.push({ pathname: '/g/[slug]', params: { slug } });
    }
  }, [primaryGroup, router]);

  if (!primaryGroup?.id) {
    return (
      <Screen title="Home">
        <EmptyState
          icon="compass-outline"
          title="No home community yet"
          body="Your account doesn't have a primary group set. Find one in Explore and it'll show up here."
          action={
            <Link href="/explore" asChild>
              <View>
                <Button label="Browse communities" />
              </View>
            </Link>
          }
        />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <ThemedText type="heading" style={styles.titleText}>
          {primaryGroup.name}
        </ThemedText>
        <Button label="Open" variant="ghost" onPress={openGroup} />
      </View>
      <SortTabs value={sort} onChange={setSort} />
    </View>
  );

  return (
    <Screen title="Home" scroll={false}>
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
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleText: {
    flex: 1,
  },
});
