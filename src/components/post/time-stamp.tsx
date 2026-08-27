import { useState } from 'react';
import { Platform, Pressable } from 'react-native';

import { ThemedText } from '../themed-text';

import { useNow } from '@/lib/clock';
import { absoluteTime, preciseDelta, relativeTime } from '@/lib/time';

/**
 * Post age, live.
 *
 * Both views tick, at the granularity they actually display: the collapsed
 * relative age reads in minutes so 30s is plenty, while the expanded view shows
 * seconds and would look broken frozen. The timers are shared across every
 * timestamp on screen — see src/lib/clock.ts.
 */
const COLLAPSED_TICK = 30_000;
const EXPANDED_TICK = 1_000;

export function TimeStamp({ iso, type = 'small' }: { iso: string; type?: 'small' | 'caption' }) {
  const [expanded, setExpanded] = useState(false);
  const now = useNow(expanded ? EXPANDED_TICK : COLLAPSED_TICK);

  const detail = `${absoluteTime(iso)} · ${preciseDelta(iso, now)} ago`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail}
      accessibilityHint="Shows the exact time this was posted"
      onPress={() => setExpanded((v) => !v)}
      {...(Platform.OS === 'web' ? { title: detail } : null)}>
      <ThemedText type={type} themeColor="textTertiary" numberOfLines={1}>
        {expanded ? detail : relativeTime(iso, now)}
      </ThemedText>
    </Pressable>
  );
}
