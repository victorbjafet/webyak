# webyak — plan & todo

A universal (web-first) Yik Yak client built on **Expo Router** + **[sidechat.js](https://github.com/micahlt/sidechat.js)**.
Goal: faithful parity with the official app, plus features the official web client doesn't have.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `⛔` blocked/gap

**This file is the roadmap.** Decisions and findings live next to it:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (URL shape, hosting),
[docs/API.md](docs/API.md) (auth flow, ID blockers, library defects),
[docs/DESIGN.md](docs/DESIGN.md) (tokens, layout rules).
The rule for keeping them current is in [CLAUDE.md](CLAUDE.md).

---

## 1. Current state

Scaffolded and smoke-tested on 2026-08-26:

| Thing | Version / result |
|---|---|
| Expo SDK | 57.0.16 |
| expo-router | 57.0.16 (typed routes on, `web.output: "static"`) |
| React / React Native | 19.2.3 / 0.86.2 (react-compiler on) |
| react-native-web | 0.21 |
| sidechat.js | 2.6.6 (installed) |
| Web dev server | `npx expo start --web` → HTTP 200 ✅ |
| Git | initialized, 1 commit (template) |

Source lives in `src/`:

| Path | What |
|---|---|
| `src/app/` | expo-router routes; URLs mirror web.yikyak.com |
| `src/api/` | client singleton, typed wrappers, session context, query provider |
| `src/lib/storage.ts(.web.ts)` | platform-split key/value stores |
| `src/theme/` | theme preference provider (light/dark/system, persisted) |
| `src/components/` | shell, nav, themed primitives |
| `src/constants/theme.ts` | design tokens |

Added in Phase 1: `@tanstack/react-query` + persist client, `expo-secure-store`,
`@react-native-async-storage/async-storage`, `@expo/vector-icons`, eslint (via `expo lint`).

Web output is `single` (SPA), not `static` — build with **`npm run build:web`**,
which also writes the `404.html` fallback and `.nojekyll` that GitHub Pages needs.
Reasoning in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment-model--static-serverless-github-pages).

> ⚠️ `AGENTS.md` (from the template): **read <https://docs.expo.dev/versions/v57.0.0/> before
> writing code.** SDK 57 changed a lot; don't code from memory of older Expo.

---

## 2. Verified findings (recon, 2026-08-26)

These were checked against the live API, not assumed. They drive the architecture below.

1. **`api.sidechat.lol` is CORS-open.** Both a simple GET and an `OPTIONS` preflight return
   `access-control-allow-origin: *`, `access-control-allow-methods: *`,
   `access-control-allow-headers: *`.
   → **sidechat.js runs directly in the browser. No backend, no proxy, no server.** This is the
   single biggest de-risking fact for the project: webyak can be a pure static site.

2. **`web.yikyak.com/api/*` is public but *not* CORS-enabled.** It serves real post data with no
   auth (`/api/groups/<slug>/posts?group_id=<uuid>&type=hot|recent|top`, cursor pagination
   confirmed working, 24 posts/page, zero overlap between pages) — but sends no ACAO header, so
   a browser can't call it cross-origin. Using it for a logged-out mode requires a small proxy.

3. **Public comments only come from the SvelteKit route**, not a REST endpoint.
   `/{region}/{group}/comments/{code}/{slug}/__data.json?x-sveltekit-invalidated=01` → 200.
   `/api/posts/<code>/comments` → 404. That payload is **devalue-flattened** (the numeric-pointer
   array format), so it needs `devalue.parse()` to rehydrate.

4. **Public asset URLs are pre-signed R2 links** (`X-Amz-Signature`, `X-Amz-Expires=3600`) and load
   in a plain `<img>`. Authenticated asset URLs are typed `SidechatPrivateAssetURL` and need the
   bearer token in a header — those can't go in an `<img src>`. See open question Q2.

5. **sidechat.js has real bugs to route around** (read from 2.6.6 source):
   - `getUserContent()` builds `/v1/posts&type=…` — missing `?`. Broken.
   - `getGroupChats()` builds `/v1/chats/explore&cacheBust=…` — missing `?`. Broken.
   - `uploadAsset()` uses the React-Native `FormData` `{uri, type, name}` object shape and then
     `PUT`s `data.getAll("image")[0]`. On web that's a plain object → uploads `[object Object]`.
     Needs a web path that PUTs a real `Blob`/`File`.
   - Escape hatch for all of these: `client.sendRequest(endpoint, method, body, headers)` (2.4.9+)
     calls arbitrary endpoints with the current auth.

