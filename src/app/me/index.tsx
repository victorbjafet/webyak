import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useKarma, useMyContent, useMyIdentity, useSavedPosts } from '@/api/queries';
import { useSession } from '@/api/session';
import { KarmaPanel } from '@/components/me/karma-panel';
import { CommentItem } from '@/components/post/comment-item';
import { IdentityAvatar } from '@/components/post/identity-avatar';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'posts' | 'comments' | 'saved' | 'upvotes';

const TABS: { value: Tab; label: string }[] = [
  { value: 'posts', label: 'Posts' },
  { value: 'comments', label: 'Comments' },
  { value: 'saved', label: 'Saved' },
  { value: 'upvotes', label: 'Upvotes' },
];

export default function MeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId, primaryGroup, deviceId, signOut } = useSession();
  const [tab, setTab] = useState<Tab>('posts');
  const identity = useMyIdentity();
  const karma = useKarma();

  // Each tab is a separate cache entry, so switching back is instant. The
  // queries for the tab that isn't showing stay disabled rather than running.
  const isContentTab = tab === 'posts' || tab === 'comments';
  const content = useMyContent(isContentTab ? (tab as 'posts' | 'comments') : 'posts');
  const saved = useSavedPosts();

  const active = tab === 'saved' ? saved : content;
  const items = tab === 'saved' ? saved.data : isContentTab ? content.data : undefined;

  return (
    <Screen title="You" scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.card,
            styles.identityCard,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <IdentityAvatar
            identity={{
              name: identity.data?.username ?? '',
              posted_with_username: true,
              conversation_icon: identity.data?.conversation_icon,
            }}
            size={44}
          />
          <View style={styles.identityText}>
            <ThemedText type="bodyBold" numberOfLines={1}>
              {identity.data?.username || 'No username yet'}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
              {identity.data?.bio || 'No bio yet'}
            </ThemedText>
          </View>
          <Button label="Edit" variant="secondary" onPress={() => router.push('/me/edit')} />
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <ThemedText type="bodyBold">Yakarma</ThemedText>
          {karma.isLoading ? (
            <ThemedText type="small" themeColor="textTertiary">
              Loading…
            </ThemedText>
          ) : (
            <KarmaPanel karma={karma.data} />
          )}
        </View>

        <View style={styles.tabs}>
          <Tabs value={tab} onChange={setTab} />
        </View>

        {tab === 'upvotes' ? (
          /*
            ⛔ No endpoint found. Six candidates swept, all 404 — see
            docs/API.md#-posts-you-upvoted. Shown rather than hidden because the
            official app has this tab, so its absence is a gap worth naming
            instead of a feature we appear to have forgotten.
          */
          <EmptyState
            icon="arrow-up-circle-outline"
            title="Upvotes aren't available"
            body="The official app lists posts you've upvoted, but no endpoint for it has been found — six candidate routes all return 404. Documented in docs/API.md."
          />
        ) : (
          <>
            {active.isLoading ? <LoadingState label={`Loading your ${tab}…`} /> : null}

            {active.isError ? (
              <ErrorState
                error={active.error}
                onRetry={() => active.refetch()}
                title={`Couldn't load your ${tab}`}
              />
            ) : null}

            {items?.length === 0 ? (
              <EmptyState
                icon={
                  tab === 'comments'
                    ? 'chatbubble-outline'
                    : tab === 'saved'
                      ? 'bookmark-outline'
                      : 'document-outline'
                }
                title={
                  tab === 'comments'
                    ? 'No comments yet'
                    : tab === 'saved'
                      ? 'Nothing saved'
                      : 'No posts yet'
                }
                body={
                  tab === 'comments'
                    ? 'Your replies show up here.'
                    : tab === 'saved'
                      ? "Posts you save in the official app appear here. Saving can't be done from webyak yet — the API has no write path for it."
                      : 'Anything you post shows up here, anonymous or not.'
                }
              />
            ) : null}

            {/*
              Anonymous posts appear here too — this list is keyed to the
              account, not the identity shown on the post. That is how the
              official app behaves, and it is worth knowing before assuming the
              list is filtered.
            */}
            {items?.map((item) =>
              tab === 'comments' ? (
                <CommentItem key={item.id} comment={item} />
              ) : (
                <PostCard
                  key={item.id}
                  post={item}
                  showGroup
                  onPress={
                    item.index_code
                      ? () =>
                          router.push({ pathname: '/p/[code]', params: { code: item.index_code! } })
                      : undefined
                  }
                />
              ),
            )}
          </>
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
        {TABS.map(({ value: key, label }) => {
          const selected = key === value;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(key)}
              style={({ hovered }) => [
                styles.tab,
                selected && { backgroundColor: theme.backgroundSelected },
                !selected && hovered ? { backgroundColor: theme.controlHover } : null,
              ]}>
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                style={{ color: selected ? theme.brand : theme.controlText }}>
                {label}
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
    paddingTop: Spacing.one,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  identityText: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
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
