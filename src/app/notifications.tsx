import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import type { ActivityItem } from '@/api/activity';
import { getGroupMetadata } from '@/api/client';
import { groupHref, groupSlug } from '@/api/groups';
import { useMarkActivitySeen } from '@/api/mutations';
import { activityItems, useActivity } from '@/api/queries';
import { ActivityRow, activityTarget } from '@/components/alerts/activity-row';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showToast, toastError } from '@/lib/toast';

type Filter = 'all' | 'unread';

/**
 * Alerts: votes on your posts, replies, followers, suggestions.
 *
 * **An alert is marked read when you act on it, never by being shown**: tap one,
 * or Mark all read. offsides behaves the same way (tap, or swipe it away), and it
 * keeps Unread meaningful — a list that cleared itself on sight would have
 * nothing left to filter. Whether the official app marks alerts on open instead
 * is PLAN Q18.
 *
 * Seen alerts stay listed, dimmed, where offsides hides them. Unread is the
 * owner's B2, a filter rather than the whole list.
 */
export default function AlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const activity = useActivity();
  const markSeen = useMarkActivitySeen();
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => activityItems(activity.data), [activity.data]);
  const unread = useMemo(() => items.filter((item) => !item.is_seen), [items]);
  const shown = filter === 'unread' ? unread : items;

  const open = async (item: ActivityItem) => {
    if (!item.is_seen) markSeen.mutate([item.id]);
    const target = activityTarget(item);
    if (target.kind === 'post') {
      router.push({ pathname: '/p/[code]', params: { code: target.postId } });
    } else if (target.kind === 'group') {
      // The alert names the community by id; its page is addressed by slug.
      try {
        const group = await getGroupMetadata(target.groupId);
        const slug = group ? groupSlug(group) : null;
        if (slug) router.push(groupHref(slug));
        else showToast("That community couldn't be found.");
      } catch (error) {
        toastError(error, "Couldn't open that community.");
      }
    }
  };

  const filters = (
    <View style={[styles.filters, { backgroundColor: theme.control }]}>
      {(['all', 'unread'] as const).map((value) => {
        const selected = value === filter;
        const label = value === 'all' ? 'All' : `Unread${unread.length ? ` · ${unread.length}` : ''}`;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => setFilter(value)}
            style={({ hovered }) => [
              styles.filter,
              selected && { backgroundColor: theme.backgroundSelected },
              !selected && hovered ? { backgroundColor: theme.controlHover } : null,
            ]}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={{ color: selected ? theme.brand : theme.controlText }}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  const markAll =
    unread.length > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mark ${unread.length} unread alerts as read`}
        disabled={markSeen.isPending}
        onPress={() => markSeen.mutate(unread.map((item) => item.id))}
        style={({ hovered, pressed }) => [
          styles.action,
          { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
        ]}>
        <Ionicons name="checkmark-done-outline" size={16} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary">
          Mark all read
        </ThemedText>
      </Pressable>
    ) : null;

  return (
    <Screen title="Alerts" headerBelow={filters} action={markAll} scroll={false}>
      {activity.isLoading ? <LoadingState label="Loading alerts…" /> : null}

      {activity.isError && !activity.data ? (
        <ErrorState
          error={activity.error}
          onRetry={() => activity.refetch()}
          title="Couldn't load your alerts"
        />
      ) : null}

      {activity.data ? (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => <ActivityRow item={item} onPress={open} />}
          onEndReachedThreshold={0.5}
          onEndReached={
            activity.hasNextPage && !activity.isFetchingNextPage
              ? () => void activity.fetchNextPage()
              : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={activity.isRefetching && !activity.isFetchingNextPage}
              onRefresh={() => void activity.refetch()}
              tintColor={theme.textSecondary}
            />
          }
          ListEmptyComponent={
            filter === 'unread' ? (
              <EmptyState
                icon="checkmark-done-outline"
                title="You're all caught up"
                body="Nothing unread."
              />
            ) : (
              <EmptyState
                icon="notifications-outline"
                title="No alerts yet"
                body="Votes on your posts, replies and new followers show up here."
              />
            )
          }
          ListFooterComponent={
            activity.isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator color={theme.textSecondary} />
              </View>
            ) : !activity.hasNextPage && shown.length > 0 ? (
              <View style={styles.footer}>
                <ThemedText type="caption" themeColor="textTertiary">
                  {`That's everything`}
                </ThemedText>
              </View>
            ) : null
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  filters: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.pill,
    gap: Spacing.half,
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  gap: {
    height: Spacing.two,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
});
