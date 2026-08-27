import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Rendered on the right of the header row. */
  action?: React.ReactNode;
  /** Set false for screens that own their own scrolling (feeds, chat threads). */
  scroll?: boolean;
  /** Constrain the reading column. Feeds use the default. */
  maxWidth?: number;
  children: React.ReactNode;
}

export function Screen({
  title,
  subtitle,
  action,
  scroll = true,
  maxWidth = Layout.feedMaxWidth,
  children,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const header = title ? (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <View style={styles.headerText}>
        <ThemedText type="subtitle" style={{ color: theme.brand }}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action}
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
  header: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
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
