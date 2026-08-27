import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '../ui/confirm-dialog';

import { useDeleteContent } from '@/api/mutations';
import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shareUrlForPost } from '@/lib/share';

/**
 * Save, repost, share, and delete-your-own.
 *
 * **Save is still inert.** `/v1/posts/saved` lists saved posts, but no *write*
 * path exists — thirteen candidate endpoints swept, all 404 (docs/API.md). It
 * renders dimmed with a tooltip rather than being hidden, because the bookmark
 * previously appeared only on already-saved posts, which read as a bug.
 *
 * **Awards** stay absent: posts carry an `awards[]` array but there is no
 * endpoint to give one, and it is the lowest-value feature on the list.
 */
export function PostActions({
  post,
  onDeleted,
}: {
  post: PostOrComment;
  /** Fired after a successful delete. The post screen uses it to leave. */
  onDeleted?: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useDeleteContent();

  const url = shareUrlForPost(post);

  const share = useCallback(async () => {
    if (!url) return;
    try {
      if (Platform.OS === 'web') {
        const nav = globalThis.navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
        if (typeof nav?.share === 'function') {
          await nav.share({ url, text: post.text?.slice(0, 120) });
          return;
        }
        await Clipboard.setStringAsync(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        return;
      }
      await Share.share({ message: url, url });
    } catch {
      /* the user dismissed the sheet, or the clipboard was blocked */
    }
  }, [url, post.text]);

  const repost = useCallback(() => {
    router.push({ pathname: '/compose', params: { repost: post.id, group: post.group_id } });
  }, [router, post.id, post.group_id]);

  return (
    <View style={styles.row}>
      <ActionButton
        icon={post.is_saved ? 'bookmark' : 'bookmark-outline'}
        label={post.is_saved ? 'Saved' : 'Save'}
        active={post.is_saved}
        disabled
        disabledHint="Saving isn't wired up yet — the API has no endpoint for it"
      />
      <ActionButton
        icon="repeat-outline"
        label="Repost"
        onPress={post.type === 'post' ? repost : undefined}
        disabled={post.type !== 'post'}
        disabledHint="Only posts can be quoted"
      />
      <ActionButton
        icon={copied ? 'checkmark' : 'share-outline'}
        label={copied ? 'Link copied' : 'Share'}
        onPress={url ? share : undefined}
        active={copied}
      />
      {post.authored_by_user ? (
        <ActionButton
          icon="trash-outline"
          label="Delete"
          onPress={() => setConfirmingDelete(true)}
          danger
        />
      ) : null}

      <ConfirmDialog
        visible={confirmingDelete}
        title={post.type === 'comment' ? 'Delete this comment?' : 'Delete this post?'}
        body="This can't be undone."
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          remove.mutate(
            { id: post.id, parentPostId: post.parent_post_id },
            {
              onSuccess: () => onDeleted?.(),
              onSettled: () => setConfirmingDelete(false),
            },
          );
        }}
      />
    </View>
  );

  function ActionButton({
    icon,
    label,
    onPress,
    active = false,
    disabled = false,
    danger = false,
    disabledHint,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress?: () => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    disabledHint?: string;
  }) {
    const inert = disabled || !onPress;
    const tint = danger ? theme.danger : active ? theme.brand : theme.textSecondary;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, selected: active }}
        disabled={inert}
        onPress={onPress}
        {...(Platform.OS === 'web' && inert && disabledHint ? { title: disabledHint } : null)}
        style={({ hovered, pressed }) => [
          styles.button,
          !inert && (hovered || pressed) ? { backgroundColor: theme.controlHover } : null,
          inert && styles.inert,
        ]}>
        <Ionicons name={icon} size={17} color={tint} />
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  button: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inert: {
    opacity: 0.45,
  },
});
