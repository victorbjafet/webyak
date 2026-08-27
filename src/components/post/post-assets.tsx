import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AuthedImage } from '../authed-image';
import { DownloadButton } from './download-button';
import { PostVideo } from './post-video';

import type { Asset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bestAssetUrl } from '@/lib/asset-url';
import { useMediaMaxHeight } from '@/lib/media';

/**
 * Images and videos on a post.
 *
 * Asset URLs are inconsistent about auth — some are pre-signed, some need the
 * bearer token — so everything goes through AuthedImage rather than a raw
 * source. See src/lib/asset-url.ts for the rules.
 */
export function PostAssets({
  assets,
  preload = false,
  visible = false,
}: {
  assets?: Asset[];
  preload?: boolean;
  visible?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState<Asset | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const maxHeight = useMediaMaxHeight();

  if (!assets?.length) return null;

  return (
    <>
      <View style={styles.stack}>
        {assets.map((asset) => {
          if (asset.type === 'video') {
            return (
              <PostVideo key={asset.id} asset={asset} preload={preload} visible={visible} />
            );
          }

          const uri = bestAssetUrl(asset);
          if (!uri) return null;
          const ratio = asset.width && asset.height ? asset.width / asset.height : 1;

          return (
            <View key={asset.id} style={styles.imageWrap}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="Open image"
                onPress={() => setOpen(asset)}
                style={({ hovered }) => [hovered && styles.hovered]}>
                <AuthedImage
                  uri={uri}
                  style={[
                    styles.image,
                    {
                      aspectRatio: ratio,
                      // Capped so a tall portrait image can't take over the
                      // feed. `contain` because once capped the frame no longer
                      // matches the asset's ratio, and `cover` would crop it.
                      maxHeight,
                      backgroundColor: theme.skeleton,
                    },
                  ]}
                  contentFit="contain"
                  transition={120}
                />
              </Pressable>
              <DownloadButton
                uri={uri}
                filename={`webyak-${asset.id}.${asset.content_type || 'jpg'}`}
                label="Download image"
              />
            </View>
          );
        })}
      </View>

      <Modal
        visible={Boolean(open)}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}>
        <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(null)}
            accessibilityRole="button"
            accessibilityLabel="Close image"
          />
          {open ? (
            <AuthedImage
              uri={bestAssetUrl(open)}
              style={{ width: screenWidth * 0.94, height: screenHeight * 0.8 }}
              contentFit="contain"
            />
          ) : null}

          <Pressable
            onPress={() => setOpen(null)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[styles.close, { backgroundColor: theme.backgroundElevated }]}>
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>

          {open ? (
            <View style={styles.lightboxDownload}>
              <DownloadButton
                uri={bestAssetUrl(open)}
                filename={`webyak-${open.id}.${open.content_type || 'jpg'}`}
                label="Download image"
              />
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.two,
  },
  imageWrap: {
    position: 'relative',
  },
  image: {
    width: '100%',
    borderRadius: Radius.md,
  },
  hovered: {
    opacity: 0.92,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    top: Spacing.four,
    right: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.pill,
  },
  lightboxDownload: {
    position: 'absolute',
    bottom: Spacing.five,
    right: Spacing.four,
    width: 40,
    height: 40,
  },
});
