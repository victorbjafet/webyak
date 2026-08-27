import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { PostAssets } from './post-assets';
import { VoteControl } from './vote-control';

import type { PostOrComment, VoteStatus } from '@/api/types';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { absoluteTime, relativeTime } from '@/lib/time';

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
  onVote,
}: {
  comment: PostOrComment;
  onVote?: (next: VoteStatus) => void;
}) {
  const theme = useTheme();
  const reply = isReply(comment);
  const displayName = comment.identity?.name || comment.alias || 'Anonymous';

  return (
    <View
      style={[
        styles.wrap,
        reply && [styles.reply, { borderLeftColor: theme.border }],
      ]}>
      <View style={styles.header}>
        <IdentityAvatar identity={comment.identity} size={22} />
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.name}>
          {displayName}
        </ThemedText>
        <ThemedText
          type="caption"
          themeColor="textTertiary"
          accessibilityLabel={absoluteTime(comment.created_at)}>
          {relativeTime(comment.created_at)}
        </ThemedText>
      </View>

      {comment.text ? <ThemedText type="small">{comment.text}</ThemedText> : null}

      <PostAssets assets={comment.assets} />

      <VoteControl total={comment.vote_total} status={comment.vote_status} onVote={onVote} compact />
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
  name: {
    flex: 1,
  },
});
