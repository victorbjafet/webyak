import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A date input.
 *
 * **Speaks plain `YYYY-MM-DD`, not ISO timestamps.** Callers that need a moment
 * rather than a day convert on the way in and out — the archive search box wants
 * the bare date because that is what its query grammar accepts, while the
 * refresh window wants start-of-day and end-of-day. Putting that choice in the
 * component would have meant one of them converting back.
 *
 * `date-field.web.tsx` replaces this with a real `<input type="date">`, which
 * brings the browser's own calendar, locale-aware display and keyboard handling
 * for free. This file is the native fallback **and** the typed surface: tsc only
 * ever resolves `./date-field` here, so the web file's props are checked against
 * these (docs/ARCHITECTURE.md#-a-platform-split-hides-missing-exports-from-the-compiler).
 */
export interface DateFieldProps {
  label?: string;
  /** `YYYY-MM-DD`, or empty for unset. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** `2026-9-3` → `2026-09-03`. Returns '' for anything that is not a date. */
export function normalizeDate(input: string): string {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim());
  if (!match) return '';
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = 'YYYY-MM-DD',
  disabled,
}: DateFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          Typography.caption,
          { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
        ]}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  input: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
});
