import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '../themed-text';
import { DateField } from '../ui/date-field';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  bucketEnd,
  bucketLabel,
  chooseUnit,
  niceCeiling,
  type DensityResult,
} from '@/lib/archive/density';
import { isEmptyQuery, parseQuery } from '@/lib/archive/query';
import { countDensity, getArchiveStats } from '@/lib/archive/store';
import { formatCount } from '@/lib/time';

/**
 * How the archive's posts spread over time, for the current search.
 *
 * ## Counted on request, not on every keystroke
 *
 * Every record in the range is read, because the baseline (everything of the
 * same kind, `density.ts`) has no index to narrow it. Over a whole archive
 * that takes seconds. So edits to the search only mark the chart out of date,
 * and **Refresh** recounts. The chart's own range controls recount straight
 * away: picking dates or zooming into a column is a deliberate act, and the
 * date field only reports complete dates.
 *
 * ## One series, two scales
 *
 * **Count** is the matching records per bucket, scaled to the matches
 * themselves. **% of all** is their share of the baseline. Both on one chart,
 * the matches drawn inside the baseline, would leave a rare word a sliver at
 * the bottom of every column: invisible exactly when it is worth seeing. The
 * baseline's own numbers are in the readout and the table instead.
 */

const PLOT_HEIGHT = 140;
const Y_AXIS_WIDTH = 40;
/** Narrowest column worth drawing: a 2px gap still leaves a visible bar. */
const MIN_SLOT = 6;
const MAX_BAR = 24;

type Mode = 'count' | 'share';

/** What a count was asked for: the search as typed, and the chart's own range. */
interface Request {
  input: string;
  from: string;
  to: string;
  /** Lets Refresh recount an unchanged request, after a crawl for instance. */
  nonce: number;
}

function full(n: number): string {
  return n.toLocaleString('en-US');
}

/** Axis ticks in full under 10,000, compact above. */
function tick(n: number): string {
  return n < 10_000 ? full(n) : formatCount(n);
}

