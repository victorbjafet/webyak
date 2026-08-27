# The Cloudflare Worker — deferred, specified

**Status: not built.** This file exists so that whenever we do build it, no
re-investigation is needed.

> ⚠️ **"Nothing depends on it" stopped being true on 2026-08-27.** Image upload
> is blocked by CORS on the storage host and **cannot be fixed from a static
> origin** — see [the second route below](#post-upload) and
> [API.md](API.md#-image-upload-is-blocked-by-cors). Share codes were a missing
> convenience; this is a feature of the app that does not work at all.

## Why it exists

> **Scope changed twice on 2026-08-27.** It originally covered share codes and
> group slugs. Group slugs were then closed natively — the live search endpoint
> resolves groups outside explore once its response envelope is read correctly
> (see [API.md § Blocker 2](API.md#blocker-2--group-slug--group_id)), and its
> `/group/:slug` route is kept below as a documented fallback, not a requirement.
> Then **image upload turned out to need it**, which is a stronger justification
> than share codes ever were: a shared link failing to cold-load is a degraded
> experience, while attaching an image simply does not work.

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
| upload image bytes | pre-signed `PUT` to the storage host is blocked by CORS, and no combination of headers or fetch modes avoids the preflight | ❌ **dead end — the second thing the worker is for** |

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

### `POST /upload`

**Required for image attachments.** Unlike the two routes above this is not a
scrape — it is a plain byte relay, and it exists purely because browsers enforce
CORS and native apps do not.

```
POST /upload?content_type=png
Authorization: Bearer <the user's token>
Body: the raw image bytes

→ { "asset_id": "<uuid>" }
```

What it does:

1. `GET https://api.sidechat.lol/v1/assets/upload_url?content_type=<type>` with
   the caller's bearer token, to obtain `{upload_url, asset_id}`.
2. `PUT` the request body to `upload_url` with the right `Content-Type`. **This
   is the step that only works server-side** — no preflight is involved between
   two servers.
3. Return the `asset_id`, which the client puts into `createPost`'s `assets[]`.

Three things to get right:

- **The token belongs to the user, not the worker.** Forward the caller's
  `Authorization` header; never hold a credential of our own. The worker stays
  stateless and has nothing worth stealing.
- **Cap the body size.** An open relay to someone else's storage is worth abusing.
  Yik Yak's own limit is unknown; something like 10 MB is comfortably above a
  phone photo and far below useful abuse.
- **Restrict `content_type`** to `png`, `jpeg` and `gif`, the set
  `uploadAssetWeb` already enforces, and reject anything else before making the
  first request.

Client-side, `uploadAssetWeb` already isolates this: it is the only function that
touches `upload_url`, so wiring the worker in means changing one function body.

**The attach control is already gated on this.** `imageUploadEnabled` in
[src/lib/worker.ts](../src/lib/worker.ts) is simply `Boolean(WORKER_URL)`, and
the composer hides the Photo button when it is false. So there is no flag to
remember: deploying the worker and setting `EXPO_PUBLIC_WORKER_URL` restores
attachments, and until then the UI never offers an upload that provably cannot
complete.

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
