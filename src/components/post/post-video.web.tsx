import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { Asset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Video posts are served as **HLS** (`.m3u8`) — confirmed from offsides, which
 * passes `type: 'm3u8'` to react-native-video.
 *
 * Safari plays HLS natively; Chrome and Firefox do not, which is why video
 * "didn't work at all" on web. hls.js is loaded lazily, and only when the
 * browser can't handle the stream itself, so Safari never pays for it.
 */
export function PostVideo({ asset }: { asset: Asset }) {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = asset.signed_url || asset.url || '';
  const poster = asset.thumbnail_asset?.url;
  const ratio = asset.width && asset.height ? asset.width / asset.height : 16 / 9;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !started || !src) return;

    // Safari (and iOS webviews) report native HLS support here.
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
      void el.play().catch(() => {});
      return;
    }

    let destroyed = false;
    let hls: { destroy(): void } | null = null;

    void (async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (destroyed) return;
        if (!Hls.isSupported()) {
          setError('This browser cannot play this video.');
          return;
        }
        const instance = new Hls({ enableWorker: true });
        hls = instance;
        instance.loadSource(src);
        instance.attachMedia(el);
        instance.on(Hls.Events.MANIFEST_PARSED, () => void el.play().catch(() => {}));
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError('Playback failed.');
        });
      } catch {
        if (!destroyed) setError('Could not load the video player.');
      }
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [started, src]);

  if (!src) return null;

  return (
    <View
      style={[styles.frame, { aspectRatio: ratio, backgroundColor: theme.skeleton }]}
      // @ts-expect-error web-only DOM attribute passthrough
      dataSet={{ kind: 'video' }}>
      <video
        ref={videoRef}
        poster={poster}
        controls={started}
        playsInline
        preload="none"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {!started ? (
        <Pressable
          onPress={() => setStarted(true)}
          accessibilityRole="button"
          accessibilityLabel="Play video"
          style={styles.overlay}>
          <View style={[styles.playButton, { backgroundColor: theme.overlay }]}>
            <Ionicons name="play" size={26} color="#FFFFFF" />
          </View>
        </Pressable>
      ) : null}

      {error ? (
        <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
          <ThemedText type="small" style={{ color: '#FFFFFF' }}>
            {error}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