function percent(share: number): string {
  const value = share * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function DensityChart({ input }: { input: string }) {
  const theme = useTheme();

  const [range, setRange] = useState({ from: '', to: '' });
  const [request, setRequest] = useState<Request>(() => ({ input, from: '', to: '', nonce: 0 }));
  const [mode, setMode] = useState<Mode>('count');
  const [result, setResult] = useState<DensityResult | null>(null);
  const [countedInput, setCountedInput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [oldest, setOldest] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);

  // Read at count time, not a reason to recount: resizing keeps the columns.
  const widthRef = useRef(0);
  // Each count takes a number; an older one stops at its next batch.
  const runRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void getArchiveStats()
      .then((stats) => {
        if (!cancelled) setOldest(stats.oldest ?? new Date().toISOString());
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read the archive.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = useCallback(
    async (next: Request, archiveStart: string) => {
      const run = ++runRef.current;
      const start = next.from ? `${next.from}T00:00:00.000Z` : archiveStart;
      // All time runs to today, not to the newest record: a stretch nothing was
      // archived in is exactly what the chart should show.
      const end = next.to ? `${next.to}T23:59:59.999Z` : new Date().toISOString();
      if (start > end) {
        setError('From is after To.');
        return;
      }
      const slots = widthRef.current > 0 ? Math.floor(widthRef.current / MIN_SLOT) : 60;
      const unit = chooseUnit(start, end, Math.min(120, Math.max(12, slots)));

      setRunning(true);
      setScanned(0);
      setError(null);
      try {
        const counted = await countDensity(parseQuery(next.input), { start, end }, unit, {
          onProgress: (n) => {
            if (run === runRef.current) setScanned(n);
          },
          shouldStop: () => run !== runRef.current,
        });
        if (counted && run === runRef.current) {
          setResult(counted);
          setCountedInput(next.input);
          setPinned(null);
          setHovered(null);
        }
      } catch (e) {
        if (run === runRef.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (run === runRef.current) setRunning(false);
      }
    },
    [],
  );

  // Debounced, so stepping through dates doesn't start a count per step.
  useEffect(() => {
    if (!oldest) return;
    const handle = setTimeout(() => void count(request, oldest), 250);
    return () => clearTimeout(handle);
  }, [request, oldest, count]);

  // Leaving the screen stops a count in progress.
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const ask = (from: string, to: string) => {
    setRange({ from, to });
    setRequest({ input, from, to, nonce: Date.now() });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    widthRef.current = event.nativeEvent.layout.width;
    setPlotWidth(event.nativeEvent.layout.width);
  };

  const stale = countedInput !== null && countedInput !== input;
  const counted = countedInput !== null ? parseQuery(countedInput) : null;
  // With nothing searched, every record matches and the share is always 100%.
  const everything = counted ? isEmptyQuery(counted) : true;
  const shown: Mode = everything ? 'count' : mode;

  const buckets = result?.buckets ?? [];
  const value = (i: number) => {
    const bucket = buckets[i];
    if (!bucket) return 0;
    return shown === 'share' ? (bucket.all > 0 ? bucket.matching / bucket.all : 0) : bucket.matching;
  };
  const peak = buckets.reduce((max, _, i) => Math.max(max, value(i)), 0);
  // Share is scaled in percent so its ticks land on clean numbers too.
  const top =
    shown === 'share' ? Math.min(100, niceCeiling(peak * 100)) / 100 : niceCeiling(peak);
  const label = (v: number) => (shown === 'share' ? percent(v) : tick(v));

  const slot = buckets.length > 0 ? plotWidth / buckets.length : 0;
  const gap = slot >= MIN_SLOT ? 2 : slot >= 3 ? 1 : 0;
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - gap));
  const radius = Math.min(4, barWidth / 2);

  const active = hovered ?? pinned;
  const activeBucket = active !== null ? buckets[active] : undefined;
  const unit = result?.unit;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {/* The controls scope the chart, so they sit in one row above it. */}
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !range.from && !range.to }}
          onPress={() => ask('', '')}
          style={({ hovered: over }) => [
            styles.chip,
            {
              backgroundColor: !range.from && !range.to ? theme.brandMuted : theme.control,
              borderColor: !range.from && !range.to ? theme.brand : 'transparent',
            },
            over && { opacity: 0.85 },
          ]}>
          <ThemedText
            type="caption"
            style={{ color: !range.from && !range.to ? theme.brand : theme.controlText }}>
            All time
          </ThemedText>
        </Pressable>
        <View style={styles.dates}>
          <DateField label="From" value={range.from} onChange={(next) => ask(next, range.to)} />
          <DateField
            label="To"
            value={range.to}
            placeholder="today"
            onChange={(next) => ask(range.from, next)}
          />
        </View>
      </View>

      <View style={styles.controls}>
        <View style={[styles.segment, { backgroundColor: theme.control }]}>
          {(
            [
              { value: 'count', label: 'Count' },
              { value: 'share', label: '% of all' },
            ] as const
          ).map((option) => {
            const selected = shown === option.value;
            const disabled = option.value === 'share' && everything;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => setMode(option.value)}
                style={({ hovered: over }) => [
                  styles.segmentItem,
                  selected && { backgroundColor: theme.backgroundSelected },
                  !selected && over ? { backgroundColor: theme.controlHover } : null,
                  disabled && { opacity: 0.4 },
                ]}>
                <ThemedText
                  type="caption"
                  style={{ color: selected ? theme.brand : theme.controlText }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recount the chart for the current search"
          disabled={running || !oldest}
          onPress={() => setRequest({ input, from: range.from, to: range.to, nonce: Date.now() })}
          style={({ hovered: over }) => [
            styles.chip,
            {
              backgroundColor: stale ? theme.brand : theme.control,
              borderColor: 'transparent',
            },
            over && { opacity: 0.85 },
            (running || !oldest) && { opacity: 0.5 },
          ]}>
          <Ionicons name="refresh" size={13} color={stale ? theme.onBrand : theme.controlText} />
          <ThemedText type="caption" style={{ color: stale ? theme.onBrand : theme.controlText }}>
            Refresh
          </ThemedText>
        </Pressable>
      </View>

      {stale ? (
        <ThemedText type="caption" style={{ color: theme.brand }}>
          The search has changed since this was counted. Refresh to count it again.
        </ThemedText>
      ) : null}

      {/* The readout: the hovered or tapped column, or the whole range. */}
      {result ? (
        <View style={styles.readout}>
          <ThemedText type="small" style={styles.readoutText}>
            {activeBucket && unit ? (
              <>
                <ThemedText type="smallBold">
                  {everything
                    ? full(activeBucket.all)
                    : `${full(activeBucket.matching)} of ${full(activeBucket.all)}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {' '}
                  {result.baseline}
                  {everything || activeBucket.all === 0
                    ? ''
                    : ` · ${percent(activeBucket.matching / activeBucket.all)}`}
                  {' · '}
                  {bucketLabel(activeBucket.key, unit)}
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="smallBold">
                  {everything ? full(result.all) : `${full(result.matching)} of ${full(result.all)}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {' '}
                  {result.baseline}
                  {everything || result.all === 0 ? '' : ` · ${percent(result.matching / result.all)}`}
                  {' · per '}
                  {result.unit}
                </ThemedText>
              </>
            )}
          </ThemedText>
          {activeBucket && unit && unit !== 'day' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Zoom to ${bucketLabel(activeBucket.key, unit)}`}
              onPress={() => ask(activeBucket.key, bucketEnd(activeBucket.key, unit))}
              style={({ hovered: over }) => [styles.zoom, over && { opacity: 0.7 }]}>
              <Ionicons name="search-outline" size={13} color={theme.brand} />
              <ThemedText type="caption" style={{ color: theme.brand }}>
                Zoom in
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.plotRow, running && result ? { opacity: 0.5 } : null]}>
        <View style={[styles.yAxis, { height: PLOT_HEIGHT }]}>
          {result ? (
            <>
              <ThemedText type="caption" themeColor="textTertiary" style={styles.tick}>
                {label(top)}
              </ThemedText>
              <ThemedText type="caption" themeColor="textTertiary" style={styles.tick}>
                {label(top / 2)}
              </ThemedText>
              <ThemedText type="caption" themeColor="textTertiary" style={styles.tick}>
                {label(0)}
              </ThemedText>
            </>
          ) : null}
        </View>

        <View style={[styles.plot, { height: PLOT_HEIGHT }]} onLayout={onLayout}>
          {/* Hairline gridlines at the ticks, recessive. */}
          {[0, 0.5, 1].map((at) => (
            <View
              key={at}
              pointerEvents="none"
              style={[styles.grid, { top: at * (PLOT_HEIGHT - 1), backgroundColor: theme.border }]}
            />
          ))}

          {result ? (
            <View style={styles.columns}>
              {buckets.map((bucket, i) => {
                const v = value(i);
                // A non-empty bucket never draws as nothing: telling 0 from 1 is
                // the point when looking for gaps.
                const height = v > 0 ? Math.max(1, (v / top) * PLOT_HEIGHT) : 0;
                const isActive = active === i;
                return (
                  <Pressable
                    key={bucket.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${bucketLabel(bucket.key, result.unit)}: ${
                      everything ? full(bucket.all) : `${full(bucket.matching)} of ${full(bucket.all)}`
                    }`}
                    onHoverIn={() => setHovered(i)}
                    onHoverOut={() => setHovered((current) => (current === i ? null : current))}
                    onPress={() => setPinned((current) => (current === i ? null : i))}
                    style={[
                      styles.column,
                      isActive && { backgroundColor: theme.backgroundHover },
                    ]}>
                    <View
                      style={{
                        width: barWidth,
                        height,
                        backgroundColor: theme.brand,
                        borderTopLeftRadius: radius,
                        borderTopRightRadius: radius,
                        opacity: active === null || isActive ? 1 : 0.55,
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.placeholder}>
              <ThemedText type="caption" themeColor="textTertiary">
                {error ?? (running ? 'Counting…' : '')}
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      {result && unit && buckets.length > 0 ? (
        <View style={[styles.xAxis, { marginLeft: Y_AXIS_WIDTH }]}>
          <ThemedText type="caption" themeColor="textTertiary">
            {bucketLabel(buckets[0].key, unit, true)}
          </ThemedText>
          {buckets.length > 2 ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {bucketLabel(buckets[Math.floor(buckets.length / 2)].key, unit, true)}
            </ThemedText>
          ) : null}
          <ThemedText type="caption" themeColor="textTertiary">
            {bucketLabel(buckets[buckets.length - 1].key, unit, true)}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.footer}>
        <ThemedText type="caption" themeColor="textTertiary" style={styles.footerText}>
          {running
            ? `Counting… ${formatCount(scanned)} records read`
            : error && result
              ? error
              : result
                ? `${formatCount(result.scanned)} records read in ${seconds(result.ms)}`
                : ''}
        </ThemedText>
        {result ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showTable }}
            onPress={() => setShowTable((v) => !v)}
            style={({ hovered: over }) => [styles.zoom, over && { opacity: 0.7 }]}>
            <Ionicons name="list-outline" size={13} color={theme.textTertiary} />
            <ThemedText type="caption" themeColor="textTertiary">
              {showTable ? 'Hide table' : 'Table'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {/* Every value without hovering, and the fallback for anyone the bars don't serve. */}
      {showTable && result && unit ? (
        <ScrollView style={[styles.table, { borderColor: theme.border }]} nestedScrollEnabled>
          {buckets.map((bucket) => (
            <View key={bucket.key} style={[styles.tableRow, { borderColor: theme.border }]}>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.tableLabel}>
                {bucketLabel(bucket.key, unit)}
              </ThemedText>
              <ThemedText type="caption" style={styles.tableNumber}>
                {everything ? full(bucket.all) : `${full(bucket.matching)} / ${full(bucket.all)}`}
              </ThemedText>
              {everything ? null : (
                <ThemedText type="caption" themeColor="textTertiary" style={styles.tableShare}>
                  {bucket.all > 0 ? percent(bucket.matching / bucket.all) : '—'}
                </ThemedText>
              )}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.two,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  dates: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexGrow: 1,
    flexBasis: 240,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  segment: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.pill,
    gap: Spacing.half,
  },
  segmentItem: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    minHeight: 22,
  },
  readoutText: {
    flexShrink: 1,
  },
  zoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  plotRow: {
    flexDirection: 'row',
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    justifyContent: 'space-between',
    paddingRight: Spacing.one,
  },
  tick: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
    marginVertical: -6,
  },
  plot: {
    flex: 1,
    minWidth: 0,
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  columns: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  footerText: {
    flex: 1,
  },
  table: {
    maxHeight: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableLabel: {
    flex: 1,
  },
  tableNumber: {
    fontVariant: ['tabular-nums'],
  },
  tableShare: {
    width: 48,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
