import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { CommentCrawlProgress } from '@/lib/archive/crawler';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/lib/clock';
import { formatCount } from '@/lib/time';

const TICK = 1000;

function duration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Live read-out for the comment pass.
 *
 * The feed crawl's open question is "is it still getting anywhere". This job's
 * is different: the work is a **known, finite queue**, so the useful questions
 * are how much is left and how long that will take. Hence a real completion
 * percentage and an ETA — both of which the feed crawler deliberately refuses to
 * show, because there the denominator is unknown and inventing one would be a
 * made-up number.
 */
export function CommentMonitor({
  progress,
  scopeName,
}: {
  progress: CommentCrawlProgress;
  scopeName?: string;
}) {
  const theme = useTheme();
  const now = useNow(TICK);

  const elapsed = Math.max(0, now - progress.startedAt);
  const minutes = elapsed / 60_000;
  const threadsPerMin = minutes > 0.05 ? progress.threads / minutes : 0;
  const commentsPerThread =
    progress.threads > 0 ? (progress.archived + progress.duplicates) / progress.threads : 0;

  const done = progress.outstandingAtStart - progress.remaining;
  const fraction =
    progress.outstandingAtStart > 0
      ? Math.min(1, Math.max(0, done / progress.outstandingAtStart))
      : 0;

  // Projected from the rate actually achieved, not the configured delay — the
  // two diverge as soon as anything is retried.
  const etaMs = threadsPerMin > 0 ? (progress.remaining / threadsPerMin) * 60_000 : undefined;

  const sinceLast = progress.lastAt ? now - progress.lastAt : undefined;
  const live = !progress.finished;

  const status = progress.finished
    ? { done: 'Finished', stopped: 'Stopped', error: 'Stopped after an error' }[progress.finished]
    : progress.error
      ? 'Retrying'
      : 'Collecting threads';

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.headerRow}>
        {live ? <View style={[styles.pulse, { backgroundColor: theme.brand }]} /> : null}
        <ThemedText type="smallBold" style={styles.headerText} numberOfLines={1}>
          {scopeName ?? 'All communities'} — {status}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {duration(elapsed)}
        </ThemedText>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(fraction * 100)}%`, backgroundColor: theme.brand },
          ]}
        />
      </View>
      <ThemedText type="caption" themeColor="textTertiary">
        {formatCount(done)} of {formatCount(progress.outstandingAtStart)} threads ·{' '}
        {Math.round(fraction * 100)}%
        {etaMs !== undefined && live ? ` · ~${duration(etaMs)} left` : ''}
      </ThemedText>

      <View style={styles.grid}>
        <Metric label="Threads" value={formatCount(progress.threads)} hint="fetched" />
        <Metric
          label="New comments"
          value={formatCount(progress.archived)}
          hint="never seen"
          accent
        />
        <Metric label="Re-seen" value={formatCount(progress.duplicates)} hint="already held" />
        <Metric
          label="Per thread"
          value={commentsPerThread > 0 ? commentsPerThread.toFixed(1) : '—'}
          hint="comments"
        />
        <Metric
          label="Threads/min"
          value={threadsPerMin > 0 ? threadsPerMin.toFixed(1) : '—'}
          hint="actual rate"
        />
        <Metric
          label="Remaining"
          value={formatCount(progress.remaining)}
          hint="still flagged"
        />
        <Metric
          label="Empty"
          value={formatCount(progress.empty)}
          hint="claimed replies, had none"
          warn={progress.empty > progress.threads * 0.5 && progress.threads > 20}
        />
        <Metric
          label="Errors"
          value={formatCount(progress.errors)}
          hint={progress.errors > 0 ? 'skipped, retried later' : 'none'}
          warn={progress.errors > 0}
        />
      </View>

      {sinceLast !== undefined && live ? (
        <View style={styles.row}>
          <Ionicons name="time-outline" size={13} color={theme.textTertiary} />
          <ThemedText
            type="caption"
            style={{ color: sinceLast > 20_000 ? theme.danger : theme.textTertiary }}>
            Last thread {duration(sinceLast)} ago
          </ThemedText>
        </View>
      ) : null}

      {progress.error ? (
        <ThemedText type="caption" style={{ color: theme.danger }}>
          {progress.error}
        </ThemedText>
      ) : null}

      {progress.finished === 'done' ? (
        <ThemedText type="caption" style={{ color: theme.brand }}>
          Every flagged post has had its thread collected.
        </ThemedText>
      ) : progress.finished === 'stopped' ? (
        <ThemedText type="caption" themeColor="textTertiary">
          Stopped. Nothing is lost — the remaining posts stay flagged and a later run picks them
          straight back up.
        </ThemedText>
      ) : null}
    </View>
  );

  function Metric({
    label,
    value,
    hint,
    accent,
    warn,
  }: {
    label: string;
    value: string;
    hint?: string;
    accent?: boolean;
    warn?: boolean;
  }) {
    return (
      <View style={[styles.metric, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText
          type="bodyBold"
          style={{ color: warn ? theme.danger : accent ? theme.brand : theme.text }}>
          {value}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  fill: {
    height: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  metric: {
    flexGrow: 1,
    flexBasis: 88,
    minWidth: 88,
    gap: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
