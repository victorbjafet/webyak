import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ThemedText } from '../themed-text';

import { useAuthorPhoto } from '@/api/profile-photos';
import type { Identity } from '@/api/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * A user's avatar.
 *
 * Three states, in priority order: a **photo** if the account has one, the
 * `conversation_icon` emoji on its color, or a person glyph for anonymous posts
 * — which is the default, since `conversation_icon` only appears when someone
 * posts under a username.
 *
 * This component once rendered *only* emoji and glyphs, following sidechat.js's
 * typedef, which says an icon is emoji + color. That made "profile photos don't
 * render" partly a self-inflicted wound: there was no code path that could have
 * shown one even with a correct URL.
 *
 * The field turned out to be `icon_url`, and it lives on the **profile**, not on
 * a post's `identity` — nor on `MyIdentity`. Nothing that renders an avatar has
 * the URL in hand, which is why photos appeared on the profile screen and
 * nowhere else for so long.
 *
 * So the lookup happens **here**, once, rather than being threaded through every
 * call site: feed cards, comments, quoted posts and the "You" tab all get photos
 * by doing nothing. `photoUrl` stays as an escape hatch for a caller that
 * already holds a URL and wants to skip the request.
 * See docs/API.md#profile-photos-icon_url-and-the-bearer-was-breaking-it.
 */
export function IdentityAvatar({
  identity,
  size = 32,
  photoUrl,
}: {
  identity?: Identity;
  size?: number;
  /** A real profile photo, when the account has one. */
  photoUrl?: string;
}) {
  const theme = useTheme();
  const icon = identity?.conversation_icon;

  /*
    Only accounts that post under a username have a profile to look up — an
    anonymous post has no `name` worth asking about, and asking would spend a
    request per post to learn nothing. Skipped entirely when the caller already
    supplied a URL.
  */
  const username = identity?.posted_with_username ? identity.name : undefined;
  const looked = useAuthorPhoto(username, !photoUrl);
  const url = photoUrl ?? looked;

  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  const emojiOrGlyph = icon?.emoji ? (
    <View
      style={[base, styles.center, { backgroundColor: icon.color || theme.control }]}
      accessibilityLabel={identity?.name ? `${identity.name}'s icon` : 'User icon'}>
      <ThemedText style={{ fontSize: size * 0.5, lineHeight: size * 0.7 }}>{icon.emoji}</ThemedText>
    </View>
  ) : (
    <View
      style={[base, styles.center, { backgroundColor: theme.control }]}
      accessibilityLabel="Anonymous">
      <Ionicons name="person" size={size * 0.5} color={theme.textTertiary} />
    </View>
  );

  if (!url) return emojiOrGlyph;

  return (
    <AuthedImage
      uri={url}
      fallback={emojiOrGlyph}
      style={[base, { backgroundColor: theme.control }]}
      contentFit="cover"
      transition={100}
      accessibilityLabel={identity?.name ? `${identity.name}'s photo` : 'Profile photo'}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