---

## 3. Architecture

```
src/
  app/                      # expo-router routes (URLs mirror web.yikyak.com)
    _layout.tsx             # providers: query, auth, theme, toasts
    index.tsx               # home / primary group feed
    explore.tsx             # group discovery + search
    [region]/[group]/index.tsx
    [region]/[group]/comments/[code]/[slug].tsx
    profile/[username].tsx
    me/(posts|comments|saved).tsx
    chats/index.tsx, chats/[id].tsx
    notifications.tsx
    login/*.tsx             # phone → code → age → email
  api/                      # sidechat.js client singleton + typed wrappers + bug workarounds
  features/                 # feed, post, comment, compose, poll, groups, chat, profile
  components/               # presentational, platform-split where needed (.web.tsx)
  lib/                      # storage, formatting, devalue, keyboard, cache
```

- **State/data**: TanStack Query (cursor-paginated infinite queries, optimistic votes,
  persisted cache). One `SidechatAPIClient` singleton in a context.
- **Token storage**: platform-split adapter — `localStorage` on web, `expo-secure-store` on
  native (SecureStore has no web implementation; don't call it there).
- **URL fidelity**: keep Yik Yak's path shape so links are interchangeable with the real site.
- **Theme**: the real web client hard-forces dark (`<html class="dark">`). webyak ships
  dark + light + system.

---

## 4. Parity matrix — feature → sidechat.js method

| # | Feature | Method(s) | Notes |
|---|---|---|---|
| 1 | SMS login | `loginViaSMS`, `verifySMSCode` | US numbers, no `+1` |
| 2 | New-user setup | `setAge`, `registerEmail`, `checkEmailVerification`, `setDeviceID` | age ≥ 13 enforced client-side |
| 3 | Session bootstrap | `getUpdates`, `getCurrentUser` | `getUserAndGroup` is deprecated |
| 4 | Group feed | `getGroupPosts(groupID, "hot"\|"recent"\|"top", cursor)` | infinite scroll |
| 5 | Single post | `getPost` | by ID |
| 6 | Comments | `getPostComments` | lib already nests + flattens replies |
| 7 | Vote | `setVote(postID, "upvote"\|"downvote"\|"none")` | posts **and** comments |
| 8 | Create post | `createPost(text, groupID, assets, disableDMs, disableComments, anonymous, repostId, pollOptions)` | polls + quote-repost included |
| 9 | Create comment/reply | `createComment(parentPostID, text, groupID, replyCommentID, topLevelReplyID, …)` | 2-level threading |
| 10 | Delete own content | `deletePostOrComment` | |
| 11 | Polls | `voteOnPoll`, `viewPollResults` | |
| 12 | Image upload | `uploadAsset` | ⛔ RN-only — needs web rewrite (finding 5) |
| 13 | Group asset library | `getAssetLibrary` | stickers/memes per group |
| 14 | Explore groups | `getAvailableGroups`, `searchAvailableGroups` | `onePage` toggles via `App-Version: 0` |
| 15 | Group metadata | `getGroupMetadata` | |
| 16 | Join / leave group | `setGroupMembership` | |
| 17 | Username | `checkUsername`, `setUsername` | |
| 18 | Bio + icon | `setUserBio`, `setUserIcon(emoji, primary, secondary)` | |
| 19 | Public profile | `getUserProfile`, `getUserPosts` | |
| 20 | My posts / comments | `getUserContent` | ⛔ broken URL — patch via `sendRequest` |
| 21 | DMs | `getDMs`, `getDMThread`, `sendDM`, `startDM` | needs a stable client/device ID |
| 22 | Group chats | `getGroupChats`, `joinGroupChat` | ⛔ `getGroupChats` URL broken |
| 23 | Hide user's posts | `hidePostsFromUser`, `unhidePostsFromAllUsers` | |
| 24 | Mark activity read | `readActivity` | |
| 25 | Save / unsave post | — | List works: `/v1/posts/saved` → `{posts, cursor}`. ⛔ Write path: 8 candidates swept, all 404 |
| 26 | Follow / unfollow post | — | ⛔ readable, not writable; six candidate paths all 404 |
| 27 | Notification feed | — | ✅ `/v1/activity` → `{items, cursor}` with server-rendered `text`. Ready to build |
| 28 | Report content | — | ⛔ no method |
| 29 | Awards | — | ⛔ no method; posts carry `awards[]`. Deliberately deprioritised |
| 30 | Community leaderboard | — | ⛔ no endpoint; groups carry `should_show_leaderboard`. Stub button in the header |

Items 25–29 are the "sniff the official client and add via `sendRequest`" pile (Phase 8).

---

## 5. Features beyond the official client

- Real, shareable URLs for every screen + static export (the RN apps have none).
- Desktop multi-column layout; the official web client is a single narrow column.
- Keyboard shortcuts: `j`/`k` move, `u`/`d` vote, `c` comment, `/` search, `g` then key to jump.
- **Multi-feed**: one merged, re-ranked timeline across several groups.
- Light theme + system theme + reduced-motion support.
- Client-side search/filter over the loaded feed; recent-search history.
- Compose drafts autosaved; offline read via a persisted query cache.
- Image lightbox with zoom; `alt` text and real focus rings throughout.
- Export my posts/comments to JSON.
- PWA: installable, offline shell.
- *(stretch)* Logged-out read-only mode over `web.yikyak.com/api` — needs the proxy from finding 2.

---

## 6. Roadmap

### Phase 0 — base ✅
- [x] Scaffold Expo SDK 57 + expo-router, verify `expo start --web`
- [x] Install `sidechat.js@2.6.6`
- [x] Recon API, CORS, pagination, payload shapes
- [x] Write this plan

### Phase 1 — foundation ✅
- [x] Strip template demo screens/components; keep theme hooks + `constants/theme.ts`
- [x] Design tokens: colors, spacing, radii, type scale, breakpoints; dark + light
- [x] `lib/storage.ts` platform-split token store (localStorage / SecureStore)
- [x] `api/client.ts` — `SidechatAPIClient` singleton, typed wrappers, defect workarounds
- [x] `api/session.tsx` — session context, token restore, persisted device ID
- [x] TanStack Query provider + persisted cache
- [x] Port `SidechatTypes` typedefs into real TS, corrected against live payloads
- [x] App shell: sidebar (>=900px) / bottom tab bar, `Screen` container, all 12 route skeletons

Verified: `tsc --noEmit` clean, `expo lint` clean, `expo export --platform web` renders all
12 routes, `/nope/...` returns a real HTTP 404.

### Phase 2 — auth ✅
- [x] Phone entry → `/v1/login_register`
- [x] Code entry → `/v1/verify_phone_number`, three-way branch, persist token
- [x] New-user branch: age gate → school email → verification polling (skippable)
- [x] Device token registered after the age gate
- [x] Session restore on boot; global 401 → sign-out; sign-out clears storage
- [x] Auth gate via `Stack.Protected` — every route except `/login` is gated
- [x] Error surfacing verified against the live API (400 + `message`)
- [x] `/diagnostics` screen that runs the blocker probes on one press
- [x] Signed in with a real number; round-1 probes run
- [x] Q2 **closed** — assets are pre-signed R2 URLs, plain `<img>` works
- [x] Q6 **closed** — the URL slug is a group's `index_name`
- [x] Q1 **closed** — `cy` is a hardcoded literal, not a region
- [x] Blocker 1 **answered: no native endpoint exists.** Confirmed by a DynamoDB
      key error, not inferred — [docs/API.md](docs/API.md#blocker-1--index_code--post_id)
- [x] Blocker 2 layered resolver implemented (`src/api/groups.ts`)
- [x] Feed defences ported from offsides (`src/api/feed.ts`)
- [x] Round-2 probes run — every resolver layer missed; direct slug lookup
      confirmed dead (`NOT_FOUND_ERROR`); search crashed on a library defect
- [x] Search wrapper defect found and bypassed (`coerceGroupList`)
- [x] Worker **deferred by decision**, fully specified in [docs/WORKER.md](docs/WORKER.md);
      client hooks in place and inert
- [x] Round-3 probes run — **Blocker 2 closed**. Search envelope is `{groups}`,
      not `results`; layer 4 resolves groups outside explore
- [x] Unicode slugs handled (`wsu-wordle-🧩` is a real `index_name`)
- [x] `memberships[]` (4) vs `getUpdates` (3) discrepancy documented

### Phase 3 — read — built, needs visual QA

> Blocker 2 is **closed** — `/g/<slug>` resolves for any group. Blocker 1 has no
> client-side fix and is parked on the deferred Worker; it only affects pasted
> post links.
> Read [docs/API.md](docs/API.md#two-id-resolution-blockers) before starting.
> The feed helpers in `src/api/feed.ts` are **not optional** — see
> [docs/OFFSIDES.md](docs/OFFSIDES.md#the-feed-needs-two-defensive-filters-not-one).

- [x] Slug → `group_id` resolver working end to end (`src/api/groups.ts`)
- [ ] ⛔ `/p/<code>` from a **pasted link** needs [the Worker](docs/WORKER.md),
      which is deferred. In-app navigation carries the UUID, so build the post
      screen against that and the gap closes later. `/g/<slug>` is unaffected.
- [x] Group feed with hot/new/top tabs, cursor infinite scroll
- [x] Post card: text, vote count, comment count, identity chip, relative time
- [x] Identity avatar (emoji on the user's color, neutral glyph when anonymous)
- [x] Image attachments + lightbox
- [x] Poll rendering (pre- and post-vote states)
- [x] Post detail route + comment thread with reply indentation
- [x] Empty / loading / error states; pull-to-refresh + end-of-feed
- [x] Home feed on the account's primary group
- [x] Visual QA round 1, and the fixes from it:
      - nested `<button>` crash — the card is a `View` now, see docs/DESIGN.md
      - meta text unified at 14px; vote arrows are circular
      - back button on post, group and profile screens
      - **Top time ranges** (`period=day|week|all_time`) — new API discovery
      - author names link to profiles; profile screen reads real data
      - **video plays** — HLS, with an hls.js fallback for Chrome/Firefox
      - link-preview attachments render
      - post age hovers/taps to an exact timestamp and second-level delta
- [x] Visual QA round 2, and the fixes from it:
      - video preloads on approach; fullscreen no longer crops vertical video
      - download control on images and video
      - **asset auth corrected** — not everything is pre-signed; video posters
        needed the bearer, which is why they were blank
      - save / repost / share always visible, dimmed where unavailable
      - timestamps live-update, on one shared timer
- [x] Visual QA round 3, and the fixes from it:
      - timestamps refresh immediately when switching detail level
      - media capped to the viewport, resize-aware
      - video pauses when scrolled away, and shows a first frame
      - header rebuilt: community name + icon, sort tabs, leaderboard stub
      - community switcher — sidebar list and mobile strip, persisted
      - community and profile icons render (`icon.yik-yak.com` is public)
- [x] **Profile pictures fixed** — a profile is a group object, so the picture is
      `icon_url`; the earlier probe used a path that doesn't exist
- [ ] Visual QA round 4

### Phase 4 — write
- [ ] Optimistic voting on posts and comments
- [ ] Compose post: text, anonymous toggle, disable DMs, disable comments
- [ ] Poll composer (add/remove options)
- [ ] Comment + reply-to-reply composer
- [ ] Delete own post/comment with confirm
- [ ] Poll voting + view results
- [ ] Quote/repost
- [ ] ⛔ Fix `uploadAsset` for web (Blob PUT) → image attachments in compose

### Phase 5 — groups & profile
- [ ] Explore page: group grid, member counts, icons
- [ ] ⛔ Explore links to `/g/<slug>`, so it depends on the slug assumption from
      Blocker 2 being confirmed
- [ ] Group search
- [ ] Join / leave; membership reflected in nav
- [ ] Group header: icon, description, member count, rules
- [ ] Profile: username claim (`checkUsername` → `setUsername`), bio, emoji/color icon picker
- [ ] Public profile + that user's posts
- [ ] My posts / my comments (via patched `getUserContent`)

### Phase 6 — messaging
- [ ] DM list + unread state
- [ ] ⛔ Verify a random-UUID device ID is accepted where offsides uses a hashed
      hardware ID — [docs/API.md](docs/API.md#what-we-copy-and-one-thing-we-deliberately-dont)
- [ ] DM thread view + send
- [ ] Start DM from a post or comment
- [ ] Group chat explore + join (patch the broken URL first)
- [ ] Polling or interval refresh for new messages

### Phase 7 — the extras from §5
- [ ] Keyboard shortcuts + shortcut help overlay
- [ ] Multi-feed merged timeline
- [ ] Desktop multi-column layout
- [ ] Light/system theme toggle
- [ ] Draft autosave, offline cache, JSON export
- [ ] PWA manifest + service worker
- [ ] Redirect real Yik Yak URLs (`/cy/<group>/comments/<code>/<slug>`) to `/p/<code>`

### Phase 8 — gap-filling
- [x] `/v1/posts/saved` and `/v1/activity` found, and their shapes probed
- [ ] Wrap both — saved reuses the feed query wholesale, activity needs a screen
- [ ] Capture official-client traffic for the rest: follow, report, awards, and
      the *write* path for save
- [ ] Implement each via `client.sendRequest()`
- [ ] Upstream the four sidechat.js bugs as a PR

### Phase 9 — polish & ship
- [ ] Accessibility pass (focus order, labels, contrast, reduced motion)
- [ ] Rate-limit handling + friendly error surfaces
- [ ] Responsive QA: 360px → 2560px
- [ ] iOS/Android smoke test (universal comes nearly free)
- [ ] `npm run build:web` → GitHub Pages; verify deep links and that `_expo/`
      assets load (needs `.nojekyll`) — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-two-github-pages-gotchas)

---

## 7. Open questions

Resolved ones are kept with their answer so they don't get re-asked.

- **Q1 — the `cy` path segment.** ✅ Resolved by no longer caring: webyak does not
  mirror Yik Yak's URLs. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#url-shape).
- **Q2 — asset URLs.** ✅ Resolved: pre-signed R2, `<img src>` works, no shim and
  no proxy. Caveat: asset-*library* URLs are not pre-signed.
- **Q3 — rate limits.** Unknown. Add backoff before hammering feeds.
- **Q4 — `App-Version: 6.0.0`.** Does the API accept it indefinitely, or force
  upgrades? Unknown.
- **Q5 — logged-out mode.** ✅ Resolved: no. webyak is auth-only, matching the
  real app. This is what removes the need for a proxy —
  [docs/API.md](docs/API.md#auth-is-mandatory).
- **Q6 — is a group's URL slug its `index_name`?** ✅ Resolved: yes, confirmed two
  ways. Note `index_name` isn't always derivable from the display name
  (`Who Would Win?` → `who-would-win-meun`), which is fine since we only go
  slug → group.
- **Q7 — the Cloudflare Worker.** ✅ Decided: yes eventually, **deferred for now**.
  Two routes, no state, fully specified in [docs/WORKER.md](docs/WORKER.md).
- **Q8 — does group search work?** ✅ Resolved: yes. The envelope is `{groups}`;
  sidechat.js reads `results`, which is why it appeared broken. This closed
  Blocker 2.
- **Q9 — why does `getUpdates` return fewer groups than `memberships`?** New,
  minor. One id (`3e27b02b-…`) is in `/v1/users/me` but not `getUpdates`. Not
  blocking; matters for Phase 5's "your groups" list, which should seed from
  `memberships[]` rather than assume `getUpdates` is complete.

---

## 8. Risks

- **Private API.** sidechat.js is reverse-engineered and unofficial. Endpoints can change or break
  without notice, and this likely runs against Yik Yak's ToS — worth deciding now whether this
  stays a personal/local client or ever gets published.
- **Auth is a phone number.** The token is a real account credential. On web it lives in
  `localStorage`, readable by any XSS. Keep third-party script count at zero.
- **Account risk.** Automated or high-volume requests from a non-official client could get the
  account flagged. Keep request rates human.
- **Moderation.** Anonymous feeds carry unfiltered content; a self-hosted client has no moderation
  layer of its own.
