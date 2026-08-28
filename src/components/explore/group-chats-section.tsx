import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { useJoinGroupChat } from '@/api/mutations';
import { useGroupChats, useMyIdentity } from '@/api/queries';
import type { GroupChat } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/** How many fit before "View all" earns its place. */
const PREVIEW_COUNT = 6;

/**
 * Joinable school group chats, above the community list.
 *
 * The official app puts a horizontal strip here with a "View all" and the
 * infinite community list beneath, so that is the shape.
 *
 * Joining takes a **per-chat identity** — a display name and icon that need not
 * match your profile — so the defaults come from the account and joining is one
 * tap. Nothing in the API suggests the identity can be changed afterwards, so
 * the defaults matter.
 */
export function GroupChatsSection({ schoolName }: { schoolName?: string }) {
  const theme = useTheme();
  const chats = useGroupChats();
  const identity = useMyIdentity();
  const join = useJoinGroupChat();
  const [expanded, setExpanded] = useState(false);

  const all = chats.data ?? [];
  const shown = expanded ? all : all.slice(0, PREVIEW_COUNT);

  // Nothing to show and nothing loading: stay out of the way rather than
  // leaving an empty header where the app has content.
  if (!chats.isLoading && all.length === 0 && !chats.isError) return null;

  const joinChat = (chat: GroupChat) => {
    join.mutate({
      chatId: chat.id,
      identity: {
        displayName: identity.data?.username || 'Anonymous',
        emoji: identity.data?.conversation_icon?.emoji || '😀',
        color: identity.data?.conversation_icon?.color || theme.brand,
        secondaryColor:
          identity.data?.conversation_icon?.secondary_color ||
          identity.data?.conversation_icon?.color ||
          theme.brand,
      },
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="bodyBold" numberOfLines={1} style={styles.title}>
          {schoolName ? `${schoolName} group chats` : 'Group chats'}
        </ThemedText>
        {all.length > PREVIEW_COUNT ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show fewer group chats' : 'View all group chats'}
            onPress={() => setExpanded((v) => !v)}
            style={({ hovered }) => [styles.viewAll, hovered && { opacity: 0.7 }]}>
            <ThemedText type="caption" style={{ color: theme.brand }}>
              {expanded ? 'Show less' : 'View all'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {chats.isLoading ? (
        <ThemedText type="caption" themeColor="textTertiary">
          Loading group chats…
        </ThemedText>
      ) : null}

      {chats.isError ? (
        <ThemedText type="caption" themeColor="textTertiary">
          Group chats couldn&rsquo;t be loaded.
        </ThemedText>
      ) : null}

      {/* Horizontal strip when collapsed, wrapping grid when expanded. */}
      <ScrollView
        horizontal={!expanded}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={expanded ? styles.grid : styles.strip}>
        {shown.map((chat) => {
          // `is_member` has never been observed; `notification_state` is
          // present on chats you're in, so it stands in until something clearer
          // turns up (docs/API.md#group-chats).
          const member = chat.is_member === true || Boolean(chat.notification_state);
          return (
            <View
              key={chat.id}
              style={[
                styles.chat,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}>
              <View style={[styles.chatIcon, { backgroundColor: chat.color || theme.control }]}>
                <ThemedText style={styles.chatEmoji}>{chat.emoji || '💬'}</ThemedText>
              </View>

              <View style={styles.chatText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {chat.name ?? 'Group chat'}
                </ThemedText>
                {chat.member_count ? (
                  <ThemedText type="caption" themeColor="textTertiary">
                    {formatCount(chat.member_count)} members
                  </ThemedText>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={member ? 'Joined' : `Join ${chat.name ?? 'chat'}`}
                disabled={member || join.isPending}
                onPress={() => joinChat(chat)}
                style={({ hovered, pressed }) => [
                  styles.joinButton,
                  {
                    backgroundColor: member ? 'transparent' : theme.brand,
                    borderColor: member ? theme.borderStrong : theme.brand,
                  },
                  (hovered || pressed) && { opacity: 0.85 },
                  join.isPending && styles.pending,
                ]}>
                <ThemedText
                  type="caption"
                  style={{ color: member ? theme.textSecondary : theme.onBrand }}>
                  {member ? 'Joined' : 'Join'}
                </ThemedText>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      {/*
        ⛔ There is no chat *screen* for these yet. `/v1/chats/explore` lists
        them and `/v1/chats/groups/join` joins them, but a joined group chat does
        not appear in `/v1/chats` (which returns DM threads), and no endpoint for
        reading group-chat messages has been found. Joining works; opening does
        not. See docs/API.md#-group-chats-can-be-joined-but-not-opened.
      */}
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={13} color={theme.textTertiary} />
        <ThemedText type="caption" themeColor="textTertiary" style={styles.noteText}>
          You can join from here, but reading a group chat isn&rsquo;t possible yet — no endpoint
          for its messages has been found.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  viewAll: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  strip: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chat: {
    width: 210,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatEmoji: {
    fontSize: 16,
    lineHeight: 22,
  },
  chatText: {
    flex: 1,
    minWidth: 0,
  },
  joinButton: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pending: {
    opacity: 0.5,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  noteText: {
    flex: 1,
  },
});
