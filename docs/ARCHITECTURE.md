# Architecture

## Where this lives

| | |
|---|---|
| Source | [github.com/victorbjafet/webyak](https://github.com/victorbjafet/webyak) — public since 2026-08-27 |
| Site | [webyak.vbjfr.xyz](https://webyak.vbjfr.xyz) — GitHub Pages, `CNAME` written by `npm run build:web` |
| Backend | none today; one small Cloudflare Worker is required for image upload ([WORKER.md](WORKER.md)) |

## The public URL

**webyak is deployed at `https://webyak.vbjfr.xyz`.**

That is the canonical base for every user-facing link — shared post links, deep
links, anything printed or copied. It lives in one place, `BASE_URL` in
[src/lib/share.ts](../src/lib/share.ts), overridable with
`EXPO_PUBLIC_BASE_URL` for a preview or local deploy. Never hardcode it anywhere
else.

Because it is a custom domain on GitHub Pages:
- `npm run build:web` writes a **`CNAME`** file into `dist/`. Pages drops the
  custom domain on any deploy that lacks it.
- No `experiments.baseUrl` is needed — the site is served from the domain root,
  not a `/repo/` subpath.

## Deployment model — static, serverless, GitHub Pages

webyak ships as a **pure static bundle with no server of its own**. Verified
2026-08-26: `api.sidechat.lol` returns `access-control-allow-origin: *`,
`access-control-allow-methods: *` and `access-control-allow-headers: *` on both
simple requests and `OPTIONS` preflight, so the browser talks to the Sidechat API
directly. **No CORS proxy is required for the app's own data path.**

### Web output is `single`, not `static`

`app.json` sets `expo.web.output: "single"` — one `index.html`, client-side
routing for everything.

We started on `"static"` (per-route prerendered HTML). That was the wrong choice
once the product decision landed that webyak is **auth-only** (see
[docs/API.md](API.md#auth-is-mandatory)): prerendered HTML exists to be crawled
and to paint before JS, and neither matters for a screen that immediately
redirects to a login gate. `"single"` also removes a whole class of
hydration-mismatch bugs — nothing is rendered in Node, so client output can't
disagree with it.

Consequence: `useHydrated()` in [src/hooks/use-hydrated.ts](../src/hooks/use-hydrated.ts)
is now effectively always `true` on first paint, so the desktop-shows-mobile-bar
flash is gone. The hook is kept because it stays correct if `output` ever changes
back.

### The two GitHub Pages gotchas

`npm run build:web` handles both. Do not hand-run `expo export` and upload it.

1. **Deep links 404.** GitHub Pages serves files, and `/g/wordle` is not a file.
   Pages falls back to `404.html` for unmatched paths, so the build copies
   `index.html` → `404.html` and the client router takes over from there. The HTTP
   status on a cold deep link is a real `404` — harmless for an auth-gated app,
   but it means Pages can never be used for anything crawlable.
2. **Jekyll eats `_expo/`.** Pages runs Jekyll by default, and Jekyll skips
   directories starting with `_` — which is where every JS and CSS bundle lives.
   The build touches `.nojekyll` to disable it. Without this the site loads a
   blank page with 404s on all assets.

3. **A custom domain needs a `CNAME` file** in the published output, every
   deploy. The build writes one. If it ever goes missing, Pages silently reverts
   to `<user>.github.io` and the domain stops resolving.

If this were ever served from `<user>.github.io/<repo>/` instead, it would also
need `expo.experiments.baseUrl` set to `/<repo>` or every asset path breaks.
That does not apply at a domain root.

### Where serverless stops working

> **Confirmed 2026-08-27: it stops at image upload.** This section was written
> as a list of hypotheticals. One of them is now real — the pre-signed `PUT`
> that uploads an image is refused by the browser before it is sent, because a
> cross-origin `PUT` always preflights and the storage bucket answers no
> `OPTIONS` from our origin. Nothing client-side gets around it
> ([API.md](API.md#-image-upload-is-blocked-by-cors)).

Currently: nowhere. Tracked so we notice the moment it changes.

| Need | Static-only? | Notes |
|---|---|---|
| Read/write the Sidechat API | ✅ | CORS-open, bearer token in header |
| Store the user's token | ✅ | localStorage; it is the user's own credential |
| Deep links / routing | ✅ | via the `404.html` fallback above |
| Images and video in posts | ✅ **verified** | Mixed: some URLs are pre-signed, some need the bearer. Both work client-side — `AuthedImage` fetches the authenticated ones to a blob. No proxy needed. [Rules](API.md#asset-urls-and-auth--corrected) |
| Cold-load group links (`/g/<slug>`) | ✅ **verified** | Resolved natively via `/v1/groups/explore/search` — [Blocker 2 closed](API.md#blocker-2--group-slug--group_id) |
| **Cold-load share links** (`/p/<code>`) | ❌ | The authenticated API cannot resolve a share code — [confirmed, not suspected](API.md#blocker-1--index_code--post_id). The public web client can, but has no CORS. **The one remaining case for a Worker.** |
| Logged-out browsing | ❌ | Out of scope — webyak is auth-only |
| Push notifications | ❌ | Needs a server to hold subscriptions. Out of scope; polling only |
| Hiding a secret | ❌ | We have none. If that ever changes, it needs a worker |

### The Worker question — deferred

Everything except one thing is static-only. That one thing is resolving a
**share code** on a cold load: the authenticated API has no endpoint for it at
all.

Group slugs were originally in the same bucket and are **no longer** — live
search resolves them natively, so the worker shrank to a single required route.

The public web client resolves share codes unauthenticated, blocked only by CORS
and an encoding. A worker of one route and no state closes it.

**Deferred by decision — we build it later.** Nothing depends on it, and the
client-side hooks (`EXPO_PUBLIC_WORKER_URL`, layer 5 of the slug resolver) are
already in place and inert, so enabling it is config plus one call.

Full spec, verified request/response shapes, and the wiring steps:
**[docs/WORKER.md](WORKER.md)**.

## URL shape

**Decision: we do not mirror Yik Yak's URLs.** Their shape is built for SEO on a
public marketing surface; ours is an auth-gated app where nothing is crawled.

Yik Yak: `/cy/advice/comments/0ESz5N3t/how-do-i-raise-my-testosterone`

Three of those five segments are dead weight for us:
- `cy` — a region/scope segment whose meaning we never established, and which
  carries no routing information we act on
- `comments` — pure filler
- the trailing slug — SEO only, and it duplicates the post title

Worse, a `/[region]/[group]` shape is a **greedy two-segment catch-all** that
shadows any future two-segment static route. It nearly collided with `/chats/[id]`
already.

### Sitemap

| URL | Screen | Route file |
|---|---|---|
| `/` | Home feed | `src/app/index.tsx` |
| `/explore` | Group discovery | `src/app/explore.tsx` |
| `/g/<slug>` | Group feed | `src/app/g/[slug].tsx` |
| `/g/<slug>?sort=hot\|new\|top` | Group feed, sorted | ” |
| `/p/<code>` | Post + comments | `src/app/p/[code].tsx` |
| `/u/<username>` | Public profile | `src/app/u/[username].tsx` |
| `/me` | Your profile and content | `src/app/me/index.tsx` |
| `/chats` | DM list | `src/app/chats/index.tsx` |
| `/chats/<id>` | DM thread | `src/app/chats/[id].tsx` |
| `/notifications` | Activity | `src/app/notifications.tsx` |
| `/compose` | New post | `src/app/compose.tsx` |
| `/compose?repost=<id>&group=<id>` | Quote-repost | ” |
| `/login` | Auth flow | `src/app/login/index.tsx` |
| anything else | Not found | `src/app/+not-found.tsx` |

Rules behind it:

- **Single-letter namespaces** (`/g/`, `/p/`, `/u/`) keep every dynamic route to a
  fixed depth and make collisions with static routes structurally impossible.
- **A post is addressable by its share code alone.** `/p/0ESz5N3t` needs no group
  and no slug, so a shared link stays valid even when we don't know the group yet.
- **Sort is a query param, not a path segment**, because it is view state, not a
  resource.
- **No region segment.** If `cy` ever turns out to mean something we need, it
  becomes a query param, not a path segment.

Yik Yak → webyak redirect compatibility (so real Yik Yak links opened in webyak
resolve to `/p/<code>`) is a Phase 7 nicety, not a requirement.

## App structure

```
src/
  app/          expo-router routes; the sitemap above, one file per row
  api/          client singleton, typed wrappers, session context, query provider
  components/   shell (sidebar/bottom bar), Screen container, themed primitives
  constants/    design tokens
  hooks/        useTheme, useHydrated
  lib/          platform-split key/value storage
  theme/        theme preference provider
```

Data flow: **screen → TanStack Query → `src/api/client.ts` → sidechat.js →
api.sidechat.lol**. The client is a singleton because sidechat.js keeps the bearer
token on the instance; `SessionProvider` owns loading that token out of storage
and pushing it into the client.


## Writing (Phase 4)

Reads go through `src/api/queries.ts`; writes go through
[src/api/mutations.ts](../src/api/mutations.ts). The split is not ceremony — the
two have opposite failure modes. A failed read shows an error state and the user
retries. A failed *optimistic* write has already changed the screen, so it has to
be able to put it back.

### Writes are wired to content, not to screens

`PostCard` and `CommentItem` call `useVote()` themselves rather than taking an
`onVote` prop from whatever is rendering them. Whether a post can be voted on is
a property of the post, and threading a callback through every list, profile and
search result only creates places to forget one — the read-only card is then
indistinguishable from a broken one.

### One post lives in many caches

This is the part that is easy to get wrong. A single post can be cached in:

- every feed page holding it — one infinite query per `sort × period` the user
  has opened
- its own `['post', id]` entry
- a `['comments', postId]` array, if it is a comment
- a `['profile', username, 'posts']` array

An optimistic update that patches only the one the user is looking at leaves the
same post showing two different scores on two screens. `patchPostEverywhere`
walks all four, and **returns a snapshot of only the queries it actually
changed** so a failure can restore exactly those — restoring untouched queries
would clobber anything that arrived in the meantime.

Two details that are not obvious:

- **Comment lists are both flat and nested.** `getPostComments` returns a flat
  array whose entries also carry a `replies` array, so the same comment is
  reachable twice. In memory those are the same object; after the query cache
  rehydrates from storage they are two copies. The walker patches both.
- **The delta is computed per copy, from that copy's own `vote_status`** — not
  once from a shared "before" value. Two caches can legitimately disagree (a feed
  page may be minutes stale while the post screen is fresh), and applying a local
  delta keeps each one self-consistent instead of forcing both to a number that
  is only correct for one of them.

### What is deliberately not optimistic

**Creating a post.** Where a new post lands depends on the server's ranking, and
a guess that puts it in the wrong place makes it visibly jump on the next fetch.
The feed is invalidated and refetched instead — slower, and honest.

**Poll votes are optimistic but unusually consequential.** The API has no "change
my answer", and `participated` locks the UI to read-only, so without rollback a
failed vote leaves a permanently locked poll displaying a choice that was never
recorded.


## The explore catalogue (Phase 5)

`GET /v1/groups/explore` returns **every** joinable community in one response —
4,237 of them as of 2026-08-27 — with no cursor and no page parameter. So it is
fetched once and cached for half an hour rather than paged.

That shapes the search design. Typing filters the cached list locally, which is
instant and works offline, and a live `explore/search` request is merged in for
anything the catalogue missed. **Local results come first**, because those
objects carry the `membership_type` the join button reads — a search result
substituted over a local one would flip the button to the wrong state.

The list is virtualized with a deliberately tight window. Four thousand rows is
enough that a generous `windowSize` is felt on scroll.

## Membership is cached in more than one place

Joining patches every cached copy of the group — the explore catalogue and any
search result holding the same id are separate query keys with separate objects,
so patching one leaves the other showing the opposite state.

The user's *own* group list is invalidated rather than patched: joining changes
what the switcher and the home feed show, and only the server knows the
resulting order.
