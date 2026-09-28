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
| `onNotification` | `#FFFFFF` | the count on an unread badge |

Semantic aliases: `upvote` → accent green, `downvote` → the red, `link` → accent,
`success` → accent. Downvote reuses the notification red rather than introducing a
sixth color; revisit if the two ever need to be distinguished at a glance.

## Logo

A simple outline of a laptop, in `onBrand` near-black on the accent green. The
laptop is [Lucide](https://lucide.dev)'s `laptop`, picked because its base flares
the way a keyboard does when seen from slightly above, where most outline laptops
are a flat front view. Lucide is **ISC**, which asks only that the notice travel
with the icon. The notice and the provenance of every derived file are in
[assets/brand/LICENSE](../assets/brand/LICENSE).

The first version, earlier on 2026-09-27, used Microsoft's Fluent emoji laptop,
a filled colour illustration. It was replaced the same day: the brief was always
a simple outline.

**Why near-black, not white:** it's the palette's rule for anything on the accent
(`onBrand`, above). White on `#10CEAC` is too faint, and at favicon size a faint
1px outline disappears. The Post button pairs the same two colours.

**Every icon is generated. Don't edit the PNGs by hand:**

```sh
python3 assets/brand/render-icons.py   # needs Pillow and Google Chrome
```

It renders [laptop.svg](../assets/brand/laptop.svg), unmodified, with headless
Chrome. Only its coverage is used: the SVG strokes with `currentColor`, so the
script takes the alpha and fills it with each output's colour. Then it composes
each output:

| Output | Used as | Composition |
|---|---|---|
| `assets/images/icon.png` 1024 | `expo.icon`: the app icon on iOS and Android | opaque green square, laptop 66% of its width. The OS rounds the corners, and the App Store rejects transparency |
| `public/apple-touch-icon.png` 180 | the icon when a page is added to an iPhone home screen | the same picture. Safari fetches it from the site root without a `<link>` |
| `assets/images/favicon.png` 48 | `web.favicon`; Expo builds `favicon.ico` (16/32/48) from it | green tile with 22% rounded corners, laptop 80% of its width |
| `assets/images/logo.png` 128 | the mark beside "webyak" in the sidebar, shown at 28px | the favicon's picture, larger |
| `assets/images/android-icon-foreground.png` 512 | adaptive icon foreground | the outline alone, sized so its farthest pixel stays inside the 66dp safe circle. `adaptiveIcon.backgroundColor` supplies the green |
| `assets/images/android-icon-monochrome.png` 432 | Android 13+ themed icon | the same outline in white, since the system only reads its alpha and tints it |
| `assets/images/splash-icon.png` | native splash, 100dp wide on green | the outline alone |

Two size rules: an app icon leaves the laptop room, because the OS crops the
corners. A favicon doesn't, because at 16px every pixel of laptop counts.

The favicon is handed to Expo at exactly 48px, the size Expo reduces any
`web.favicon` to before it builds the `.ico`. That way the big reduction is done
by Pillow (Lanczos), not by the Jimp fallback Expo uses when `sharp` isn't
installed, which it isn't here or in CI.

The colours are repeated where [theme.ts](../src/constants/theme.ts) can't be
imported: the accent twice in `app.json` (the adaptive icon background and the
splash), and the accent and `onBrand` as the script's `GREEN` and `INK`. If
either changes, change them all and re-render.

There is no Icon Composer (`.icon`) file for iOS 26's layered icons: iOS uses
`icon.png`. Expo's template art, including the blue chevron, is gone.

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
and `action` slots for exactly this, `titleContent` for a title that is itself a
control (the home feed's community switcher), and `titleAccessory` for small print
on the title's own line: Settings' version and its *View source* link to GitHub.

## Explore is three tabs

**Communities, Group chats, Archive** — a segmented control under the title.
They share nothing but the screen: live communities to join, the school's chats
to join, and a search over what this browser has archived. Group chats were a
strip above the community list with "View all"; as a tab they are the whole
list, laid out like communities (one card each, two columns above 720px, the
same full-width join control), largest first.

Each list's header carries its count and a **create** button, dimmed with a
tooltip because neither is wired to anything yet. Communities have one order,
most members first; a sort row whose only other option was disabled ("Newest",
which no explore field can support) was removed.

## Alerts

Built 2026-09-27; what the API gives it is in
[API.md](API.md#the-activity-feed-alerts).

- **Unread looks like an unread chat:** accent border, accent dot, full-strength
  text. Read alerts stay in the list, dimmed. Two tabs that mean "new" should
  say it the same way.
- **Read and unread are webyak's, not the official app's**, which shows no
  such state for alerts (the owner, 2026-09-27). The *Unread* filter and the
  badge are the owner's B2, an addition built on the API's `is_seen`.
- **An alert is marked read when you act on it, never by being shown.** Tapping
  it (which also opens its post) or *Mark all read* marks it. A list that cleared
  itself on sight would leave the *Unread* filter with nothing to filter, and
  would send writes nobody asked for. offsides works the same way.
- **The tab carries a count** of unread alerts, in `notification` red with
  `onNotification` numerals, ringed in the background colour so it stays
  legible over the icon. It reads the same query as the screen, so marking
  something read clears the badge in the same render. Only loaded pages are
  counted, which in practice is the first.
- **Each type gets an icon and a label, and unknown types still render**, as
  their own name with a bell. The server's sentence says what happened, so a
  new type needs a label, not a fix.
- **The server's sentence is shown as sent.** The one edit is offsides': a
  leading 📈 on *Popular* and *Followed post*, whose icon already says it.

## Chats: opening one reads it

- **Opening a thread marks it read, and so does *Mark all read* on the list.**
  Reading a chat is exactly what the official app treats as read, unlike alerts.
- **The mark is this device's for now.** The server's read mark only moves when
  the official app reads the chat, and the call that moves it hasn't been found
  (PLAN Q19). So webyak records its own mark, and a chat reads as unread only
  when something arrived after both. The official app still shows a chat read
  here as unread until Q19 is answered
  ([API.md](API.md#chats-dont-mark-read-from-here)).
- *Mark all read* sits in the header's action slot, as it does on Alerts, and
  appears only while something is unread.

## Accounts

- **The switcher is the first card in Settings**, above the archive: the
  signed-in account marked *Signed in*, each other account with *Switch* and
  *Remove*, then *Add account* and *Export login file*. An account is its
  emoji, its name (`@username`, or *Phone ending 1234*), and its community
  underneath, which is often what tells two numbers apart.
- **The sign-in screen offers what's saved first**: *Saved in this browser*,
  above the phone number, one *Continue* each. *Use a login file instead* sits
  under *Send code*.
- **A passphrase is asked for in a dialog, never kept.** Exporting asks twice and
  wants 8 characters; importing asks once. The fields live in the dialog, which
  is only mounted while open.
- **Switching reloads the page.** A moment's blank is the price of nothing from
  one account showing under another ([ARCHITECTURE.md](ARCHITECTURE.md#accounts-and-login-files)).

## Media sizing

Inline media is capped at ~68% of viewport height. A tall portrait image
otherwise pushes the whole post off screen and has to be opened in the lightbox
to be read at all. The cap comes from `useWindowDimensions`, so it **tracks
window resizes** rather than being measured once.

Once capped, the frame no longer matches the asset's aspect ratio, so media uses
`contain` — `cover` would crop precisely the images that triggered the cap.

## Switching communities

**The home header's title is the switcher.** The current community's icon and
name, with a chevron, open a dropdown of For You and every community — For You
first, a checkmark on the current one, and *Find more communities* at the foot,
into Explore. That is where the official app keeps it, and it sits on the thing
it changes. On wide screens the sidebar also lists them under the nav. Selection
persists, and switching starts the new feed at its top.

*Changed 2026-09-27.* Narrow screens used to get a scrollable strip of chips
directly above the tab bar. It spent a permanent row of the smallest screens on a
control used a few times a session, as far from the feed's header as it could
be. The dropdown is a `Modal` rather than a view positioned under the header: the
feed is its own scroller, and on web its layer painted over anything that
overflowed the header. A long community name truncates; the chevron and the
header's action keep their room.

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
Positioned against the root it sits underneath the tab bar, which is only
visible on a short viewport.

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
the top**. The bottom is occupied by the tab bar and the compose FAB on narrow
viewports — a toast down there covers the post button, which is often the
action the user was trying to take.

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


## Anonymity is shown by absence

**A post never says "Anonymous".** Anonymous is the default on Yik Yak, so
labelling it adds a word and no information — the missing name already carries
it, and writing it out makes the common case look like the special one.

So the header of a post is the **community**, and an author row appears *only*
when someone chose to post under a username. That holds on the post page as well
as in a feed.

**Comments are the exception.** A reply is identified relative to the thread —
`OP`, `#1`, `#2` — or by username, and those aliases are meaningful, so comments
keep their identity row.

## The community label is a title, not a tag

It sits at the top of every post card, with the community's icon beside it and
the same colour as the body text. No chip background: a filled pill reads as
metadata attached to the post, and this is the post's context.

It shows even inside that community's own feed, where it is strictly redundant.
That is the parity behaviour, and it is what keeps the For You feed legible when
consecutive posts come from different places.

## Numbers in a column need a fixed width

`19` and `9.6k` are different widths. In a list of rows ending in a value and a
chevron, that pushes the chevrons to different x positions and the column looks
broken. Any right-aligned numeric column gets `minWidth` and `textAlign: right`
— the yakarma panel is the case that surfaced it.


## Dates are picked, not typed

Every date input in the app is `DateField`
([src/components/ui/date-field.tsx](../src/components/ui/date-field.tsx)), which
on web is a real `<input type="date">` — the browser's own calendar, locale-aware
display, arrow-key stepping and keyboard entry, none of which a styled text box
gets. A `.web.tsx` split keeps the native build on a plain `TextInput`; the
native file is also the typed surface, since tsc only ever resolves the bare
import (see ARCHITECTURE.md).

It speaks **plain `YYYY-MM-DD`**, never ISO timestamps. Callers that need a
moment convert on the way in and out: archive search wants the bare date because
that is what its query grammar accepts, while a refresh window wants
start-of-day and end-of-day — so a window of "3rd to 3rd" contains the 3rd
instead of matching only midnight.

**The text version it replaced could not be typed into at all.** Its value was
round-tripped through a date parser, so `2`, `20` and `2026-0` were all
incomplete, all parsed to nothing, and the box stayed empty no matter what was
pressed. A controlled input whose value is derived by validating its own text
only accepts complete input — which for a date means it only accepts a paste.
A native date input holds its own partial state and reports only a finished
date, which is the contract the callers actually wanted.

`colorScheme` is set on the element. Without it the browser paints the calendar
icon and picker panel for a light page, leaving a near-invisible icon on a dark
background.
