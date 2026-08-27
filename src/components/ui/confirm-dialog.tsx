import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from './button';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A confirmation the user has to answer.
 *
 * Not `Alert.alert` — react-native-web doesn't implement it, so on the web build
 * the native path is silently a no-op and a destructive action would fire with
 * no prompt at all. `Modal` is implemented on both.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back, and Escape on web.
      onRequestClose={onCancel}>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onCancel}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        {/* Swallows presses so tapping the card itself doesn't dismiss it. */}
        <Pressable
          accessibilityViewIsModal
          onPress={() => {}}
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
          ]}>
          <ThemedText type="heading">{title}</ThemedText>
          {body ? (
            <ThemedText type="small" themeColor="textSecondary">
              {body}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={busy} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
              loading={busy}
            />
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
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.45)' },
      default: { elevation: 8 },
    }),
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
});
