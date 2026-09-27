import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { DateField } from '../ui/date-field';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { nextWindowStart, resumeMatches, type UpdateState } from '@/lib/archive/types';
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
 * ## When nothing has been refreshed yet
 *
 * An archive built before refresh tracking has no watermark for that kind of
 * pass — and they are **per kind**, so refreshing posts leaves comments with
 * none. The window then falls back to the same month-back default, shown in the
 * box and editable like any other.
 *
 * Defaulting it is safe, which is not obvious. The worry would be that a guessed
 * start declares everything before it current — but the watermark a finished run
 * records is `now - 1 month` **regardless of the window it covered**, so the
 * start date never becomes a claim about history. The rolling window reaches a
 * month back whatever happens; deeper history is what the full re-scrape is for.
 */
export interface UpdateChoice {
  enabled: boolean;
  start?: string;
  end?: string;
}

/**
 * Resolves the controls into the window a run should cover.
 *
 * Falls back to a month back when nothing has been recorded, so a refresh always
 * has somewhere sensible to start rather than refusing.
 */
export function resolveWindow(
  choice: UpdateChoice,
  state: UpdateState | undefined,
): { start: string; end: string; openEnd: boolean } | undefined {
  // `enabled` is authoritative: a start date left over from a full re-scrape
  // must not resurrect a refresh the box says is off. The UI keeps the two in
  // step by forcing `enabled` on whenever it sets a whole-archive start.
  if (!choice.enabled) return undefined;
  return {
    start: choice.start || state?.window_start || nextWindowStart(),
    end: choice.end || new Date().toISOString(),
    // "Now" is a moving target, so it cannot be part of a window's identity —
    // two sessions of the same window must still recognise each other.
    openEnd: !choice.end,
  };
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
  earliest,
  scopeName,
  onCheckDeletions,
  disabled,
}: {
  kind: 'posts' | 'comments';
  value: UpdateChoice;
  onChange: (next: UpdateChoice) => void;
  /** The watermark for the selected community, if one has been recorded. */
  state: UpdateState | undefined;
  /** Oldest post held, so "everything" is an offerable window. */
  earliest?: string;
  /** Which community the shown window belongs to. */
  scopeName?: string;
  /** Checks the last finished window for posts Yik Yak no longer serves. */
  onCheckDeletions?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  const resolved = resolveWindow(value, state);
  const everything = Boolean(earliest && value.start === earliest);
  const noun = kind === 'posts' ? 'posts' : 'threads';

  /*
    The From box shows the window that will actually run — `<input type="date">`
    ignores placeholders, so anything left to one renders `mm/dd/yyyy` and the
    default looks absent.
  */
  const defaultStart = state?.window_start ?? nextWindowStart();
  const custom =
    Boolean(value.end) || Boolean(value.start && asDate(value.start) !== asDate(defaultStart));

  // A saved position only applies to the window it was taken from.
  const resumable = resumeMatches(state?.resume, resolved);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {/*
        Re-scrape-everything **implies** re-reading, so with it ticked this one
        is forced on and locked rather than left as a control that cannot change
        anything. A checkbox you can click that does nothing is worse than one
        that is visibly not yours to set.
      */}
      <Check
        checked={value.enabled || everything}
        disabled={disabled || everything}
        label={`Re-read existing ${noun} first`}
        hint={
          kind === 'posts'
            ? 'Refreshes scores, reply counts and removals for everything already archived in the window.'
            : 'Re-reads threads already collected, picking up new replies and flagging ones that have been deleted.'
        }
        onPress={() => onChange({ ...value, enabled: !value.enabled })}
      />

      {earliest ? (
        <Check
          checked={everything}
          disabled={disabled}
          danger
          label={`Re-scrape everything — back to ${asDate(earliest)}`}
          hint={
            everything
              ? 'Days of requests. It saves its position, so it can be stopped and picked up.'
              : 'Ignores the window and re-reads the whole archive.'
          }
          // Derived from the dates rather than held as its own flag, so the two
          // cannot disagree: ticking widens the window, editing a date unticks.
          onPress={() =>
            onChange(
              everything ? { enabled: true } : { enabled: true, start: earliest, end: undefined },
            )
          }
        />
      ) : null}

      {value.enabled || everything ? (
        <>
          <ThemedText type="caption" themeColor="textSecondary">
            {scopeName ? `${scopeName}: ` : ''}Covering{' '}
            <ThemedText type="caption" style={{ color: theme.brand }}>
              {asDate(resolved?.start)} → {value.end ? asDate(value.end) : 'now'}
            </ThemedText>
            {everything
              ? ' · the whole archive'
              : state && !custom
                ? ` · the default: a month before your last refresh on ${asDate(
                    new Date(state.updated_at).toISOString(),
                  )}`
                : !state && !custom
                  ? ' · the default: the last month, since nothing has been refreshed yet'
                  : ' · custom range'}
          </ThemedText>

          <View style={styles.dates}>
            <DateField
              label="From"
              value={asDate(value.start ?? defaultStart)}
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
                accessibilityLabel="Use the default window"
                disabled={disabled}
                onPress={() => onChange({ enabled: true })}
                style={({ hovered }) => [styles.reset, hovered && { opacity: 0.7 }]}>
                <ThemedText type="caption" themeColor="textTertiary">
                  Reset
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {resumable ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="caption" style={{ color: theme.brand }}>
                Paused part-way through this window.
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {state?.resume?.through
                  ? `Reached ${asDate(state.resume.through)}. `
                  : state?.resume?.offset !== undefined
                    ? `Reached thread ${state.resume.offset}. `
                    : ''}
                Starting again picks up from there rather than from the top — the saved position
                is kept until the window finishes. Changing either date discards it, since a
                position only means something for the range it was taken from.
              </ThemedText>
            </View>
          ) : null}
        </>
      ) : null}

      {/* About a run that already happened, so shown whatever is ticked now. */}
      {state?.last_window_start ? (
        <View style={styles.lastRow}>
          <ThemedText type="caption" themeColor="textTertiary" style={styles.lastText}>
            Last refresh covered {asDate(state.last_window_start)} →{' '}
            {asDate(state.last_window_end)}.
          </ThemedText>
          {onCheckDeletions ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check that window for deleted posts"
              disabled={disabled}
              onPress={onCheckDeletions}
              style={({ hovered }) => [
                styles.reset,
                { borderColor: theme.border },
                hovered && !disabled ? { opacity: 0.7 } : null,
                disabled ? { opacity: 0.5 } : null,
              ]}>
              <ThemedText type="caption" style={{ color: theme.brand }}>
                Check it for deleted posts
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One checkbox row, so both read at the same weight. */
function Check({
  checked,
  disabled,
  label,
  hint,
  danger,
  onPress,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tint = danger ? theme.danger : theme.brand;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }) => [
        styles.checkRow,
        hovered && !disabled ? { opacity: 0.85 } : null,
        disabled ? { opacity: 0.6 } : null,
      ]}>
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={18}
        color={checked ? tint : theme.textTertiary}
      />
      <View style={styles.checkText}>
        <ThemedText type="smallBold" style={checked && danger ? { color: tint } : undefined}>
          {label}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
    </Pressable>
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
  lastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  lastText: {
    flexShrink: 1,
  },
});
