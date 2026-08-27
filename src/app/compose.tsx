import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useCurrentGroup } from '@/api/current-group';
import { groupDisplayName, isForYouFeed } from '@/api/groups';
import { useSession } from '@/api/session';
import { uploadAssetWeb } from '@/api/client';
import { useCreatePost } from '@/api/mutations';
import { usePost } from '@/api/queries';
import type { NewPostAsset } from '@/api/types';
import { GroupAvatar } from '@/components/group-avatar';
import { PollComposer, MAX_POLL_OPTIONS } from '@/components/compose/poll-composer';
import { QuotedPost } from '@/components/post/quoted-post';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { canPickImages, pickImage, releaseImage, type PickedImage } from '@/lib/image-picker';
import { imageUploadEnabled } from '@/lib/worker';

/**
 * Yik Yak's own limit. Not enforced by the API as far as we can tell — a longer
 * body posts fine — but the official app caps here and a client that lets you
 * write 900 characters that then render truncated elsewhere is worse than one
 * that says no.
 */
const MAX_LENGTH = 300;

export default function ComposeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { current } = useCurrentGroup();
  const { primaryGroup } = useSession();
  const params = useLocalSearchParams<{ repost?: string; group?: string }>();

  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [disableDMs, setDisableDMs] = useState(false);
  const [disableComments, setDisableComments] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [focused, setFocused] = useState(false);

  const create = useCreatePost();
  const quoted = usePost(params.repost);
  // A repost targets the quoted post's own group, which may not be the selected
  // one. Resolved to a single group so the icon and the name can't disagree —
  // showing the current community's icon beside another community's name is
  // exactly the kind of thing nobody notices until they've posted to the wrong
  // place.
  const targetGroup = params.group && quoted.data?.group ? quoted.data.group : current;
  // You cannot post to For You — it is a combined view, not a community. offsides
  // substitutes the school group's id for exactly this case, and so do we;
  // posting to the Home id would either fail or land somewhere unexpected.
  const composeTarget = isForYouFeed(targetGroup) ? primaryGroup : targetGroup;
  const groupId = params.group || composeTarget?.id || current?.id;

  // The preview is an object URL; dropping the screen without releasing it pins
  // the decoded bitmap for the life of the tab.
  useEffect(() => () => releaseImage(image), [image]);

  const trimmed = text.trim();
  // Memoised because `submit` depends on it — a fresh array each render would
  // rebuild the callback every keystroke.
  const filledOptions = useMemo(
    () => pollOptions?.map((o) => o.trim()).filter(Boolean) ?? [],
    [pollOptions],
  );
  const pollIncomplete = pollOptions !== null && filledOptions.length < 2;
  const overLimit = trimmed.length > MAX_LENGTH;
  const canSubmit =
    Boolean(groupId) &&
    (trimmed.length > 0 || Boolean(image)) &&
    !overLimit &&
    !pollIncomplete &&
    !create.isPending &&
    !uploading;

  const attach = useCallback(async () => {
    setError(null);
    try {
      const picked = await pickImage();
      if (picked) setImage(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image couldn't be attached.");
    }
  }, []);

  const submit = useCallback(async () => {
    if (!groupId) return;
    setError(null);

    let assets: NewPostAsset[] = [];
    if (image) {
      // Uploaded at submit time, not at pick time: an abandoned draft would
      // otherwise leave an orphan in the asset library with no way to remove it.
      setUploading(true);
      try {
        const { assetId } = await uploadAssetWeb(image.blob, image.mimeType);
        assets = [
          {
            id: assetId,
            type: 'image',
            content_type: image.mimeType.split('/')[1] as NewPostAsset['content_type'],
            width: image.width,
            height: image.height,
          },
        ];
      } catch (e) {
        setUploading(false);
        setError(e instanceof Error ? e.message : "The image couldn't be uploaded.");
        return;
      }
      setUploading(false);
    }

    create.mutate(
      {
        text: trimmed,
        groupId,
        assets,
        anonymous,
        disableDMs,
        disableComments,
        repostId: params.repost,
        pollOptions: filledOptions.length >= 2 ? filledOptions : undefined,
      },
      {
        // `back()` throws with nothing to go back to, which is the case when
        // /compose is opened cold from a pasted URL.
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/')),
        onError: (e) =>
          setError(e instanceof Error ? e.message : "That didn't post. Try again."),
      },
    );
  }, [
    groupId,
    image,
    create,
    trimmed,
    anonymous,
    disableDMs,
    disableComments,
    params.repost,
    filledOptions,
    router,
  ]);

  if (!groupId) {
    return (
      <Screen title="New post" back>
        <ThemedText type="body" themeColor="textSecondary">
          Pick a community first — posts have to go somewhere.
        </ThemedText>
      </Screen>
    );
  }

  const remaining = MAX_LENGTH - trimmed.length;

  return (
    <Screen
      title={params.repost ? 'Quote post' : 'New post'}
      back
      action={
        <Button
          label={params.repost ? 'Repost' : 'Post'}
          onPress={submit}
          disabled={!canSubmit}
          loading={create.isPending || uploading}
        />
      }>
      <View style={styles.body}>
        <View style={styles.groupRow}>
          <GroupAvatar
            group={composeTarget}
            name={groupDisplayName(composeTarget)}
            iconUrl={composeTarget?.icon_url}
            color={composeTarget?.color}
            size={24}
          />
          <ThemedText type="smallBold" themeColor="textSecondary">
            Posting to {groupDisplayName(composeTarget) || 'this community'}
          </ThemedText>
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={params.repost ? 'Add a comment…' : "What's happening?"}
          placeholderTextColor={theme.textTertiary}
          multiline
          autoFocus
          maxLength={MAX_LENGTH * 2}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.input,
            Typography.body,
            {
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              // The global CSS suppresses the browser's focus ring, so the
              // border is the only focus feedback a pointer user gets.
              borderColor: overLimit ? theme.danger : focused ? theme.brand : theme.border,
            },
          ]}
        />

        <View style={styles.counterRow}>
          <View style={styles.spacer} />
          <ThemedText
            type="caption"
            style={{ color: overLimit ? theme.danger : theme.textTertiary }}>
            {remaining}
          </ThemedText>
        </View>

        {params.repost && quoted.data ? <QuotedPost post={quoted.data} /> : null}

        {image ? (
          <View style={styles.attachment}>
            <Image
              source={{ uri: image.previewUrl }}
              style={[styles.preview, { aspectRatio: image.width / image.height }]}
              contentFit="cover"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove image"
              onPress={() => {
                releaseImage(image);
                setImage(null);
              }}
              style={[styles.removeImage, { backgroundColor: theme.overlay }]}>
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}

        {pollOptions ? (
          <PollComposer
            options={pollOptions}
            onChange={setPollOptions}
            onRemove={() => setPollOptions(null)}
          />
        ) : null}

        {/*
          Attachments are gated on the worker, not on a hand-flipped flag: the
          upload is a pre-signed PUT that a browser cannot issue at all
          (docs/API.md#-image-upload-is-blocked-by-cors), so offering the control
          without a relay means offering an upload that provably cannot finish.
          Deploying the worker turns it back on by itself.

          A poll and an image are mutually exclusive. Not because the API is
          known to reject the combination — it has never been tried — but
          because the official app doesn't offer it, so a post carrying both is
          untested territory that would only be discovered by a user losing a
          draft to it.
        */}
        <View style={styles.tools}>
          {canPickImages && imageUploadEnabled && !image && !pollOptions ? (
            <ToolButton icon="image-outline" label="Photo" onPress={attach} />
          ) : null}
          {!pollOptions && !image ? (
            <ToolButton
              icon="stats-chart-outline"
              label="Poll"
              onPress={() => setPollOptions(['', ''])}
            />
          ) : null}
        </View>

        <View style={styles.options}>
          <Toggle
            label="Post anonymously"
            hint={anonymous ? 'Shown as a random alias' : 'Shown with your username'}
            icon={anonymous ? 'eye-off-outline' : 'person-outline'}
            value={anonymous}
            onChange={setAnonymous}
          />
          <Toggle
            label="Turn off replies"
            icon="chatbubble-outline"
            value={disableComments}
            onChange={setDisableComments}
          />
          <Toggle
            label="Turn off DMs"
            icon="mail-outline"
            value={disableDMs}
            onChange={setDisableDMs}
          />
        </View>

        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}

        {pollIncomplete ? (
          <ThemedText type="caption" themeColor="textTertiary">
            A poll needs at least two options — up to {MAX_POLL_OPTIONS}.
          </ThemedText>
        ) : null}
      </View>
    </Screen>
  );

  function ToolButton({
    icon,
    label,
    onPress,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.tool,
          { backgroundColor: hovered || pressed ? theme.controlHover : theme.control },
        ]}>
        <Ionicons name={icon} size={16} color={theme.controlText} />
        <ThemedText type="smallBold" themeColor="controlText">
          {label}
        </ThemedText>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    minHeight: 140,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  counterRow: {
    flexDirection: 'row',
    marginTop: -Spacing.two,
  },
  spacer: {
    flex: 1,
  },
  attachment: {
    position: 'relative',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  preview: {
    width: '100%',
    maxHeight: 320,
    borderRadius: Radius.md,
  },
  removeImage: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tools: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
  },
  options: {
    gap: Spacing.two,
  },
});
