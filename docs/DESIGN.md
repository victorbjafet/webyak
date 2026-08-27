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

## The header is chrome, not a page title

The header block holds **where you are and what you can do to it**, not a repeat
of the nav. A feed screen shows the community's icon and name, its sort tabs, and
the leaderboard control; a post screen keeps the community name and swaps the
tabs for a back button. Section screens without a community (Explore, Alerts,
Chats, You) still use their own name, because there is nothing else to put there.

Sort tabs live in the header rather than scrolling with the posts, so switching
sort never requires scrolling back up. `Screen` takes `leading`, `headerBelow`
and `action` slots for exactly this.

## Media sizing

Inline media is capped at ~68% of viewport height. A tall portrait image
otherwise pushes the whole post off screen and has to be opened in the lightbox
to be read at all. The cap comes from `useWindowDimensions`, so it **tracks
window resizes** rather than being measured once.

Once capped, the frame no longer matches the asset's aspect ratio, so media uses
`contain` — `cover` would crop precisely the images that triggered the cap.

## Switching communities

Two presentations of one control, following the official app: a list under the
nav in the desktop sidebar, and a scrollable strip directly above the tab bar on
narrow screens. Selection persists.

The list comes from `getUpdates().groups` — which is **not** a complete
membership list (`/v1/users/me` reported 4 memberships against 3 groups), so it
is "communities you can switch to", not "everything you belong to".


## Composing (Phase 4)

### The post button is the one brand-colored control

Green is reserved for selection and for posting. The composer entry point takes
the strongest form the layout allows: a full-width button under the sidebar nav
on wide, a circular FAB above the tab bar on narrow — where the official app puts
it. It hides itself on `/compose`, because a button that reopens the screen you
are already on is noise, and on narrow it would sit on top of the text field.

The FAB renders **inside the content area**, not against the shell root.
Positioned against the root it sits underneath the community strip and the tab
bar, which is only visible on a short viewport.

### Confirmations are a component, not `Alert.alert`

`Alert` has no react-native-web implementation. On web the call is silently a
no-op — so a delete confirmation written the native way would fire the delete
with no prompt at all. `ConfirmDialog` uses `Modal`, which both platforms
implement, and it is what any destructive action must use.

### Anonymous is the default, and it is stated

The composer defaults to anonymous, matching Yik Yak, and the toggle spells out
the consequence either way — "Shown as a random alias" against "Shown with your
username". This is the one setting where a mistaken guess is unrecoverable: the
post is already public before you notice.

Under the hood the API's field is `using_identity`, the exact inverse. That
inversion happens in one place in `client.ts` and never in a component — see
docs/API.md#write-endpoints.

### Quoted posts are not cards

A quoted post renders through `QuotedPost`, not `PostCard`. A card would bring
vote buttons, a profile link and a delete control for a post that is only being
*referenced* — and inside the composer those become interactive controls nested
in a form, which is the nested-button problem again (see "Never nest interactive
elements").


## Failure has to be visible

A rejected write **rolls back and says so.** Rolling back silently is its own
bug: the score springs back a moment after the user pressed it, with no
explanation, and reads as the app dropping votes at random — which is worse than
an error, because the user has no reason to retry.

Every mutation in `src/api/mutations.ts` pairs its rollback with a toast, and the
message prefers the API's own text (`unwrap` surfaces `error_code` bodies) over a
generic fallback.

`ToastHost` is mounted once at the root, above the shell, and is **anchored to
the top**. The bottom is occupied by the tab bar, the community strip and the
compose FAB on narrow viewports — a toast down there covers the post button,
which is often the action the user was trying to take.

Repeated messages collapse: voting on three posts while offline says one thing,
not three identical bars.

## Focus rings

The browser's default focus ring is blue — the one color in the app that belongs
to nothing, and against pitch black it reads as a rendering artifact.
react-native-web sets no outline of its own, so this is handled in
`src/global.css`, which is the only place it can be.

Two rules:

- The ring is on **`:focus-visible`, not `:focus`.** Painting it on every mouse
  click is why people disable focus rings altogether and break keyboard
  navigation doing it.
- Because pointer users therefore see no ring, **every text input paints its own
  focused border** in brand green. An input whose only focus feedback was the
  browser default now has none, so this is not optional decoration — it is the
  replacement.

Text selection is themed for the same reason.


## Scrollers span the viewport; content is what's centred

A reading column is capped at `Layout.feedMaxWidth`. The **scrollable element is
not** — it fills the whole area and centres its content via
`contentContainerStyle`.

Getting this backwards is easy and the bug is subtle: capping the scroller
itself looks identical on a laptop and breaks on a wide monitor, where the empty
space beside the feed belongs to no scroller and the wheel does nothing over it.
`Screen` therefore hands `scroll={false}` children the full width and lets them
centre their own content.

## Dismissing overlays

Anything opened over the page closes by clicking **anywhere outside its
content**, not only via an X.

One trap, hit in the image lightbox: with `contentFit="contain"` the image
element keeps its full box while the picture is letterboxed inside it, so the
apparently-empty margin around the picture still belongs to the element. A
backdrop behind it never receives those clicks. The image is wrapped in its own
dismiss target so the whole overlay responds — safe because an image is not
interactive, so nothing ends up nested inside a control.

## Deleting the thing you are looking at

A destructive action on a *screen's own subject* has to navigate. Deleting the
post you are viewing leaves the screen showing content that no longer exists —
the caches it reads have already dropped it — so `PostCard` takes an `onDeleted`
callback and the post screen uses it to go back. In a feed the row simply
vanishes, which is correct there and wrong here.
