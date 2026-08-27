import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
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
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // All or nothing: the remove control is gated on the option *count*, so every
  // row has one or no row does. Everything below reserves the trailing space
  // only when it is actually occupied, which keeps one right edge down the whole
  // composer instead of insetting the inputs against a full-width Add button.
  const showRemove = options.length > MIN_POLL_OPTIONS;

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
          style={({ hovered, pressed }) => [
            styles.removePoll,
            {
              borderColor: hovered || pressed ? theme.danger : theme.borderStrong,
              backgroundColor: hovered || pressed ? theme.controlHover : 'transparent',
            },
          ]}>
          {({ hovered, pressed }) => (
            <ThemedText
              type="smallBold"
              style={{ color: hovered || pressed ? theme.danger : theme.textSecondary }}>
              Remove
            </ThemedText>
          )}
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
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
            style={[
              styles.input,
              Typography.small,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: focusedIndex === index ? theme.brand : theme.border,
              },
            ]}
          />
          {showRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${index + 1}`}
              onPress={() => removeAt(index)}
              style={({ hovered, pressed }) => [
                styles.iconButton,
                (hovered || pressed) && { backgroundColor: theme.controlHover },
              ]}>
              {({ hovered, pressed }) => (
                <Ionicons
                  name="close"
                  size={16}
                  color={hovered || pressed ? theme.danger : theme.textSecondary}
                />
              )}
            </Pressable>
          ) : null}
        </View>
      ))}

      {options.length < MAX_POLL_OPTIONS ? (
        <View style={styles.optionRow}>
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
          {showRemove ? <View style={styles.iconButton} /> : null}
        </View>
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
  removePoll: {
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
