import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ComposeButton } from './compose-button';
import { CommunitySwitcher } from './community-switcher';
import { ThemedText } from './themed-text';
import { isActive, NAV_ITEMS } from './nav-config';

import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Sidebar() {
  const theme = useTheme();
  const pathname = usePathname();

  return (
    <View style={[styles.container, { borderRightColor: theme.border }]} role="navigation">
      <View style={styles.brandRow}>
        <View style={[styles.brandMark, { backgroundColor: theme.brand }]}>
          <ThemedText type="smallBold" style={{ color: theme.onBrand }}>
            yak
          </ThemedText>
        </View>
        <ThemedText type="heading">webyak</ThemedText>
      </View>

      <View style={styles.list}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.match);
          return (
            // See the note in bottom-bar.tsx: the style must be on <Link>.
            <Link key={item.label} href={item.href} asChild style={styles.link}>
              <Pressable accessibilityRole="link" accessibilityState={{ selected: active }}>
                {({ pressed, hovered }) => (
                  <View
                    style={[
                      styles.item,
                      (hovered || pressed) && { backgroundColor: theme.controlHover },
                      active && { backgroundColor: theme.backgroundSelected },
                    ]}>
                    <Ionicons
                      name={active ? item.activeIcon : item.icon}
                      size={22}
                      color={active ? theme.brand : theme.textSecondary}
                    />
                    <ThemedText
                      type={active ? 'bodyBold' : 'body'}
                      style={{ color: active ? theme.brand : theme.textSecondary }}>
                      {item.label}
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            </Link>
          );
        })}
      </View>

      <ComposeButton variant="sidebar" />

      <CommunitySwitcher variant="sidebar" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: Layout.sidebarWidth,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.four,
    gap: Spacing.four,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  brandMark: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.sm,
  },
  list: {
    gap: Spacing.half,
  },
  link: {
    width: '100%',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
});
