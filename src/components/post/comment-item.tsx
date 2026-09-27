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
import { isTombstoneText } from '@/lib/archive/types';

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
  const mine = comment.authored_by_user;

  /*
    A deleted comment stays in its thread as a placeholder — text "Comment
    Deleted", alias "Deleted", no votes, no author — so the replies under it keep
    a parent (docs/API.md#deleted-comments-stay-in-the-thread-as-comment-deleted).
    It used to render as if someone had typed that. Nothing is left to vote on,
    reply to, share or report, so it gets none of the controls; its replies still
    render beneath it, which is the point of keeping it.
  */
  if (isTombstoneText(comment.text)) {
    return (
      <View style={[styles.wrap, reply && [styles.reply, { borderLeftColor: theme.border }]]}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textTertiary" style={styles.removed}>
            Comment deleted
          </ThemedText>
          <View style={styles.spacer} />
          <TimeStamp iso={comment.created_at} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, reply && [styles.reply, { borderLeftColor: theme.border }]]}>
      <View style={styles.header}>
        {username ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={mine ? 'Open your profile' : `View ${username}'s profile`}
            // Your own name opens the You tab. The public profile is a page
            // *about* you; the You tab is the one that is yours.
            onPress={() =>
              mine
                ? router.push('/me')
                : router.push({ pathname: '/u/[username]', params: { username } })
            }
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

        {/* Whether or not it was posted under your name — an anonymous comment
            is the one you are likeliest to lose track of in a long thread. */}
        {mine ? (
          <View style={[styles.you, { backgroundColor: theme.brandMuted }]}>
            <ThemedText type="caption" style={{ color: theme.brand }}>
              You
            </ThemedText>
          </View>
        ) : null}

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
  you: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
  removed: {
    fontStyle: 'italic',
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
