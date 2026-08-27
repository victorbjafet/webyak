# The Cloudflare Worker — deferred, specified

**Status: not built. Deferred deliberately.** Nothing in webyak depends on it.
This file exists so that whenever we do build it, no re-investigation is needed.

## Why it exists

> **Scope narrowed 2026-08-27.** This originally covered *two* gaps: share codes
> and group slugs. Group slugs were then closed natively — the live search
> endpoint resolves groups outside explore once its response envelope is read
> correctly (see [API.md § Blocker 2](API.md#blocker-2--group-slug--group_id)).
> **The worker's only remaining justification is share codes.** Its `/group/:slug`
> route is kept below as a documented fallback, not a requirement.

webyak is a static, serverless GitHub Pages app and the authenticated Sidechat
API is CORS-open, so **the entire app works without a server** — except for
resolving a **share code** on a cold load.

Our post URLs carry a share code (`/p/0ESz5N3t`); the API takes UUIDs. In-app
navigation is fine, because a post reached from a feed already carries its UUID.
The gap is someone opening a shared link with an empty cache.

Probing established the authenticated API **cannot** close that gap:

| Need | Authenticated API | Status |
|---|---|---|
| share code → post | no endpoint exists; `/v1/posts/get` is UUID-keyed (a DynamoDB `ValidationException` proves it), and every guessable alternative 404s | ❌ **dead end — this is what the worker is for** |
| group slug → group | `/v1/groups/explore/search?term=` resolves it | ✅ closed natively, no worker needed |

The public web client resolves share codes unauthenticated, and its only
obstacles are CORS and an encoding — exactly what a worker is for.

## What it would do

One required route and one optional one, both the same shape: fetch a SvelteKit
`__data.json`, rehydrate it, re-serve as clean JSON with CORS headers.

### `GET /post/:code`

```
→ https://web.yikyak.com/cy/x/comments/:code/x/__data.json?x-sveltekit-invalidated=01
← { post, comments }
```

Verified: **the code alone resolves the post.** Byte-identical 200s with a wrong
group slug, a wrong title slug, and a group that does not exist. Only the leading
segment matters and it must be the literal `cy` (`us`, `uk`, `ca`, `all`, `x` all
404) — so `cy` is a hardcoded constant in their routing, not a region. The `x`
placeholders above are arbitrary and intentional.

Response carries the post **and its full comment tree**, which means this route
can serve the whole post detail screen on a cold load.

### `GET /group/:slug` — optional

Not needed any more; layer 4 of the slug resolver covers this natively. Kept
documented because it is verified and free to add alongside the route above, and
it would serve as a fallback if search is ever rate-limited or withdrawn.

```
→ https://web.yikyak.com/cy/:slug/__data.json?x-sveltekit-invalidated=01
← { group }
```

Verified against `wordle`: 687 bytes, unauthenticated, returning a complete group
object — `id`, `name`, `index_name`, `color`, `description`, `icon_url`,
`member_count`, `group_join_type`, `group_visibility`. Everything the group header
needs, keyed by slug alone.

## The one non-obvious part

Both payloads are **devalue-flattened**: a `nodes[].data` array where objects hold
*numeric indices* into that same array rather than values.

```jsonc
{ "id": 2, "name": 3 }              // 2 and 3 are array indices
// ...
"602fb305-4ec2-4d01-83be-4d80c6636a56",   // index 2
"Wordle",                                  // index 3
```

Use `devalue`'s `parse` rather than hand-rolling the pointer chase — it is the
same library SvelteKit encodes with. Keep this **server-side**: the point of the
worker is that the client never sees this format.

## Contract

```
GET /post/:code   → 200 { post: PostOrComment, comments: PostOrComment[] }
GET /group/:slug  → 200 { group: Group }
                    404 { error: "not_found" }
                    502 { error: "upstream", status: <n> }
```

- CORS: `Access-Control-Allow-Origin` restricted to the Pages origin, not `*`
- No auth, no secrets, no state, no KV — a fetch, a parse, and a header
- Cache upstream responses briefly (60s) via the Cache API; these are public and
  hot-linked
- Types already match `src/api/types.ts`

## Wiring it in

The client side is already built and inert:

- `WORKER_URL` in [src/api/groups.ts](../src/api/groups.ts) reads
  `EXPO_PUBLIC_WORKER_URL`. Empty means every worker layer no-ops.
- `lookupGroupViaWorker()` is already **layer 5** of `resolveGroupBySlug`.

So enabling it is: deploy the worker, set `EXPO_PUBLIC_WORKER_URL`, and add the
matching `/post/:code` call in the post detail screen. No refactor.

## What we lose by deferring

Only cold-loaded share links:

- `/p/<code>` works whenever the post was reached from a feed, because the UUID
  is already in cache. A **pasted link** fails until the worker exists.
- `/g/<slug>` is unaffected — it resolves natively through the search layer,
  including for groups outside explore.

That is a "shared post links don't work yet" gap, not an "the app doesn't work"
gap, and it does not block Phase 3 from being built or used.
