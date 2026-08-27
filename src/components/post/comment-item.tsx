import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { PostActions } from './post-actions';
import { PostAssets } from './post-assets';
import { PostAttachments } from './post-attachments';
import { TimeStamp } from './time-stamp';
import { VoteControl } from './vote-control';

import { useVote } from '@/api/mutations';
import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Threading is two levels, not arbitrary nesting. offsides distinguishes them
 * with `reply_post_id != parent_post_id` — equal means top-level — and that is
 * the whole depth model.
 */
export function isReply(comment: PostOrComment) {
  return Boolean(
    comment.reply_post_id &&
      comment.parent_post_id &&
      comment.reply_post_id !== comment.parent_post_id,
  );
}

export function CommentItem({
  comment,
  onReply,
}: {
  comment: PostOrComment;
  /** Omitted when the parent post has comments disabled. */
  onReply?: (comment: PostOrComment) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const vote = useVote();
  const reply = isReply(comment);
  const displayName = comment.identity?.name || comment.alias || 'Anonymous';
  const username = comment.identity?.posted_with_username ? comment.identity?.name : undefined;

  return (
    <View style={[styles.wrap, reply && [styles.reply, { borderLeftColor: theme.border }]]}>
      <View style={styles.header}>
        {username ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`View ${username}'s profile`}
            onPress={() => router.push({ pathname: '/u/[username]', params: { username } })}
            style={({ hovered }) => [styles.author, hovered && styles.authorHovered]}>
            <IdentityAvatar identity={comment.identity} size={22} />
            <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>
              {displayName}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.author}>
            <IdentityAvatar identity={comment.identity} size={22} />
            <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>
              {displayName}
            </ThemedText>
          </View>
        )}

        <View style={styles.spacer} />
        <TimeStamp iso={comment.created_at} />
      </View>

      {comment.text ? <ThemedText type="small">{comment.text}</ThemedText> : null}

      <PostAssets assets={comment.assets} />
      <PostAttachments attachments={comment.attachments} />

      <View style={styles.footer}>
        <VoteControl
          total={comment.vote_total}
          status={comment.vote_status}
          onVote={(next) => vote.mutate({ id: comment.id, next })}
          compact
        />

        {onReply ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${displayName}`}
            onPress={() => onReply(comment)}
            style={({ hovered, pressed }) => [
              styles.replyButton,
              (hovered || pressed) && { backgroundColor: theme.controlHover },
            ]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Reply
            </ThemedText>
          </Pressable>
        ) : null}

        <View style={styles.spacer} />
        <PostActions post={comment} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  reply: {
    marginLeft: Spacing.three,
    paddingLeft: Spacing.three,
    borderLeftWidth: 2,
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
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.half,
  },
  replyButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
});
