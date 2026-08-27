import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { isActive, NAV_ITEMS } from './nav-config';

import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function BottomBar() {
  const theme = useTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View
      role="navigation"
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          paddingBottom: insets.bottom,
        },
      ]}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.match);
        return (
          // The layout style has to live on <Link>, not on the <Pressable>:
          // expo-router spreads its own `style` after `...rest` when cloning the
          // asChild child, so a style set on the child is overwritten with
          // undefined and every item collapses to its content width.
          <Link key={item.label} href={item.href} asChild style={styles.link}>
            <Pressable accessibilityRole="link" accessibilityState={{ selected: active }}>
              {({ pressed }) => (
                <View style={[styles.item, pressed && styles.pressed]}>
                  <Ionicons
                    name={active ? item.activeIcon : item.icon}
                    size={22}
                    color={active ? theme.brand : theme.textTertiary}
                  />
                  <ThemedText
                    type="caption"
                    numberOfLines={1}
                    style={{ color: active ? theme.brand : theme.textTertiary }}>
                    {item.label}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  link: {
    flex: 1,
  },
  item: {
    flex: 1,
    minHeight: Layout.bottomBarHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
