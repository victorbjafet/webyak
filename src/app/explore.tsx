import { Ionicons } from '@expo/vector-icons';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useExploreGroups, useGroupSearch } from '@/api/queries';
import { useSession } from '@/api/session';
import type { Group } from '@/api/types';
import { ArchiveSearch } from '@/components/explore/archive-search';
import { UnwiredCreateButton } from '@/components/explore/create-button';
import { GroupCard } from '@/components/explore/group-card';
import { GroupChatsList } from '@/components/explore/group-chats-list';
import { TWO_COLUMN_AT } from '@/components/explore/layout';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Breakpoints, Layout, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/**
 * Explore's three tabs. They share nothing but the screen — live communities,
 * the school's group chats, and what has been archived — so they are tabs
 * rather than one merged list.
 */
type Mode = 'communities' | 'chats' | 'archive';

const MODES: { value: Mode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'communities', label: 'Communities', icon: 'compass-outline' },
  { value: 'chats', label: 'Group chats', icon: 'chatbubbles-outline' },
  { value: 'archive', label: 'Archive', icon: 'search-outline' },
];

export default function ExploreScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<Mode>('communities');
  const { primaryGroup } = useSession();

  const all = useExploreGroups();
  // Keeps typing responsive: filtering 4,000+ rows on every keystroke blocks
  // input, and the deferred value lets React drop intermediate passes.
  const deferredTerm = useDeferredValue(term);
  const remote = useGroupSearch(deferredTerm);

  const trimmed = deferredTerm.trim();
  const searching = trimmed.length >= 2;

  /**
   * Local filter first, server results merged in.
   *
   * The catalogue is already in memory, so filtering it is instant and works
   * offline; search adds anything the catalogue missed. Merged by id, local
   * first, because those objects carry the membership state the join button
   * reads.
   */
  const results = useMemo(() => {
    const catalogue = all.data ?? [];
    if (!searching) return catalogue;

    const needle = trimmed.toLowerCase();
    const local = catalogue.filter((g) => g.name?.toLowerCase().includes(needle));
    const seen = new Set(local.map((g) => g.id));
    const extra = (remote.data ?? []).filter((g) => g?.id && !seen.has(g.id));
    return [...local, ...extra];
  }, [all.data, remote.data, searching, trimmed]);

  /**
   * Most members first, matching the official app — any other order buries
   * every community anyone uses under thousands of dead ones. It is the only
   * order: "Newest" was offered disabled, since no explore field is a
   * timestamp, and was removed on 2026-09-27
   * (docs/API.md#-explore-cannot-sort-by-newest).
   *
   * Search results keep their relevance order — re-sorting them by size would
   * bury an exact name match under a bigger partial one.
   */
  const ordered = useMemo(() => {
    if (searching) return results;
    return [...results].sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0));
  }, [results, searching]);

  const columns = width >= TWO_COLUMN_AT ? 2 : 1;

  const modeTabs = (
    <View style={[styles.modes, { backgroundColor: theme.control }]}>
      {MODES.map((option) => {
        const selected = option.value === mode;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => setMode(option.value)}
            style={({ hovered }) => [
              styles.mode,
              selected && { backgroundColor: theme.backgroundSelected },
              !selected && hovered ? { backgroundColor: theme.controlHover } : null,
            ]}>
            <Ionicons
              name={option.icon}
              size={14}
              color={selected ? theme.brand : theme.controlText}
            />
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.brand : theme.controlText }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  const search = (
    <View
      style={[
        styles.search,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: focused ? theme.brand : theme.border,
        },
      ]}>
      <Ionicons name="search" size={16} color={theme.textTertiary} />
      <TextInput
        value={term}
        onChangeText={setTerm}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search communities"
        placeholderTextColor={theme.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.input, Typography.small, { color: theme.text }]}
      />
      {term ? (
        <Ionicons
          name="close-circle"
          size={16}
          color={theme.textTertiary}
          onPress={() => setTerm('')}
        />
      ) : null}
    </View>
  );

  if (mode === 'archive') {
    return (
      <Screen title="Explore" headerBelow={modeTabs} scroll={false}>
        <ArchiveSearch />
      </Screen>
    );
  }

  if (mode === 'chats') {
    return (
      <Screen title="Explore" headerBelow={modeTabs} scroll={false}>
        <GroupChatsList schoolName={primaryGroup?.name} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Explore"
      headerBelow={
        <View style={styles.headerStack}>
          {modeTabs}
          {search}
        </View>
      }
      scroll={false}>
      {all.isLoading ? <LoadingState label="Loading communities…" /> : null}

      {all.isError ? (
        <ErrorState
          error={all.error}
          onRetry={() => all.refetch()}
          title="Couldn't load communities"
        />
      ) : null}

      {all.data ? (
        <FlatList
          // `key` forces a fresh list when the column count changes — FlatList
          // cannot change `numColumns` on an existing instance.
          key={columns}
          data={ordered}
          numColumns={columns}
          keyExtractor={(item: Group) => item.id}
          renderItem={({ item }) => <GroupCard group={item} />}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          // 4,000+ rows: keep the window tight so scrolling stays cheap.
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <ThemedText type="caption" themeColor="textTertiary" style={styles.count}>
                {searching
                  ? `${formatCount(ordered.length)} matching`
                  : `${formatCount(ordered.length)} communities · most members first`}
                {searching && remote.isFetching ? ' · searching…' : ''}
              </ThemedText>
              <UnwiredCreateButton
                label="Create community"
                reason="Not wired up yet. getUpdates() carries create_group_application_enabled, which suggests communities are applied for rather than created."
              />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No communities found"
              body={
                searching
                  ? 'Try a shorter or different term.'
                  : 'The explore list came back empty.'
              }
            />
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    // Web only: the input carries the browser's default focus outline, which
    // the ring is meant to replace (docs/DESIGN.md#focus-rings).
    outlineStyle: 'none',
  } as object,
  content: {
    width: '100%',
    maxWidth: Breakpoints.sidebar,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  row: {
    gap: Spacing.two,
  },
  count: {
    paddingVertical: Spacing.two,
  },
  headerStack: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    gap: Spacing.two,
  },
  modes: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.pill,
    gap: Spacing.half,
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
  },
  mode: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    flexWrap: 'wrap',
    paddingTop: Spacing.two,
  },
});
