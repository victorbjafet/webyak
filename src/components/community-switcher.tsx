import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupAvatar } from './group-avatar';
import { ThemedText } from './themed-text';

import { useCurrentGroup } from '@/api/current-group';
import { groupDisplayName, isForYouFeed } from '@/api/groups';
import type { Group } from '@/api/types';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Switches which community the home feed shows.
 *
 * Two presentations of one control. On wide screens, a list under Home in the
 * sidebar (`CommunitySwitcher`). Everywhere, the home header's title is itself
 * the picker (`CommunityMenu`): the current community's icon and name with a
 * chevron, opening a dropdown — where the official app keeps it.
 *
 * Narrow screens used to get a scrollable strip of chips above the tab bar
 * instead. It cost a permanent row of the smallest screens for a control used a
 * few times a session, and it sat furthest from the thing it changes — the feed's
 * own header.
 */

/** For You first, then the communities in the order the API gives them. */
function ordered(groups: Group[]) {
  return [...groups.filter(isForYouFeed), ...groups.filter((g) => !isForYouFeed(g))];
}

export function CommunitySwitcher() {
  const router = useRouter();
  const { groups, current, setCurrent, isLoading } = useCurrentGroup();

  // Selecting always lands you on that community's feed, so the choice has a
  // visible result even if you were three screens deep when you made it.
  const choose = useCallback(
    (group: Group) => {
      setCurrent(group);
      router.push('/');
    },
    [setCurrent, router],
  );

  if (isLoading || groups.length === 0) return null;

  return (
    <View style={styles.sidebar}>
      <SidebarHeading />
      {ordered(groups).map((group) => (
        <CommunityRow
          key={group.id}
          group={group}
          active={group.id === current?.id}
          onPress={() => choose(group)}
        />
      ))}
    </View>
  );
}

/**
 * The home header's title, as a dropdown.
 *
 * A `Modal` rather than an absolutely positioned view: the feed below is its own
 * scroller, and a dropdown stacked inside the header loses to it on web, where
 * the list's layer paints over anything that overflows the header. A modal
 * renders above the whole app, and its backdrop is what closes the menu when
 * you tap anywhere else.
 */
export function CommunityMenu() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { groups, current, setCurrent } = useCurrentGroup();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<View>(null);

  const name = groupDisplayName(current);

  const show = () => {
    setOpen(true);
    // Measured on each open, so the menu hangs from wherever the header is now.
    trigger.current?.measureInWindow((x, y, _w, h) => {
      setAnchor({ top: y + h + Spacing.one, left: x });
    });
  };
  const close = () => setOpen(false);

  const choose = (group: Group) => {
    close();
    // Already on the feed this changes; navigating would stack a duplicate
    // history entry on web.
    setCurrent(group);
  };

  if (!current) return null;

  const menuWidth = Math.min(320, width - Spacing.three * 2);
  const top = anchor?.top ?? insets.top + Layout.headerHeight + Spacing.three;
  const left = Math.max(
    Spacing.three,
    Math.min(anchor?.left ?? Spacing.three, width - menuWidth - Spacing.three),
  );

  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={`Switch community. Showing ${name}.`}
        accessibilityState={{ expanded: open }}
        onPress={show}
        style={({ hovered, pressed }) => [
          styles.trigger,
          (hovered || pressed || open) && { backgroundColor: theme.controlHover },
        ]}>
        <GroupAvatar
          group={current}
          name={name}
          iconUrl={current.icon_url}
          color={current.color}
          size={30}
        />
        <ThemedText
          type="subtitle"
          numberOfLines={1}
          style={[styles.triggerLabel, { color: theme.brand }]}>
          {name}
        </ThemedText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.brand} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        {/* Invisible, not dimmed: this is a dropdown, not a dialog. */}
        <Pressable accessibilityLabel="Close" onPress={close} style={StyleSheet.absoluteFill} />
        <View
          accessibilityViewIsModal
          style={[
            styles.menu,
            {
              top,
              left,
              width: menuWidth,
              maxHeight: Math.max(160, height - top - Spacing.five),
              backgroundColor: theme.backgroundElevated,
              borderColor: theme.border,
            },
          ]}>
          <ScrollView bounces={false} contentContainerStyle={styles.menuList}>
            {ordered(groups).map((group) => (
              <CommunityRow
                key={group.id}
                group={group}
                active={group.id === current.id}
                onPress={() => choose(group)}
              />
            ))}
          </ScrollView>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.menuList}>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                close();
                router.push('/explore');
              }}
              style={({ hovered, pressed }) => [
                styles.row,
                (hovered || pressed) && { backgroundColor: theme.backgroundHover },
              ]}>
              <View style={[styles.exploreIcon, { backgroundColor: theme.control }]}>
                <Ionicons name="compass-outline" size={15} color={theme.textSecondary} />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
                Find more communities
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

/*
  Module scope, not nested — see
  docs/ARCHITECTURE.md#helper-components-go-at-module-scope-never-inside-another-component.
*/

function SidebarHeading() {
  return (
    <ThemedText type="caption" themeColor="textTertiary" style={styles.heading}>
      My communities
    </ThemedText>
  );
}

function CommunityRow({
  group,
  active,
  onPress,
}: {
  group: Group;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.row,
        active && { backgroundColor: theme.backgroundSelected },
        !active && (hovered || pressed) ? { backgroundColor: theme.backgroundHover } : null,
      ]}>
      <GroupAvatar
        group={group}
        name={groupDisplayName(group)}
        iconUrl={group.icon_url}
        color={group.color}
        size={24}
      />
      <ThemedText
        type={active ? 'smallBold' : 'small'}
        numberOfLines={1}
        style={[styles.rowLabel, { color: active ? theme.text : theme.textSecondary }]}>
        {groupDisplayName(group)}
      </ThemedText>
      {active ? <Ionicons name="checkmark" size={15} color={theme.brand} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    gap: Spacing.half,
  },
  heading: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    minHeight: 40,
  },
  rowLabel: {
    flex: 1,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
    // The pill reaches a little past the avatar, and the negative margin keeps
    // the avatar itself on the header's content edge.
    paddingLeft: Spacing.one,
    paddingRight: Spacing.two,
    marginLeft: -Spacing.one,
    borderRadius: Radius.pill,
  },
  triggerLabel: {
    flexShrink: 1,
  },
  menu: {
    position: 'absolute',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.45)' },
      default: { elevation: 8 },
    }),
  },
  menuList: {
    paddingHorizontal: Spacing.one,
    gap: Spacing.half,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  exploreIcon: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
