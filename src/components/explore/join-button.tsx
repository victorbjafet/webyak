import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '../themed-text';

import { useGroupMembership } from '@/api/mutations';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Join / leave, for anywhere a community is shown.
 *
 * Rendered as a `Pressable` rather than the shared `Button` so it can sit in a
 * header row at chip height. State is optimistic — the mutation patches the
 * cached group and rolls back with a toast on failure
 * (docs/ARCHITECTURE.md#writing-phase-4).
 */
export function JoinButton({
  groupId,
  name,
  isMember,
  canJoin = true,
  size = 'md',
}: {
  groupId: string;
  name?: string;
  isMember: boolean;
  /** `can_join: false` — gated on something we can't satisfy, e.g. a school email. */
  canJoin?: boolean;
  size?: 'sm' | 'md';
}) {
  const theme = useTheme();
  const membership = useGroupMembership();
  const pad = size === 'sm' ? Spacing.two : Spacing.three;

  if (!canJoin && !isMember) {
    return (
      <ThemedText type="caption" themeColor="textTertiary">
        Closed
      </ThemedText>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isMember ? `Leave ${name ?? 'this community'}` : `Join ${name ?? 'this community'}`}
      accessibilityState={{ busy: membership.isPending }}
      disabled={membership.isPending}
      onPress={() => membership.mutate({ groupId, join: !isMember })}
      style={({ hovered, pressed }) => [
        styles.button,
        {
          paddingHorizontal: pad,
          backgroundColor: isMember ? 'transparent' : theme.brand,
          borderColor: isMember ? theme.borderStrong : theme.brand,
        },
        (hovered || pressed) && { opacity: 0.85 },
        membership.isPending && styles.pending,
      ]}>
      <ThemedText type="caption" style={{ color: isMember ? theme.textSecondary : theme.onBrand }}>
        {isMember ? 'Joined' : 'Join'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pending: {
    opacity: 0.5,
  },
});
