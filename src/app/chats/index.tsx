import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useDMThreads } from '@/api/queries';
import { isGroupChat, isUnreadThread, type DirectThread } from '@/api/types';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/clock';

/** Thread rows show minutes, so a 30s tick is plenty. */
const TICK = 30_000;

type Filter = 'all' | 'dms' | 'groups';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'dms', label: 'Chats' },
  { value: 'groups', label: 'Group chats' },
];

/**
 * Every conversation, in one list.
 *
 * `/v1/chats` returns DMs **and** group chats together — they are the same shape
 * and only distinguishable structurally. An earlier version read group chats
 * from `getUpdates().chats` as if that were a separate source; it returns the
 * identical list, so every conversation rendered twice.
 *
 * So: one query, one list, and a filter for when you want only one kind.
 */
export default function ChatsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow(TICK);
  const threads = useDMThreads();
  const [filter, setFilter] = useState<Filter>('all');

  const ordered = useMemo(() => {
    const all = threads.data ?? [];
    const matching = all.filter((t) => {
      if (filter === 'groups') return isGroupChat(t);
      if (filter === 'dms') return !isGroupChat(t);
      return true;
    });
    // Most recent message first, always. `updated_at` moves with the last
    // message, so this is recency of conversation rather than of creation.
    return [...matching].sort(
      (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime(),
    );
  }, [threads.data, filter]);

  const tabs = (
    <View style={[styles.filters, { backgroundColor: theme.control }]}>
      {FILTERS.map(({ value, label }) => {
        const selected = value === filter;
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

  return (
    <Screen title="Chats" headerBelow={tabs} scroll={false}>
      {threads.isLoading ? <LoadingState label="Loading conversations…" /> : null}

      {threads.isError ? (
        <ErrorState
          error={threads.error}
          onRetry={() => threads.refetch()}
          title="Couldn't load your chats"
        />
      ) : null}

      {threads.data ? (
        <FlatList
          data={ordered}
          keyExtractor={(item: DirectThread) => item.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-outline"
              title={filter === 'groups' ? 'No group chats' : 'No messages'}
              body={
                filter === 'groups'
                  ? 'Join one from Explore.'
                  : "Direct messages start from a post — open one and use the message action. There's no way to message someone out of nowhere."
              }
            />
          }
          renderItem={({ item }) => {
            const group = isGroupChat(item);
            const pending = item.accept_status === 'pending';
            const unread = isUnreadThread(item);
            // Messages are inlined on the list, so the preview is real text.
            const last = item.messages?.[item.messages.length - 1];
            const sender = last?.identity?.display_name;

            return (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.name ?? 'conversation'}`}
                onPress={() => router.push({ pathname: '/chats/[id]', params: { id: item.id } })}
                style={({ hovered, pressed }) => [
                  styles.row,
                  {
                    backgroundColor:
                      hovered || pressed ? theme.backgroundHover : theme.backgroundElement,
                    borderColor: unread ? theme.brand : theme.border,
                  },
                ]}>
                <View style={[styles.avatar, { backgroundColor: theme.control }]}>
                  <Ionicons
                    name={
                      pending
                        ? 'mail-unread-outline'
                        : group
                          ? 'people-outline'
                          : 'chatbubble-ellipses-outline'
                    }
                    size={18}
                    color={unread ? theme.brand : theme.textSecondary}
                  />
                </View>

                <View style={styles.text}>
                  <View style={styles.titleRow}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
                      {item.name ?? (pending ? 'Message request' : 'Conversation')}
                    </ThemedText>
                    {pending ? (
                      <View style={[styles.pill, { backgroundColor: theme.control }]}>
                        <ThemedText type="caption" themeColor="textSecondary">
                          Request
                        </ThemedText>
                      </View>
                    ) : null}
                    {item.updated_at ? (
                      <ThemedText type="caption" themeColor="textTertiary">
                        {relativeTime(item.updated_at, now)}
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedText
                    type="small"
                    themeColor={unread ? 'text' : 'textSecondary'}
                    numberOfLines={2}>
                    {last?.text ? (sender ? `${sender}: ${last.text}` : last.text) : 'No messages yet'}
                  </ThemedText>
                </View>

                {unread ? <View style={[styles.dot, { backgroundColor: theme.brand }]} /> : null}
              </Pressable>
            );
          }}
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
  gap: {
    height: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Radius.pill,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
