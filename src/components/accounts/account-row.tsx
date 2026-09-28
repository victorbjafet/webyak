import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import type { SavedAccount } from '@/api/accounts';
import { groupDisplayName } from '@/api/groups';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A saved account as the switcher shows it: its icon, its name, and its
 * community underneath, which is often what tells two phone numbers apart.
 * `trailing` is the row's own controls.
 */
export function AccountRow({
  account,
  current = false,
  trailing,
}: {
  account: SavedAccount;
  current?: boolean;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  const community = account.primaryGroup ? groupDisplayName(account.primaryGroup) : null;

  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: account.icon?.color || theme.control }]}>
        {account.icon?.emoji ? (
          <ThemedText style={styles.emoji}>{account.icon.emoji}</ThemedText>
        ) : (
          <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
        )}
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {account.label}
          </ThemedText>
          {current ? (
            <View style={[styles.pill, { backgroundColor: theme.brandMuted }]}>
              <ThemedText type="caption" style={{ color: theme.brand }}>
                Signed in
              </ThemedText>
            </View>
          ) : null}
        </View>
        {community ? (
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
            {community}
          </ThemedText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 16,
    lineHeight: 22,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flexShrink: 1,
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Radius.pill,
  },
});
