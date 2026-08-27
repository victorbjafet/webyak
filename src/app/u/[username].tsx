import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useUserPosts, useUserProfile } from '@/api/queries';
import { AuthedImage } from '@/components/authed-image';
import { PostCard } from '@/components/post/post-card';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();

  const profile = useUserProfile(username);
  const posts = useUserPosts(username);

  if (profile.isLoading) {
    return (
      <Screen title={username ? `@${username}` : 'Profile'} back>
        <LoadingState label="Loading profile…" />
      </Screen>
    );
  }

  if (profile.isError) {
    return (
      <Screen title={username ? `@${username}` : 'Profile'} back>
        <ErrorState
          error={profile.error}
          onRetry={() => profile.refetch()}
          title="Couldn't load this profile"
        />
      </Screen>
    );
  }

  const icon = profile.data?.conversation_icon;
  // The Profile typedef says the icon is emoji + color, but that came from
  // sidechat.js's JSDoc which has been wrong before, so handle an image URL too
  // and fall back to a glyph rather than rendering an empty circle.
  const imageUrl = profile.data?.icon_url ?? profile.data?.image_url;

  return (
    <Screen title={`@${username}`} back scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <View style={styles.identityRow}>
            <View style={[styles.bigAvatar, { backgroundColor: icon?.color || theme.control }]}>
              <AuthedImage
                uri={imageUrl}
                context="profile-photo"
                fallback={<ThemedText style={styles.bigEmoji}>{icon?.emoji ?? '👤'}</ThemedText>}
                style={styles.avatarImage}
                contentFit="cover"
              />
            </View>
            <View style={styles.identityText}>
              <ThemedText type="subtitle">{profile.data?.name ?? username}</ThemedText>
              {profile.data?.description ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {profile.data.description}
                </ThemedText>
              ) : null}
            </View>
          </View>

          {/*
            Following is not implementable yet: posts carry `follow_status` and
            identities carry `is_following`, but sidechat.js exposes no method to
            change either and no endpoint has been found. Tracked in PLAN.md
            Phase 8 rather than shipped as a button that does nothing.
          */}
          <ThemedText type="caption" themeColor="textTertiary">
            Following isn&apos;t available yet — the endpoint for it hasn&apos;t been found.
          </ThemedText>
        </View>

        <ThemedText type="heading">Posts</ThemedText>

        {posts.isLoading ? <LoadingState label="Loading posts…" /> : null}
        {posts.isError ? (
          <ErrorState error={posts.error} onRetry={() => posts.refetch()} title="Couldn't load posts" />
        ) : null}
        {posts.data?.length === 0 ? (
          <EmptyState icon="document-outline" title="No posts" body="Nothing public here yet." />
        ) : null}

        {posts.data?.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            showGroup
            onPress={
              post.index_code
                ? () => router.push({ pathname: '/p/[code]', params: { code: post.index_code! } })
                : undefined
            }
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    // Full-width scroller, centred content — see the note in screen.tsx.
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  bigAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bigEmoji: {
    fontSize: 30,
    lineHeight: 40,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  identityText: {
    flex: 1,
    gap: Spacing.one,
  },
});
