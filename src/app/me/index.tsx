import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  useKarma,
  useMyContent,
  useMyIdentity,
  useSavedPosts,
  useUpvotedPosts,
} from '@/api/queries';
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
  const upvoted = useUpvotedPosts();

  const active = tab === 'saved' ? saved : tab === 'upvotes' ? upvoted : content;
  const items =
    tab === 'saved' ? saved.data : tab === 'upvotes' ? upvoted.data : isContentTab ? content.data : undefined;

  return (
    <Screen
      title="You"
      scroll={false}
      action={
        // Temporary. The probes are how every API question gets answered, and
        // they were previously reachable only by scrolling past every post on
        // this screen. Header slot until there's a settings screen to hold it.
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open diagnostics"
          onPress={() => router.push('/diagnostics')}
          style={({ hovered, pressed }) => [
            styles.debug,
            { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
          ]}>
          <Ionicons name="bug-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Probes
          </ThemedText>
        </Pressable>
      }>
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
                      : tab === 'upvotes'
                        ? 'arrow-up-circle-outline'
                        : 'document-outline'
                }
                title={
                  tab === 'comments'
                    ? 'No comments yet'
                    : tab === 'saved'
                      ? 'Nothing saved'
                      : tab === 'upvotes'
                        ? 'No upvotes yet'
                        : 'No posts yet'
                }
                body={
                  tab === 'comments'
                    ? 'Your replies show up here.'
                    : tab === 'saved'
                      ? "Posts you save in the official app appear here. Saving can't be done from webyak yet — the API has no write path for it."
                      : tab === 'upvotes'
                        ? 'Posts you upvote show up here.'
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
  debug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
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
