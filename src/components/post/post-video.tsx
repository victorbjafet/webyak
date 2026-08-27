import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

import type { Asset } from '@/api/types';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Native video. HLS is handled by the platform players, so unlike the web
 * variant (post-video.web.tsx) this needs no shim.
 */
export function PostVideo({ asset }: { asset: Asset }) {
  const theme = useTheme();
  const src = asset.signed_url || asset.url || '';
  const ratio = asset.width && asset.height ? asset.width / asset.height : 16 / 9;

  const player = useVideoPlayer(src || null, (p) => {
    p.loop = false;
  });

  if (!src) return null;

  return (
    <View style={[styles.frame, { aspectRatio: ratio, backgroundColor: theme.skeleton }]}>
      <VideoView player={player} style={styles.video} contentFit="cover" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
