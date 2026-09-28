import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';

import { useUnhideAll } from '@/api/mutations';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The undo for *Hide posts from this person*. The API offers only an undo for
 * everyone at once (`/v1/users/unhide_all`), and no list of who is hidden, so
 * that is all this can be: one button, behind a confirm, since it writes.
 */
export function HiddenCard() {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const unhide = useUnhideAll();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="bodyBold">Hidden people</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        People you hid from a post stay hidden on Yik Yak itself. There&apos;s no list of them, and
        they can only be brought back all at once.
      </ThemedText>
      <View style={styles.actions}>
        <Button
          label="Unhide everyone"
          variant="secondary"
          onPress={() => setConfirming(true)}
          disabled={unhide.isPending}
        />
      </View>
      <ConfirmDialog
        visible={confirming}
        title="Unhide everyone?"
        body="Everyone you've hidden, from webyak or the official app, shows up in your feeds again."
        confirmLabel="Unhide everyone"
        busy={unhide.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => unhide.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
  },
});
