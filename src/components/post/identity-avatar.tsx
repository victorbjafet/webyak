import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ThemedText } from '../themed-text';

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
 * The photo branch is new. This component previously rendered *only* emoji and
 * glyphs, following sidechat.js's typedef, which says an icon is emoji + color.
 * That made "profile photos don't render" partly a self-inflicted wound: there
 * was no code path that could have shown one even with a correct URL. The field
 * that carries it is still unidentified — `photoUrl` is threaded through so
 * that the moment the probe names it, one call site changes. See
 * docs/API.md#-images-that-dont-render--unresolved.
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

  if (!photoUrl) return emojiOrGlyph;

  return (
    <AuthedImage
      uri={photoUrl}
      context="profile-photo"
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
