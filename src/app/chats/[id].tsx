import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useSendDM } from '@/api/mutations';
import { useDMThread, useDMThreads, usePost } from '@/api/queries';
import { isComment, isGroupChat, isSystemMessage, type DirectMessage } from '@/api/types';
import { QuotedPost } from '@/components/post/quoted-post';
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
  const router = useRouter();
  const theme = useTheme();
  const now = useNow(TICK);
  const thread = useDMThread(id);
  // The list endpoint inlines every thread's messages, so a cached entry is a
  // complete fallback if the per-thread fetch fails — which matters for group
  // chats, where `/v1/chats/messages` has never been exercised.
  const list = useDMThreads(false);
  const send = useSendDM();

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const cached = list.data?.find((t) => t.id === id);
  const chat = thread.data ?? cached ?? null;
  const messages = chat?.messages ?? [];
  const count = messages.length;
  const group = chat ? isGroupChat(chat) : false;

  // Every DM hangs off a post — that is what `/v1/chats/start` requires — so the
  // thread shows what it was about. Without it a message request is a stranger
  // saying "hello" with no context at all.
  const source = usePost(chat?.post_id);

  /*
    That id can be a **comment**, when the conversation started from a reply.
    `/p/<code>` only understands posts, so opening the comment's own code
    rendered a reply as a top-level post with its own empty comment section.
    Fetch the parent so the link goes where the reply actually lives.
  */
  const sourceIsComment = source.data ? isComment(source.data) : false;
  const parent = usePost(sourceIsComment ? source.data?.parent_post_id : undefined);
  const openTarget = sourceIsComment ? parent.data : source.data;

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

  if (thread.isLoading && !cached) {
    return (
      <Screen title="Conversation" back>
        <LoadingState label="Loading messages…" />
      </Screen>
    );
  }

  if (thread.isError && !cached) {
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

  const isRequest = chat?.accept_status === 'pending';

  return (
    <Screen title={chat?.name ?? (isRequest ? 'Message request' : 'Conversation')} back scroll={false}>
      <View style={styles.frame}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}>
          {/* What the conversation is about, pinned above the messages. */}
          {source.data ? (
            <View style={styles.source}>
              <ThemedText type="caption" themeColor="textTertiary">
                {isRequest ? 'They messaged you about' : 'About'}
                {sourceIsComment ? ' (a reply)' : ''}
              </ThemedText>
              <QuotedPost
                post={source.data}
                onPress={
                  openTarget?.index_code
                    ? () =>
                        router.push({
                          pathname: '/p/[code]',
                          params: { code: openTarget.index_code! },
                        })
                    : undefined
                }
              />
            </View>
          ) : null}

          {isRequest ? (
            /*
              ⛔ No accept/decline endpoint exists. The four candidates that
              looked promising — /v1/chats/accept, /requests, /decline — all
              returned 200 against a *nonsense* control path with an identical
              empty body, so `/v1/chats/:x` is a catch-all and none of them are
              real (docs/API.md#-message-requests-are-read-only).
            */
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="mail-unread-outline" size={16} color={theme.textSecondary} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.noticeText}>
                This is a message request. webyak can read and reply, but can&rsquo;t formally
                accept or decline — no endpoint for that exists. Replying may accept it
                implicitly.
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
            // Membership events are not messages anyone sent, so they get no
            // bubble and no side — just a quiet centred line, the way every
            // chat app renders them.
            if (isSystemMessage(message)) {
              return (
                <View key={message.id ?? message.client_id} style={styles.systemRow}>
                  <ThemedText type="caption" themeColor="textTertiary" style={styles.systemText}>
                    {message.text}
                  </ThemedText>
                </View>
              );
            }

            const mine = message.authored_by_user;
            // Group chats carry a per-message identity; DMs don't, because they
            // are anonymous unless the sender chose otherwise.
            const sender = !mine && group ? message.identity : undefined;
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
                  {/*
                    In a group chat every message gets an attribution line. An
                    identity-less one is genuinely anonymous, and saying so beats
                    an unlabelled bubble that looks like it belongs to whoever
                    spoke last.
                  */}
                  {!mine && group ? (
                    <ThemedText
                      type="caption"
                      style={{
                        color: sender?.display_name
                          ? sender.color || theme.brand
                          : theme.textTertiary,
                      }}>
                      {sender?.display_name
                        ? `${sender.emoji ? `${sender.emoji} ` : ''}${sender.display_name}`
                        : 'Anonymous'}
                    </ThemedText>
                  ) : null}
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
  source: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  systemRow: {
    alignItems: 'center',
    paddingVertical: Spacing.half,
  },
  systemText: {
    textAlign: 'center',
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
