import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { PollView } from './poll-view';
import { PostAssets } from './post-assets';
import { VoteControl } from './vote-control';

import type { PostOrComment, VoteStatus } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { absoluteTime, formatCount, relativeTime } from '@/lib/time';

interface PostCardProps {
  post: PostOrComment;
  onPress?: () => void;
  /** Show which group the post is in — for cross-group feeds. */
  showGroup?: boolean;
  onVote?: (next: VoteStatus) => void;
}

export function PostCard({ post, onPress, showGroup = false, onVote }: PostCardProps) {
  const theme = useTheme();
  const displayName = post.identity?.name || post.alias || 'Anonymous';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        onPress && (hovered || pressed) ? { borderColor: theme.borderStrong } : null,
      ]}>
      <View style={styles.header}>
        <IdentityAvatar identity={post.identity} size={28} />
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {displayName}
        </ThemedText>
        {post.pinned ? <Ionicons name="pin" size={13} color={theme.brand} /> : null}
        <ThemedText
          type="caption"
          themeColor="textTertiary"
          accessibilityLabel={absoluteTime(post.created_at)}>
          {relativeTime(post.created_at)}
        </ThemedText>
      </View>

      {showGroup && post.group?.name ? (
        <View style={[styles.groupChip, { backgroundColor: theme.control }]}>
          <ThemedText type="caption" style={{ color: post.group.color || theme.controlText }}>
            {post.group.name}
          </ThemedText>
        </View>
      ) : null}

      {post.text ? <ThemedText type="body">{post.text}</ThemedText> : null}

      <PostAssets assets={post.assets} />

      {post.poll ? <PollView poll={post.poll} /> : null}

      <View style={styles.footer}>
        <VoteControl total={post.vote_total} status={post.vote_status} onVote={onVote} />

        <View style={styles.metaItem}>
          <Ionicons
            name={post.comments_disabled ? 'chatbubble-outline' : 'chatbubble-outline'}
            size={16}
            color={theme.textTertiary}
          />
          <ThemedText type="caption" themeColor="textTertiary">
            {post.comments_disabled ? 'off' : formatCount(post.comment_count)}
          </ThemedText>
        </View>

        {post.is_saved ? <Ionicons name="bookmark" size={14} color={theme.brand} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
  },
  groupChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
