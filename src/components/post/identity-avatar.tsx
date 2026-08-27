import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { Identity } from '@/api/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * A user's icon: an emoji on their chosen color. Absent when the post was made
 * anonymously, which is the default — `conversation_icon` only appears when
 * someone posts under a username.
 */
export function IdentityAvatar({ identity, size = 32 }: { identity?: Identity; size?: number }) {
  const theme = useTheme();
  const icon = identity?.conversation_icon;

  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (!icon?.emoji) {
    return (
      <View
        style={[base, styles.center, { backgroundColor: theme.control }]}
        accessibilityLabel="Anonymous">
        <Ionicons name="person" size={size * 0.5} color={theme.textTertiary} />
      </View>
    );
  }

  return (
    <View
      style={[base, styles.center, { backgroundColor: icon.color || theme.control }]}
      accessibilityLabel={identity?.name ? `${identity.name}'s icon` : 'User icon'}>
      <ThemedText style={{ fontSize: size * 0.5, lineHeight: size * 0.7 }}>{icon.emoji}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
