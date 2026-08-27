import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useMyContent } from '@/api/queries';
import { useSession } from '@/api/session';
import { CommentItem } from '@/components/post/comment-item';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'posts' | 'comments';

export default function MeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId, primaryGroup, deviceId, signOut } = useSession();
  const [tab, setTab] = useState<Tab>('posts');

  // Both tabs are cached separately, so switching back is instant.
  const content = useMyContent(tab);

  return (
    <Screen title="You" scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.tabs}>
          <Tabs value={tab} onChange={setTab} />
        </View>

        {content.isLoading ? <LoadingState label={`Loading your ${tab}…`} /> : null}

        {content.isError ? (
          <ErrorState
            error={content.error}
            onRetry={() => content.refetch()}
            title={`Couldn't load your ${tab}`}
          />
        ) : null}

        {content.data?.length === 0 ? (
          <EmptyState
            icon={tab === 'posts' ? 'document-outline' : 'chatbubble-outline'}
            title={tab === 'posts' ? 'No posts yet' : 'No comments yet'}
            body={
              tab === 'posts'
                ? 'Anything you post shows up here, anonymous or not.'
                : 'Your replies show up here.'
            }
          />
        ) : null}

        {/*
          Anonymous posts appear here too — this list is keyed to the account,
          not the identity shown on the post. That is how the official app
          behaves, and it is worth knowing before assuming the list is filtered.
        */}
        {content.data?.map((item) =>
          tab === 'posts' ? (
            <PostCard
              key={item.id}
              post={item}
              showGroup
              onPress={
                item.index_code
                  ? () => router.push({ pathname: '/p/[code]', params: { code: item.index_code! } })
                  : undefined
              }
            />
          ) : (
            <CommentItem key={item.id} comment={item} />
          ),
        )}

        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <ThemedText type="bodyBold">Account</ThemedText>
          <Row label="user id" value={userId ?? '—'} />
          <Row label="primary group" value={primaryGroup?.name ?? 'none'} />
          <Row label="device id" value={deviceId ?? '—'} />
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <ThemedText type="bodyBold">Diagnostics</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Runs the probes that answer open API questions against the live API.
          </ThemedText>
          <Button
            label="Open diagnostics"
            variant="secondary"
            onPress={() => router.push('/diagnostics')}
          />
        </View>

        <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );

  function Tabs({ value, onChange }: { value: Tab; onChange: (next: Tab) => void }) {
    return (
      <View style={[styles.tabRow, { backgroundColor: theme.control }]}>
        {(['posts', 'comments'] as Tab[]).map((key) => {
          const active = key === value;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(key)}
              style={({ hovered }) => [
                styles.tab,
                active && { backgroundColor: theme.backgroundSelected },
                !active && hovered ? { backgroundColor: theme.controlHover } : null,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? theme.brand : theme.controlText }}>
                {key === 'posts' ? 'Your posts' : 'Your comments'}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="code">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  tabs: {
    paddingTop: Spacing.three,
  },
  tabRow: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.pill,
    gap: Spacing.half,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
