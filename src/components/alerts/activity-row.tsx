import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { TimeStamp } from '../post/time-stamp';
import { ThemedText } from '../themed-text';

import { activityDate, type ActivityItem } from '@/api/activity';
import { isPostId } from '@/api/queries';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Kind {
  label: string;
  icon: IoniconName;
}

/**
 * The alert types offsides renders, under its own labels, which follow the
 * official app. Only `votes` has been seen by our own probe (PLAN Q14); any
 * other type still renders, as its own name with a bell, because the server's
 * sentence says what happened either way.
 */
const KINDS: Record<string, Kind> = {
  votes: { label: 'Votes', icon: 'arrow-up-circle-outline' },
  trending_post: { label: 'Popular', icon: 'trending-up-outline' },
  followed_post: { label: 'Followed post', icon: 'chatbubbles-outline' },
  comment: { label: 'Comment', icon: 'chatbubble-outline' },
  comment_reply: { label: 'Comment reply', icon: 'arrow-undo-outline' },
  new_follower: { label: 'New follower', icon: 'person-add-outline' },
  suggested_sidechats: { label: 'Suggested community', icon: 'sparkles-outline' },
};

export function activityKind(type: string): Kind {
  const kind = KINDS[type];
  if (kind) return kind;
  // offsides reads any type containing "comment" as a comment.
  if (type.includes('comment')) return KINDS.comment;
  const words = type.replace(/[_-]+/g, ' ').trim();
  return {
    label: words ? words[0].toUpperCase() + words.slice(1) : 'Alert',
    icon: 'notifications-outline',
  };
}

export type ActivityTarget =
  | { kind: 'post'; postId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'none' };

/**
 * Where an alert leads.
 *
 * `post_id` first, which is what offsides opens for every type. Failing that, a
 * UUID inside the id itself — `votes~<uuid>~25`. That fallback is a lead, not a
 * rule: whether the UUID is always the post, and never a comment, is PLAN Q14.
 */
export function activityTarget(item: ActivityItem): ActivityTarget {
  if (item.post_id && isPostId(item.post_id)) return { kind: 'post', postId: item.post_id };
  const group = item.suggested_sidechats_data?.group_ids_to_suggest?.find(Boolean);
  if (group) return { kind: 'group', groupId: group };
  const embedded = item.id.split('~').find((part) => isPostId(part));
  return embedded ? { kind: 'post', postId: embedded } : { kind: 'none' };
}

/**
 * The server's sentence, as sent. The one edit is offsides': a leading 📈 on
 * the two kinds whose icon already says it.
 */
export function activityText(item: ActivityItem): string {
  const text = item.text ?? '';
  return item.type === 'trending_post' || item.type === 'followed_post'
    ? text.replace(/^📈\s*/u, '')
    : text;
}

/**
 * One alert. Unread is the chat list's treatment — accent border and a dot —
 * so the two tabs read the same way.
 */
export function ActivityRow({
  item,
  onPress,
}: {
  item: ActivityItem;
  onPress: (item: ActivityItem) => void;
}) {
  const theme = useTheme();
  const kind = activityKind(item.type);
  const unread = !item.is_seen;
  const when = activityDate(item);
  const text = activityText(item);
  // A new follower's own icon, where offsides draws one.
  const icon = item.type === 'new_follower' ? item.conversation_icon : undefined;
  const leads = activityTarget(item).kind !== 'none';

  return (
    <Pressable
      accessibilityRole={leads ? 'link' : 'button'}
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${kind.label}. ${text}`}
      onPress={() => onPress(item)}
      style={({ hovered, pressed }) => [
        styles.row,
        {
          backgroundColor: hovered || pressed ? theme.backgroundHover : theme.backgroundElement,
          borderColor: unread ? theme.brand : theme.border,
        },
      ]}>
      <View style={[styles.avatar, { backgroundColor: icon?.color || theme.control }]}>
        {icon?.emoji ? (
          <ThemedText style={styles.emoji}>{icon.emoji}</ThemedText>
        ) : (
          <Ionicons name={kind.icon} size={18} color={unread ? theme.brand : theme.textSecondary} />
        )}
      </View>

      <View style={styles.text}>
        <View style={styles.titleRow}>
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            style={[styles.title, { color: unread ? theme.text : theme.textSecondary }]}>
            {kind.label}
          </ThemedText>
          {when ? <TimeStamp iso={when} type="caption" interactive={false} /> : null}
        </View>
        <ThemedText type="small" themeColor={unread ? 'text' : 'textSecondary'} numberOfLines={3}>
          {text || 'No details'}
        </ThemedText>
      </View>

      {unread ? <View style={[styles.dot, { backgroundColor: theme.brand }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
