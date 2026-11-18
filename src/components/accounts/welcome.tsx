import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExternalLink } from '../external-link';
import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { APP_VERSION } from '@/constants/version';
import { useTheme } from '@/hooks/use-theme';
import { SOURCE_URL } from '@/lib/share';

/*
  What the sign-in screen says about webyak, for someone who has only been sent
  the link: what it is, what it does that the official app doesn't, and where
  the code is. docs/DESIGN.md#the-sign-in-screen-introduces-webyak.

  Every claim here has to stay true of the app. If a feature it names goes, or
  starts needing the Worker, change the copy in the same commit.
*/

type IconName = ComponentProps<typeof Ionicons>['name'];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'chatbubbles-outline',
    title: 'Yik Yak in a browser',
    body: 'Feeds, posts, polls, comments, chats and alerts. What you do here shows up in the official app, and the other way round.',
  },
  {
    icon: 'archive-outline',
    title: 'An archive of what Yik Yak drops',
    body: 'Every post and comment you see is saved in this browser, to search, chart and export, even after it is deleted.',
  },
  {
    icon: 'desktop-outline',
    title: 'Made for a bigger screen',
    body: 'A sidebar layout and keyboard shortcuts, and it installs as an app.',
  },
  {
    icon: 'eye-off-outline',
    title: 'No tracking',
    body: 'No ads, no analytics and no third-party scripts. Every line is on GitHub.',
  },
];

/** The mark, the name and one line on what webyak is. */
export function Welcome() {
  return (
    <View style={styles.welcome}>
      <View style={styles.nameRow}>
        {/* The name beside it is the label, so alt is empty. */}
        <Image source={require('@/assets/images/logo.png')} alt="" style={styles.mark} />
        <ThemedText type="title">webyak</ThemedText>
      </View>
      <ThemedText type="subtitle">Yik Yak, on the web.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        An unofficial, open-source Yik Yak client that runs in your browser. Sign in with your Yik
        Yak account to read and post in your communities from any computer.
      </ThemedText>
    </View>
  );
}

export function FeatureList() {
  const theme = useTheme();
  return (
    <View style={styles.features}>
      {FEATURES.map((feature) => (
        <View key={feature.title} style={styles.feature}>
          <View style={[styles.featureIcon, { backgroundColor: theme.brandMuted }]}>
            <Ionicons name={feature.icon} size={18} color={theme.brand} />
          </View>
          <View style={styles.featureText}>
            <ThemedText type="smallBold">{feature.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {feature.body}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The source, and the README's warnings, which are worth reading before handing over a phone number. */
export function ProjectLinks() {
  return (
    <View style={styles.links}>
      <PillLink href={SOURCE_URL} icon="logo-github" label="View source on GitHub" />
      <PillLink
        href={`${SOURCE_URL}#read-this-before-you-trust-it`}
        icon="document-text-outline"
        label="Read before you sign in"
      />
    </View>
  );
}

/** Small print under everything: the version, and whose app this isn't. */
export function WelcomeFooter() {
  return (
    <ThemedText type="caption" themeColor="textTertiary" style={styles.footer}>
      v{APP_VERSION} · Not affiliated with Yik Yak or Sidechat, which runs it.
    </ThemedText>
  );
}

/*
  Module scope, not nested — see
  docs/ARCHITECTURE.md#helper-components-go-at-module-scope-never-inside-another-component.
*/

/** Outlined like Settings' *View source* link. */
function PillLink({
  href,
  icon,
  label,
}: {
  href: `https://${string}`;
  icon: IconName;
  label: string;
}) {
  const theme = useTheme();
  return (
    <ExternalLink href={href} style={[styles.pill, { borderColor: theme.borderStrong }]}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {` ${label}`}
      </ThemedText>
    </ExternalLink>
  );
}

const styles = StyleSheet.create({
  welcome: {
    gap: Spacing.two,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  mark: {
    width: 56,
    height: 56,
  },
  features: {
    gap: Spacing.three,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: Spacing.half,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pill: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  footer: {
    textAlign: 'center',
  },
});
