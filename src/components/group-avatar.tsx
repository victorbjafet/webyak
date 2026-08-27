import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AuthedImage } from './authed-image';
import { ThemedText } from './themed-text';

import { useGroupIcon, type GroupIconSubject } from '@/api/group-icons';
import { FOR_YOU_LABEL, isForYouFeed } from '@/api/groups';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A community's icon.
 *
 * `icon_url` points at `icon.yik-yak.com`, which is **public** (verified 200
 * unauthenticated), so these load without the bearer — unlike post assets. Going
 * through AuthedImage anyway costs nothing and keeps one code path for images.
 *
 * The initials are a real fallback, not just an else-branch: they render when
 * there is no URL *and* when the URL fails, so a broken icon degrades to
 * something readable instead of a hole. Which of those happened is recorded —
 * see src/lib/image-debug.ts.
 *
 * Pass `group` rather than a bare `iconUrl` wherever you have the object: most
 * group payloads omit `icon_url` entirely, and `useGroupIcon` fetches it from
 * the endpoint that has it (src/api/group-icons.ts).
 */
export function GroupAvatar({
  name,
  iconUrl,
  color,
  size = 28,
  context = 'group-icon',
  group,
}: {
  name?: string;
  iconUrl?: string;
  color?: string;
  size?: number;
  context?: string;
  /** Enables the icon lookup for groups whose payload has no `icon_url`. */
  group?: GroupIconSubject | null;
}) {
  const theme = useTheme();
  const base = { width: size, height: size, borderRadius: Radius.sm };
  const looked = useGroupIcon(group);
  const resolvedUrl = iconUrl || group?.icon_url || looked.data || undefined;

  // The For You feed is not a community and has no icon anywhere in the API, so
  // initials would render a lone letter forever — offsides special-cases it to a
  // glyph for the same reason (docs/OFFSIDES.md).
  const label = name ?? group?.name;
  if (label === FOR_YOU_LABEL || label === 'Home' || isForYouFeed(group)) {
    return (
      <View style={[base, styles.fallback, { backgroundColor: color || theme.control }]}>
        <Ionicons name="home" size={size * 0.5} color="#FFFFFF" />
      </View>
    );
  }

  const initialsBlock = (
    <View style={[base, styles.fallback, { backgroundColor: color || theme.control }]}>
      <ThemedText type="caption" style={{ color: '#FFFFFF', fontSize: size * 0.38 }}>
        {initials(label)}
      </ThemedText>
    </View>
  );

  // Still nothing to draw: either no lookup was possible, or this community
  // genuinely has no icon — the synthetic "Home" feed being the obvious case.
  if (!resolvedUrl) return initialsBlock;

  return (
    <AuthedImage
      uri={resolvedUrl}
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
