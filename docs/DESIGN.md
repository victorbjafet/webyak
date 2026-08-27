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

## Feed and post conventions

- **"New" means `recent`.** The API's categories are `hot` / `recent` / `top`;
  the tab is labelled New because that is what the official app calls it. The
  label and the API value are deliberately not the same word — keep the mapping
  in `sort-tabs.tsx` and don't leak `recent` into the UI.
- **Sort is a query param** (`/g/<slug>?sort=new`), so a sorted feed is
  linkable and survives a back navigation.
- **Vote controls render read-only until Phase 4.** `VoteControl` takes an
  optional `onVote`; without it the arrows are disabled rather than absent, so
  the layout doesn't shift when voting is wired up.
- **Identity is emoji-on-color, or a neutral glyph.** `conversation_icon` only
  exists when someone posts under a username; anonymous is the default and gets
  a person glyph on `control`, never a fake avatar.
- **Comment depth is one level.** `reply_post_id !== parent_post_id` marks a
  reply, which gets an indent and a left rule. There is no deeper nesting to
  render — see [OFFSIDES.md](OFFSIDES.md#comment-threading-has-one-signal).
- **Every list state is explicit**: loading, empty, error-with-retry, and
  end-of-feed all render something. A feed that silently shows nothing is a bug.

### Screen has two modes

`<Screen>` scrolls its children by default. Feeds and threads pass
`scroll={false}`, which switches the content column to `flex: 1` so the list
inside owns the scrolling — otherwise the list has no height to scroll within and
silently renders one screenful.

### Never nest interactive elements

react-native-web renders a `Pressable` with `accessibilityRole="button"` as a
real `<button>`, and React rejects `<button>` inside `<button>` outright — it is
a console error, not a warning.

The first post card was a `Pressable` wrapping vote buttons, a profile link, a
timestamp toggle and image buttons. Every one of those is a `<button>`, so the
card threw on render.

**The card is a plain `View`.** The "open this post" affordance lives on specific
children — the post text and the comment count — as siblings of the other
controls. Same rule for `Link`: `<Link asChild>` renders an `<a>`, so a `Button`
inside one is interactive content inside an anchor. Navigate with
`router.push()` from the button's own `onPress` instead.

When adding anything pressable to a card, check what it will be nested inside.

### Meta text is one size

Vote count, comment count and post age all render at 14px (`small`/`smallBold`).
They sit on the same line and mean comparable things, so three different sizes
read as accidental. Comments use the same 14px — only the vote buttons shrink.

Vote arrows are circular (`control` background, `pill` radius), matching the
official app, and they keep that treatment while read-only so nothing shifts
when Phase 4 makes them live.

### Media

- **Video buffers on approach, not on press.** The feed reports viewable rows
  and widens that range by two either side; a post in that band attaches its HLS
  stream and starts buffering while still paused. Playback only ever begins on an
  explicit press — preloading must never autoplay.
- **`object-fit: contain`, never `cover`.** The frame already matches the asset's
  aspect ratio so inline rendering is identical either way, but `cover` crops the
  top and bottom off a vertical video in fullscreen, where the container becomes
  the screen.
- **Every image and video gets a download control.** On web the `download`
  attribute is ignored cross-origin, so it fetches to a blob first — which also
  lets it attach the bearer token for the URLs that need one.

### Live timestamps share one timer

Post ages tick. A feed holds dozens of them, so they subscribe to a shared clock
(`src/lib/clock.ts`) that keeps **one interval per tick rate** regardless of
subscriber count and stops when the last one unmounts — rather than each
timestamp owning a `setInterval` and waking the main thread out of phase.

Tick rate matches what is displayed: 30s for the collapsed relative age, 1s for
the expanded view, which shows seconds and would look broken frozen.

### Show unavailable actions, dimmed

Save and repost render in their real positions but are inert, with a tooltip
saying why. The bookmark previously appeared *only* on already-saved posts, which
read as a rendering bug rather than a state.

A dimmed control that explains itself is better than one that appears and
disappears, and it means Phase 4 changes behaviour without moving anything.
Awards are the exception — genuinely not built, and low enough value that a
placeholder would be clutter.
