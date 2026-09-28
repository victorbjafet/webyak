import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AuthedImage } from '../authed-image';
import { ErrorState, LoadingState } from '../states';
import { ThemedText } from '../themed-text';

import { useAssetLibrary } from '@/api/queries';
import type { LibraryAsset } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';


/**
 * Pick an image from Sidechat's stock library to attach to a post
 * (docs/API.md#the-asset-library-sidechats-stock-images-not-yours).
 *
 * The library is thousands of images, each fetched with the bearer, so the
 * grid is a windowed list: only what is near the screen loads. The list itself
 * is one ~1.5 MB request, made the first time this opens and kept for the
 * session.
 *
 * Closes on the backdrop, the close button, Escape, or a pick.
 */
export function LibraryPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (asset: LibraryAsset) => void;
}) {
  const theme = useTheme();
  const library = useAssetLibrary(visible);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  // Three across on a phone, four once there's room.
  const columns = gridWidth >= 480 ? 4 : 3;
  const cell = gridWidth > 0 ? (gridWidth - Spacing.one * (columns - 1)) / columns : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close the library"
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElevated,
              borderColor: theme.border,
              width: Math.min(560, windowWidth - Spacing.four * 2),
              height: Math.min(640, windowHeight - Spacing.five * 2),
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="heading" style={styles.title}>
              Library
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ hovered }) => [
                styles.close,
                { backgroundColor: hovered ? theme.controlHover : theme.control },
              ]}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ThemedText type="caption" themeColor="textSecondary">
            Sidechat&apos;s stock images, the same for everyone.
          </ThemedText>

          <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
            {library.isLoading ? <LoadingState label="Loading the library…" /> : null}
            {library.isError ? (
              <ErrorState
                error={library.error}
                onRetry={() => library.refetch()}
                title="Couldn't load the library"
              />
            ) : null}
            {library.data && cell > 0 ? (
              <FlatList
                // numColumns can't change on a mounted list, so a new count remounts it.
                key={columns}
                data={library.data}
                keyExtractor={(item) => item.id}
                numColumns={columns}
                columnWrapperStyle={styles.row}
                contentContainerStyle={styles.rows}
                initialNumToRender={columns * 5}
                maxToRenderPerBatch={columns * 4}
                windowSize={5}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Attach library image ${item.metadata.width} by ${item.metadata.height}`}
                    onPress={() => onPick(item)}
                    style={({ hovered }) => [
                      styles.cell,
                      { width: cell, height: cell, backgroundColor: theme.control },
                      hovered && styles.cellHovered,
                    ]}>
                    <AuthedImage
                      uri={item.url}
                      style={styles.image}
                      contentFit="cover"
                      recyclingKey={item.id}
                    />
                  </Pressable>
                )}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flex: 1,
  },
  rows: {
    gap: Spacing.one,
  },
  row: {
    gap: Spacing.one,
  },
  cell: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  cellHovered: {
    opacity: 0.8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
