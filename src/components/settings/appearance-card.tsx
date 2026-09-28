import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme, useThemePreference } from '@/hooks/use-theme';
import type { ThemePreference } from '@/theme/theme-provider';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'system', label: 'System', icon: 'contrast-outline' },
];

/**
 * Dark, light, or whatever the device says. Dark is the default, as Yik Yak's
 * own web client is dark-only; the choice is kept in this browser
 * (`webyak.themePreference`) and applies at once.
 */
export function AppearanceCard() {
  const theme = useTheme();
  const { preference, setPreference, scheme } = useThemePreference();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="bodyBold">Appearance</ThemedText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Theme"
        style={[styles.segments, { backgroundColor: theme.control }]}>
        {OPTIONS.map(({ value, label, icon }) => {
          const selected = value === preference;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setPreference(value)}
              style={({ hovered }) => [
                styles.segment,
                selected && { backgroundColor: theme.backgroundSelected },
                !selected && hovered ? { backgroundColor: theme.controlHover } : null,
              ]}>
              <Ionicons name={icon} size={16} color={selected ? theme.brand : theme.controlText} />
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                style={{ color: selected ? theme.brand : theme.controlText }}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {preference === 'system' ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {`Following this device, which is set to ${scheme} right now.`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  segments: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.pill,
    gap: Spacing.half,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
