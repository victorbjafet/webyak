import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { api } from '@/api/client';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { assetNeedsAuth } from '@/lib/asset-url';

/**
 * Saves an asset to disk.
 *
 * The `download` attribute is ignored on cross-origin links, so a plain anchor
 * would navigate instead of saving. Fetching to a blob puts the bytes on our own
 * origin, which makes `download` work and lets us attach the bearer token for
 * the asset URLs that need it.
 */
export function DownloadButton({
  uri,
  filename,
  label = 'Download',
}: {
  uri?: string;
  filename: string;
  label?: string;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  if (!uri) return null;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        uri,
        assetNeedsAuth(uri) ? { headers: { Authorization: `Bearer ${api.userToken}` } } : undefined,
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Give the browser a moment to start the save before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      /* nothing useful to say — the browser will have shown its own failure */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={save}
      style={({ hovered, pressed }) => [
        styles.button,
        { backgroundColor: hovered || pressed ? theme.backgroundElevated : theme.overlay },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Ionicons name="download-outline" size={16} color="#FFFFFF" />
      )}
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
