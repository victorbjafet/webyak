import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';

import { useStartDM } from '@/api/mutations';
import type { PostOrComment } from '@/api/types';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showToast } from '@/lib/toast';

const MAX_LENGTH = 1000;

/**
 * Opens a DM about a specific post.
 *
 * This is the *only* way a conversation starts: `/v1/chats/start` requires a
 * `post_id`, so there is no "message this user" out of nowhere. That is a
 * property of the API and of Yik Yak's design — you message someone about
 * something they wrote — so the entry point lives on the post rather than in a
 * chats screen.
 *
 * Anonymous by default, like everything else here. The recipient sees a post
 * they wrote and a message about it; whether your name is attached is the
 * sender's choice.
 */
export function MessageAuthorDialog({
  post,
  visible,
  onClose,
}: {
  post: PostOrComment;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const start = useStartDM();
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [focused, setFocused] = useState(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !start.isPending;

  const submit = useCallback(() => {
    if (!canSend) return;
    start.mutate(
      { text: trimmed, postId: post.id, anonymous },
      {
        onSuccess: () => {
          setText('');
          onClose();
          showToast('Message sent.', 'info');
          router.push('/chats');
        },
      },
    );
  }, [canSend, start, trimmed, post.id, anonymous, onClose, router]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => {}}
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
          ]}>
          <ThemedText type="heading">Message this poster</ThemedText>
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={3}>
            About: {post.text || 'this post'}
          </ThemedText>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Write a message"
            placeholderTextColor={theme.textTertiary}
            multiline
            autoFocus
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

          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Send anonymously"
            accessibilityState={{ checked: anonymous }}
            onPress={() => setAnonymous((v) => !v)}
            style={({ hovered }) => [
              styles.anon,
              { backgroundColor: anonymous ? theme.brandMuted : theme.control },
              hovered && { opacity: 0.85 },
            ]}>
            <Ionicons
              name={anonymous ? 'eye-off-outline' : 'person-outline'}
              size={14}
              color={anonymous ? theme.brand : theme.controlText}
            />
            <ThemedText
              type="caption"
              style={{ color: anonymous ? theme.brand : theme.controlText }}>
              {anonymous ? 'Anonymous' : 'As you'}
            </ThemedText>
          </Pressable>

          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              disabled={start.isPending}
            />
            <Button
              label="Send"
              onPress={submit}
              disabled={!canSend}
              loading={start.isPending}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.45)' },
      default: { elevation: 8 },
    }),
  },
  input: {
    minHeight: 96,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
  anon: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
});
