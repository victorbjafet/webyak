import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Native fallback. Saving to the camera roll would need expo-file-system and a
 * media-library permission prompt, which isn't worth adding until the native
 * builds are a real target — opening the asset lets the OS handle it.
 */
export function DownloadButton({
  uri,
  label = 'Open',
}: {
  uri?: string;
  /** Accepted for parity with the web variant; the OS names the file here. */
  filename?: string;
  label?: string;
}) {
  const theme = useTheme();
  if (!uri) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(uri)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? theme.backgroundElevated : theme.overlay },
      ]}>
      <Ionicons name="open-outline" size={16} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
