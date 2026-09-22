import { View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useColorScheme, useTheme } from '@/hooks/use-theme';

import type { DateFieldProps } from './date-field';

export { normalizeDate } from './date-field';

/**
 * A date input backed by the browser's own `<input type="date">`.
 *
 * ## Why a real DOM input rather than a styled `TextInput`
 *
 * It brings the platform calendar, locale-aware display, arrow-key stepping and
 * keyboard entry that already works — none of which a text box gets, and all of
 * which people expect from a date field.
 *
 * It also sidesteps the bug that made the text version unusable. A controlled
 * text box whose value is round-tripped through a date parser cannot be typed
 * into: `2`, `20`, `2026-0` are all incomplete, all parse to nothing, so the
 * value stays empty and the character never appears. A native date input holds
 * its own partial state and only reports a **complete** date, which is exactly
 * the contract the callers want.
 *
 * ## Why it is hand-styled
 *
 * `react-native-web` cannot render this — there is no `TextInput` type that maps
 * to it — so this is React DOM directly and the app's tokens are applied as
 * inline CSS. `colorScheme` is the one non-obvious property: without it the
 * browser paints the calendar icon and the picker panel for a light page, which
 * on a dark background renders a near-invisible icon.
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: DateFieldProps) {
  const theme = useTheme();
  const scheme = useColorScheme();

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {label}
        </ThemedText>
      ) : null}
      <input
        type="date"
        value={value}
        disabled={disabled}
        // An empty input reports '', which callers read as "unset".
        onChange={(event) => onChange(event.target.value)}
        aria-label={label ?? placeholder ?? 'Date'}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: `${Spacing.one}px ${Spacing.two}px`,
          borderRadius: Radius.sm,
          border: `1px solid ${theme.border}`,
          background: theme.background,
          color: theme.text,
          font: 'inherit',
          fontSize: 12,
          lineHeight: '16px',
          outline: 'none',
          opacity: disabled ? 0.5 : 1,
          // Without this the picker and its icon are drawn for a light page.
          colorScheme: scheme === 'dark' ? 'dark' : 'light',
        }}
      />
    </View>
  );
}

const styles = {
  wrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
} as const;
