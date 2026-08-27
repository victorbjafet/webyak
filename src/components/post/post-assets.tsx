import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import type { Asset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Post images.
 *
 * Verified: post assets come back as **pre-signed** R2 URLs, so no auth header
 * is needed and a plain image source works. offsides attaches a bearer token to
 * every image request because asset-*library* URLs do need one — that
 * distinction matters if Phase 4 renders library assets.
 */
export function PostAssets({ assets }: { assets?: Asset[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState<Asset | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  if (!assets?.length) return null;

  return (
    <>
      <View style={styles.stack}>
        {assets.map((asset) => {
          const uri = asset.signed_url || asset.url;
          if (!uri) return null;
          const ratio = asset.width && asset.height ? asset.width / asset.height : 1;
          return (
            <Pressable
              key={asset.id}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open image"
              onPress={() => setOpen(asset)}
              style={({ hovered }) => [hovered && styles.hovered]}>
              <Image
                source={{ uri }}
                style={[styles.image, { aspectRatio: ratio, backgroundColor: theme.skeleton }]}
                contentFit="cover"
                transition={120}
              />
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={Boolean(open)}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.overlay }]}
          onPress={() => setOpen(null)}
          accessibilityRole="button"
          accessibilityLabel="Close image">
          {open ? (
            <Image
              source={{ uri: open.signed_url || open.url }}
              style={{ width: screenWidth * 0.94, height: screenHeight * 0.8 }}
              contentFit="contain"
            />
          ) : null}
          <View style={[styles.close, { backgroundColor: theme.backgroundElevated }]}>
            <Ionicons name="close" size={22} color={theme.text} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.two,
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
});
