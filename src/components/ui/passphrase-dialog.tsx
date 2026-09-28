import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from './button';
import { TextField } from './text-field';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MIN_PASSPHRASE } from '@/lib/login-file';

/**
 * Asks for the passphrase a login file is sealed with.
 *
 * `create` asks twice and holds out for `MIN_PASSPHRASE` characters; `enter`
 * asks once. Mount it only while it's open: the fields live in its state, so a
 * passphrase is gone the moment the dialog is.
 */
export function PassphraseDialog({
  mode,
  title,
  body,
  confirmLabel,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'enter';
  title: string;
  body?: string;
  confirmLabel: string;
  busy?: boolean;
  /** Why the last try failed — a wrong passphrase, a dead login. */
  error?: string | null;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');

  const creating = mode === 'create';
  const tooShort = creating && passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = creating && confirm.length > 0 && confirm !== passphrase;
  const ready = creating
    ? passphrase.length >= MIN_PASSPHRASE && confirm === passphrase
    : passphrase.length > 0;
  const submit = () => {
    if (ready && !busy) onSubmit(passphrase);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onCancel}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => {}}
          style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <ThemedText type="heading">{title}</ThemedText>
          {body ? (
            <ThemedText type="small" themeColor="textSecondary">
              {body}
            </ThemedText>
          ) : null}

          <TextField
            label="Passphrase"
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={creating ? 'new-password' : 'current-password'}
            onSubmitEditing={creating ? undefined : submit}
            hint={creating ? `At least ${MIN_PASSPHRASE} characters.` : undefined}
            error={tooShort ? `At least ${MIN_PASSPHRASE} characters.` : creating ? null : error}
          />
          {creating ? (
            <TextField
              label="Again"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              onSubmitEditing={submit}
              error={mismatch ? "They don't match." : error}
            />
          ) : null}

          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
            <Button label={confirmLabel} onPress={submit} loading={busy} disabled={!ready} />
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
    gap: Spacing.three,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.45)' },
      default: { elevation: 8 },
    }),
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
});
