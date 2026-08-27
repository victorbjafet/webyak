import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ThemedText } from '../themed-text';
import { DownloadButton } from './download-button';

import type { Asset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMediaMaxHeight } from '@/lib/media';

/**
 * Video posts are HLS (`.m3u8`). Safari plays them natively; Chrome and Firefox
 * need hls.js, which is imported lazily so Safari never downloads it and it
 * code-splits out of the main bundle.
 *
 * `preload` is set by the feed when the post is at or near the viewport, so the
 * manifest and first segments are already in flight by the time anyone presses
 * play. Attaching the stream does not start playback — `autoplay` is never set,
 * so this buffers quietly and stays paused.
 */
export function PostVideo({
  asset,
  preload = false,
  visible = false,
}: {
  asset: Asset;
  preload?: boolean;
  /** Strictly on-screen, unlike `preload` which includes the approach margin. */
  visible?: boolean;
}) {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attached, setAttached] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxHeight = useMediaMaxHeight();

  const src = asset.signed_url || asset.url || '';
  const poster = asset.thumbnail_asset?.url;
  const ratio = asset.width && asset.height ? asset.width / asset.height : 16 / 9;

  // Attach as soon as the feed says this post is near the viewport, or as soon
  // as someone presses play — whichever happens first.
  const shouldAttach = preload || playing;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !shouldAttach || !src || attached) return;

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
      setAttached(true);
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
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError('Playback failed.');
        });
        setAttached(true);
      } catch {
        if (!destroyed) setError('Could not load the video player.');
      }
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [shouldAttach, src, attached]);

  // Play only on an explicit press, never as a side effect of preloading.
  useEffect(() => {
    if (playing && attached) void videoRef.current?.play().catch(() => {});
  }, [playing, attached]);

  // Scrolling away pauses — audio continuing from a video nobody can see is the
  // most annoying thing a feed can do.
  //
  // This only touches the element, never component state: the video is an
  // external system, so pausing it here is exactly what an effect is for, and
  // setting state instead would cascade a render. `started` stays true, so the
  // native controls remain and scrolling back leaves it paused with a play
  // button rather than resuming audio unannounced.
  useEffect(() => {
    if (!visible) videoRef.current?.pause();
  }, [visible]);

  // Nudge the element to decode and paint frame one, so an attached-but-unplayed
  // video shows a still rather than a black box. The API's own thumbnail needs
  // the bearer token and is rendered behind this as the first choice; this is
  // the fallback when that fetch hasn't landed.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !attached || playing) return;
    const seekToFirstFrame = () => {
      if (el.currentTime === 0 && el.readyState >= 1) {
        try {
          el.currentTime = 0.05;
        } catch {
          /* seeking before metadata is ready throws; the listener retries */
        }
      }
    };
    el.addEventListener('loadeddata', seekToFirstFrame);
    seekToFirstFrame();
    return () => el.removeEventListener('loadeddata', seekToFirstFrame);
  }, [attached, playing]);

  if (!src) return null;

  return (
    <View
      style={[styles.frame, { aspectRatio: ratio, maxHeight, backgroundColor: theme.skeleton }]}>
      <video
        ref={videoRef}
        controls={playing}
        playsInline
        preload="none"
        // `contain`, not `cover`: the frame already matches the video's aspect
        // ratio so nothing changes inline, but fullscreen letterboxes a vertical
        // video instead of cropping its top and bottom off.
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />

      {!playing ? (
        <>
          {/*
            ⛔ The poster does not load in a browser, and cannot be made to.

            `/v1/assets?post_id=…` is a hard 401 unauthenticated (verified), so
            the bearer is required; but sending it forces a CORS preflight, the
            endpoint answers 302 to signed storage, and a preflighted request
            cannot follow a cross-origin redirect. Both routes are closed: no
            header means 401, header means a blocked redirect. It needs the
            worker's asset relay — docs/API.md#-video-thumbnails-need-the-worker.

            Left in place because it costs nothing and starts working the moment
            the relay exists. `fallback` is what actually renders today: a
            neutral panel, so a video reads as a video rather than a black hole.
          */}
          {!attached ? (
            <View style={styles.posterLayer} pointerEvents="none">
              <AuthedImage
                uri={poster}
                context="video-poster"
                style={styles.poster}
                contentFit="contain"
                fallback={
                  <View style={[styles.posterFallback, { backgroundColor: theme.skeleton }]}>
                    <Ionicons name="videocam" size={28} color={theme.textTertiary} />
                  </View>
                }
              />
            </View>
          ) : null}

          <Pressable
            onPress={() => setPlaying(true)}
            accessibilityRole="button"
            accessibilityLabel="Play video"
            style={styles.overlay}>
            <View style={[styles.playButton, { backgroundColor: theme.overlay }]}>
              <Ionicons name="play" size={26} color="#FFFFFF" />
            </View>
          </Pressable>
        </>
      ) : null}

      {error ? (
        <View style={[styles.overlay, { backgroundColor: theme.overlay }]} pointerEvents="none">
          <ThemedText type="small" style={{ color: '#FFFFFF' }}>
            {error}
          </ThemedText>
        </View>
      ) : null}

      <DownloadButton uri={src} filename={`webyak-${asset.id}.m3u8`} label="Download video" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  posterLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  posterFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: {
    width: '100%',
    height: '100%',
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
