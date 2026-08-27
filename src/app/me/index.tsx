import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useSession } from '@/api/session';
import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function MeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId, primaryGroup, deviceId, signOut } = useSession();

  return (
    <Screen title="You">
      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="bodyBold">Account</ThemedText>
        <Row label="user id" value={userId ?? '—'} />
        <Row label="primary group" value={primaryGroup?.name ?? 'none'} />
        <Row label="device id" value={deviceId ?? '—'} />
      </View>

      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="bodyBold">Diagnostics</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Runs the probes that unblock Phase 3 against the live API.
        </ThemedText>
        <Button
          label="Open diagnostics"
          variant="secondary"
          onPress={() => router.push('/diagnostics')}
        />
      </View>

      <PhasePlaceholder
        phase="Phase 5"
        title="Your profile and content"
        description="Username, bio, emoji/color icon, plus your posts and comments via the patched getUserContent."
      />

      <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="code">{value}</ThemedText>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
