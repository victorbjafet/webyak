import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { VoteStatus } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

interface VoteControlProps {
  total: number;
  status: VoteStatus;
  /** Phase 4 wires this. Without it the control renders read-only. */
  onVote?: (next: VoteStatus) => void;
  /** Slightly tighter for comments — text size stays the same on purpose. */
  compact?: boolean;
}

export function VoteControl({ total, status, onVote, compact = false }: VoteControlProps) {
  const theme = useTheme();
  const interactive = Boolean(onVote);
  const diameter = compact ? 26 : 30;

  const color =
    status === 'upvote' ? theme.upvote : status === 'downvote' ? theme.downvote : theme.text;

  const press = (dir: Exclude<VoteStatus, 'none'>) => () => onVote?.(status === dir ? 'none' : dir);

  return (
    <View style={styles.row}>
      <Arrow
        name="arrow-up"
        diameter={diameter}
        active={status === 'upvote'}
        activeColor={theme.upvote}
        idleColor={theme.textSecondary}
        background={theme.control}
        hoverBackground={theme.controlHover}
        disabled={!interactive}
        onPress={press('upvote')}
        label="Upvote"
      />
      <ThemedText type="smallBold" style={[styles.count, { color }]}>
        {formatCount(total)}
      </ThemedText>
      <Arrow
        name="arrow-down"
        diameter={diameter}
        active={status === 'downvote'}
        activeColor={theme.downvote}
        idleColor={theme.textSecondary}
        background={theme.control}
        hoverBackground={theme.controlHover}
        disabled={!interactive}
        onPress={press('downvote')}
        label="Downvote"
      />
    </View>
  );
}

function Arrow({
  name,
  diameter,
  active,
  activeColor,
  idleColor,
  background,
  hoverBackground,
  disabled,
  onPress,
  label,
}: {
  name: 'arrow-up' | 'arrow-down';
  diameter: number;
  active: boolean;
  activeColor: string;
  idleColor: string;
  background: string;
  hoverBackground: string;
  disabled: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.arrow,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: !disabled && (hovered || pressed) ? hoverBackground : background,
        },
      ]}>
      <Ionicons name={name} size={diameter * 0.55} color={active ? activeColor : idleColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  count: {
    minWidth: 24,
    textAlign: 'center',
  },
});
