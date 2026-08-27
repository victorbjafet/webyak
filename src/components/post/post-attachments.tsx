import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ExternalLink } from '../external-link';
import { ThemedText } from '../themed-text';

import type { Attachment } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Link previews. Distinct from `assets` — these are unfurled URLs the API
 * attaches to a post, shape confirmed from live payloads:
 * `{id, type: "link", link_url, display_url, title}`.
 */
export function PostAttachments({ attachments }: { attachments?: Attachment[] }) {
  const theme = useTheme();
  const links = attachments?.filter((a) => a.link_url);
  if (!links?.length) return null;

  return (
    <View style={styles.stack}>
      {links.map((attachment) => (
        <ExternalLink
          key={attachment.id}
          href={attachment.link_url as `https://${string}`}
          style={styles.link}>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}>
            <Ionicons name="link-outline" size={16} color={theme.textTertiary} />
            <View style={styles.text}>
              {attachment.title ? (
                <ThemedText type="smallBold" numberOfLines={1}>
                  {attachment.title}
                </ThemedText>
              ) : null}
              <ThemedText type="caption" themeColor="textTertiary" numberOfLines={1}>
                {attachment.display_url || attachment.link_url}
              </ThemedText>
            </View>
          </View>
        </ExternalLink>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.two,
  },
  link: {
    width: '100%',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});
