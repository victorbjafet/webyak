import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { NavBadgeKey } from './nav-config';

import { useUnseenActivityCount } from '@/api/queries';
import { useTheme } from '@/hooks/use-theme';

/** Every count a nav item can carry, keyed as `NavItem.badge` names them. */
export function useNavBadges(): Record<NavBadgeKey, number> {
  return { alerts: useUnseenActivityCount() };
}

/**
 * A count over a nav icon, in the notification red the palette keeps for
 * unread badges. Ringed in the background colour, so it stays legible where
 * it overlaps the icon.
 */
export function NavBadge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: theme.notification, borderColor: theme.background },
      ]}>
      <ThemedText style={[styles.label, { color: theme.onNotification }]}>
        {count > 99 ? '99+' : count}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -5,
    left: 13,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
});
