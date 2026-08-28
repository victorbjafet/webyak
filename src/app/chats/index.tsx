import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useDMThreads, useJoinedGroupChats } from '@/api/queries';
import type { DirectThread } from '@/api/types';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/clock';

/** Thread rows show minutes, so a 30s tick is plenty. */
const TICK = 30_000;

export default function ChatsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow(TICK);
  const threads = useDMThreads();
  // Group chats live somewhere other than /v1/chats — the lead is
  // getUpdates().chats, unconfirmed. Shown when present so a chat joined in the
  // official app is at least visible here rather than silently missing.
  const joined = useJoinedGroupChats();

  /**
   * Requests are separated out.
   *
   * A thread you haven't accepted is a stranger writing to you about one of
   * your posts, and mixing those into the same list as ongoing conversations is
   * how people miss both. The official app gates them the same way.
   */
  const all = threads.data ?? [];
  const accepted = all.filter((t) => t.accept_status === 'accepted');
  const requests = all.filter((t) => t.accept_status && t.accept_status !== 'accepted');

  const ordered = [...requests, ...accepted];

  return (
    <Screen title="Chats" scroll={false}>
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
          ListHeaderComponent={
            (joined.data?.length ?? 0) > 0 ? (
              <View style={styles.joinedBlock}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Group chats
                </ThemedText>
                {joined.data?.map((chat) => (
                  <View
                    key={chat.id}
                    style={[
                      styles.joinedRow,
                      { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                    ]}>
                    <ThemedText style={styles.joinedEmoji}>{chat.emoji || '💬'}</ThemedText>
                    <ThemedText type="small" numberOfLines={1} style={styles.title}>
                      {chat.name ?? 'Group chat'}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textTertiary">
                      Can&rsquo;t open yet
                    </ThemedText>
                  </View>
                ))}
                <ThemedText type="caption" themeColor="textTertiary">
                  Reading a group chat needs an endpoint that hasn&rsquo;t been found — see
                  docs/API.md.
                </ThemedText>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-outline"
              title="No messages"
              body="Direct messages start from a post — open one and use the message action. There's no way to message someone out of nowhere."
            />
          }
          renderItem={({ item }) => {
            const isRequest = Boolean(item.accept_status) && item.accept_status !== 'accepted';
            const preview =
              item.last_message?.text ??
              item.messages?.[item.messages.length - 1]?.text ??
              'No messages yet';
            const unread = (item.unread_count ?? 0) > 0;

            return (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open conversation`}
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
                    name={isRequest ? 'mail-unread-outline' : 'chatbubble-ellipses-outline'}
                    size={18}
                    color={unread ? theme.brand : theme.textSecondary}
                  />
                </View>

                <View style={styles.text}>
                  <View style={styles.titleRow}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
                      {isRequest ? 'Message request' : 'Conversation'}
                    </ThemedText>
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
                    {preview}
                  </ThemedText>
                </View>

                {unread ? (
                  <View style={[styles.badge, { backgroundColor: theme.notification }]}>
                    <ThemedText type="caption" style={{ color: '#FFFFFF' }}>
                      {item.unread_count}
                    </ThemedText>
                  </View>
                ) : null}
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
  gap: {
    height: Spacing.two,
  },
  joinedBlock: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  joinedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  joinedEmoji: {
    fontSize: 16,
    lineHeight: 22,
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
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
