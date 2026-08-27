import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { GroupAvatar } from '../group-avatar';
import { ThemedText } from '../themed-text';
import { JoinButton } from './join-button';

import type { Group } from '@/api/types';
import { groupHref, groupSlug } from '@/api/groups';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/**
 * One community in the explore grid.
 *
 * The card body opens the group and the join control is a **sibling**, not a
 * child — a button inside a button is rejected outright on the web
 * (docs/DESIGN.md#never-nest-interactive-elements). That is also why the whole
 * card isn't pressable: the join button has to live somewhere.
 */
export function GroupCard({ group }: { group: Group }) {
  const theme = useTheme();
  const router = useRouter();

  const isMember = group.membership_type === 'member';
  // No slug means no URL we can build; the card still shows, it just doesn't
  // navigate, rather than routing to /g/null.
  const slug = groupSlug(group);
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${group.name}`}
        disabled={!slug}
        onPress={() => slug && router.push(groupHref(slug))}
        style={({ hovered, pressed }) => [
          styles.body,
          slug && (hovered || pressed) ? styles.bodyActive : null,
        ]}>
        <GroupAvatar group={group} name={group.name} iconUrl={group.icon_url} color={group.color} size={40} />
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {group.name}
          </ThemedText>
          {group.member_count ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {formatCount(group.member_count)} members
            </ThemedText>
          ) : null}
          {group.description ? (
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
              {group.description}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>

      <JoinButton
        groupId={group.id}
        name={group.name}
        isMember={isMember}
        canJoin={group.can_join !== false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
    minWidth: 0,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: Radius.md,
  },
  bodyActive: {
    opacity: 0.8,
  },
  text: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  join: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  locked: {
    opacity: 0.6,
  },
  pending: {
    opacity: 0.5,
  },
});
