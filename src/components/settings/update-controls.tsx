import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UpdateState } from '@/lib/archive/types';

/**
 * The refresh window for a scrape run.
 *
 * ## What the window means
 *
 * A finished refresh records **a month before the run** as the start of the next
 * one. So each pass re-covers the month its predecessor already did, and that
 * overlap is deliberate: a post that gained votes or replies right at the old
 * boundary is read again rather than being sealed off by a date.
 *
 * Worked through: first scrape 15 Aug, plain catch-up runs since, archive
 * current to 21 Sep. Refreshing today reads **15 Jul → now** — a month before
 * the last run that actually refreshed anything — and then records **21 Aug** as
 * where the next one starts.
 *
 * ## Why a missing window is not guessed
 *
 * An archive built before refreshing existed has no watermark, and there is
 * nothing on disk to derive one from: `first_seen_at` says when a record was
 * archived, not when the archive was last *checked*. Picking a date silently
 * would declare everything before it current, which is the one error that cannot
 * be noticed later — the gap simply never gets read. So it asks.
 */
export interface UpdateChoice {
  enabled: boolean;
  start?: string;
  end?: string;
}

/** Resolves the controls into the window a run should cover, or nothing. */
export function resolveWindow(
  choice: UpdateChoice,
  state: UpdateState | undefined,
): { start: string; end: string } | undefined {
  if (!choice.enabled) return undefined;
  const start = choice.start || state?.window_start;
  if (!start) return undefined;
  return { start, end: choice.end || new Date().toISOString() };
}

function asDate(iso: string | undefined) {
  return iso ? iso.slice(0, 10) : '';
}

function toIso(value: string, endOfDay = false): string | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, y, m, d] = match;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return endOfDay ? `${iso}T23:59:59.999Z` : `${iso}T00:00:00.000Z`;
}

export function UpdateControls({
  kind,
  value,
  onChange,
  state,
  disabled,
}: {
  kind: 'posts' | 'comments';
  value: UpdateChoice;
  onChange: (next: UpdateChoice) => void;
  /** The watermark for the selected community, if one has been recorded. */
  state: UpdateState | undefined;
  disabled?: boolean;
}) {
  const theme = useTheme();

  const resolved = resolveWindow(value, state);
  const missing = value.enabled && !resolved;
  const custom = Boolean(value.start || value.end);
  const noun = kind === 'posts' ? 'posts' : 'threads';

  return (
    <View style={[styles.wrap, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.enabled, disabled }}
        disabled={disabled}
        onPress={() => onChange({ ...value, enabled: !value.enabled })}
        style={({ hovered }) => [styles.checkRow, hovered && { opacity: 0.85 }]}>
        <Ionicons
          name={value.enabled ? 'checkbox' : 'square-outline'}
          size={18}
          color={value.enabled ? theme.brand : theme.textTertiary}
        />
        <View style={styles.checkText}>
          <ThemedText type="smallBold">Re-read existing {noun} first</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {kind === 'posts'
              ? 'Refreshes scores, reply counts and removals for everything already archived in the window.'
              : 'Re-reads threads already collected, picking up new replies and flagging ones that have been deleted.'}
          </ThemedText>
        </View>
      </Pressable>

      {value.enabled ? (
        <>
          {missing ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="caption" style={{ color: theme.danger }}>
                No update window recorded for this community.
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                This archive predates refresh tracking, so there is nothing on disk saying how
                current it is — and guessing would mark everything before the guess as up to date.
                Pick a start date: the safest choice is a month before your first ever scrape.
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="caption" themeColor="textSecondary">
              Covering{' '}
              <ThemedText type="caption" style={{ color: theme.brand }}>
                {asDate(resolved?.start)} → {value.end ? asDate(value.end) : 'now'}
              </ThemedText>
              {state && !custom ? ` · a month before the last refresh on ${asDate(
                new Date(state.updated_at).toISOString(),
              )}` : ''}
              {custom ? ' · custom range' : ''}
            </ThemedText>
          )}

          <View style={styles.dates}>
            <Field
              label="From"
              value={value.start ? asDate(value.start) : ''}
              placeholder={asDate(state?.window_start) || 'YYYY-MM-DD'}
              onChangeText={(next) =>
                onChange({ ...value, start: next ? toIso(next) : undefined })
              }
            />
            <Field
              label="To"
              value={value.end ? asDate(value.end) : ''}
              placeholder="now"
              onChangeText={(next) =>
                onChange({ ...value, end: next ? toIso(next, true) : undefined })
              }
            />
            {custom ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use the recorded window"
                onPress={() => onChange({ enabled: true })}
                style={({ hovered }) => [styles.reset, hovered && { opacity: 0.7 }]}>
                <ThemedText type="caption" themeColor="textTertiary">
                  Reset
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {state?.last_window_start ? (
            <ThemedText type="caption" themeColor="textTertiary">
              Last refresh covered {asDate(state.last_window_start)} →{' '}
              {asDate(state.last_window_end)}.
            </ThemedText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (next: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="caption" themeColor="textTertiary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
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

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  checkText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  notice: {
    gap: Spacing.one,
    padding: Spacing.two,
    borderRadius: Radius.sm,
  },
  dates: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  field: {
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
  reset: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
});
