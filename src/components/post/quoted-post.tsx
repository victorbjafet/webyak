import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ThemedText } from '../themed-text';
import { IdentityAvatar } from './identity-avatar';
import { TimeStamp } from './time-stamp';

import type { PostOrComment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bestAssetUrl } from '@/lib/asset-url';
import { useMediaMaxHeight } from '@/lib/media';

/**
 * The post being quoted, shown inside the composer and inside a published
 * repost.
 *
 * Deliberately not a `PostCard`: nothing here is interactive. A card would
 * bring vote buttons, a profile link and a delete control for a post that is
 * only being referenced — and inside the composer those would be nested
 * controls inside a form, which is the nested-button problem again.
 */
export function QuotedPost({
  post,
  onPress,
}: {
  post: PostOrComment;
  /** Opens the original. Omitted in the composer, where nothing should navigate. */
  onPress?: () => void;
}) {
  const theme = useTheme();
  const displayName = post.identity?.name || post.alias || 'Anonymous';
  // Much shorter than a normal post's cap: a repost stacks two posts in one
  // card, so a full-height original buries the comment that was the point of
  // reposting it.
  const maxHeight = useMediaMaxHeight('quoted');

  // Only the first image. A quote is a reference, not a gallery — the rest are
  // one tap away on the original.
  const preview = post.assets?.find((a) => a.type === 'image');
  const video = post.assets?.find((a) => a.type === 'video');
  const previewUri = preview ? bestAssetUrl(preview) : undefined;
  const extra = (post.assets?.length ?? 0) - (preview ? 1 : 0);

  const body = (
    <>
      <View style={styles.header}>
        <IdentityAvatar identity={post.identity} size={20} />
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {displayName}
        </ThemedText>
        <View style={styles.spacer} />
        <TimeStamp iso={post.created_at} interactive={false} />
      </View>

      {post.text ? (
        <ThemedText type="small" numberOfLines={6}>
          {post.text}
        </ThemedText>
      ) : null}

      {previewUri ? (
        <AuthedImage
          uri={previewUri}
          context="quoted-post-image"
          style={[
            styles.media,
            {
              aspectRatio: preview?.width && preview?.height ? preview.width / preview.height : 1,
              maxHeight,
              backgroundColor: theme.skeleton,
            },
          ]}
          // `contain`, like the full-size card: once the cap bites, the frame no
          // longer matches the asset's ratio and `cover` would crop it.
          contentFit="contain"
          transition={100}
        />
      ) : null}

      {video && !previewUri ? (
        <View style={[styles.mediaNote, { backgroundColor: theme.control }]}>
          <Ionicons name="videocam-outline" size={13} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Video
          </ThemedText>
        </View>
      ) : null}

      {extra > 0 ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {`+${extra} more`}
        </ThemedText>
      ) : null}
    </>
  );

  const frame = [styles.wrap, { borderColor: theme.border, backgroundColor: theme.background }];

  // A Pressable is safe here even inside a card: everything above is text and
  // plain Views — the timestamp is rendered non-interactive on purpose — so no
  // control ends up nested inside another.
  if (!onPress) return <View style={frame}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the quoted post"
      onPress={onPress}
      style={({ hovered, pressed }) => [
        frame,
        (hovered || pressed) && { backgroundColor: theme.backgroundHover },
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
  media: {
    width: '100%',
    borderRadius: Radius.sm,
  },
  mediaNote: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
});
