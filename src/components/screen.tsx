import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Rendered left of the title — a group icon, typically. */
  leading?: React.ReactNode;
  /**
   * Rendered inside the header block, below the title row. Feeds put their
   * sort tabs here so the tabs sit in the chrome rather than scrolling with
   * the posts, matching the official app.
   */
  headerBelow?: React.ReactNode;
  /** Rendered on the right of the header row. */
  action?: React.ReactNode;
  /**
   * Show a back control. Browser back works, but a screen you can only leave
   * via browser chrome is a dead end on mobile and on native.
   */
  back?: boolean;
  /** Set false for screens that own their own scrolling (feeds, chat threads). */
  scroll?: boolean;
  /** Constrain the reading column. Feeds use the default. */
  maxWidth?: number;
  children: React.ReactNode;
}

export function Screen({
  title,
  subtitle,
  leading,
  headerBelow,
  action,
  back = false,
  scroll = true,
  maxWidth = Layout.feedMaxWidth,
  children,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const header =
    title || headerBelow ? (
      <View style={[styles.headerBlock, { borderBottomColor: theme.border }]}>
        <View style={styles.header}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ hovered, pressed }) => [
            styles.back,
            { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
          ]}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </Pressable>
      ) : null}
      {leading}
      <View style={styles.headerText}>
        {title ? (
          <ThemedText type="subtitle" numberOfLines={1} style={{ color: theme.brand }}>
            {title}
          </ThemedText>
        ) : null}
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action}
        </View>
        {headerBelow ? <View style={styles.headerBelow}>{headerBelow}</View> : null}
      </View>
    ) : null;

  const body = <View style={[styles.column, { maxWidth }]}>{children}</View>;

  if (!scroll) {
    // Screens that own their scrolling (feeds, threads) need the column to
    // actually fill, or the list inside it has no height to scroll within.
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.centerFill}>
          <View style={[styles.column, styles.fill, { maxWidth }]}>{children}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.two,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerBelow: {
    paddingHorizontal: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    width: '100%',
  },
  fill: {
    flex: 1,
  },
  column: {
    width: '100%',
    gap: Spacing.three,
  },
});
