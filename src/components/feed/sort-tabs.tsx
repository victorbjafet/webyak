import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { FeedCategory, TopPeriod } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The API's categories are hot/recent/top; "New" is just the label for recent. */
const TABS: { value: FeedCategory; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'recent', label: 'New' },
  { value: 'top', label: 'Top' },
];

/**
 * The For You feed has no `top`. offsides refuses it outright — "This feature
 * isn't supported in your Home group" — and the official app doesn't offer it
 * there either. Passing `categories` trims the row rather than showing a tab
 * that returns nothing useful.
 */
export const FOR_YOU_TABS: FeedCategory[] = ['hot', 'recent'];

/**
 * Time window for the `top` feed. Verified 2026-08-27 against the live API:
 * these are the only three values it recognizes — anything else silently falls
 * back to `day`. See docs/API.md#top-time-ranges.
 */
const PERIODS: { value: TopPeriod; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'all_time', label: 'All time' },
];

export function SortTabs({
  value,
  onChange,
  period = 'day',
  onPeriodChange,
  categories,
}: {
  value: FeedCategory;
  onChange: (next: FeedCategory) => void;
  period?: TopPeriod;
  onPeriodChange?: (next: TopPeriod) => void;
  /** Restricts which tabs render. Defaults to all three. */
  categories?: FeedCategory[];
}) {
  const theme = useTheme();
  const tabs = categories ? TABS.filter((t) => categories.includes(t.value)) : TABS;

  return (
    <View style={styles.stack}>
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((tab) => {
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

    {value === 'top' && onPeriodChange ? (
      <View style={styles.row} accessibilityRole="tablist">
        {PERIODS.map((option) => {
          const active = option.value === period;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onPeriodChange(option.value)}
              style={({ hovered, pressed }) => [
                styles.period,
                { borderColor: active ? theme.brand : theme.border },
                !active && (hovered || pressed) ? { backgroundColor: theme.controlHover } : null,
              ]}>
              <ThemedText
                type="caption"
                style={{ color: active ? theme.brand : theme.textSecondary }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.two,
  },
  period: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
