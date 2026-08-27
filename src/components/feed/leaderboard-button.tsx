import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Placeholder for the community leaderboard.
 *
 * The concept is real — group objects carry `should_show_leaderboard` — but no
 * endpoint for it has been found yet, so this is inert and says so. Tracked in
 * PLAN.md Phase 8 alongside the other read-only-state gaps.
 */
export function LeaderboardButton() {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View leaderboard"
      accessibilityState={{ disabled: true }}
      disabled
      {...(Platform.OS === 'web'
        ? { title: "Leaderboard isn't built yet — no endpoint for it has been found" }
        : null)}
      style={[styles.button, { backgroundColor: theme.control }]}>
      <Ionicons name="trophy-outline" size={17} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
});
