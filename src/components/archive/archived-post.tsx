import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ArchivedContent } from '@/lib/archive/types';
import { formatCount } from '@/lib/time';

/**
 * A post read back from the archive, for when the live one is unavailable.
 *
 * ## Why this is not a `PostCard`
 *
 * A card implies working vote buttons, a live score and a reply box. None of
 * those are true of an archived record: it is a snapshot, and for a deleted post
 * there is nothing left to vote on or reply to. Dressing it up as the real thing
 * would misrepresent what it is — the same rule the archive search follows
 * (docs/ARCHITECTURE.md#results-are-not-post-cards).
 *
 * ## Two different reasons to be here
 *
 * - **gone** — the API was asked for this post by id and does not serve it.
 *   It was deleted by its author or removed by moderation; the API does not
 *   say which, so this does not guess.
 * - **offline** — the lookup failed for a reason that says nothing about the
 *   post (a dropped connection, a server error). The archived copy is shown so
 *   the screen is still useful, and nothing is flagged.
 */
export function ArchivedPost({
  record,
  thread,
  reason,
  error,
  onRetry,
}: {
  record: ArchivedContent;
  thread: ArchivedContent[];
  reason: 'gone' | 'offline';
  error?: unknown;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const removedComments = thread.filter((comment) => comment.deleted).length;

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.notice,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: reason === 'gone' ? theme.danger : theme.border,
          },
        ]}>
        <View style={styles.noticeHead}>
          <Ionicons
            name={reason === 'gone' ? 'trash-outline' : 'cloud-offline-outline'}
            size={16}
            color={reason === 'gone' ? theme.danger : theme.textSecondary}
          />
          <ThemedText
            type="smallBold"
            style={{ color: reason === 'gone' ? theme.danger : theme.text }}>
            {reason === 'gone' ? 'Removed from Yik Yak' : "Couldn't reach Yik Yak"}
          </ThemedText>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          {reason === 'gone'
            ? `Yik Yak no longer serves this post — deleted by its author or removed by moderation; the API doesn't say which. This is the copy archived ${day(
                record.first_seen_at,
              )}, last seen live ${day(record.last_seen_at)}.`
            : `${
                error instanceof Error ? `${error.message} ` : ''
              }Showing the copy archived ${day(record.first_seen_at)}, last seen live ${day(
                record.last_seen_at,
              )}. It may be out of date.`}
        </ThemedText>
        {reason === 'offline' && onRetry ? (
          <View style={styles.noticeAction}>
            <Button label="Try again" variant="secondary" onPress={onRetry} />
          </View>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.head}>
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
            {record.group_name ?? 'Community'}
          </ThemedText>
          <Byline record={record} />
          <View style={styles.spacer} />
          <ThemedText type="caption" themeColor="textTertiary">
            {record.created_at?.slice(0, 10)}
          </ThemedText>
        </View>

        <ThemedText type="body">{record.text || '(no text)'}</ThemedText>

        {record.has_media ? (
          <View style={styles.media}>
            <Ionicons name="image-outline" size={14} color={theme.textTertiary} />
            <ThemedText type="caption" themeColor="textTertiary">
              {record.media.length === 1 ? 'Had an attachment' : `Had ${record.media.length} attachments`}
              {record.media.some((m) => m.cached)
                ? ''
                : ' — not saved, and the links it had have expired'}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.foot}>
          <ThemedText type="caption" style={{ color: theme.brand }}>
            {record.vote_total > 0 ? '+' : ''}
            {formatCount(record.vote_total)}
          </ThemedText>
          <ThemedText type="caption" themeColor="textTertiary">
            when last seen
          </ThemedText>
        </View>
      </View>

      <ThemedText type="heading" style={styles.commentsHeader}>
        {thread.length > 0
          ? `${formatCount(thread.length)} archived comment${thread.length === 1 ? '' : 's'}`
          : 'Comments'}
      </ThemedText>
      {record.comment_count && thread.length < record.comment_count ? (
        <ThemedText type="caption" themeColor="textTertiary">
          The post had {formatCount(record.comment_count)} when last seen. Only threads the comment
          pass reached before it was removed were saved.
        </ThemedText>
      ) : null}
      {removedComments > 0 ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {formatCount(removedComments)} of these were removed individually before the post was.
        </ThemedText>
      ) : null}

      {thread.length === 0 ? (
        <ThemedText type="small" themeColor="textTertiary" style={styles.empty}>
          {record.comment_count
            ? 'None of its comments were archived before it was removed.'
            : 'It had no comments.'}
        </ThemedText>
      ) : (
        thread.map((comment) => <ArchivedComment key={comment.id} comment={comment} />)
      )}
    </View>
  );
}

/*
  Module scope, not nested — see
  docs/ARCHITECTURE.md#helper-components-go-at-module-scope-never-inside-another-component.
*/

function Byline({ record }: { record: ArchivedContent }) {
  const theme = useTheme();
  if (record.author) {
    return (
      <ThemedText type="caption" style={{ color: theme.brand }} numberOfLines={1}>
        @{record.author}
      </ThemedText>
    );
  }
  if (record.alias) {
    return (
      <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
        {record.alias}
      </ThemedText>
    );
  }
  return null;
}

function ArchivedComment({ comment }: { comment: ArchivedContent }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.comment,
        comment.is_reply ? styles.reply : null,
        { borderColor: comment.deleted ? theme.danger : theme.border },
      ]}>
      <View style={styles.head}>
        <Byline record={comment} />
        <View style={styles.spacer} />
        {comment.deleted ? (
          <ThemedText type="caption" style={{ color: theme.danger }}>
            removed
          </ThemedText>
        ) : null}
        <ThemedText type="caption" themeColor="textTertiary">
          {comment.created_at?.slice(0, 10)}
        </ThemedText>
      </View>
      <ThemedText type="small">{comment.text || '(no text)'}</ThemedText>
      <ThemedText type="caption" style={{ color: theme.brand }}>
        {comment.vote_total > 0 ? '+' : ''}
        {formatCount(comment.vote_total)}
      </ThemedText>
    </View>
  );
}

function day(ms: number | undefined) {
  return ms ? new Date(ms).toISOString().slice(0, 10) : 'at some point';
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  notice: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  noticeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  noticeAction: {
    flexDirection: 'row',
    paddingTop: Spacing.one,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
  media: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  commentsHeader: {
    paddingTop: Spacing.three,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  comment: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reply: {
    marginLeft: Spacing.four,
  },
});
