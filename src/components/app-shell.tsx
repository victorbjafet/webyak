import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { BottomBar } from './bottom-bar';
import { CommunitySwitcher } from './community-switcher';
import { ComposeButton } from './compose-button';
import { Sidebar } from './sidebar';

import { useSession } from '@/api/session';
import { Breakpoints } from '@/constants/theme';
import { useHydrated } from '@/hooks/use-hydrated';
import { useTheme } from '@/hooks/use-theme';

/**
 * Sidebar at >= 900px, bottom tab bar below it.
 *
 * Mobile-first before hydration: the static export prerenders in Node with no
 * real viewport, so we must render the narrow layout until `useHydrated` flips,
 * then switch. Desktop therefore shows the bottom bar for one frame — a known
 * tradeoff, revisit in Phase 9 if it's visible in practice.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  const { status } = useSession();

  // Nav is meaningless before sign-in — every destination behind it is gated.
  const showNav = status === 'authenticated';
  const wide = hydrated && width >= Breakpoints.sidebar;

  return (
    <View
      style={[styles.root, { backgroundColor: theme.background }, showNav && wide && styles.wide]}>
      {showNav && wide ? <Sidebar /> : null}
      <View style={styles.content}>
        {children}
        {/* Inside the content area on purpose: absolutely positioned against the
            root it would sit underneath the community strip and the tab bar. */}
        {showNav && !wide ? <ComposeButton variant="floating" /> : null}
      </View>
      {showNav && !wide ? (
        <>
          <CommunitySwitcher variant="bar" />
          <BottomBar />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
  },
  wide: {
    flexDirection: 'row',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
});
