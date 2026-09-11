import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { CrawlProgress } from '@/lib/archive/crawler';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/lib/clock';
import { formatCount } from '@/lib/time';

/** A crawl reports per page, so a second is the finest granularity worth showing. */
const TICK = 1000;

const DAY_MS = 1000 * 60 * 60 * 24;

function duration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function day(iso?: string) {
  return iso ? iso.slice(0, 10) : '—';
}

/**
 * Live read-out for a running backfill.
 *
 * A crawl is a long, mostly invisible process against someone else's server, so
 * the panel is deliberately verbose: the useful question during one is rarely
 * "how many posts" but "is it still getting anywhere, and how fast". Rates, the
 * date range being walked, and the idle counter answer that; a single total does
 * not.
 *
 * Run figures and lifetime figures are kept visibly apart. Mixing them is what
 * previously made a stalled run look productive — the page count carried over
 * from earlier runs while the duplicate count did not.
 */
export function CrawlMonitor({
  progress,
  groupName,
  stopped,
}: {
  progress: CrawlProgress;
  groupName?: string;
  stopped?: boolean;
}) {
  const theme = useTheme();
  // Drives the elapsed clock and the idle timer between pages.
  const now = useNow(TICK);

  const { run } = progress;
  const elapsed = Math.max(0, now - run.startedAt);
  const minutes = elapsed / 60_000;
  const pagesPerMin = minutes > 0.05 ? run.pages / minutes : 0;
  const postsPerMin = minutes > 0.05 ? (run.archived + run.duplicates) / minutes : 0;

  // Silence between pages is the clearest early signal of a stall — clearer than
  // any counter, because it moves every second.
  const sinceLastPage = run.lastPageAt ? now - run.lastPageAt : undefined;

  /*
    Span walked, as a share of the distance to the target.

    Only meaningful while heading toward already-archived ground; past it there
    is no known floor to measure against, so the bar gives way to a plain "into
    new history" state rather than inventing a denominator.
  */
  const span =
    run.newestReached && run.oldestReached
      ? new Date(run.newestReached).getTime() - new Date(run.oldestReached).getTime()
      : 0;
  const toTarget =
    progress.target && run.newestReached
      ? new Date(run.newestReached).getTime() - new Date(progress.target).getTime()
      : 0;
  const fraction =
    !progress.intoNewHistory && toTarget > 0 ? Math.min(1, Math.max(0, span / toTarget)) : 1;

  const status = stopped
    ? 'Stopped'
    : progress.finished
      ? 'Finished'
      : progress.error
        ? 'Retrying'
        : progress.recovering
          ? 'Waiting it out'
          : progress.phase === 'catching-up'
            ? 'Catching up on new posts'
            : 'Backfilling history';

  const live = !stopped && !progress.finished;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.headerRow}>
        {live ? <View style={[styles.pulse, { backgroundColor: theme.brand }]} /> : null}
        <ThemedText type="smallBold" style={styles.headerText} numberOfLines={1}>
          {groupName ?? 'Crawl'} — {status}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {duration(elapsed)}
        </ThemedText>
      </View>

      {/* Distance covered toward already-archived ground. */}
      {progress.target && !progress.finished ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(fraction * 100)}%`,
                backgroundColor: progress.intoNewHistory ? theme.brand : theme.brandMuted,
              },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.grid}>
        <Metric label="Pages" value={formatCount(run.pages)} hint="this run" />
        <Metric label="New" value={formatCount(run.archived)} hint="never seen before" accent />
        <Metric label="Re-seen" value={formatCount(run.duplicates)} hint="already held" />
        <Metric label="With media" value={formatCount(run.withMedia)} hint="flagged" />
        <Metric
          label="Pages/min"
          value={pagesPerMin > 0 ? pagesPerMin.toFixed(1) : '—'}
          hint={`~${Math.round(progress.nextDelayMs / 100) / 10}s apart`}
        />
        <Metric
          label="Posts/min"
          value={postsPerMin > 0 ? Math.round(postsPerMin).toString() : '—'}
          hint="seen, not saved"
        />
        <Metric
          label="Requests"
          value={formatCount(run.requests)}
          hint={run.errors > 0 ? `${run.errors} retried` : 'no errors'}
        />
        <Metric
          label="Idle pages"
          value={String(progress.idlePages)}
          hint={progress.idlePages > 0 ? 'no progress' : 'moving'}
          warn={progress.idlePages >= 5}
        />
      </View>

      <View style={[styles.rangeRow, { borderTopColor: theme.border }]}>
        <Row
          icon="calendar-outline"
          label="Walked"
          value={`${day(run.newestReached)} → ${day(run.oldestReached)}`}
          hint={span > 0 ? `${(span / DAY_MS).toFixed(1)} days` : undefined}
        />
        {progress.target ? (
          <Row
            icon="flag-outline"
            label="Target"
            value={day(progress.target)}
            hint={
              progress.intoNewHistory
                ? 'passed — into new history'
                : 'oldest already archived'
            }
            accent={progress.intoNewHistory}
          />
        ) : null}
        <Row
          icon="server-outline"
          label="Archived total"
          value={`${formatCount(progress.total.archived)} posts`}
          hint={`${formatCount(progress.total.pages)} pages, all runs`}
        />
        {sinceLastPage !== undefined && live ? (
          <Row
            icon="time-outline"
            label="Last page"
            value={duration(sinceLastPage)}
            hint="ago"
            warn={sinceLastPage > 30_000}
          />
        ) : null}
        {progress.cursor ? (
          <Row icon="bookmark-outline" label="Cursor" value={progress.cursor} mono />
        ) : null}
      </View>
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

  function Row({
    icon,
    label,
    value,
    hint,
    accent,
    warn,
    mono,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    value: string;
    hint?: string;
    accent?: boolean;
    warn?: boolean;
    mono?: boolean;
  }) {
    return (
      <View style={styles.row}>
        <Ionicons name={icon} size={13} color={theme.textTertiary} />
        <ThemedText type="caption" themeColor="textTertiary" style={styles.rowLabel}>
          {label}
        </ThemedText>
        <ThemedText
          type={mono ? 'code' : 'caption'}
          numberOfLines={1}
          style={[
            styles.rowValue,
            { color: warn ? theme.danger : accent ? theme.brand : theme.text },
          ]}>
          {value}
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
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  progressFill: {
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
  rangeRow: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowLabel: {
    minWidth: 86,
  },
  rowValue: {
    flexShrink: 1,
  },
});
