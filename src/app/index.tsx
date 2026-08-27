import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '@/api/session';
import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme, useThemePreference, type ThemePreference } from '@/hooks/use-theme';

const PREFERENCES: ThemePreference[] = ['light', 'dark', 'system'];

const SAMPLE_ROUTES = [
  { label: 'Group feed — /g/wordle', href: '/g/wordle' },
  { label: 'Group feed, sorted — /g/advice?sort=new', href: '/g/advice?sort=new' },
  { label: 'Post detail — /p/0ESz5N3t', href: '/p/0ESz5N3t' },
  { label: 'Profile — /u/rat.brat', href: '/u/rat.brat' },
  { label: 'Diagnostics — /diagnostics', href: '/diagnostics' },
  // Deliberately unrouted, to exercise +not-found. Typed routes reject unknown
  // paths at compile time, which is the point — hence the cast.
  { label: 'A route that does not exist', href: '/nope/nope/nope' as Href },
] as const;

export default function HomeScreen() {
  const theme = useTheme();
  const { status, deviceId } = useSession();
  const { preference, scheme, setPreference } = useThemePreference();

  return (
    <Screen title="webyak" subtitle="Phase 1 — foundation">
      <View
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <ThemedText type="bodyBold">Session</ThemedText>
        <Row label="status" value={status} />
        <Row label="device id" value={deviceId ?? '—'} />
        <ThemedText type="small" themeColor="textSecondary">
          Every route here is gated — reaching this screen at all means the token
          restored correctly.
        </ThemedText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <ThemedText type="bodyBold">Theme</ThemedText>
        <Row label="preference" value={preference} />
        <Row label="resolved" value={scheme} />
        <View style={styles.chipRow}>
          {PREFERENCES.map((option) => {
            const active = preference === option;
            return (
              <Pressable
                key={option}
                onPress={() => setPreference(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? theme.brand : theme.background,
                    borderColor: active ? theme.brand : theme.borderStrong,
                  },
                  (hovered || pressed) && !active && { backgroundColor: theme.backgroundHover },
                ]}>
                <ThemedText type="smallBold" style={{ color: active ? theme.onBrand : theme.text }}>
                  {option}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          The choice is persisted, so it should survive a reload. A real toggle in
          the nav is Phase 7.
        </ThemedText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <ThemedText type="bodyBold">Route check</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Each of these should change the URL and render its own screen.
        </ThemedText>
        <View style={styles.linkList}>
          {SAMPLE_ROUTES.map((route) => (
            <Link key={route.label} href={route.href} asChild>
              <Pressable
                accessibilityRole="link"
                style={({ hovered, pressed }) => [
                  styles.linkRow,
                  { borderColor: theme.border },
                  (hovered || pressed) && { backgroundColor: theme.backgroundHover },
                ]}>
                <ThemedText type="small" themeColor="link">
                  {route.label}
                </ThemedText>
              </Pressable>
            </Link>
          ))}
        </View>
      </View>

      <PhasePlaceholder
        phase="Phase 3"
        title="Home feed"
        description="Replaced by the group feed: hot/recent/top tabs, post cards, cursor-based infinite scroll."
      />
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
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkList: {
    gap: Spacing.half,
    paddingTop: Spacing.one,
  },
  linkRow: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
