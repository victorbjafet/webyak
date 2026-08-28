import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useSendDM } from '@/api/mutations';
import { useDMThread } from '@/api/queries';
import type { DirectMessage } from '@/api/types';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Layout, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/lib/clock';
import { absoluteTime, relativeTime } from '@/lib/time';

const MAX_LENGTH = 1000;
const TICK = 30_000;

export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const now = useNow(TICK);
  const thread = useDMThread(id);
  const send = useSendDM();

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const messages = thread.data?.messages ?? [];
  const count = messages.length;

  // Newest at the bottom, so a new message should bring itself into view. Keyed
  // on the count rather than the array so a poll returning the same messages
  // doesn't yank the view while someone is reading back.
  useEffect(() => {
    if (count > 0) scrollRef.current?.scrollToEnd({ animated: true });
  }, [count]);

  const trimmed = text.trim();
  const canSend = Boolean(id) && trimmed.length > 0 && !send.isPending;

  const submit = useCallback(() => {
    if (!canSend) return;
    send.mutate(
      { chatId: id as string, text: trimmed },
      { onSuccess: () => setText('') },
    );
  }, [canSend, send, id, trimmed]);

  if (thread.isLoading) {
    return (
      <Screen title="Conversation" back>
        <LoadingState label="Loading messages…" />
      </Screen>
    );
  }

  if (thread.isError) {
    return (
      <Screen title="Conversation" back>
        <ErrorState
          error={thread.error}
          onRetry={() => thread.refetch()}
          title="Couldn't load this conversation"
        />
      </Screen>
    );
  }

  const isRequest =
    Boolean(thread.data?.accept_status) && thread.data?.accept_status !== 'accepted';

  return (
    <Screen title="Conversation" back scroll={false}>
      <View style={styles.frame}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}>
          {isRequest ? (
            /*
              ⛔ No accept/decline endpoint has been found — `accept_status` is
              readable but nothing in sidechat.js writes it, and no candidate
              route has been swept yet. Saying so beats rendering a button that
              does nothing. See docs/API.md#-message-requests-are-read-only.
            */
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="mail-unread-outline" size={16} color={theme.textSecondary} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.noticeText}>
                This is a message request. webyak can read it but can&rsquo;t accept or decline —
                no endpoint for that has been found yet. Replying may accept it implicitly.
              </ThemedText>
            </View>
          ) : null}

          {count === 0 ? (
            <EmptyState
              icon="chatbubble-outline"
              title="No messages yet"
              body="Say something to get started."
            />
          ) : null}

          {messages.map((message: DirectMessage) => {
            const mine = message.authored_by_user;
            return (
              <View
                key={message.id ?? message.client_id}
                style={[styles.bubbleRow, mine ? styles.mineRow : styles.theirsRow]}>
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: mine ? theme.brand : theme.backgroundElement,
                      borderColor: mine ? theme.brand : theme.border,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: mine ? theme.onBrand : theme.text }}>
                    {message.text}
                  </ThemedText>
                  {message.created_at ? (
                    <ThemedText
                      type="caption"
                      style={{
                        color: mine ? theme.onBrand : theme.textTertiary,
                        opacity: mine ? 0.7 : 1,
                      }}
                      // Hover for the exact time, same convention as post ages.
                      {...{ title: absoluteTime(message.created_at) }}>
                      {relativeTime(message.created_at, now)}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.composer, { borderTopColor: theme.border }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={theme.textTertiary}
            multiline
            maxLength={MAX_LENGTH}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.input,
              Typography.small,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: focused ? theme.brand : theme.border,
              },
            ]}
          />
          <Button label="Send" onPress={submit} disabled={!canSend} loading={send.isPending} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
  },
  messages: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    marginBottom: Spacing.two,
  },
  noticeText: {
    flex: 1,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  mineRow: {
    justifyContent: 'flex-end',
  },
  theirsRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
});
