import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { PassphraseDialog } from '../ui/passphrase-dialog';
import { AccountRow } from './account-row';

import { accountLabel, type SavedAccount } from '@/api/accounts';
import { useSession } from '@/api/session';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LoginFileError, loginFileName, sealLogin } from '@/lib/login-file';
import { saveFile } from '@/lib/save-file';
import { showToast } from '@/lib/toast';

/**
 * The account switcher, at the top of Settings: the accounts saved in this
 * browser, a way to add one, and the login file that carries this one to
 * another webyak (docs/ARCHITECTURE.md#accounts-and-login-files).
 *
 * Web only. Login files need Web Crypto and a download, and switching reloads
 * the page to be sure nothing of one account shows under another.
 */
export function AccountsCard() {
  const theme = useTheme();
  const { accounts, userId, token, primaryGroup, switchAccount, addAccount, forgetAccount } =
    useSession();
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<SavedAccount | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  if (Platform.OS !== 'web') return null;

  const active = accounts.find((a) => a.userId === userId) ?? null;
  const others = accounts.filter((a) => a.userId !== userId);

  const exportLogin = async (passphrase: string) => {
    if (!token || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await sealLogin(
        {
          userId,
          token,
          primaryGroup,
          label: active?.label ?? accountLabel(null, userId),
          icon: active?.icon ?? null,
          exportedAt: new Date().toISOString(),
          origin: window.location.origin,
        },
        passphrase,
      );
      if (!(await saveFile(blob, loginFileName()))) {
        throw new LoginFileError("This browser couldn't save the file.");
      }
      setExporting(false);
      showToast('Login file saved. Import it on the other webyak, then delete the file.', 'info');
    } catch (e) {
      setError(e instanceof LoginFileError ? e.message : "Couldn't create the login file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="bodyBold">Accounts</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Saved in this browser, so a friend can use webyak on it without signing you out. Signing
        out, on the You tab, removes an account from this browser.
      </ThemedText>

      {active ? <AccountRow account={active} current /> : null}
      {others.map((account) => (
        <AccountRow
          key={account.userId}
          account={account}
          trailing={
            <View style={styles.rowActions}>
              <Button
                label="Switch"
                variant="secondary"
                loading={switching === account.userId}
                onPress={() => {
                  setSwitching(account.userId);
                  void switchAccount(account.userId);
                }}
              />
              <Button label="Remove" variant="ghost" onPress={() => setForgetting(account)} />
            </View>
          }
        />
      ))}

      <View style={styles.actions}>
        <Button label="Add account" variant="secondary" onPress={() => void addAccount()} />
        <Button
          label="Export login file"
          variant="secondary"
          disabled={!token || !userId}
          onPress={() => {
            setError(null);
            setExporting(true);
          }}
        />
      </View>
      <ThemedText type="caption" themeColor="textTertiary">
        A login file moves this account to another webyak — the live site instead of localhost,
        say — without the texted code. It is sealed with a passphrase you choose. Anyone with
        both could use your account, so delete the file once it&rsquo;s imported.
      </ThemedText>

      {exporting ? (
        <PassphraseDialog
          mode="create"
          title="Export login file"
          body="Choose a passphrase to seal it with. You'll type it once more on the other webyak."
          confirmLabel="Save file"
          busy={busy}
          error={error}
          onSubmit={(passphrase) => void exportLogin(passphrase)}
          onCancel={() => setExporting(false)}
        />
      ) : null}

      <ConfirmDialog
        visible={forgetting !== null}
        title={`Remove ${forgetting?.label ?? 'this account'}?`}
        body="Only from this browser. Adding it back takes its login file or the phone number."
        confirmLabel="Remove"
        destructive
        onCancel={() => setForgetting(null)}
        onConfirm={() => {
          const id = forgetting?.userId;
          setForgetting(null);
          if (id) void forgetAccount(id);
        }}
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
  rowActions: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
});
