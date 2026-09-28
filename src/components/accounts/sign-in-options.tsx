import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';
import { PassphraseDialog } from '../ui/passphrase-dialog';
import { AccountRow } from './account-row';

import { useSession } from '@/api/session';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LOGIN_FILE_ACCEPT, LoginFileError, openLogin } from '@/lib/login-file';
import { pickFile } from '@/lib/pick-file';

/*
  The two ways onto webyak's sign-in screen that skip the texted code. Web only,
  like the account switcher they belong to (docs/ARCHITECTURE.md#accounts-and-login-files).
*/

/** Accounts already saved in this browser: one tap back into any of them. */
export function SavedAccounts() {
  const theme = useTheme();
  const { accounts, switchAccount } = useSession();
  const [switching, setSwitching] = useState<string | null>(null);

  if (Platform.OS !== 'web' || accounts.length === 0) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Saved in this browser
      </ThemedText>
      {accounts.map((account) => (
        <AccountRow
          key={account.userId}
          account={account}
          trailing={
            <Button
              label="Continue"
              loading={switching === account.userId}
              onPress={() => {
                setSwitching(account.userId);
                void switchAccount(account.userId);
              }}
            />
          }
        />
      ))}
    </View>
  );
}

/** Signs in from a login file another webyak exported. */
export function LoginFileImport() {
  const { importAccount } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (Platform.OS !== 'web') return null;

  const choose = async () => {
    const picked = await pickFile(LOGIN_FILE_ACCEPT);
    if (!picked) return;
    setError(null);
    setFile(picked);
  };

  const open = async (passphrase: string) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // Success reloads the page into the account, so there's no state to reset.
      await importAccount(await openLogin(file, passphrase));
    } catch (e) {
      setError(e instanceof LoginFileError ? e.message : "Couldn't open that file.");
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        label="Use a login file instead"
        variant="secondary"
        onPress={() => void choose()}
        fullWidth
      />
      {file ? (
        <PassphraseDialog
          mode="enter"
          title="Open login file"
          body={`${file.name} — enter the passphrase it was saved with.`}
          confirmLabel="Sign in"
          busy={busy}
          error={error}
          onSubmit={(passphrase) => void open(passphrase)}
          onCancel={() => {
            setFile(null);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
