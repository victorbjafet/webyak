import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { UnwiredCreateButton } from './create-button';
import { TWO_COLUMN_AT } from './layout';

import { useJoinGroupChat } from '@/api/mutations';
import { useGroupChats, useMyIdentity } from '@/api/queries';
import type { GroupChat, JoinChatIdentity } from '@/api/types';
import { Breakpoints, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/**
 * Explore's Group chats tab: every joinable chat for the school, largest first.
 *
 * It used to be a strip above the community list with "View all", which showed
 * at most the 20 chats one request returned — the rest were never fetched
 * (`getGroupChats` now follows a cursor if the endpoint gives one). A tab of its
 * own is the whole list, with room for a create button.
 *
 * Joining takes a **per-chat identity** — a display name and icon that need not
 * match your profile — so the defaults come from the account and joining is one
 * tap. Nothing in the API suggests the identity can be changed afterwards, so
 * the defaults matter.
 */
export function GroupChatsList({ schoolName }: { schoolName?: string }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const chats = useGroupChats();
  const identity = useMyIdentity();
  const join = useJoinGroupChat();

  // Largest first, as the endpoint serves them — sorted again because several
  // pages are merged, and each is only ordered within itself.
  const sorted = useMemo(
    () => [...(chats.data ?? [])].sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0)),
    [chats.data],
  );
  const columns = width >= TWO_COLUMN_AT ? 2 : 1;

  const joinAs: JoinChatIdentity = {
    displayName: identity.data?.username || 'Anonymous',
    emoji: identity.data?.conversation_icon?.emoji || '😀',
    color: identity.data?.conversation_icon?.color || theme.brand,
    secondaryColor:
      identity.data?.conversation_icon?.secondary_color ||
      identity.data?.conversation_icon?.color ||
      theme.brand,
  };

  if (chats.isLoading) return <LoadingState label="Loading group chats…" />;
  if (chats.isError) {
    return (
      <ErrorState
        error={chats.error}
        onRetry={() => chats.refetch()}
        title="Couldn't load group chats"
      />
    );
  }

  return (
    <FlatList
      // FlatList cannot change `numColumns` on an existing instance.
      key={columns}
      data={sorted}
      numColumns={columns}
      keyExtractor={(chat: GroupChat) => chat.id}
      renderItem={({ item }) => (
        <ChatCard
          chat={item}
          joining={join.isPending}
          onJoin={() => join.mutate({ chatId: item.id, identity: joinAs })}
        />
      )}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="bodyBold" numberOfLines={1}>
              {schoolName ? `${schoolName} group chats` : 'Group chats'}
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary">
              {formatCount(sorted.length)} {sorted.length === 1 ? 'chat' : 'chats'} · largest first
            </ThemedText>
          </View>
          <UnwiredCreateButton
            label="Create chat"
            reason="Not wired up yet — no endpoint for creating a group chat is known."
          />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="chatbubbles-outline"
          title="No group chats"
          body="Your school has no group chats to join right now."
        />
      }
    />
  );
}

/*
  Module scope, not nested — see
  docs/ARCHITECTURE.md#helper-components-go-at-module-scope-never-inside-another-component.
*/

function ChatCard({
  chat,
  joining,
  onJoin,
}: {
  chat: GroupChat;
  joining: boolean;
  onJoin: () => void;
}) {
  const theme = useTheme();
  // `is_member` has never been observed; `notification_state` is present on
  // chats you're in, so it stands in until something clearer turns up
  // (docs/API.md#group-chats-joinable-and-openable).
  const member = chat.is_member === true || Boolean(chat.notification_state);
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: chat.color || theme.control }]}>
          <ThemedText style={styles.emoji}>{chat.emoji || '💬'}</ThemedText>
        </View>
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {chat.name ?? 'Group chat'}
          </ThemedText>
          {chat.member_count ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {formatCount(chat.member_count)} members
            </ThemedText>
          ) : null}
          {chat.description ? (
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
              {chat.description}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={member ? 'Joined' : `Join ${chat.name ?? 'chat'}`}
        disabled={member || joining}
        onPress={onJoin}
        style={({ hovered, pressed }) => [
          styles.join,
          {
            backgroundColor: member ? 'transparent' : theme.brand,
            borderColor: member ? theme.borderStrong : theme.brand,
          },
          (hovered || pressed) && !member ? { opacity: 0.85 } : null,
          joining && !member ? styles.pending : null,
        ]}>
        <ThemedText type="caption" style={{ color: member ? theme.textSecondary : theme.onBrand }}>
          {member ? 'Joined' : 'Join'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Breakpoints.sidebar,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  row: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  card: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
    minWidth: 0,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  text: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  // The same shape as a community's JoinButton, so the two tabs match.
  join: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pending: {
    opacity: 0.5,
  },
});
