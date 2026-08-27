import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Group chats for your school, above the community list.
 *
 * The official app puts a horizontal strip of joinable school group chats at
 * the top of Explore with a "View all", and the infinite community list below
 * it. This is the strip's slot, held with a placeholder.
 *
 * **The data is actually reachable** — `GET /v1/chats/explore` works (the
 * library builds it with `&` instead of `?`, so `getGroupChats` in client.ts
 * patches the URL). What's missing is Phase 6: there is no chat screen to open
 * one in, and no join flow. Listing chats that can't be entered would be worse
 * than saying so.
 *
 * Deliberately not hidden: the section is part of the app's shape, and leaving
 * a hole where the official app has content reads as something failing to load.
 */
export function GroupChatsSection({ schoolName }: { schoolName?: string }) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="bodyBold" numberOfLines={1} style={styles.title}>
          {schoolName ? `${schoolName} group chats` : 'Group chats'}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all group chats"
          disabled
          {...{ title: 'Group chats arrive with messaging in Phase 6' }}
          style={styles.viewAll}>
          <ThemedText type="caption" themeColor="textTertiary">
            View all
          </ThemedText>
        </Pressable>
      </View>

      <View
        style={[
          styles.placeholder,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Ionicons name="chatbubbles-outline" size={20} color={theme.textTertiary} />
        <View style={styles.placeholderText}>
          <ThemedText type="small" themeColor="textSecondary">
            Group chats aren&rsquo;t open yet
          </ThemedText>
          <ThemedText type="caption" themeColor="textTertiary">
            The list is reachable — `/v1/chats/explore` works — but there&rsquo;s nowhere to open
            one until messaging lands in Phase 6.
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  viewAll: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    opacity: 0.5,
  },
  placeholder: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeholderText: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
});
