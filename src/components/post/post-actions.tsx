import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shareUrlForPost } from '@/lib/share';

/**
 * Save, repost and share.
 *
 * Save and repost render in their real positions but are inert:
 *  - **save** — `/v1/posts/saved` lists saved posts, but no *write* path exists.
 *    Thirteen candidate endpoints have been swept and all 404 (docs/API.md).
 *  - **repost** — `createPost` takes a `repostId`, so this is a Phase 4 wiring
 *    job, not a missing capability.
 *
 * They are shown rather than hidden because the bookmark previously appeared
 * only on already-saved posts, which read as a bug. A dimmed control that says
 * why is clearer than a control that appears and disappears.
 *
 * **Awards** are deliberately absent: posts carry an `awards[]` array but there
 * is no endpoint to give one and it's the lowest-value feature on the list.
 */
export function PostActions({ post }: { post: PostOrComment }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

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
        disabled
        disabledHint="Reposting arrives with composing in Phase 4"
      />
      <ActionButton
        icon={copied ? 'checkmark' : 'share-outline'}
        label={copied ? 'Link copied' : 'Share'}
        onPress={url ? share : undefined}
        active={copied}
      />
    </View>
  );

  function ActionButton({
    icon,
    label,
    onPress,
    active = false,
    disabled = false,
    disabledHint,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress?: () => void;
    active?: boolean;
    disabled?: boolean;
    disabledHint?: string;
  }) {
    const inert = disabled || !onPress;
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
        <Ionicons name={icon} size={17} color={active ? theme.brand : theme.textSecondary} />
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
