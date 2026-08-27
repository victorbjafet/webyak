import { StyleSheet, View } from 'react-native';

import { AuthedImage } from './authed-image';
import { ThemedText } from './themed-text';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A community's icon.
 *
 * `icon_url` points at `icon.yik-yak.com`, which is **public** (verified 200
 * unauthenticated), so these load without the bearer — unlike post assets. Going
 * through AuthedImage anyway costs nothing and keeps one code path for images.
 *
 * Falls back to initials on the group's own color, which every group has.
 */
export function GroupAvatar({
  name,
  iconUrl,
  color,
  size = 28,
}: {
  name?: string;
  iconUrl?: string;
  color?: string;
  size?: number;
}) {
  const theme = useTheme();
  const base = { width: size, height: size, borderRadius: Radius.sm };

  if (iconUrl) {
    return (
      <AuthedImage
        uri={iconUrl}
        style={[base, { backgroundColor: theme.control }]}
        contentFit="cover"
        transition={100}
      />
    );
  }

  return (
    <View style={[base, styles.fallback, { backgroundColor: color || theme.control }]}>
      <ThemedText type="caption" style={{ color: '#FFFFFF', fontSize: size * 0.38 }}>
        {initials(name)}
      </ThemedText>
    </View>
  );
}

function initials(name?: string) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
