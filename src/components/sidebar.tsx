import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ComposeButton } from './compose-button';
import { CommunitySwitcher } from './community-switcher';
import { NavBadge, useNavBadges } from './nav-badge';
import { ThemedText } from './themed-text';
import { isActive, NAV_ITEMS } from './nav-config';

import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Sidebar() {
  const theme = useTheme();
  const pathname = usePathname();
  const badges = useNavBadges();

  return (
    <View style={[styles.container, { borderRightColor: theme.border }]} role="navigation">
      <View style={styles.brandRow}>
        {/* The favicon's picture; the name beside it is the label, so alt is
            empty. Regenerated from assets/brand/ — docs/DESIGN.md#logo. */}
        <Image source={require('@/assets/images/logo.png')} alt="" style={styles.brandMark} />
        <ThemedText type="heading">webyak</ThemedText>
      </View>

      <View style={styles.list}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.match);
          const count = item.badge ? badges[item.badge] : 0;
          return (
            // See the note in bottom-bar.tsx: the style must be on <Link>.
            <Link key={item.label} href={item.href} asChild style={styles.link}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={count ? `${item.label}, ${count} unread` : item.label}
                accessibilityState={{ selected: active }}>
                {({ pressed, hovered }) => (
                  <View
                    style={[
                      styles.item,
                      (hovered || pressed) && { backgroundColor: theme.controlHover },
                      active && { backgroundColor: theme.backgroundSelected },
                    ]}>
                    <View>
                      <Ionicons
                        name={active ? item.activeIcon : item.icon}
                        size={22}
                        color={active ? theme.brand : theme.textSecondary}
                      />
                      <NavBadge count={count} />
                    </View>
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

      <CommunitySwitcher />
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
  // The corners are rounded in the image itself, to match the favicon.
  brandMark: {
    width: 28,
    height: 28,
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
