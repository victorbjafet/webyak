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
| **Cold-load share links** (`/p/<id>`) | ✅ | Solved without a server: webyak links carry the post **id**, which `getPost` resolves cold. The share *code* is still unresolvable, but nothing of ours depends on it any more ([API.md](API.md#blocker-1-resolved--by-changing-the-url-not-the-api)). |
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
| `/p/<id>` | Post + comments — **the id form our share links use; opens cold** | `src/app/p/[code].tsx` |
| `/p/<code>` | Same screen, yikyak.com share code — resolvable only from cache | ” |
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


## The archive — two storage layers, not one

Added 2026-09-11. webyak now keeps **a permanent local record of every post and
comment it has ever seen**, separate from the query cache.

| Layer | Store | Job | Lifetime |
|---|---|---|---|
| Query cache | memory | rendering, dedup, optimistic updates | the session |
| **Archive** | **IndexedDB** | **a record that outlives the server's** | forever, until cleared |
| Small prefs | `localStorage` | token, selected community, seen-post ids, theme | forever, tiny |

### Why IndexedDB, and why the persister had to go

This used to be one layer: `PersistQueryClientProvider` dehydrating the whole
query cache into `localStorage` under a single key, rewritten every two seconds.
That was wrong in a way that got worse as the app grew.

- **It serialized everything** — every feed page, all 19 chat threads with their
  full message arrays, the 4,237-group explore catalogue — into one JSON string.
- **`localStorage` is ~5 MB**, and `storage.web.ts` catches quota errors and
  continues by design. So once the blob outgrew the quota, persistence simply
  **stopped, silently** — no error, no log, and no symptom except "nothing is
  ever cached after a reload". Which is very likely why cold-loaded `/p/<code>`
  links never found anything: the mechanism they depended on had quietly died.
- **It had no indexes**, so the one thing durability was for — finding a post by
  share code — still meant a linear scan.

IndexedDB fixes all three: hundreds of MB to GB of quota, real indexes, and
native `Blob` support so media needs no base64 round trip.

### What it changed immediately

`/p/<code>` resolves against the archive, which is **indexed on `index_code`**.
The API still cannot look a share code up — but we can, over every post this
client has ever seen, across reloads. That is a much larger set than the live
query cache ever held.

### Schema notes worth keeping

- **Posts and comments share one store**, separated by a `type` index. They
  carry the same metadata and the planned search wants both.
- **`has_media` and `media_pending` are `0 | 1`, not booleans.** IndexedDB
  **cannot index a boolean** — a `false` never appears in the index, so "posts
  whose media I haven't downloaded" would silently return nothing.
- **Media is flagged before it is fetched.** Bytes are not downloaded yet; every
  attachment is recorded with `cached: 0`, so a later back-fill knows exactly
  what to fetch without re-walking any feed.
- **A deletion never erases a record — and is recorded.** Once a post is removed
  the API returns its text as the literal `"Deleted Post"`; `mergeArchived` keeps
  the original text, tokens and last real vote count, and sets `deleted: 1` with
  a `deleted_at`. So the archive answers both *what did this say* and *was it
  taken down afterwards*, which is a question only an archive can answer at all.
  `deleted_at` is when we **noticed**, not when it happened — the API gives no
  removal timestamp — so treat it as an upper bound.

### Writes are fire-and-forget

Archiving happens inside the feed, post and comment `queryFn`s, with the promise
deliberately unawaited and its errors swallowed. A record-keeping side effect
must never fail a feed load or make the user wait for a disk write.


## Archive search: an index at write time, not a scan at query time

The choice was between scanning every record when a query runs, or maintaining a
token index as records are written.

**Scanning loses badly at the size this is built for.** It is O(n) per query, and
IndexedDB must deserialize each record into a JS object before a single character
can be compared. At the hundreds of thousands of records this is meant to hold,
that is seconds per keystroke — and it degrades exactly as the archive becomes
worth searching.

**The index is nearly free.** Tokenizing a 300-character post is microseconds, on
a write that is already happening, and the tokens cost roughly the size of the
text again on disk — nothing next to the media they sit beside.

No dependency was needed, because **IndexedDB's `multiEntry` index is an inverted
index**: one index entry per array element means `tokens` maps word → records
natively.

### Query shape

1. Each term resolves through the `tokens` index with **`getAllKeys`** — ids
   only, no records.
2. Those id sets are intersected in memory (AND across terms). An impossible
   query gives up before reading a single row.
3. Only the surviving ids are read as full records.

Deserialization is the expensive part of IndexedDB, so this pays it once for the
answer rather than once per term for everything matching any term.

Terms match as **prefixes** — `hokie` finds `hokies` — via a bounded key range.
That is the one piece of stemming that surprises nobody. There is no stopword
list and no stemmer: people search a corpus like this for exactly the odd, short,
specific words a stopword list discards.

Results come back **newest first**. Relevance ranking over prefix-matched tokens
would be mostly noise for social posts, where recency is what people mean.

## Crawling has two frontiers

A crawler that only resumes from a saved cursor walks *backwards forever*. Run it
today, stop, run it next week, and it politely continues digging into old history
while everything posted in the intervening week is never seen — the gap between
newest-archived and newest-posted only grows.

So a run does two passes:

1. **Catch up** — start at the top with no cursor, walk back until several
   consecutive pages are entirely duplicates. That signal means already-archived
   content has been reached, which closes the gap since the last run.
2. **Backfill** — resume from `tail_cursor` and keep going deeper.

Head first on purpose: recent posts are the ones most likely to disappear before
the next run, so they are the ones worth securing first. Only `tail_cursor` is
persisted — the head is found by starting at the top each time, which is correct
by construction.

### Backfill never stops for duplicates

Observed on a real run: a backfill that gave up as "stalled" would, when simply
started again by hand, push straight through and keep finding new posts. So an
unproductive stretch is **transient**, and ending the run made the operator do
by hand what the loop should have done itself.

Duplicates are also the *expected* state for much of a backfill. The crawl
resumes above ground it already holds, so it must cross that ground to reach
ground it doesn't — which is why the archive's oldest post for the community is
read at the start and used as a **target**. Above that line duplicates mean
"still on the way"; below it, the run is into genuinely new history.

What replaces the thresholds is a **budget on progress**, where a page counts as
progress if it archived something new *or* reached further back in time:

| Pages without progress | Behaviour |
|---|---|
| 5 | Pause longer (8s, escalating to 30s) and keep going |
| 40 | Give up and say so — something really is wrong |

A repeated cursor is treated the same way rather than as an instant abort, for
the same reason: it clears when waited out.

Catch-up still stops on duplicates after 3 pages, because meeting known content
is precisely how it knows the gap since the last run is closed.

`getOldestArchived` is a single cursor step on a compound `[group_id,
created_at]` index, so reading the target stays free as the archive grows.


## Crawl metrics: run figures and lifetime figures are separate

The backfill panel reports two scopes and never mixes them, because mixing them
actively misled.

An earlier version seeded `pages` and `archived` from saved state while
`duplicates` started at zero, so one line — *"203 pages · 3.5k new · 432 held"* —
described three different time spans at once. A run that had archived nothing new
still showed thousands, which is precisely the case where an honest number
matters.

`CrawlProgress.run` is always this session; `CrawlProgress.total` is the
community across every run.

### What the panel shows, and why

During a crawl the useful question is rarely "how many posts" — it is **"is this
still getting anywhere, and how fast"**. So the monitor leads with movement:

| Metric | Answers |
|---|---|
| Pages / min, posts / min | Is it running at the intended pace, or being throttled? |
| Requests vs pages | How many attempts failed and were retried |
| **Idle pages** | Consecutive pages that neither archived anything nor reached further back — the budget that decides whether the run continues |
| **Time since last page** | The clearest early stall signal, because it moves every second |
| Walked range + days spanned | How deep this run has actually gone |
| Target | The oldest post already held, and whether the run has passed it |
| Cursor (truncated) | Whether paging is advancing at all |

The progress bar measures the span walked against the distance to the target.
Past the target it stops pretending to be a percentage: there is no known floor
to measure against, so inventing a denominator would be a made-up number on a
screen full of real ones.
