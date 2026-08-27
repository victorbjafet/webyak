import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The post button. Brand green in both forms — it is the one action the whole
 * app exists for, and the palette reserves that color for exactly this and for
 * selection (docs/DESIGN.md).
 *
 * `sidebar` is a full-width button under the nav list; `floating` is a circular
 * FAB that sits above the bottom bar on narrow viewports, which is where the
 * official app puts it.
 */
export function ComposeButton({ variant }: { variant: 'sidebar' | 'floating' }) {
  const theme = useTheme();
  const pathname = usePathname();

  // Hidden on the composer itself — a button that reopens the screen you are
  // already on is noise, and on narrow it would cover the text field.
  if (pathname === '/compose') return null;

  if (variant === 'floating') {
    return (
      // The layout style goes on <Link>: expo-router spreads its own `style`
      // after `...rest` when cloning an asChild child, blanking the child's.
      // See the note in bottom-bar.tsx.
      <Link href="/compose" asChild style={styles.floatingAnchor}>
        <Pressable accessibilityRole="link" accessibilityLabel="New post">
          {({ pressed, hovered }) => (
            <View
              style={[
                styles.fab,
                { backgroundColor: theme.brand },
                (pressed || hovered) && styles.active,
              ]}>
              <Ionicons name="add" size={28} color={theme.onBrand} />
            </View>
          )}
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href="/compose" asChild style={styles.sidebarAnchor}>
      <Pressable accessibilityRole="link" accessibilityLabel="New post">
        {({ pressed, hovered }) => (
          <View
            style={[
              styles.sidebarButton,
              { backgroundColor: theme.brand },
              (pressed || hovered) && styles.active,
            ]}>
            <Ionicons name="add" size={18} color={theme.onBrand} />
            <ThemedText type="smallBold" style={{ color: theme.onBrand }}>
              Post
            </ThemedText>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  sidebarAnchor: {
    width: '100%',
  },
  sidebarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 44,
    borderRadius: Radius.pill,
  },
  floatingAnchor: {
    position: 'absolute',
    right: Spacing.three,
    // Clears the bottom bar and the community strip above it.
    bottom: Spacing.three,
    zIndex: 20,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 6px 20px rgba(0,0,0,0.35)' },
      default: { elevation: 6 },
    }),
  },
  active: {
    opacity: 0.85,
  },
});
