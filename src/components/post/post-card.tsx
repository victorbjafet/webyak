import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { GroupAvatar } from '../group-avatar';
import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { PollView } from './poll-view';
import { PostActions } from './post-actions';
import { PostAssets } from './post-assets';
import { PostAttachments } from './post-attachments';
import { QuotedPostInline } from './quoted-post-inline';
import { TimeStamp } from './time-stamp';
import { VoteControl } from './vote-control';

import { groupDisplayName } from '@/api/groups';
import { usePollVote, useVote } from '@/api/mutations';
import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

interface PostCardProps {
  post: PostOrComment;
  onPress?: () => void;
  showGroup?: boolean;
  /** Set by the feed when this post is at or near the viewport, so video can buffer early. */
  preload?: boolean;
  /** Strictly on screen. Video pauses when this goes false. */
  visible?: boolean;
  /**
   * Fired after this post is deleted. Only meaningful where the card *is* the
   * screen — a feed just drops the row, but the post page would otherwise sit
   * on content that no longer exists.
   */
  onDeleted?: () => void;
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
  preload = false,
  visible = false,
  onDeleted,
}: PostCardProps) {
  const theme = useTheme();
  const router = useRouter();
  // Writes are wired here rather than passed down from each screen: whether a
  // post can be voted on is a property of the post, not of what is showing it,
  // and threading a callback through every list only creates places to forget.
  const vote = useVote();
  const pollVote = usePollVote();

  // Only a real username gets an identity row. An anonymous post shows the
  // community and nothing else — Yik Yak never labels one "Anonymous", because
  // the absence of a name *is* the signal. Comments are the exception and keep
  // their alias (OP, #1, #2), which is handled in comment-item.tsx.
  const username = post.identity?.posted_with_username ? post.identity?.name : undefined;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {/*
        The header is the community, not the author. A post with no username has
        no author to show, so labelling it "Anonymous" adds a word and no
        information — the missing name already says it.

        No chip background: this reads as a title, not a tag, so it takes the
        same colour as the body text with the community's icon beside it.
      */}
      <View style={styles.header}>
        {showGroup && post.group?.name ? (
          <View style={styles.groupLabel}>
            <GroupAvatar
              group={post.group}
              name={groupDisplayName(post.group)}
              iconUrl={post.group.icon_url}
              color={post.group.color}
              size={20}
            />
            <ThemedText type="smallBold" numberOfLines={1}>
              {groupDisplayName(post.group)}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.spacer} />
        {post.pinned ? <Ionicons name="pin" size={14} color={theme.brand} /> : null}
        <TimeStamp iso={post.created_at} />
      </View>

      {username ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`View ${username}'s profile`}
          onPress={() => router.push({ pathname: '/u/[username]', params: { username } })}
          style={({ hovered }) => [styles.author, hovered && styles.authorHovered]}>
          <IdentityAvatar identity={post.identity} size={24} />
          <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>
            {username}
          </ThemedText>
        </Pressable>
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

      {/* The quoted original, above the media, the way a retweet reads. */}
      <QuotedPostInline post={post} />

      <PostAssets assets={post.assets} preload={preload} visible={visible} />
      <PostAttachments attachments={post.attachments} />

      {post.poll ? (
        <PollView
          poll={post.poll}
          onVote={(choiceIndex) =>
            pollVote.mutate({ pollId: post.poll!.id, choiceIndex, postId: post.id })
          }
        />
      ) : null}

      <View style={styles.footer}>
        <VoteControl
          total={post.vote_total}
          status={post.vote_status}
          onVote={(next) => vote.mutate({ id: post.id, next })}
        />

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
        <PostActions post={post} onDeleted={onDeleted} />
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
  groupLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
    minWidth: 0,
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
