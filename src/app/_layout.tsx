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
import { ThemePreferenceProvider } from '@/theme/theme-provider';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useSession();
  const scheme = useColorScheme();
  const theme = useTheme();

  useEffect(() => {
    if (status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

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
              webyak is auth-only (docs/API.md#auth-is-mandatory). `guard` is
              written against `anonymous`/`authenticated` rather than a boolean
              so that during `loading` neither group is withdrawn — otherwise the
              login screen flashes on every cold start before the stored token
              has been read.
            */}
            <Stack.Protected guard={status !== 'anonymous'}>
              <Stack.Screen name="index" />
              <Stack.Screen name="explore" />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="g/[slug]" />
              <Stack.Screen name="p/[code]" />
              <Stack.Screen name="u/[username]" />
              <Stack.Screen name="me/index" />
              <Stack.Screen name="chats/index" />
              <Stack.Screen name="chats/[id]" />
              <Stack.Screen name="diagnostics" />
            </Stack.Protected>

            <Stack.Protected guard={status !== 'authenticated'}>
              <Stack.Screen name="login/index" />
            </Stack.Protected>
          </Stack>
        </AppShell>

        {status === 'loading' ? (
          <View style={[styles.boot, { backgroundColor: theme.background }]}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Restoring session…
            </ThemedText>
          </View>
        ) : null}

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
  boot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
