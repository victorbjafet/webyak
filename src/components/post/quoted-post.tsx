import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { TimeStamp } from './time-stamp';

import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The post being quoted, shown inside the composer and inside a published
 * repost.
 *
 * Deliberately not a `PostCard`: nothing here is interactive. A card would
 * bring vote buttons, a profile link and a delete control for a post that is
 * only being referenced — and inside the composer those would be nested
 * controls inside a form, which is the nested-button problem again.
 */
export function QuotedPost({
  post,
  onPress,
}: {
  post: PostOrComment;
  /** Opens the original. Omitted in the composer, where nothing should navigate. */
  onPress?: () => void;
}) {
  const theme = useTheme();
  const displayName = post.identity?.name || post.alias || 'Anonymous';

  const body = (
    <>
      <View style={styles.header}>
        <IdentityAvatar identity={post.identity} size={20} />
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {displayName}
        </ThemedText>
        <View style={styles.spacer} />
        <TimeStamp iso={post.created_at} interactive={false} />
      </View>

      {post.text ? (
        <ThemedText type="small" numberOfLines={6}>
          {post.text}
        </ThemedText>
      ) : null}

      {post.assets?.length ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {post.assets.length === 1 ? 'Contains an image' : `Contains ${post.assets.length} images`}
        </ThemedText>
      ) : null}
    </>
  );

  const frame = [styles.wrap, { borderColor: theme.border, backgroundColor: theme.background }];

  // A Pressable is safe here even inside a card: everything above is text and
  // plain Views — the timestamp is rendered non-interactive on purpose — so no
  // control ends up nested inside another.
  if (!onPress) return <View style={frame}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the quoted post"
      onPress={onPress}
      style={({ hovered, pressed }) => [
        frame,
        (hovered || pressed) && { backgroundColor: theme.backgroundHover },
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
});
