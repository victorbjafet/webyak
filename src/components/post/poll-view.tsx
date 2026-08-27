import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { Poll } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Poll. Results are shown once the user has participated (or the poll allows
 * viewing without voting); before that it's just choices.
 *
 * offsides caps composition at 2–4 options, so assume that range here too.
 */
export function PollView({ poll, onVote }: { poll: Poll; onVote?: (index: number) => void }) {
  const theme = useTheme();
  const showResults = poll.participated || poll.allows_view_results;
  const totalVotes = poll.choices.reduce((sum, c) => sum + (c.count || 0), 0);
  const interactive = Boolean(onVote) && !poll.participated;

  return (
    <View style={styles.wrap}>
      {poll.choices.map((choice, index) => {
        const pct = totalVotes > 0 ? Math.round(((choice.count || 0) / totalVotes) * 100) : 0;
        return (
          <Pressable
            key={`${choice.text}-${index}`}
            disabled={!interactive}
            onPress={() => onVote?.(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: choice.selected, disabled: !interactive }}
            style={({ hovered, pressed }) => [
              styles.choice,
              {
                borderColor: choice.selected ? theme.brand : theme.border,
                backgroundColor: theme.backgroundElement,
              },
              interactive && (hovered || pressed) ? { borderColor: theme.brand } : null,
            ]}>
            {showResults ? (
              <View
                style={[
                  styles.bar,
                  { width: `${pct}%`, backgroundColor: choice.selected ? theme.brandMuted : theme.control },
                ]}
              />
            ) : null}

            <View style={styles.choiceRow}>
              <ThemedText
                type={choice.selected ? 'smallBold' : 'small'}
                style={[styles.choiceText, choice.selected ? { color: theme.brand } : null]}>
                {choice.text}
              </ThemedText>
              {showResults ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  {pct}%
                </ThemedText>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {showResults ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
  },
  choice: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    justifyContent: 'center',
    minHeight: 40,
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  choiceText: {
    flex: 1,
  },
});
