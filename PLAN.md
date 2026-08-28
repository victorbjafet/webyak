# webyak — plan & todo

A universal (web-first) Yik Yak client built on **Expo Router** + **[sidechat.js](https://github.com/micahlt/sidechat.js)**.
Goal: faithful parity with the official app, plus features the official web client doesn't have.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `⛔` blocked/gap

**This file is the roadmap.** Decisions and findings live next to it:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (URL shape, hosting),
[docs/API.md](docs/API.md) (auth flow, ID blockers, library defects),
[docs/DESIGN.md](docs/DESIGN.md) (tokens, layout rules),
[docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md) (secret hygiene, release audit).
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
| 12 | Image upload | `uploadAssetWeb` | ✅ web. ⛔ native needs `expo-image-picker` |
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
| 30 | Yakarma total + per-community | `getUpdates().karma` | ✅ with post/comment split |
| 31 | For You feed | `Home` group, `index_name: "all"` | ✅ not a community — no top, not postable |
| 32 | Saved posts list | `/v1/posts/saved` | ✅ read-only |
| 33 | Upvoted posts list | `/v1/posts/upvoted` | ✅ a path, not a `type` |
| 34 | Unread filter | — | ✅ client-side; the API rejects `type=unread` |
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

### Requested 2026-08-27 — not scheduled yet

Five ideas from the owner, with what is already known about each. Two of them
are mostly plumbing; three need a probe before they can be estimated.

| # | Idea | What we already know | Blocked on |
|---|---|---|---|
| B1 | **Live-ish score refresh** on posts and comments | No push channel has been found; this would be polling. The infrastructure is already there — TanStack Query `refetchInterval` on a visible feed, plus the existing viewability tracking so only on-screen posts refetch | Deciding a polite interval. This is a private API and the account is real, so an aggressive poll is an account-risk decision, not just a perf one (PLAN §8) |
| B2 | **Unread tab** in Alerts | ✅ **The API already supports this.** `/v1/activity` items carry `is_seen`, and `POST /v1/activity/seen` takes `{ids: [...]}` — an array, so it batches, even though sidechat.js's `readActivity` only passes one. So this is a UI job, not a capability gap | Nothing. Ready to build |
| B3 | **Show removal / warning state** when a post is taken down or reported | ✅ **Unblocked 2026-08-28.** `getUpdates()` returns `unacknowledged_removed_post_ids`. The name implies a matching acknowledge call, which is what the official app's dismissable warning would use ([docs/API.md](docs/API.md#what-else-is-in-getupdates)) | Nothing to probe for the ids themselves. Finding the acknowledge endpoint needs a sweep, and testing the whole flow still needs a post that actually gets removed |
| B4 | **Stats bubble in Alerts** — new upvotes since last open | Half-supported. Activity items already carry a ready-made string (*"Your post reached 25 karma: …"*) and an id shaped `votes~<uuid>~25`, where the trailing number is the karma threshold. Counting *new* ones needs `is_seen`, same mechanism as B2 | Nothing beyond B2 |
| B7 | **Sort your own posts/comments by top of all time** | **Does not exist in the official app** — requested as an addition. `/v1/posts?type=my_posts` returns a flat list with no sort parameter, and the same silent-ignore behaviour as the feed endpoint means an unrecognised `sort` would look like it worked. The lists are small enough to sort client-side by `vote_total`, which sidesteps the question entirely | Nothing — client-side sorting works today. Wants a probe only if server-side paging is ever added, since sorting one page of many would be wrong |
| B6 | **Style deleted posts properly** | They come back in feeds and threads with `text` replaced by the literal `"Deleted Post"`, which we render as ordinary body text so it reads like someone typed it. Should be muted, italic, without vote or reply controls | No `deleted` flag has been found, so detection means matching that string — fragile, worth a probe first ([docs/API.md](docs/API.md#deleted-posts-render-as-bare-text)) |
| B5 | **Yakarma over time** on the You tab, per-post and overall | Karma is at `getUpdates().karma` as `{post, comment, groups}` — and the same payload also carries **`quarterly_karma`, `season_karma` and `season`**, so there may be period-scoped values to read rather than sampling a single lifetime number. Worth inspecting those before building a sampler | Inspect the three season/quarter fields. If they hold real history this gets much cheaper; if not, fall back to client-side sampling, which is per-device and should say so rather than look like lost data |

Two things worth deciding before any of these start:

- **B1 and B4 overlap.** Both want to know "what changed since last time", and
  the activity feed's `is_seen` already answers it server-side. Building B2/B4
  first would give B1 a cheaper implementation than polling every score.
- **B5's data is only as good as its sampling.** A score logged on app open is a
  sparse, irregular series — fine for a sparkline, misleading if drawn as a
  continuous line. Worth settling the presentation before collecting, because
  the collection can't be redone retroactively.

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

### Phase 3 — read ✅ (one deferred bug, see below)

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
- [x] Visual QA round 4, and the fixes from it:
      - community selection persists the group object rather than an id, so a
        failed lookup can no longer silently fall back
      - selecting a community navigates to it; the redundant "Open X" button is gone
      - share links point at `webyak.vbjfr.xyz`, not yikyak.com
- [x] ⛔ **Images that don't render** — moved into Phase 5 and re-diagnosed.
      It is **three causes, not one**: community icons have no `icon_url` in the
      data at all, profile photos had no render path in the component, and only
      video thumbnails are actually a pipeline problem. See
      [docs/API.md](docs/API.md#-images-that-dont-render--under-investigation-phase-5)
- [ ] ⛔ Membership count discrepancy — deferred, switcher source is correct in
      practice
- [x] Visual QA round 5 — Phase 3 closes with the image bug carried forward

### Phase 3.5 — open-source audit (GATE) ✅

**Audit passed 2026-08-27 and the repo is live** at
[github.com/victorbjafet/webyak](https://github.com/victorbjafet/webyak). No
credentials or personal data were found in `HEAD` or in any of the 294 objects
in history. The [standing pre-commit rule](CLAUDE.md) still applies to every
commit from here — the audit cleared what was there, not what comes next.
Full checklist and pre-scan findings:
[docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md). The standing pre-commit rule is in
[CLAUDE.md](CLAUDE.md).

- [x] Replace `LICENSE` — was Expo's `Copyright (c) 2015-present 650 Industries, Inc.`
- [x] `SAMPLE_PROFILE = 'snoopyvt'` — **decided: keep.** Owner's call, 2026-08-27
- [x] Widen `.gitignore` to cover plain `.env` (Expo reads it for `EXPO_PUBLIC_*`)
- [x] `.gitignore` now also covers `*.har` and probe dumps — the realistic leak vector
- [x] Hardcoded Virginia Tech group UUID — **decided: keep.** A public community
      id, not personal data
- [x] Delete unused Expo template assets and `scripts/reset-project.js`
- [x] Real README, including the `localStorage` token disclosure
- [x] Secret scan over **full history** — every blob, not just `HEAD`. Clean
- [x] Read every `docs/` file as a stranger — payloads were already redacted to `…`
- [x] Created the GitHub repo and pushed — **public at
      [github.com/victorbjafet/webyak](https://github.com/victorbjafet/webyak)**

### Phase 4 — write ✅ verified live 2026-08-27 (one blocker: image upload)
- [x] Optimistic voting on posts and comments — `useVote`, patched across every
      cache the post lives in ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#one-post-lives-in-many-caches))
- [x] Compose post: text, anonymous toggle, disable DMs, disable comments
- [x] Poll composer (2–4 options, add/remove)
- [x] Comment + reply-to-reply composer, two-level threading
- [x] Delete own post/comment with confirm — `ConfirmDialog`, because
      `Alert.alert` is a silent no-op on web
- [x] Poll voting + mark results viewed (fixed the library's broken path)
- [x] Quote/repost → `/compose?repost=<id>`
- [~] Image attachments on web — picker, preview, measurement and submit all
      work; **the upload itself is blocked by CORS on the storage host** and
      cannot be fixed from a static origin
      ([docs/API.md](docs/API.md#-image-upload-is-blocked-by-cors)). ⛔ **Needs
      the Worker's `POST /upload` relay** ([docs/WORKER.md](docs/WORKER.md#post-upload))
      — the first hard dependency on it
- [x] **Attach control disabled 2026-08-27** until that relay exists. Gated on
      `EXPO_PUBLIC_WORKER_URL` in [src/lib/worker.ts](src/lib/worker.ts), not on
      a hand-flipped flag — deploying the worker turns it back on by itself,
      and there is no state in which the UI offers an upload that cannot finish
- [x] **Native image attachment — closed as out of scope**, owner's decision
      2026-08-27. Attachments are a web feature; revisit only if the app is
      actually ported ([src/lib/image-picker.ts](src/lib/image-picker.ts))
- [x] **Verified against the live API** — write probes PASS, and voting and
      commenting confirmed to sync **both ways with the official app**
- [x] Failed writes roll back **and say so** — every mutation pairs its rollback
      with a toast ([docs/DESIGN.md](docs/DESIGN.md#failure-has-to-be-visible))
- [x] Focus rings themed — the browser default blue is suppressed and every
      input paints its own ([docs/DESIGN.md](docs/DESIGN.md#focus-rings))

### Phase 5 — groups & profile ✅ (one worker dependency)
- [x] **For You parity** — "Home" is not a community: it is the combined feed.
      Renamed, given a glyph, denied `top`, and composing from it posts to the
      school group instead ([docs/API.md](docs/API.md#home-is-not-a-community--it-is-the-for-you-feed))
- [x] Every post labelled with its community, on every feed, as Yik Yak does
- [x] For You `unread` filter — **there is no server-side one**: `type=unread`
      returns `400 Invalid post type`. Implemented client-side with per-device
      read tracking marked on viewport entry, and the feed auto-advances pages
      while the filtered result is short
      ([docs/API.md](docs/API.md#unread-is-ours-not-theirs)). Defaults to unread
- [x] Explore sorted by member count by default
- [ ] ⛔ Explore "newest" — no timestamp on any explore field. Shown disabled
      with a reason ([docs/API.md](docs/API.md#-explore-cannot-sort-by-newest))
- [x] School group-chats section on Explore — placeholder; `/v1/chats/explore`
      works, but there is nowhere to open a chat until Phase 6
- [x] You tab: yakarma total and per-community, each expanding to the
      post/comment split ([docs/API.md](docs/API.md#yakarma)). Names are joined
      from the user's own groups — the karma payload carries ids but no names
- [x] Anonymous posts show the community, never the word "Anonymous"; an author
      row appears only for a real username. Comments keep their OP/#1/#2 aliases
      ([docs/DESIGN.md](docs/DESIGN.md#anonymity-is-shown-by-absence))
- [x] You tab: saved posts (read-only — no save endpoint exists)
- [x] You tab: upvoted posts — **found**: `/v1/posts/upvoted` is a *path*, not a
      `type` value, which is why earlier sweeps missed it
      ([docs/API.md](docs/API.md#posts-you-upvoted))
- [~] **Fix images first.** Explore is a grid of community icons and profiles
      are built around avatars, so this bites here before anything else does.
      Groundwork done 2026-08-27:
  - [x] `AuthedImage` no longer swallows failures — renders the caller's
        fallback and records a reason (`no-url`/`http`/`network`/`decode`) with
        the host only, never the signed URL
  - [x] Every call site labelled with a `context`, so a failure names its place
  - [x] `IdentityAvatar` gained the photo branch it never had; `GroupAvatar`'s
        initials are a real fallback rather than an else-branch
  - [x] Three probes added: which endpoint carries `icon_url`, whether the
        poster fetch works with the bearer, and what actually failed on screen
  - [x] **Probed 2026-08-27 — two of three solved.** Community icons: the
        endpoints the app reads omit `icon_url` entirely for some groups, so
        `useGroupIcon` looks it up via search and matches on id. Profile photos:
        the field is `icon_url`, on `api.sidechat.lol`, needing the bearer
  - [x] **Profile photos fixed** — the endpoint needs *no* auth; it 302s to a
        signed R2 URL, and sending the bearer forced a preflight that cannot
        follow a redirect. Removing the header fixed it
        ([docs/API.md](docs/API.md#profile-photos-icon_url-and-the-bearer-was-breaking-it))
  - [x] ⛔ **Video thumbnails — settled: not fixable from a browser.** Both
        routes are closed. No header → the endpoint is a hard 401 (verified
        directly, unlike `/v1/assets/profile`). With the header → preflight, then
        a 302 a preflighted request may not follow. Needs the worker's asset
        relay ([docs/WORKER.md](docs/WORKER.md#get-asset)). The poster now falls
        back to a neutral panel instead of a black box
        ([docs/API.md](docs/API.md#-video-thumbnails-need-the-worker))
  - [ ] ⛔ Video preloading doesn't work — deferred, non-blocking
        ([docs/API.md](docs/API.md#-videos-are-not-preloading))
  - [ ] ⛔ Post-card avatars stay emoji: a post's `identity` carries no photo
        URL, so feed avatars would need a profile lookup per author
- [x] Explore page: group grid, member counts, icons. Two columns above 720px,
      virtualized — the catalogue is 4,237 groups in a single uncursored
      response, so it is fetched once and cached rather than paged
- [x] Explore links to `/g/<slug>` — Blocker 2 confirmed closed
- [x] Group search — local filter over the cached catalogue, merged with live
      results. Local first, because those objects carry the membership state the
      join button reads
- [x] Join / leave, optimistic, with rollback and a toast. Patches every cached
      copy (explore + search are separate keys) and invalidates the user's own
      group list, since the server decides the resulting order
- [x] Group header: icon, description, member count, join control. **No rules
      field exists** on any group payload — dropped, not deferred
- [x] Profile: username claim with a debounced availability check, bio, and an
      emoji/color icon picker with a live preview. All three are the same
      `PATCH /v1/users/<id>`, and only changed fields are sent — a full payload
      would re-claim the username on every bio edit
- [x] Public profile + that user's posts
- [x] My posts / my comments, tabbed, via the URL-patched `getUserContent`

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

- **⛔ Fully-serverless is no longer strictly true.** **Two** features need a proxy, both for the
  same reason — a browser request carrying an `Authorization` header cannot follow a redirect:
  image upload and video thumbnails. Everything else works from a static origin
  ([docs/WORKER.md](docs/WORKER.md)).
- **Private API.** sidechat.js is reverse-engineered and unofficial. Endpoints can change or break
  without notice, and this likely runs against Yik Yak's ToS.
- **Publishing this repo.** It goes open source; the release audit passed 2026-08-27 and found
  nothing. The *ongoing* risk remains: probe output is our main documentation input and it carries
  live tokens and user ids, so every commit gets checked. [docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md).
- **Auth is a phone number.** The token is a real account credential. On web it lives in
  `localStorage`, readable by any XSS. Keep third-party script count at zero.
- **Account risk.** Automated or high-volume requests from a non-official client could get the
  account flagged. Keep request rates human.
- **Moderation.** Anonymous feeds carry unfiltered content; a self-hosted client has no moderation
  layer of its own.
