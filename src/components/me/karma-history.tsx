import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { useSession } from '@/api/session';
import type { KarmaSnapshot } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type KarmaSample, useKarmaHistory } from '@/lib/karma-history';
import { absoluteTime, formatCount } from '@/lib/time';

/**
 * This season's and this quarter's karma, from the same `getUpdates()` as the
 * total. Current values only: the server keeps no history of either.
 */
export function KarmaPeriods({ karma }: { karma: KarmaSnapshot | undefined }) {
  const season = karma?.season;
  const total = (k: { post?: number; comment?: number } | undefined) =>
    k && (typeof k.post === 'number' || typeof k.comment === 'number')
      ? (k.post ?? 0) + (k.comment ?? 0)
      : null;
  const seasonal = total(karma?.seasonal);
  const quarterly = total(karma?.quarterly);
  if (seasonal === null && quarterly === null) return null;

  const name = [
    season?.season ? season.season[0].toUpperCase() + season.season.slice(1) : null,
    season?.year ?? null,
  ]
    .filter(Boolean)
    .join(' ');
  const left =
    typeof season?.remaining_days === 'number'
      ? `${season.remaining_days} day${season.remaining_days === 1 ? '' : 's'} left`
      : null;

  return (
    <View style={styles.periods}>
      {seasonal !== null ? (
        <Period
          label={name ? `This season · ${name}` : 'This season'}
          value={seasonal}
          note={left}
        />
      ) : null}
      {quarterly !== null ? <Period label="This quarter" value={quarterly} /> : null}
    </View>
  );
}

function Period({ label, value, note }: { label: string; value: number; note?: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.period, { backgroundColor: theme.control }]}>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText type="bodyBold">{formatCount(value)}</ThemedText>
      {note ? (
        <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

const PLOT_HEIGHT = 72;
/** Dot radius: 8px markers. */
const R = 4;
/** Hit target around each dot, bigger than the mark. */
const HIT = 20;
/** Past this many samples, points are thinned evenly (the last is always kept). */
const MAX_POINTS = 160;

function thin(samples: KarmaSample[]): KarmaSample[] {
  if (samples.length <= MAX_POINTS) return samples;
  const step = samples.length / (MAX_POINTS - 1);
  const out: KarmaSample[] = [];
  for (let i = 0; i < MAX_POINTS - 1; i++) out.push(samples[Math.floor(i * step)]);
  out.push(samples[samples.length - 1]);
  return out;
}

const totalOf = (s: KarmaSample) => s.post + s.comment;

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Total karma over time, as sampled on this device (B5).
 *
 * **Points, not a line.** Samples are taken whenever webyak reads your karma,
 * so they are irregular, and nothing is known about the gaps between them. A
 * line would claim a path the data never saw (PLAN B5's note on sampling). One
 * series, so no legend: the card's title names it. The readout above the plot
 * shows the first and last values, or the hovered point's, with its time.
 */
export function KarmaHistory() {
  const theme = useTheme();
  const { userId } = useSession();
  const samples = useKarmaHistory(userId);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (samples.length === 0) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];

  if (samples.length === 1) {
    return (
      <ThemedText type="caption" themeColor="textTertiary">
        {`Karma history starts ${shortDate(first.at)}. webyak keeps a point each time it reads your karma on this device, and the chart appears once there are two.`}
      </ThemedText>
    );
  }

  const points = thin(samples);
  const t0 = Date.parse(first.at);
  const t1 = Date.parse(last.at);
  const values = points.map(totalOf);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (s: KarmaSample) =>
    t1 === t0 ? width / 2 : R + ((Date.parse(s.at) - t0) / (t1 - t0)) * Math.max(0, width - 2 * R);
  const y = (v: number) =>
    max === min ? PLOT_HEIGHT / 2 : R + (1 - (v - min) / (max - min)) * (PLOT_HEIGHT - 2 * R);

  const shown = active !== null ? points[active] : null;
  const change = totalOf(last) - totalOf(first);

  return (
    <View
      style={styles.history}
      accessible
      accessibilityLabel={`Karma history on this device: ${samples.length} samples from ${shortDate(first.at)} to ${shortDate(last.at)}, from ${totalOf(first)} to ${totalOf(last)}.`}>
      <View style={styles.readout}>
        <ThemedText type="smallBold">
          {shown
            ? formatCount(totalOf(shown))
            : `${formatCount(totalOf(first))} → ${formatCount(totalOf(last))}`}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {shown
            ? absoluteTime(shown.at)
            : `${change >= 0 ? '+' : '−'}${formatCount(Math.abs(change))} since ${shortDate(first.at)}`}
        </ThemedText>
      </View>

      <View
        style={[styles.plot, { borderBottomColor: theme.border }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0
          ? points.map((sample, index) => (
              <Pressable
                key={sample.at}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onHoverIn={() => setActive(index)}
                onHoverOut={() => setActive((current) => (current === index ? null : current))}
                onPress={() => setActive((current) => (current === index ? null : index))}
                style={[
                  styles.hit,
                  { left: x(sample) - HIT / 2, top: y(totalOf(sample)) - HIT / 2 },
                ]}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: theme.brand,
                      borderColor: theme.backgroundElement,
                      transform: [{ scale: index === active ? 1.4 : 1 }],
                    },
                  ]}
                />
              </Pressable>
            ))
          : null}
      </View>

      <View style={styles.axis}>
        <ThemedText type="caption" themeColor="textTertiary">
          {shortDate(first.at)}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          Sampled on this device
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {shortDate(last.at)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  periods: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  period: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  history: {
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  plot: {
    height: PLOT_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hit: {
    position: 'absolute',
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 2 * R + 4,
    height: 2 * R + 4,
    borderRadius: R + 2,
    borderWidth: 2,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
