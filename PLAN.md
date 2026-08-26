# webyak — plan & todo

A universal (web-first) Yik Yak client built on **Expo Router** + **[sidechat.js](https://github.com/micahlt/sidechat.js)**.
Goal: faithful parity with the official app, plus features the official web client doesn't have.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `⛔` blocked/gap

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

Source lives in `src/` (`src/app` = routes). The template's demo screens
(`src/app/index.tsx`, `src/app/explore.tsx`, `src/components/*`) are still in place and get
replaced in Phase 1 — keep `src/hooks/use-color-scheme*` and `src/constants/theme.ts`.

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
| 25 | Save / unsave post | — | ⛔ no method; `is_saved` exists on posts → find endpoint |
| 26 | Follow / unfollow post | — | ⛔ no method; `follow_status` exists on posts |
| 27 | Notification feed | — | ⛔ no method; start from `getUpdates`, then sniff |
| 28 | Report content | — | ⛔ no method |
| 29 | Awards | — | ⛔ no method; posts carry an `awards[]` array |

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

### Phase 1 — foundation
- [ ] Strip template demo screens/components; keep theme hooks + `constants/theme.ts`
- [ ] Design tokens: colors, spacing, type scale; dark + light
- [ ] `lib/storage.ts` platform-split token store (localStorage / SecureStore)
- [ ] `api/client.ts` — `SidechatAPIClient` singleton + React context
- [ ] TanStack Query provider + persisted cache
- [ ] Port `SidechatTypes` JSDoc typedefs into real `.d.ts` types
- [ ] App shell: sidebar (desktop) / tab bar (mobile), header, route skeletons

### Phase 2 — auth
- [ ] Phone entry → `loginViaSMS`
- [ ] Code entry → `verifySMSCode`, persist token
- [ ] New-user branch: `setAge` → `registerEmail` → `checkEmailVerification` polling
- [ ] `setDeviceID` with a generated, persisted device/client ID (also needed by DMs)
- [ ] Session restore on boot; 401 → sign-out; logout clears storage

### Phase 3 — read
- [ ] Group feed with hot/recent/top tabs, cursor infinite scroll
- [ ] Post card: text, vote count, comment count, alias/identity chip, relative time
- [ ] Identity avatar (emoji + primary/secondary color)
- [ ] Image attachments + lightbox
- [ ] Poll rendering (pre- and post-vote states)
- [ ] Post detail route + nested comment tree
- [ ] Empty / loading / error states; pull-to-refresh + refetch

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
- [ ] Group search
- [ ] Join / leave; membership reflected in nav
- [ ] Group header: icon, description, member count, rules
- [ ] Profile: username claim (`checkUsername` → `setUsername`), bio, emoji/color icon picker
- [ ] Public profile + that user's posts
- [ ] My posts / my comments (via patched `getUserContent`)

### Phase 6 — messaging
- [ ] DM list + unread state
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

### Phase 8 — gap-filling
- [ ] Capture official-client traffic to find endpoints for save, follow, notifications, report, awards
- [ ] Implement each via `client.sendRequest()`
- [ ] Upstream the four sidechat.js bugs as a PR

### Phase 9 — polish & ship
- [ ] Accessibility pass (focus order, labels, contrast, reduced motion)
- [ ] Rate-limit handling + friendly error surfaces
- [ ] Responsive QA: 360px → 2560px
- [ ] iOS/Android smoke test (universal comes nearly free)
- [ ] `expo export --platform web` → static host; verify deep links

---

## 7. Open questions

- **Q1** — What is the `cy` path segment in `/cy/wordle`? Region? "community"? Mirror it verbatim
  until known.
- **Q2** — Do posts from `api.sidechat.lol` return pre-signed asset URLs (like the public web API
  does) or bearer-only private URLs? Decides whether images need a fetch-to-blob shim on web.
  Answerable in one request once a token exists.
- **Q3** — Rate limits: unknown. Add backoff before hammering feeds.
- **Q4** — Does the API accept the `App-Version: 6.0.0` default forever, or force upgrades?
- **Q5** — Logged-out mode: worth standing up a tiny proxy for `web.yikyak.com/api`, or keep
  webyak login-only and stay fully static?

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
