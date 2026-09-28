import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CurrentGroupProvider } from '@/api/current-group';
import { QueryProvider } from '@/api/query-provider';
import { SessionProvider, useSession } from '@/api/session';
import { AppShell } from '@/components/app-shell';
import { ThemedText } from '@/components/themed-text';
import { ToastHost } from '@/components/toast-host';
import { useColorScheme, useTheme } from '@/hooks/use-theme';
import { restoreChatReads } from '@/lib/chat-reads';
import { restoreSeenPosts } from '@/lib/seen-posts';
import { ThemePreferenceProvider } from '@/theme/theme-provider';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status, userId } = useSession();
  const scheme = useColorScheme();
  const theme = useTheme();

  useEffect(() => {
    if (status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  // Read state for the unread filter and for chats, kept per account, so it
  // waits to know whose. A failure just means things look unread, which is the
  // safe direction.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void restoreSeenPosts(userId);
    void restoreChatReads(userId);
  }, [status, userId]);

  // Map our palette onto the navigation theme so native stack transitions and
  // the web document background match the app instead of flashing white.
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: scheme === 'dark',
      colors: {
        ...base.colors,
        primary: theme.brand,
        background: theme.background,
        card: theme.backgroundElevated,
        text: theme.text,
        border: theme.border,
      },
    };
  }, [scheme, theme]);

  /*
    Nothing authenticated is mounted until the session is known.

    This used to render the whole app underneath a loading overlay, which looked
    the same and was not: the screens beneath it were live, so every cold reload
    fired a feed request before the stored token had been read. That went out as
    `Bearer undefined`, came back 401, and the 401 handler signed the user out —
    deleting the token that was still being restored. The overlay hid a request
    storm and a self-inflicted logout behind a spinner.

    Returning early instead of guarding with `Stack.Protected` is deliberate:
    `guard={status !== 'anonymous'}` is true while loading, which is what kept
    the login screen from flashing but also kept the screens mounted. Not
    rendering the navigator at all until boot completes is the Expo template's
    own pattern for exactly this, and it cannot race.
  */
  if (status === 'loading') {
    return (
      <ThemeProvider value={navigationTheme}>
        <View style={[styles.root, styles.bootOnly, { backgroundColor: theme.background }]}>
          <ActivityIndicator color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            Restoring session…
          </ThemedText>
        </View>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <View style={styles.root}>
        <AppShell>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.background },
            }}>
            {/*
              webyak is auth-only (docs/API.md#auth-is-mandatory). By the time
              this renders `status` is settled — the early return above handles
              `loading` — so these guards only ever see a real answer, and the
              login screen cannot flash before the stored token has been read.
            */}
            <Stack.Protected guard={status === 'authenticated'}>
              <Stack.Screen name="index" />
              <Stack.Screen name="explore" />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="g/[slug]" />
              <Stack.Screen name="p/[code]" />
              <Stack.Screen name="u/[username]" />
              <Stack.Screen name="me/index" />
              <Stack.Screen name="me/edit" />
              <Stack.Screen name="chats/index" />
              <Stack.Screen name="chats/[id]" />
              <Stack.Screen name="diagnostics" />
              <Stack.Screen name="settings" />
            </Stack.Protected>

            <Stack.Protected guard={status === 'anonymous'}>
              <Stack.Screen name="login/index" />
            </Stack.Protected>
          </Stack>
        </AppShell>

        {/* Above the shell so a failed write is visible from any screen. */}
        <ToastHost />
      </View>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemePreferenceProvider>
        <QueryProvider>
          <SessionProvider>
            <CurrentGroupProvider>
              <RootNavigator />
            </CurrentGroupProvider>
          </SessionProvider>
        </QueryProvider>
      </ThemePreferenceProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  bootOnly: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
