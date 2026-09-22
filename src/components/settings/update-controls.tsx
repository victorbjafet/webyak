import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { DateField } from '../ui/date-field';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UpdateState } from '@/lib/archive/types';
import { normalizeDate } from '@/lib/time';

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

/**
 * A picked day widened into a moment.
 *
 * `start` takes the first instant of the day and `end` the last, so a window of
 * "3rd to 3rd" contains the 3rd rather than being empty — `created_at` is a full
 * timestamp, and a bare date would only ever match midnight.
 */
function toIso(value: string, endOfDay = false): string | undefined {
  const date = normalizeDate(value);
  if (!date) return undefined;
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
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
            <DateField
              label="From"
              value={asDate(value.start)}
              placeholder={asDate(state?.window_start) || 'YYYY-MM-DD'}
              disabled={disabled}
              onChange={(next) => onChange({ ...value, start: toIso(next) })}
            />
            <DateField
              label="To"
              value={asDate(value.end)}
              placeholder="now"
              disabled={disabled}
              onChange={(next) => onChange({ ...value, end: toIso(next, true) })}
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
  reset: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
});
