# Design

Tokens live in [src/constants/theme.ts](../src/constants/theme.ts). Nothing should
hard-code a hex value outside that file.

## Palette

Dark is the primary theme and the default. Light exists and is kept working, but
it is not what the app is designed around — Yik Yak's own web client is dark-only.

### The four decided colors

| Role | Value | Where it appears |
|---|---|---|
| Background | `#000000` pitch black | The app canvas. Not near-black — actual black. |
| Text | `#FFFFFF` | Primary text |
| Accent | `#10CEAC` green | Selections, active nav, the post button, screen titles |
| Notification | `#EF514F` red | Unread badges, destructive actions, errors |

### Everything else, and why

Pitch black needs *near*-black steps above it, otherwise cards float with no edge
and every surface reads as the same plane:

| Token | Dark | Purpose |
|---|---|---|
| `background` | `#000000` | canvas |
| `backgroundElement` | `#0F0F11` | cards, panels |
| `backgroundElevated` | `#141416` | modals, menus |
| `backgroundSelected` | `#1E1F22` | active nav row |
| `backgroundHover` | `#171719` | hover on a surface |
| `control` | `#1E1F22` | **unselected buttons — the grey** |
| `controlHover` | `#292A2E` | hover on a control |
| `controlText` | `#C7CACF` | label on an unselected control |
| `border` | `#222325` | hairlines |
| `borderStrong` | `#3A3C40` | input outlines |
| `textSecondary` | `#A2A6AD` | supporting copy |
| `textTertiary` | `#6E727A` | inactive nav labels, timestamps |
| `brand` | `#10CEAC` | accent |
| `onBrand` | `#00201A` | text *on* the accent — near-black, since `#10CEAC` is bright enough that white on it fails contrast |
| `brandMuted` | `#0B2F29` | accent-tinted fill |
| `notification` / `danger` | `#EF514F` | badges, errors, destructive |

Semantic aliases: `upvote` → accent green, `downvote` → the red, `link` → accent,
`success` → accent. Downvote reuses the notification red rather than introducing a
sixth color; revisit if the two ever need to be distinguished at a glance.

## Type scale

`Typography` in the token file; used as `<ThemedText type="…">`.

| Variant | Size / line | Use |
|---|---|---|
| `title` | 32/38 700 | page hero |
| `subtitle` | 22/28 700 | screen titles (accent-colored) |
| `heading` | 17/24 600 | section headers |
| `body` | 16/23 400 | post text |
| `bodyBold` | 16/23 600 | emphasis |
| `small` | 14/20 400 | supporting |
| `smallBold` | 14/20 600 | labels |
| `caption` | 12/16 500 | timestamps, nav labels |
| `code` | 12/18 500 mono | IDs, debug |

## Layout

4pt spacing scale (`Spacing.half` = 2 … `Spacing.six` = 64). Radii: `sm` 6,
`md` 10, `lg` 16, `xl` 24, `pill` 999.

**Breakpoint: 900px.** At or above, a 240px sidebar; below, a bottom tab bar.
One breakpoint, on purpose — a second one should be justified by an actual layout
that breaks, not added preemptively. `Layout.feedMaxWidth` is 640: the reading
column never spans a wide monitor.

## Component conventions

- Every color comes from `useTheme()`. No literals in components.
- `ThemedText` / `ThemedView` take semantic token names, not colors.
- `Screen` owns the page frame: title, optional subtitle and action, scrolling,
  and the max-width column.
- Active state in nav is signalled by **both** the accent color and a filled icon
  variant — never color alone, which fails for color-blind users.

### The one non-obvious rule

**Layout styles for a nav link go on `<Link>`, never on the child `<Pressable>`.**

expo-router's `BaseExpoRouterLink` spreads its own `style` *after* `...rest` when
cloning an `asChild` child
([source](../node_modules/expo-router/build/link/BaseExpoRouterLink.js)), so a
style set on the child is silently overwritten with `undefined`. This is what made
the first bottom bar collapse every item to its content width and bunch them all
to the left.

```tsx
// wrong — style is dropped
<Link href={href} asChild>
  <Pressable style={styles.item}>…</Pressable>
</Link>

// right — style reaches the rendered <a>
<Link href={href} asChild style={styles.item}>
  <Pressable>{({ pressed }) => <View style={…}>…</View>}</Pressable>
</Link>
```

Press and hover feedback goes through Pressable's children function, which is
unaffected.
