import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Layout, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeQuery, isEmptyQuery, parseQuery } from '@/lib/archive/query';
import { archiveAvailable, getArchiveStats, searchArchive } from '@/lib/archive/store';
import type { SearchResult } from '@/lib/archive/store';
import type { ArchivedContent } from '@/lib/archive/types';
import { formatCount } from '@/lib/time';

/**
 * Long enough that a query isn't run on every keystroke of a long expression,
 * short enough to feel immediate. Search is local, so this is about wasted work
 * rather than network politeness.
 */
const DEBOUNCE_MS = 250;

const EXAMPLES: { label: string; query: string }[] = [
  { label: 'Exact phrase', query: '"grey market"' },
  { label: 'Exclude a word', query: 'parking -permit' },
  { label: 'By a user', query: 'from:snoopyvt' },
  { label: 'Best of a month', query: 'since:2026-04-01 until:2026-04-30 sort:top' },
  { label: 'Popular only', query: 'min_score:50 sort:top' },
  { label: 'With photos', query: 'has:image' },
  { label: 'Removed posts', query: 'is:deleted' },
];

/**
 * Advanced search over the local archive.
 *
 * This searches **what this browser has saved**, not Yik Yak — the API has no
 * search endpoint, and posts leave it. So the corpus is whatever the archive
 * holds, which is the point: it can answer questions about content the server no
 * longer serves.
 *
 * Results are archive records rather than live posts, so they are rendered
 * plainly instead of as `PostCard`s. A card implies working vote buttons and a
 * live score; these are a snapshot, and dressing them up as the real thing would
 * be a lie about what they are.
 */
export function ArchiveSearch() {
  const theme = useTheme();
  const router = useRouter();

  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!archiveAvailable) return;
    void getArchiveStats()
      .then((stats) => setTotal(stats.posts + stats.comments))
      .catch(() => setTotal(null));
  }, []);

  const run = useCallback(async (raw: string) => {
    const query = parseQuery(raw);
    if (isEmptyQuery(query)) {
      setResult(null);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await searchArchive(query));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Debounced so a long expression isn't re-run mid-typing.
  useEffect(() => {
    const handle = setTimeout(() => void run(input), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input, run]);

  const parsed = parseQuery(input);
  const description = describeQuery(parsed);

  if (!archiveAvailable) {
    return (
      <View style={styles.pad}>
        <ThemedText type="small" themeColor="textSecondary">
          Archive search is only available on the web build.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
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
            value={input}
            onChangeText={setInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search the archive — try from:someone or min_score:50"
            placeholderTextColor={theme.textTertiary}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.input, Typography.small, { color: theme.text }]}
          />
          {input ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setInput('')}>
              <Ionicons name="close-circle" size={16} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        {/* Echoes back what the query was understood to mean, so a mistyped
            operator is visible rather than silently treated as a word. */}
        {description.length > 0 ? (
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={2}>
            {description.join(' · ')}
          </ThemedText>
        ) : (
          <View style={styles.examples}>
            {EXAMPLES.map((example) => (
              <Pressable
                key={example.query}
                accessibilityRole="button"
                accessibilityLabel={`Try ${example.label}`}
                onPress={() => setInput(example.query)}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
                ]}>
                <ThemedText type="caption" themeColor="controlText">
                  {example.query}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        {result ? (
          <ThemedText type="caption" themeColor="textTertiary">
            {formatCount(result.records.length)}
            {result.truncated ? '+' : ''} of {formatCount(total ?? 0)} archived · {result.ms}ms ·{' '}
            {result.strategy} · {formatCount(result.scanned)} examined
          </ThemedText>
        ) : total !== null ? (
          <ThemedText type="caption" themeColor="textTertiary">
            {formatCount(total)} posts and comments saved on this device.
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="caption" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
      </View>

      <FlatList
        data={result?.records ?? []}
        keyExtractor={(item: ArchivedContent) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        windowSize={7}
        ListEmptyComponent={
          busy ? null : (
            <ThemedText type="small" themeColor="textTertiary" style={styles.empty}>
              {input.trim()
                ? 'Nothing in the archive matches that.'
                : 'Search every post and comment this browser has saved — including ones Yik Yak has since dropped.'}
            </ThemedText>
          )
        }
        renderItem={({ item }) => <Result record={item} />}
      />
    </View>
  );

  function Result({ record }: { record: ArchivedContent }) {
    // Comments open their parent post; a comment has no page of its own.
    const target = record.type === 'comment' ? record.parent_post_id : record.id;

    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open this post"
        disabled={!target}
        onPress={() => target && router.push({ pathname: '/p/[code]', params: { code: target } })}
        style={({ hovered, pressed }) => [
          styles.result,
          {
            backgroundColor:
              hovered || pressed ? theme.backgroundHover : theme.backgroundElement,
            borderColor: record.deleted ? theme.danger : theme.border,
          },
        ]}>
        <View style={styles.resultHead}>
          <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
            {record.group_name ?? 'Community'}
          </ThemedText>
          {record.author ? (
            <ThemedText type="caption" style={{ color: theme.brand }}>
              @{record.author}
            </ThemedText>
          ) : record.alias ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {record.alias}
            </ThemedText>
          ) : null}
          <View style={styles.spacer} />
          {record.type === 'comment' ? <Tag label={record.is_reply ? 'reply' : 'comment'} /> : null}
          {record.has_media ? (
            <Tag label={record.media?.[0]?.type === 'video' ? 'video' : 'image'} />
          ) : null}
          {record.deleted ? <Tag label="deleted" danger /> : null}
        </View>

        <ThemedText type="small" numberOfLines={6}>
          {record.text || '(no text)'}
        </ThemedText>

        <View style={styles.resultFoot}>
          <ThemedText type="caption" themeColor="textTertiary">
            {record.created_at?.slice(0, 10)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.brand }}>
            {record.vote_total > 0 ? '+' : ''}
            {formatCount(record.vote_total)}
          </ThemedText>
          {record.comment_count ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {formatCount(record.comment_count)} replies
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    );
  }

  function Tag({ label, danger }: { label: string; danger?: boolean }) {
    return (
      <View
        style={[
          styles.tag,
          { backgroundColor: danger ? theme.danger : theme.control },
        ]}>
        <ThemedText type="caption" style={{ color: danger ? '#FFFFFF' : theme.controlText }}>
          {label}
        </ThemedText>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pad: {
    padding: Spacing.three,
  },
  header: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    outlineStyle: 'none',
  } as object,
  examples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  list: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
  result: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resultHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  resultFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  spacer: {
    flex: 1,
  },
  tag: {
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.sm,
  },
});
