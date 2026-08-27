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
  compact?: boolean;
}

export function VoteControl({ total, status, onVote, compact = false }: VoteControlProps) {
  const theme = useTheme();
  const size = compact ? 16 : 20;
  const interactive = Boolean(onVote);

  const color =
    status === 'upvote' ? theme.upvote : status === 'downvote' ? theme.downvote : theme.text;

  const press = (dir: Exclude<VoteStatus, 'none'>) => () => onVote?.(status === dir ? 'none' : dir);

  return (
    <View style={[styles.row, compact && styles.compact]}>
      <Arrow
        name="arrow-up"
        size={size}
        active={status === 'upvote'}
        activeColor={theme.upvote}
        idleColor={theme.textTertiary}
        hoverColor={theme.backgroundHover}
        disabled={!interactive}
        onPress={press('upvote')}
        label="Upvote"
      />
      <ThemedText type={compact ? 'caption' : 'smallBold'} style={{ color }}>
        {formatCount(total)}
      </ThemedText>
      <Arrow
        name="arrow-down"
        size={size}
        active={status === 'downvote'}
        activeColor={theme.downvote}
        idleColor={theme.textTertiary}
        hoverColor={theme.backgroundHover}
        disabled={!interactive}
        onPress={press('downvote')}
        label="Downvote"
      />
    </View>
  );
}

function Arrow({
  name,
  size,
  active,
  activeColor,
  idleColor,
  hoverColor,
  disabled,
  onPress,
  label,
}: {
  name: 'arrow-up' | 'arrow-down';
  size: number;
  active: boolean;
  activeColor: string;
  idleColor: string;
  hoverColor: string;
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
        !disabled && (hovered || pressed) ? { backgroundColor: hoverColor } : null,
      ]}>
      <Ionicons name={name} size={size} color={active ? activeColor : idleColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  compact: {
    gap: Spacing.half,
  },
  arrow: {
    padding: Spacing.one,
    borderRadius: Radius.sm,
  },
});
