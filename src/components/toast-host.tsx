import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dismissToast, useToasts } from '@/lib/toast';

/**
 * Renders whatever is in the toast store.
 *
 * Mounted once at the root, above everything, and `pointerEvents="box-none"` so
 * the container never eats clicks meant for the feed underneath — only the bars
 * themselves are interactive.
 *
 * Anchored to the top rather than the bottom: the bottom is occupied by the tab
 * bar, the community strip and the compose FAB on narrow viewports, and a toast
 * that covers the post button is a toast that blocks the recovery action.
 */
export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { paddingTop: insets.top + Spacing.three }]}>
      {toasts.map((toast) => {
        const accent = toast.tone === 'error' ? theme.danger : theme.brand;
        return (
          <Pressable
            key={toast.id}
            accessibilityRole="alert"
            accessibilityLabel={toast.message}
            onPress={() => dismissToast(toast.id)}
            style={[
              styles.toast,
              {
                backgroundColor: theme.backgroundElevated,
                borderColor: accent,
              },
            ]}>
            <Ionicons
              name={toast.tone === 'error' ? 'alert-circle' : 'information-circle'}
              size={18}
              color={accent}
            />
            <ThemedText type="small" style={styles.message}>
              {toast.message}
            </ThemedText>
            <Ionicons name="close" size={16} color={theme.textTertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    zIndex: 100,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    width: '100%',
    maxWidth: 460,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    ...Platform.select({
      web: { boxShadow: '0 8px 28px rgba(0,0,0,0.45)' },
      default: { elevation: 8 },
    }),
  },
  message: {
    flex: 1,
  },
});
