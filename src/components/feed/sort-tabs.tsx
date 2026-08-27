import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { FeedCategory } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The API's categories are hot/recent/top; "New" is just the label for recent. */
const TABS: { value: FeedCategory; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'recent', label: 'New' },
  { value: 'top', label: 'Top' },
];

export function SortTabs({
  value,
  onChange,
}: {
  value: FeedCategory;
  onChange: (next: FeedCategory) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={({ hovered, pressed }) => [
              styles.tab,
              {
                backgroundColor: active ? theme.brand : theme.control,
              },
              !active && (hovered || pressed) ? { backgroundColor: theme.controlHover } : null,
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: active ? theme.onBrand : theme.controlText }}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tab: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
  },
});
