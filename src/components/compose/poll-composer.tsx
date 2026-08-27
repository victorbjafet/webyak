import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 2–4 choices, matching offsides. The API has never been probed for a higher
 * ceiling; offsides caps at four and the official app shows no more, so this
 * follows rather than guessing at an untested limit.
 */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 4;

export function PollComposer({
  options,
  onChange,
  onRemove,
}: {
  options: string[];
  onChange: (next: string[]) => void;
  /** Discards the poll entirely and returns to a plain post. */
  onRemove: () => void;
}) {
  const theme = useTheme();

  const setAt = (index: number, value: string) =>
    onChange(options.map((option, i) => (i === index ? value : option)));

  const removeAt = (index: number) => onChange(options.filter((_, i) => i !== index));

  return (
    <View style={[styles.wrap, { borderColor: theme.border }]}>
      <View style={styles.header}>
        <Ionicons name="stats-chart-outline" size={16} color={theme.textSecondary} />
        <ThemedText type="smallBold" themeColor="textSecondary">
          Poll
        </ThemedText>
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove poll"
          onPress={onRemove}
          style={({ hovered }) => [styles.iconButton, hovered && { opacity: 0.7 }]}>
          <ThemedText type="caption" themeColor="textTertiary">
            Remove
          </ThemedText>
        </Pressable>
      </View>

      {options.map((option, index) => (
        <View key={index} style={styles.optionRow}>
          <TextInput
            value={option}
            onChangeText={(value) => setAt(index, value)}
            placeholder={`Option ${index + 1}`}
            placeholderTextColor={theme.textTertiary}
            maxLength={80}
            style={[
              styles.input,
              Typography.small,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          />
          {options.length > MIN_POLL_OPTIONS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${index + 1}`}
              onPress={() => removeAt(index)}
              style={({ hovered }) => [
                styles.iconButton,
                hovered && { backgroundColor: theme.controlHover },
              ]}>
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : (
            // Keeps the inputs aligned when the remove control isn't available,
            // so rows don't shift sideways as options are added and removed.
            <View style={styles.iconButton} />
          )}
        </View>
      ))}

      {options.length < MAX_POLL_OPTIONS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add option"
          onPress={() => onChange([...options, ''])}
          style={({ hovered, pressed }) => [
            styles.add,
            { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
          ]}>
          <Ionicons name="add" size={16} color={theme.controlText} />
          <ThemedText type="smallBold" themeColor="controlText">
            Add option
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
