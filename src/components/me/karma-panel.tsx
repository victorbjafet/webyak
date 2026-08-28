import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { useCurrentGroup } from '@/api/current-group';
import { groupDisplayName } from '@/api/groups';
import type { Karma, KarmaGroup } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/**
 * Yakarma: the total, then one row per community, each expanding to show the
 * post/comment split.
 *
 * The split is the whole point of the interaction — a single number tells you
 * nothing about whether it came from posting or replying — so the rows are
 * collapsed by default and the breakdown is one tap away rather than a wall of
 * numbers.
 *
 * Everything is defensive: `karma` is an undocumented payload, so a missing
 * `groups` array or an absent `post` count renders as zero rather than
 * collapsing the panel.
 */
export function KarmaPanel({ karma }: { karma: Karma | undefined }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Karma entries arrive with an id but **no name**, so the label has to be
  // resolved against the communities we already hold. Without this every row
  // read "Community".
  const { groups: myGroups } = useCurrentGroup();

  const nameFor = (entry: KarmaGroup): string => {
    const id = entry.group_id ?? entry.id;
    const match = id ? myGroups.find((g) => g.id === id) : undefined;
    return groupDisplayName(match) || groupDisplayName(entry) || entry.name || 'Community';
  };

  const colorFor = (entry: KarmaGroup): string | undefined => {
    const id = entry.group_id ?? entry.id;
    return entry.color ?? (id ? myGroups.find((g) => g.id === id)?.color : undefined);
  };

  const totalPost = karma?.post ?? 0;
  const totalComment = karma?.comment ?? 0;
  const karmaGroups = karma?.groups ?? [];

  const toggle = (key: string) => setExpanded((current) => (current === key ? null : key));

  return (
    <View style={styles.wrap}>
      <Row id="total" label="Total Yakarma" post={totalPost} comment={totalComment} emphasis />

      {karmaGroups.map((group: KarmaGroup, index) => {
        const key = group.group_id ?? group.id ?? group.name ?? String(index);
        return (
          <Row
            key={key}
            id={key}
            label={nameFor(group)}
            post={group.post ?? 0}
            comment={group.comment ?? 0}
            accent={colorFor(group)}
          />
        );
      })}

      {karmaGroups.length === 0 ? (
        <ThemedText type="caption" themeColor="textTertiary">
          No per-community breakdown came back. The total above is still accurate.
        </ThemedText>
      ) : null}
    </View>
  );

  function Row({
    id,
    label,
    post,
    comment,
    emphasis = false,
    accent,
  }: {
    id: string;
    label: string;
    post: number;
    comment: number;
    emphasis?: boolean;
    accent?: string;
  }) {
    const open = expanded === id;
    const total = post + comment;

    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${label}: ${total} yakarma. Tap for the breakdown.`}
          onPress={() => toggle(id)}
          style={({ hovered, pressed }) => [
            styles.row,
            {
              backgroundColor: hovered || pressed ? theme.controlHover : theme.control,
              borderColor: open ? theme.brand : 'transparent',
            },
          ]}>
          <View style={[styles.dot, { backgroundColor: accent || theme.brand }]} />
          <ThemedText type={emphasis ? 'bodyBold' : 'smallBold'} style={styles.label} numberOfLines={1}>
            {label}
          </ThemedText>
          {/*
            Fixed width, right-aligned. "19" and "9.6k" are different widths, so
            without this the chevrons sit at different x positions down the
            column and the rows look misaligned.
          */}
          <ThemedText
            type={emphasis ? 'bodyBold' : 'smallBold'}
            style={[styles.value, { color: theme.brand }]}>
            {formatCount(total)}
          </ThemedText>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.textTertiary}
          />
        </Pressable>

        {open ? (
          <View style={[styles.breakdown, { borderColor: theme.border }]}>
            <Split icon="document-text-outline" label="From posts" value={post} />
            <Split icon="chatbubble-outline" label="From comments" value={comment} />
          </View>
        ) : null}
      </View>
    );
  }

  function Split({
    icon,
    label,
    value,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    value: number;
  }) {
    return (
      <View style={styles.split}>
        <Ionicons name={icon} size={14} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
        <ThemedText type="smallBold">{formatCount(value)}</ThemedText>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    minWidth: 52,
    textAlign: 'right',
  },
  breakdown: {
    gap: Spacing.one,
    marginTop: Spacing.half,
    marginLeft: Spacing.four,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.one,
    borderLeftWidth: 2,
  },
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
