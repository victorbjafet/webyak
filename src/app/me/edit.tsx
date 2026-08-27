import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { checkUsername } from '@/api/client';
import { useUpdateProfile } from '@/api/mutations';
import { useMyIdentity } from '@/api/queries';
import { useSession } from '@/api/session';
import { Screen } from '@/components/screen';
import { ErrorState, LoadingState } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Layout, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showToast } from '@/lib/toast';

/** Yik Yak's own set. Arbitrary emoji are accepted by the API but hard to pick. */
const EMOJI = [
  '😀', '😎', '🥸', '🤠', '👻', '🐀', '🐸', '🦊',
  '🐙', '🦕', '🌵', '🍕', '🎧', '⚡', '🔥', '💀',
];

/** Matches the palette group colors come in — saturated, readable on black. */
const COLORS = [
  '#10CEAC', '#EF514F', '#9796F0', '#4D3300',
  '#335234', '#2D6CDF', '#E0A030', '#B04FA8',
];

const MAX_BIO = 150;
/** Debounce before asking the server whether a name is free. */
const CHECK_DELAY = 450;

export default function EditProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId } = useSession();
  const identity = useMyIdentity();
  const save = useUpdateProfile();

  const [username, setUsername] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  // `null` means untouched, so the loaded value shows through. Tracking that
  // separately is what lets us PATCH only what actually changed — sending every
  // field would re-claim the username on a bio edit.
  const currentUsername = identity.data?.username ?? '';
  const currentBio = identity.data?.bio ?? '';
  const currentEmoji = identity.data?.conversation_icon?.emoji ?? EMOJI[0];
  const currentColor = identity.data?.conversation_icon?.color ?? COLORS[0];

  const usernameValue = username ?? currentUsername;
  const bioValue = bio ?? currentBio;
  const emojiValue = emoji ?? currentEmoji;
  const colorValue = color ?? currentColor;

  const usernameChanged = username !== null && username.trim() !== currentUsername;
  const trimmedUsername = usernameValue.trim();

  useEffect(() => {
    if (!usernameChanged || trimmedUsername.length < 3) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const free = await checkUsername(trimmedUsername);
          if (!cancelled) setAvailable(free);
        } catch {
          // A failed check shouldn't block the form — the save itself is the
          // real gate, and the server rejects a taken name anyway.
          if (!cancelled) setAvailable(null);
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
    }, CHECK_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [usernameChanged, trimmedUsername]);

  const iconChanged = emojiValue !== currentEmoji || colorValue !== currentColor;
  const bioChanged = bio !== null && bio !== currentBio;
  const dirty = usernameChanged || bioChanged || iconChanged;

  const submit = useCallback(() => {
    if (!userId || !dirty) return;
    save.mutate(
      {
        userId,
        update: {
          // Only what changed. A full payload would re-submit the username on
          // every bio edit, which invites a needless rejection.
          ...(usernameChanged ? { username: trimmedUsername } : null),
          ...(bioChanged ? { bio: bioValue } : null),
          ...(iconChanged
            ? {
                conversationIcon: {
                  emoji: emojiValue,
                  color: colorValue,
                  secondary_color:
                    identity.data?.conversation_icon?.secondary_color ?? colorValue,
                },
              }
            : null),
        },
      },
      {
        onSuccess: () => {
          showToast('Profile updated.', 'info');
          if (router.canGoBack()) router.back();
        },
      },
    );
  }, [
    userId,
    dirty,
    save,
    usernameChanged,
    trimmedUsername,
    bioChanged,
    bioValue,
    iconChanged,
    emojiValue,
    colorValue,
    identity.data,
    router,
  ]);

  if (identity.isLoading) {
    return (
      <Screen title="Edit profile" back>
        <LoadingState label="Loading your profile…" />
      </Screen>
    );
  }

  if (identity.isError) {
    return (
      <Screen title="Edit profile" back>
        <ErrorState
          error={identity.error}
          onRetry={() => identity.refetch()}
          title="Couldn't load your profile"
        />
      </Screen>
    );
  }

  const usernameTooShort = usernameChanged && trimmedUsername.length < 3;

  return (
    <Screen
      title="Edit profile"
      back
      scroll={false}
      action={
        <Button
          label="Save"
          onPress={submit}
          disabled={!dirty || save.isPending || available === false || usernameTooShort}
          loading={save.isPending}
        />
      }>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.previewRow}>
          <View style={[styles.preview, { backgroundColor: colorValue }]}>
            <ThemedText style={styles.previewEmoji}>{emojiValue}</ThemedText>
          </View>
          <View style={styles.previewText}>
            <ThemedText type="subtitle">{trimmedUsername || 'No username yet'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {bioValue || 'No bio yet'}
            </ThemedText>
          </View>
        </View>

        <Field label="Username">
          <TextInput
            value={usernameValue}
            onChangeText={setUsername}
            placeholder="Pick a username"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            style={[
              styles.input,
              Typography.body,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor:
                  available === false ? theme.danger : available ? theme.brand : theme.border,
              },
            ]}
          />
          {usernameTooShort ? (
            <Hint tone="muted">At least 3 characters.</Hint>
          ) : checking ? (
            <Hint tone="muted">Checking…</Hint>
          ) : available === true ? (
            <Hint tone="good">That one is free.</Hint>
          ) : available === false ? (
            <Hint tone="bad">Already taken.</Hint>
          ) : (
            <Hint tone="muted">
              Shown on posts you make under your name. Anonymous posts are unaffected.
            </Hint>
          )}
        </Field>

        <Field label="Bio">
          <TextInput
            value={bioValue}
            onChangeText={setBio}
            placeholder="Say something about yourself"
            placeholderTextColor={theme.textTertiary}
            multiline
            maxLength={MAX_BIO}
            style={[
              styles.input,
              styles.bio,
              Typography.small,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          />
          <Hint tone="muted">{`${MAX_BIO - bioValue.length} left`}</Hint>
        </Field>

        <Field label="Icon">
          <View style={styles.swatches}>
            {EMOJI.map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="button"
                accessibilityLabel={`Icon ${choice}`}
                accessibilityState={{ selected: choice === emojiValue }}
                onPress={() => setEmoji(choice)}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: theme.control,
                    borderColor: choice === emojiValue ? theme.brand : 'transparent',
                  },
                ]}>
                <ThemedText style={styles.swatchEmoji}>{choice}</ThemedText>
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Color">
          <View style={styles.swatches}>
            {COLORS.map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="button"
                accessibilityLabel={`Color ${choice}`}
                accessibilityState={{ selected: choice === colorValue }}
                onPress={() => setColor(choice)}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: choice,
                    borderColor: choice === colorValue ? theme.text : 'transparent',
                  },
                ]}
              />
            ))}
          </View>
        </Field>

        {!identity.data?.username && !identity.data?.bio ? (
          <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="information-circle-outline" size={16} color={theme.textTertiary} />
            <ThemedText type="caption" themeColor="textTertiary" style={styles.noteText}>
              Your current profile came back empty. That may mean nothing is set yet, or that
              this payload doesn&rsquo;t carry it &mdash; saving still works either way.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={styles.field}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
        {children}
      </View>
    );
  }

  function Hint({ tone, children }: { tone: 'muted' | 'good' | 'bad'; children: React.ReactNode }) {
    const color =
      tone === 'good' ? theme.brand : tone === 'bad' ? theme.danger : theme.textTertiary;
    return (
      <ThemedText type="caption" style={{ color }}>
        {children}
      </ThemedText>
    );
  }
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  preview: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmoji: {
    fontSize: 26,
    lineHeight: 34,
  },
  previewText: {
    flex: 1,
    gap: Spacing.half,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
  },
  bio: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchEmoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  noteText: {
    flex: 1,
  },
});
