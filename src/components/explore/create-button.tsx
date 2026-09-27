import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A create action that is not wired to anything yet.
 *
 * Shown rather than left out, the same call as Save (post-actions.tsx): where
 * the control lives is decided, and a dimmed button with a reason reads as
 * "not yet" rather than as something nobody thought of. No endpoint for either
 * is known — PLAN.md lists the leads.
 */
export function UnwiredCreateButton({ label, reason }: { label: string; reason: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={reason}
      accessibilityState={{ disabled: true }}
      disabled
      // A hover tooltip on web saying why; ignored elsewhere.
      {...({ title: reason } as object)}
      style={[styles.button, { backgroundColor: theme.control }]}>
      <Ionicons name="add" size={16} color={theme.controlText} />
      <ThemedText type="caption" style={{ color: theme.controlText }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.one,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.three,
    borderRadius: Radius.pill,
    opacity: 0.5,
  },
});
