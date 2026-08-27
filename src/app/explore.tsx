import { Ionicons } from '@expo/vector-icons';
import { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { useExploreGroups, useGroupSearch } from '@/api/queries';
import type { Group } from '@/api/types';
import { GroupCard } from '@/components/explore/group-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Breakpoints, Layout, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/time';

/** Two columns once there's room for two readable cards side by side. */
const TWO_COLUMN_AT = 720;

export default function ExploreScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);

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

  const columns = width >= TWO_COLUMN_AT ? 2 : 1;

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

  return (
    <Screen title="Explore" headerBelow={search} scroll={false}>
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
          data={results}
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
            <ThemedText type="caption" themeColor="textTertiary" style={styles.count}>
              {searching
                ? `${formatCount(results.length)} matching`
                : `${formatCount(results.length)} communities`}
              {searching && remote.isFetching ? ' · searching…' : ''}
            </ThemedText>
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
});
