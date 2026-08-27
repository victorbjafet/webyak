import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { PollView } from './poll-view';
import { PostActions } from './post-actions';
import { PostAssets } from './post-assets';
import { PostAttachments } from './post-attachments';
import { TimeStamp } from './time-stamp';
import { VoteControl } from './vote-control';

import type { PostOrComment, VoteStatus } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

interface PostCardProps {
  post: PostOrComment;
  onPress?: () => void;
  showGroup?: boolean;
  onVote?: (next: VoteStatus) => void;
  /** Set by the feed when this post is at or near the viewport, so video can buffer early. */
  preload?: boolean;
}

/**
 * The card is a plain View, never a Pressable.
 *
 * It contains vote buttons, a profile link, a timestamp toggle and image
 * buttons — and on web react-native-web renders each of those as a real
 * <button>. Wrapping them in another Pressable produced a nested <button>,
 * which React rejects outright. So the "open this post" affordance lives on
 * specific children (the text, the comment count) rather than the whole card,
 * and no interactive element ever contains another.
 */
export function PostCard({
  post,
  onPress,
  showGroup = false,
  onVote,
  preload = false,
}: PostCardProps) {
  const theme = useTheme();
  const router = useRouter();

  const displayName = post.identity?.name || post.alias || 'Anonymous';
  const username = post.identity?.posted_with_username ? post.identity?.name : undefined;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.header}>
        {username ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`View ${username}'s profile`}
            onPress={() => router.push({ pathname: '/u/[username]', params: { username } })}
            style={({ hovered }) => [styles.author, hovered && styles.authorHovered]}>
            <IdentityAvatar identity={post.identity} size={28} />
            <ThemedText type="smallBold" numberOfLines={1}>
              {displayName}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.author}>
            <IdentityAvatar identity={post.identity} size={28} />
            <ThemedText type="smallBold" numberOfLines={1}>
              {displayName}
            </ThemedText>
          </View>
        )}

        <View style={styles.spacer} />
        {post.pinned ? <Ionicons name="pin" size={14} color={theme.brand} /> : null}
        <TimeStamp iso={post.created_at} />
      </View>

      {showGroup && post.group?.name ? (
        <View style={[styles.groupChip, { backgroundColor: theme.control }]}>
          <ThemedText type="caption" style={{ color: post.group.color || theme.controlText }}>
            {post.group.name}
          </ThemedText>
        </View>
      ) : null}

      {post.text ? (
        onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open post"
            onPress={onPress}
            style={({ hovered }) => [hovered && styles.textHovered]}>
            <ThemedText type="body">{post.text}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="body">{post.text}</ThemedText>
        )
      ) : null}

      <PostAssets assets={post.assets} preload={preload} />
      <PostAttachments attachments={post.attachments} />

      {post.poll ? <PollView poll={post.poll} /> : null}

      <View style={styles.footer}>
        <VoteControl total={post.vote_total} status={post.vote_status} onVote={onVote} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.comment_count ?? 0} comments`}
          disabled={!onPress}
          onPress={onPress}
          style={({ hovered }) => [
            styles.commentButton,
            hovered && onPress ? { backgroundColor: theme.controlHover } : null,
          ]}>
          <Ionicons name="chatbubble-outline" size={17} color={theme.textSecondary} />
          <ThemedText type="smallBold" themeColor="textSecondary">
            {post.comments_disabled ? 'off' : formatCount(post.comment_count)}
          </ThemedText>
        </Pressable>

        <View style={styles.spacer} />
        <PostActions post={post} />
      </View>
    </View>
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
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
  },
  authorHovered: {
    opacity: 0.75,
  },
  spacer: {
    flex: 1,
  },
  textHovered: {
    opacity: 0.85,
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
  commentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
});
