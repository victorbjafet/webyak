import { StyleSheet, View } from 'react-native';

import { IdentityAvatar } from '../post/identity-avatar';
import { TimeStamp } from '../post/time-stamp';
import { ThemedText } from '../themed-text';

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
export function QuotedPost({ post }: { post: PostOrComment }) {
  const theme = useTheme();
  const displayName = post.identity?.name || post.alias || 'Anonymous';

  return (
    <View
      style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.background }]}>
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
    </View>
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
