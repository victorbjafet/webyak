import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';

import { useCreateComment } from '@/api/mutations';
import type { PostOrComment } from '@/api/types';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isReply } from './comment-item';

const MAX_LENGTH = 300;

/**
 * Writes a comment, or a reply to one.
 *
 * Threading is two levels deep, so replying to a *reply* still attaches to that
 * reply's top-level parent — `reply_post_id` is what the API threads on and
 * offsides resolves it the same way (docs/OFFSIDES.md). Getting this wrong
 * doesn't error; it silently produces a comment that renders at the wrong depth.
 */
export function CommentComposer({
  post,
  replyTo,
  onCancelReply,
}: {
  post: PostOrComment;
  /** The comment being replied to, if any. */
  replyTo?: PostOrComment | null;
  onCancelReply?: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateComment();

  const trimmed = text.trim();
  const overLimit = trimmed.length > MAX_LENGTH;
  const canSubmit = trimmed.length > 0 && !overLimit && !create.isPending;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    setError(null);
    create.mutate(
      {
        parentPostId: post.id,
        text: trimmed,
        groupId: post.group_id,
        replyCommentId: replyTo?.id,
        // A reply to a reply hangs off the same top-level comment, not off the
        // reply itself — that is the whole of the depth model.
        topLevelReplyId: replyTo
          ? isReply(replyTo)
            ? replyTo.reply_post_id
            : replyTo.id
          : undefined,
        anonymous,
      },
      {
        onSuccess: () => {
          setText('');
          onCancelReply?.();
        },
        onError: (e) =>
          setError(e instanceof Error ? e.message : "That comment didn't send. Try again."),
      },
    );
  }, [canSubmit, create, post.id, post.group_id, trimmed, replyTo, anonymous, onCancelReply]);

  if (post.comments_disabled) {
    return (
      <View style={[styles.disabled, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="lock-closed-outline" size={15} color={theme.textTertiary} />
        <ThemedText type="small" themeColor="textTertiary">
          Replies are turned off for this post.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderColor: theme.border }]}>
      {replyTo ? (
        <View style={[styles.replyBanner, { backgroundColor: theme.control }]}>
          <Ionicons name="return-down-forward-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            Replying to {replyTo.identity?.name || replyTo.alias || 'Anonymous'}
          </ThemedText>
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
            style={({ hovered }) => [styles.cancel, hovered && { opacity: 0.7 }]}>
            <Ionicons name="close" size={14} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
        placeholderTextColor={theme.textTertiary}
        multiline
        maxLength={MAX_LENGTH * 2}
        style={[
          styles.input,
          Typography.small,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: overLimit ? theme.danger : theme.border,
          },
        ]}
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Post anonymously"
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

        {trimmed.length > MAX_LENGTH - 60 ? (
          <ThemedText
            type="caption"
            style={{ color: overLimit ? theme.danger : theme.textTertiary }}>
            {MAX_LENGTH - trimmed.length}
          </ThemedText>
        ) : null}

        <View style={styles.spacer} />
        <Button
          label={replyTo ? 'Reply' : 'Comment'}
          onPress={submit}
          disabled={!canSubmit}
          loading={create.isPending}
        />
      </View>

      {error ? (
        <ThemedText type="caption" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  input: {
    minHeight: 72,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  anon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  cancel: {
    padding: Spacing.half,
  },
  spacer: {
    flex: 1,
  },
  disabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
});
