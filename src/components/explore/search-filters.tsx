import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { readFlag, readOperator, writeFlag, writeOperator } from '@/lib/archive/query';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Point-and-click filters for the archive query.
 *
 * **Every control writes the query string.** The text box stays the single
 * source of truth — a panel holding its own state alongside the query would let
 * the two disagree the moment someone edited the text by hand, and then neither
 * is authoritative.
 *
 * The upside beyond correctness: the syntax stays visible. Set a filter here and
 * the operator appears in the box, so the panel teaches the query language
 * instead of hiding it — which is why the example chips it replaced are gone.
 */
export function SearchFilters({
  value,
  onChange,
  groups,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Community names present in the archive, for the picker. */
  groups: string[];
}) {
  const theme = useTheme();

  const author = readOperator(value, ['from', 'author', 'by']) ?? '';
  const group = readOperator(value, ['in', 'group', 'community']) ?? '';
  const since = readOperator(value, ['since', 'after']) ?? '';
  const until = readOperator(value, ['until', 'before']) ?? '';
  const minScore = readOperator(value, ['min_score', 'min_votes', 'min_faves']) ?? '';
  const maxScore = readOperator(value, ['max_score', 'max_votes']) ?? '';
  const sort = readOperator(value, ['sort']) ?? 'new';

  const media = readFlag(value, 'has', ['media', 'image', 'photo', 'video']);
  const reply = readFlag(value, 'is', ['reply']);
  const deleted = readFlag(value, 'is', ['deleted']) ?? readFlag(value, 'include', ['deleted']);

  const set = (keys: string[], next?: string) => onChange(writeOperator(value, keys, next));

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Row label="Author">
        <Field
          value={author}
          placeholder="username"
          onChangeText={(next) => set(['from'], next.replace(/^@/, ''))}
        />
      </Row>

      {groups.length > 1 ? (
        <Row label="Community">
          <View style={styles.chips}>
            <Chip label="Any" active={!group} onPress={() => set(['in'], undefined)} />
            {groups.map((name) => (
              <Chip
                key={name}
                label={name}
                active={group.toLowerCase() === name.toLowerCase()}
                onPress={() => set(['in'], group.toLowerCase() === name.toLowerCase() ? undefined : name)}
              />
            ))}
          </View>
        </Row>
      ) : null}

      <Row label="Dates">
        <View style={styles.pair}>
          <Field
            value={since}
            placeholder="from 2026-01-01"
            onChangeText={(next) => set(['since'], next)}
          />
          <Field
            value={until}
            placeholder="to 2026-12-31"
            onChangeText={(next) => set(['until'], next)}
          />
        </View>
      </Row>

      <Row label="Score">
        <View style={styles.pair}>
          <Field
            value={minScore}
            placeholder="at least"
            keyboardType="numeric"
            onChangeText={(next) => set(['min_score'], next)}
          />
          <Field
            value={maxScore}
            placeholder="at most"
            keyboardType="numeric"
            onChangeText={(next) => set(['max_score'], next)}
          />
        </View>
      </Row>

      <Row label="Attachments">
        <View style={styles.chips}>
          <Chip
            label="Any"
            active={!media}
            onPress={() => onChange(writeFlag(value, 'has', ['media', 'image', 'photo', 'video']))}
          />
          {(['media', 'image', 'video'] as const).map((kind) => (
            <Chip
              key={kind}
              label={kind === 'media' ? 'Has media' : kind === 'image' ? 'Images' : 'Video'}
              active={media === kind || (kind === 'image' && media === 'photo')}
              onPress={() =>
                onChange(
                  writeFlag(
                    value,
                    'has',
                    ['media', 'image', 'photo', 'video'],
                    media === kind ? undefined : kind,
                  ),
                )
              }
            />
          ))}
        </View>
      </Row>

      <Row label="Replies">
        <View style={styles.chips}>
          <Chip
            label="Any"
            active={!reply}
            onPress={() => onChange(writeFlag(value, 'is', ['reply']))}
          />
          <Chip
            label="Replies only"
            active={reply === 'reply'}
            onPress={() =>
              onChange(writeFlag(value, 'is', ['reply'], reply ? undefined : 'reply'))
            }
          />
        </View>
      </Row>

      <Row label="Removed">
        <View style={styles.chips}>
          {/*
            Three states, not a toggle: hidden, shown alongside, or shown alone.
            "Only deleted" is the interesting one — it answers what got taken
            down, which is a question only an archive can answer at all.
          */}
          <Chip
            label="Hidden"
            active={!deleted}
            onPress={() =>
              onChange(writeFlag(writeFlag(value, 'is', ['deleted']), 'include', ['deleted']))
            }
          />
          <Chip
            label="Included"
            active={deleted === 'deleted' && /include:deleted/i.test(value)}
            onPress={() =>
              onChange(
                writeFlag(writeFlag(value, 'is', ['deleted']), 'include', ['deleted'], 'deleted'),
              )
            }
          />
          <Chip
            label="Only removed"
            active={/(^|\s)is:deleted/i.test(value)}
            onPress={() =>
              onChange(
                writeFlag(writeFlag(value, 'include', ['deleted']), 'is', ['deleted'], 'deleted'),
              )
            }
          />
        </View>
      </Row>

      <Row label="Sort">
        <View style={styles.chips}>
          {(
            [
              { value: 'new', label: 'Newest' },
              { value: 'old', label: 'Oldest' },
              { value: 'top', label: 'Highest score' },
            ] as const
          ).map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={sort === option.value}
              onPress={() => set(['sort'], option.value === 'new' ? undefined : option.value)}
            />
          ))}
        </View>
      </Row>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear all filters"
        onPress={() => onChange(clearOperators(value))}
        style={({ hovered }) => [styles.clear, hovered && { opacity: 0.7 }]}>
        <Ionicons name="close-circle-outline" size={14} color={theme.textTertiary} />
        <ThemedText type="caption" themeColor="textTertiary">
          Clear filters, keep the words
        </ThemedText>
      </Pressable>
    </View>
  );
}

/*
  These live at module scope, not inside `SearchFilters`.

  Declaring a component inside another component creates a **new component type
  on every render**, so React cannot match it against the previous tree — it
  unmounts the old one and mounts a fresh one. For a `TextInput` that means the
  DOM node is replaced on every keystroke and focus goes with it, which is
  exactly the bug this caused: one character per click into the box.
*/

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <View style={styles.rowBody}>{children}</View>
    </View>
  );
}

function Field({
  value,
  placeholder,
  onChangeText,
  keyboardType,
}: {
  value: string;
  placeholder: string;
  onChangeText: (next: string) => void;
  keyboardType?: 'numeric';
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textTertiary}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboardType}
      style={[
        styles.field,
        Typography.caption,
        { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
      ]}
    />
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.brandMuted : theme.control,
          borderColor: active ? theme.brand : 'transparent',
        },
        hovered && { opacity: 0.85 },
      ]}>
      <ThemedText type="caption" style={{ color: active ? theme.brand : theme.controlText }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Strips every operator token, leaving the free text the person typed. */
function clearOperators(input: string): string {
  return (input.match(/-?(?:"[^"]*"|\S+)/g) ?? [])
    .filter((token) => token.startsWith('"') || !/^-?[a-z_]+:/i.test(token))
    .join(' ')
    .trim();
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  rowLabel: {
    width: 84,
    paddingTop: Spacing.one,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  field: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingTop: Spacing.one,
  },
});
