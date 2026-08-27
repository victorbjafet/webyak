import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GroupAvatar } from './group-avatar';
import { ThemedText } from './themed-text';

import { useCurrentGroup } from '@/api/current-group';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Switches which community the home feed shows.
 *
 * Two presentations, matching the official app: a list under Home in the desktop
 * sidebar, and a thin scrollable strip above the tab bar on narrow screens.
 */
export function CommunitySwitcher({ variant }: { variant: 'sidebar' | 'bar' }) {
  const theme = useTheme();
  const router = useRouter();
  const { groups, current, setCurrent, isLoading } = useCurrentGroup();

  // Selecting always lands you on that community's feed, so the choice has a
  // visible result even if you were three screens deep when you made it.
  const choose = useCallback(
    (group: (typeof groups)[number]) => {
      setCurrent(group);
      router.push('/');
    },
    [setCurrent, router],
  );

  if (isLoading || groups.length === 0) return null;

  if (variant === 'bar') {
    return (
      <View style={[styles.bar, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.barContent}>
          {groups.map((group) => {
            const active = group.id === current?.id;
            return (
              <Pressable
                key={group.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => choose(group)}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? theme.brandMuted : theme.control,
                    borderColor: active ? theme.brand : 'transparent',
                  },
                  !active && (hovered || pressed) ? { backgroundColor: theme.controlHover } : null,
                ]}>
                <GroupAvatar
                  name={group.name}
                  iconUrl={group.icon_url}
                  color={group.color}
                  size={20}
                />
                <ThemedText
                  type="caption"
                  numberOfLines={1}
                  style={{ color: active ? theme.brand : theme.controlText }}>
                  {group.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.sidebar}>
      <ThemedText type="caption" themeColor="textTertiary" style={styles.heading}>
        My communities
      </ThemedText>
      {groups.map((group) => {
        const active = group.id === current?.id;
        return (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => choose(group)}
            style={({ hovered, pressed }) => [
              styles.row,
              active && { backgroundColor: theme.backgroundSelected },
              !active && (hovered || pressed) ? { backgroundColor: theme.backgroundHover } : null,
            ]}>
            <GroupAvatar name={group.name} iconUrl={group.icon_url} color={group.color} size={24} />
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              numberOfLines={1}
              style={[styles.rowLabel, { color: active ? theme.text : theme.textSecondary }]}>
              {group.name}
            </ThemedText>
            {active ? <Ionicons name="checkmark" size={15} color={theme.brand} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    gap: Spacing.half,
  },
  heading: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  rowLabel: {
    flex: 1,
  },
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barContent: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    gap: Spacing.two,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 180,
  },
});
