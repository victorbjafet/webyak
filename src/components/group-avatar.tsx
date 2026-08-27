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
 * The initials are a real fallback now, not just an else-branch: they render
 * when there is no URL *and* when the URL fails, so a broken icon degrades to
 * something readable instead of a hole. Which of those happened is recorded —
 * see src/lib/image-debug.ts.
 */
export function GroupAvatar({
  name,
  iconUrl,
  color,
  size = 28,
  context = 'group-icon',
}: {
  name?: string;
  iconUrl?: string;
  color?: string;
  size?: number;
  context?: string;
}) {
  const theme = useTheme();
  const base = { width: size, height: size, borderRadius: Radius.sm };

  const initialsBlock = (
    <View style={[base, styles.fallback, { backgroundColor: color || theme.control }]}>
      <ThemedText type="caption" style={{ color: '#FFFFFF', fontSize: size * 0.38 }}>
        {initials(name)}
      </ThemedText>
    </View>
  );

  // No URL at all is a *data* gap, not a render one, and the probe answers it
  // far better than the component could — recording it here would mean a side
  // effect during render, and a double count under StrictMode.
  if (!iconUrl) return initialsBlock;

  return (
    <AuthedImage
      uri={iconUrl}
      context={context}
      fallback={initialsBlock}
      style={[base, { backgroundColor: theme.control }]}
      contentFit="cover"
      transition={100}
    />
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
