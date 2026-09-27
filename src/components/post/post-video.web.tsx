import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ThemedText } from '../themed-text';
import { DownloadButton } from './download-button';

import type {
  FragmentLoaderConstructor,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';

import type { Asset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMediaMaxHeight } from '@/lib/media';
import { workerEndpoint } from '@/lib/worker';

/**
 * Video posts are HLS (`.m3u8`): playlists from `api.sidechat.lol`, which sends
 * CORS headers, and MPEG-TS segments from Cloudflare R2 storage, **which does
 * not** (docs/API.md#-video-playback-needs-the-worker).
 *
 * ## Two players, tried in order
 *
 * 1. **The browser's own**, when it claims HLS. That was only ever Safari —
 *    Apple's player, used by every browser on iPhone — until Chrome 153 began
 *    answering `canPlayType` with "maybe" too. Chrome's then fails on these
 *    streams with `MEDIA_ERR_SRC_NOT_SUPPORTED`, so a native error before
 *    anything loads falls through to…
 * 2. **hls.js**, imported lazily so Safari never downloads it. It fetches
 *    segments itself, which needs CORS the segment host does not send — so
 *    without the worker's relay it cannot get past the first segment either,
 *    and says so rather than retrying for half a minute.
 *
 * `preload` is set by the feed when the post is at or near the viewport, so the
 * manifest and first segments are already in flight by the time anyone presses
 * play. Attaching the stream does not start playback — `autoplay` is never set,
 * so this buffers quietly and stays paused.
 */

// The download is the master playlist: its links are signed for ~12 hours, and
// a player outside the browser does not need CORS (docs/API.md).
const BLOCKED =
  "Yik Yak's video host blocks playback on other sites. Download saves a playlist VLC can open for about 12 hours.";
const FAILED = 'Playback failed.';

/**
 * Whether this browser plays HLS with Apple's own player: Safari, and every
 * browser on iPhone, which are all WebKit. That player is not the web media
 * stack and needs no CORS on segments. Every other browser does — so without
 * the worker's relay a Yik Yak video cannot play in it at all, and the post
 * says so instead of offering a play button that fails.
 *
 * `navigator.vendor` rather than the user agent: it is "Apple Computer, Inc." in
 * every WebKit browser, iOS Chrome included, and "Google Inc." or empty
 * everywhere else.
 */
function hasApplePlayer() {
  return typeof navigator !== 'undefined' && (navigator.vendor ?? '').startsWith('Apple');
}

/** Segments live on R2, which sends no CORS headers — the one host that needs the relay. */
function isSegmentHost(url: string) {
  try {
    return new URL(url).hostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}
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
  // Whether a player has been attached, and how to take it off again. Refs, not
  // state: the attach effect must not re-run because it succeeded.
  const attachedRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);
  // Set by the play button, read by a player that attaches after the press —
  // hls.js taking over from a native attempt that failed on play.
  const wantsPlayRef = useRef(false);
  const [attached, setAttached] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxHeight = useMediaMaxHeight();

  const src = asset.signed_url || asset.url || '';
  const poster = asset.thumbnail_asset?.url;
  const ratio = asset.width && asset.height ? asset.width / asset.height : 16 / 9;

  // Blocked until the worker exists, in every browser but Apple's — see
  // `hasApplePlayer`. Nothing is attached, so nothing is requested.
  const blocked = !workerEndpoint('/media') && !hasApplePlayer();

  // Attach as soon as the feed says this post is near the viewport, or as soon
  // as someone presses play — whichever happens first.
  const shouldAttach = !blocked && (preload || playing);

  /*
    Teardown has an effect of its own, keyed on the asset.

    It used to be the attach effect's cleanup. That effect listed `attached` as
    a dependency and set it on success, so succeeding re-ran it — and the
    cleanup of the run that had just attached hls.js destroyed the player it had
    just made. From 2026-08-27, every browser on the hls.js path got a video
    element with no source. Keyed on the asset rather than the URL, too: the
    URL is re-signed on every feed refetch, and a playing video should not
    restart because the feed refreshed underneath it.
  */
  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
      attachedRef.current = false;
    },
    [asset.id],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !shouldAttach || !src || attachedRef.current) return;
    attachedRef.current = true;
    const attachment = { live: true, hls: null as { destroy(): void } | null };

    const viaHlsJs = async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (!attachment.live) return;
        if (!Hls.isSupported()) {
          setError('This browser cannot play this video.');
          return;
        }

        // With the worker configured, segments are fetched through its relay,
        // which adds the CORS headers R2 leaves off. Playlists already have them.
        const relay = workerEndpoint('/media');
        const Base = Hls.DefaultConfig.loader;
        class RelayLoader extends Base {
          load(
            context: LoaderContext,
            config: LoaderConfiguration,
            callbacks: LoaderCallbacks<LoaderContext>,
          ) {
            if (relay && isSegmentHost(context.url)) {
              context.url = `${relay}?u=${encodeURIComponent(context.url)}`;
            }
            super.load(context, config, callbacks);
          }
        }

        const instance = new Hls({
          enableWorker: true,
          // The default loader is typed for any context and loads fragments
          // too; only the declared type is narrower.
          ...(relay ? { fLoader: RelayLoader as unknown as FragmentLoaderConstructor } : {}),
        });
        attachment.hls = instance;
        let segmentLoaded = false;
        instance.on(Hls.Events.FRAG_LOADED, () => {
          segmentLoaded = true;
        });
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (wantsPlayRef.current) void el.play().catch(() => {});
        });
        instance.on(Hls.Events.ERROR, (_e, data) => {
          /*
            Blocked, not flaky. The playlists just loaded from the same API, so
            the network is up; a first segment that fails with no HTTP status at
            all is the browser refusing a response without CORS headers. hls.js
            would retry that for half a minute before calling it fatal.
          */
          const blocked =
            !segmentLoaded &&
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR &&
            !data.response?.code &&
            !relay;
          if (blocked) {
            instance.destroy();
            attachment.hls = null;
            setError(BLOCKED);
          } else if (data.fatal) {
            setError(FAILED);
          }
        });
        instance.loadSource(src);
        instance.attachMedia(el);
        setAttached(true);
      } catch {
        if (attachment.live) setError('Could not load the video player.');
      }
    };

    let loaded = false;
    const onLoaded = () => {
      loaded = true;
    };
    // Only a failure *before* anything loaded falls back — see the header.
    const onNativeError = () => {
      el.removeEventListener('error', onNativeError);
      if (loaded) {
        setError(FAILED);
        return;
      }
      el.removeAttribute('src');
      el.load();
      void viaHlsJs();
    };

    detachRef.current = () => {
      attachment.live = false;
      attachment.hls?.destroy();
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onNativeError);
    };

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.addEventListener('loadedmetadata', onLoaded);
      el.addEventListener('error', onNativeError);
      // The element is rendered `preload="none"` so nothing loads before this
      // point; once attaching, buffer ahead as hls.js does. (Chrome's native
      // player still says nothing about a stream it cannot play until play()
      // is called — measured — so its failure surfaces on the press.)
      el.preload = 'auto';
      el.src = src;
      setAttached(true);
    } else {
      void viaHlsJs();
    }
  }, [shouldAttach, src]);

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
          {/* Not when blocked: its glyph would show through the label, and a
              blocked video has no poster either — thumbnails need the worker too. */}
          {!attached && !blocked ? (
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

          {error || blocked ? null : (
            <Pressable
              onPress={() => {
                wantsPlayRef.current = true;
                setPlaying(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Play video"
              style={styles.overlay}>
              <View style={[styles.playButton, { backgroundColor: theme.overlay }]}>
                <Ionicons name="play" size={26} color="#FFFFFF" />
              </View>
            </Pressable>
          )}
        </>
      ) : null}

      {blocked ? (
        <View
          style={[styles.overlay, styles.blocked, { backgroundColor: theme.overlay }]}
          pointerEvents="none">
          <Ionicons name="lock-closed" size={20} color="#FFFFFF" />
          <ThemedText type="smallBold" style={styles.onOverlay}>
            Blocked until the worker is set up
          </ThemedText>
          <ThemedText type="caption" style={[styles.onOverlay, styles.blockedBody]}>
            Yik Yak serves its videos only to its own apps. Download saves a playlist VLC can
            open for about 12 hours.
          </ThemedText>
        </View>
      ) : error ? (
        <View style={[styles.overlay, { backgroundColor: theme.overlay }]} pointerEvents="none">
          <ThemedText type="small" style={styles.onOverlay}>
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
  blocked: {
    gap: Spacing.one,
  },
  onOverlay: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  blockedBody: {
    opacity: 0.85,
    maxWidth: 320,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
