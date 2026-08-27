import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { Colors, type ColorSchemeName, type ThemePalette } from '@/constants/theme';
import { cacheStorage } from '@/lib/storage';

const PREFERENCE_KEY = 'webyak.themePreference';

export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * What renders before the stored preference has loaded. Also what the web static
 * export prerenders in Node, so the first client render must match it exactly or
 * React logs a hydration mismatch. Yik Yak's own web client is dark-only; we
 * default to dark and let the user opt into light or system.
 */
const DEFAULT_SCHEME: ColorSchemeName = 'dark';

interface ThemeContextValue {
  /** What the user picked. */
  preference: ThemePreference;
  /** What that resolves to right now. */
  scheme: ColorSchemeName;
  colors: ThemePalette;
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await cacheStorage.getItem(PREFERENCE_KEY);
      if (cancelled) return;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void cacheStorage.setItem(PREFERENCE_KEY, next);
  }, []);

  const scheme: ColorSchemeName = useMemo(() => {
    if (!hydrated) return DEFAULT_SCHEME;
    if (preference === 'system') {
      return systemScheme === 'light' ? 'light' : 'dark';
    }
    return preference;
  }, [hydrated, preference, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, colors: Colors[scheme], setPreference }),
    [preference, scheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('Theme hooks must be used inside <ThemePreferenceProvider>');
  return ctx;
}

/** The active palette. */
export function useTheme(): ThemePalette {
  return useThemeContext().colors;
}

/** Active scheme name — for things that need "dark" vs "light", not colors. */
export function useColorScheme(): ColorSchemeName {
  return useThemeContext().scheme;
}

/** Read and change the user's preference. UI for this lands in Phase 7. */
export function useThemePreference() {
  const { preference, setPreference, scheme } = useThemeContext();
  return { preference, setPreference, scheme };
}
