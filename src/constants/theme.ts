/**
 * Design tokens for webyak.
 *
 * Colors are defined for light and dark. Group accent colors (e.g. "#9796F0")
 * arrive from the API per-group and are applied on top of these neutrals —
 * chrome stays neutral, groups bring their own color.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // text
    text: '#101114',
    textSecondary: '#5A5F66',
    textTertiary: '#8B8D98',
    textInverse: '#FFFFFF',

    // surfaces
    background: '#FFFFFF',
    backgroundElement: '#F4F4F6',
    backgroundSelected: '#E6E7EB',
    backgroundElevated: '#FFFFFF',
    backgroundHover: '#F0F0F3',

    // unselected controls (chips, segmented tabs, secondary buttons)
    control: '#ECEDF0',
    controlHover: '#E0E1E6',
    controlText: '#3A3E45',

    // lines
    border: '#E3E4E8',
    borderStrong: '#CDCED4',

    // brand — selections, the post button, titles
    brand: '#10CEAC',
    onBrand: '#00201A',
    brandMuted: '#D9F7F0',

    // semantic
    notification: '#EF514F',
    danger: '#EF514F',
    upvote: '#10CEAC',
    downvote: '#EF514F',
    success: '#10CEAC',
    link: '#10CEAC',

    // misc
    overlay: 'rgba(0,0,0,0.45)',
    skeleton: '#ECEDF0',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#A2A6AD',
    textTertiary: '#6E727A',
    textInverse: '#000000',

    // pitch black, with near-black steps for anything that sits on top of it
    background: '#000000',
    backgroundElement: '#0F0F11',
    backgroundSelected: '#1E1F22',
    backgroundElevated: '#141416',
    backgroundHover: '#171719',

    control: '#1E1F22',
    controlHover: '#292A2E',
    controlText: '#C7CACF',

    border: '#222325',
    borderStrong: '#3A3C40',

    brand: '#10CEAC',
    onBrand: '#00201A',
    brandMuted: '#0B2F29',

    notification: '#EF514F',
    danger: '#EF514F',
    upvote: '#10CEAC',
    downvote: '#EF514F',
    success: '#10CEAC',
    link: '#10CEAC',

    overlay: 'rgba(0,0,0,0.7)',
    skeleton: '#141416',
  },
} as const;

/** Value types are widened to `string`; `as const` above would otherwise make
 * the light and dark palettes mutually unassignable. */
export type ThemePalette = { [K in keyof (typeof Colors)['light']]: string };
export type ThemeColor = keyof ThemePalette;
export type ColorSchemeName = keyof typeof Colors;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** 4pt base scale. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Type scale. Keys are used by <ThemedText type="..." />. */
export const Typography = {
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  subtitle: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyBold: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  code: { fontSize: 12, lineHeight: 18, fontWeight: '500', fontFamily: Fonts.mono },
} as const;

export type TypographyVariant = keyof typeof Typography;

/** Width at/above which the desktop sidebar replaces the bottom tab bar. */
export const Breakpoints = {
  sidebar: 900,
  wide: 1240,
} as const;

export const Layout = {
  sidebarWidth: 240,
  feedMaxWidth: 640,
  railWidth: 300,
  bottomBarHeight: 56,
  headerHeight: 52,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
