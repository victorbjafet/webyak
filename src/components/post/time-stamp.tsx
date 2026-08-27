import { useState } from 'react';
import { Platform, Pressable } from 'react-native';

import { ThemedText } from '../themed-text';

import { absoluteTime, preciseDelta, relativeTime } from '@/lib/time';

/**
 * Post age. Tap (or click) to swap to the exact timestamp and a
 * down-to-the-second delta; on web the same detail is also a native tooltip on
 * hover, so it's available without changing the layout.
 */
export function TimeStamp({ iso, type = 'small' }: { iso: string; type?: 'small' | 'caption' }) {
  const [expanded, setExpanded] = useState(false);
  const detail = `${absoluteTime(iso)} · ${preciseDelta(iso)} ago`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail}
      accessibilityHint="Shows the exact time this was posted"
      onPress={() => setExpanded((v) => !v)}
      // react-native-web forwards `title` to the DOM node, giving a real tooltip.
      {...(Platform.OS === 'web' ? { title: detail } : null)}>
      <ThemedText type={type} themeColor="textTertiary" numberOfLines={1}>
        {expanded ? detail : relativeTime(iso)}
      </ThemedText>
    </Pressable>
  );
}
