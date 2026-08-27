import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Route skeleton. Every route in PLAN.md exists and is reachable from Phase 1
 * so navigation, deep links and the shell can be verified before any feature
 * work lands. Each of these gets replaced in the phase it names.
 */
export function PhasePlaceholder({
  phase,
  title,
  description,
  params,
}: {
  phase: string;
  title: string;
  description: string;
  params?: Record<string, string | undefined>;
}) {
  const theme = useTheme();
  const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined);

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.headingRow}>
        <Ionicons name="construct-outline" size={18} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary">
          {phase}
        </ThemedText>
      </View>

      <ThemedText type="bodyBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {description}
      </ThemedText>

      {entries.length > 0 ? (
        <View style={[styles.params, { borderTopColor: theme.border }]}>
          <ThemedText type="caption" themeColor="textTertiary">
            route params
          </ThemedText>
          {entries.map(([key, value]) => (
            <ThemedText key={key} type="code" themeColor="textSecondary">
              {key} = {value}
            </ThemedText>
          ))}
        </View>
      ) : null}
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  params: {
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.half,
  },
});
