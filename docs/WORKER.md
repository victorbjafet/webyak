# The Cloudflare Worker

**Status: built 2026-09-28, deployed 2026-11-02.** The owner deployed it from
the Cloudflare dashboard by following [worker/SETUP.md](../worker/SETUP.md),
on a custom subdomain of the site's own domain (that guide's *Using your own
domain*). The live site's build has its address through the `WORKER_URL`
repository variable. The code is [worker/src/index.js](../worker/src/index.js),
one file with no dependencies, so it can be pasted into the dashboard. Every
client hook below is wired to it. `cd worker && npm test` runs every route in
Node against stubbed upstreams.

This file was the spec before the code existed, and it still says why each
route exists. [What was built](#what-was-built) records the choices made
while building it.

> ⚠️ **"Nothing depends on it" stopped being true on 2026-08-27.** Image upload
> is blocked by CORS on the storage host and **cannot be fixed from a static
> origin** — see [the second route below](#post-upload) and
> [API.md](API.md#-image-upload-is-blocked-by-cors). Share codes were a missing
> convenience; this is a feature of the app that does not work at all.

## Why it exists

> **Scope changed twice on 2026-08-27.** It originally covered share codes and
> group slugs. Group slugs were then closed natively — the live search endpoint
> resolves groups outside explore once its response envelope is read correctly
> (see [API.md § Blocker 2](API.md#blocker-2--group-slug--group_id---closed)), and its
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
| play video | segments are on Cloudflare R2, which sends no CORS headers, so hls.js cannot read them; Chrome's own HLS player fails on them too (2026-09-27) | ❌ **dead end — [`/media`](#get-media); Safari aside, no browser plays Yik Yak video without it** |

The public web client resolves share codes unauthenticated, and its only
obstacles are CORS and an encoding — exactly what a worker is for.

## What it does

One required route and one optional one, both the same shape: fetch a SvelteKit
`__data.json`, rehydrate it, re-serve as clean JSON with CORS headers.

> ⚠️ **This route's justification weakened on 2026-09-11, twice over.**
>
> 1. **Share links no longer need it.** webyak links carry the post id, which
>    `getPost` resolves cold. The route now only serves *yikyak.com* codes
>    pasted in from elsewhere — a real feature, but a much smaller one than
>    "shared links are broken"
>    ([API.md](API.md#blocker-1-resolved--by-changing-the-url-not-the-api)).
> 2. **It may not work for the posts that matter.** The public client returned
>    "couldn't find that post" for a Virginia Tech code. If it only serves
>    publicly visible communities, this route cannot resolve a school-community
>    post no matter how it is built. **Verify against a public-community code
>    before building it.**
>
> `POST /upload` and `GET /asset` are unaffected and remain required.

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

### `GET /asset`

**Required for video thumbnails.** Same shape as `/upload` and the same reason:
a browser cannot complete this request, a server can.

```
GET /asset?url=<encoded api.sidechat.lol asset URL>
Authorization: Bearer <the user's token>

→ the image bytes, with permissive CORS headers
```

The whole job is: forward the caller's bearer to the asset URL, **follow the
302 it answers**, and stream the bytes back. A browser cannot do this itself
because `fetch` + `Authorization` triggers a preflight, and a preflighted
request may not follow a cross-origin redirect
([API.md](API.md#-video-thumbnails-need-the-worker)).

Two constraints:

- **Only proxy `api.sidechat.lol` URLs.** An open relay that will fetch any URL
  with a forwarded bearer is an SSRF hole and a credential leak. Validate the
  host before making the request, and reject everything else.
- **Never log the URL.** These carry `post_id`, `asset_id` and, after the
  redirect, a signature.

Client-side this is one function: whatever `AuthedImage` currently fetches
directly would instead go through the relay when `EXPO_PUBLIC_WORKER_URL` is
set, which also lights up video posters with no other change.

### `GET /media`

**Required for video playback in Chrome and Firefox** (2026-09-27). A different
wall from the other routes: no bearer and no redirect — the segments are
presigned and fetch fine — but the host sends **no CORS headers**, so a browser
can request them and cannot read the answer
([API.md](API.md#-video-playback-needs-the-worker)).

```
GET /media?u=<encoded R2 segment URL>

→ the segment bytes, Content-Type passed through,
  Access-Control-Allow-Origin: *
```

- **Only relay `*.r2.cloudflarestorage.com`.** Anything else is an open proxy.
  The URL is already presigned, so no credentials pass through the worker.
- **Segments only.** The playlists come from `api.sidechat.lol`, which sends
  CORS headers already; relaying them would just add a hop.
- **Cacheable.** A segment never changes, and its URL carries its signature, so
  caching on the full URL is safe until it expires (~12 hours).
- **Never log the URL** — it carries a signature and the viewer's `user_id`.

The client side is built. `post-video.web.tsx` gives hls.js a fragment loader
that rewrites any R2 URL to `${EXPO_PUBLIC_WORKER_URL}/media?u=…` when the
variable is set, and leaves everything else alone. Tested against a live stream
with a local stand-in doing exactly the above: every segment went through it and
the video played.

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
POST /upload?content_type=png|jpeg|gif  → 200 { asset_id }
GET  /asset?url=<api.sidechat.lol URL>  → 200 the bytes
GET  /media?u=<R2 segment URL>          → 200/206 the bytes
GET  /post/:code                        → 200 { post, comments }
GET  /group/:slug                       → 200 { group }
GET  /                                  → 200 { ok: true, routes }

400 { error: "bad_url" | "bad_code" | "bad_slug" | "bad_content_type" | … }
401 { error: "no_token" }, or Sidechat's own 401/403/429 passed through
403 { error: "origin_not_allowed" }
404 { error: "not_found" }
413 { error: "too_large", max }
502 { error: "upstream", status: <n> }
```

- CORS: only the origins in `ALLOWED_ORIGINS` (a comma-separated Worker
  variable; the defaults are the live site and `http://localhost:8081`). A
  browser request from any other origin gets a 403 before any work is done. A
  request with no `Origin` (curl) is served without CORS headers.
- No secrets, no state, no KV. `/upload` and `/asset` forward the caller's own
  bearer and nothing else.
- The two scrapes and whole `/media` segments are cached with the Cache API,
  best-effort (it does nothing in the dashboard preview).

## Wiring it in

**Done 2026-09-28.** Every client path reads `EXPO_PUBLIC_WORKER_URL` through
`workerEndpoint()` in [src/lib/worker.ts](../src/lib/worker.ts); empty means
each one keeps its no-Worker behaviour:

| Route | Client | Without the Worker |
|---|---|---|
| `/upload` | `uploadAssetWeb` in [client.ts](../src/api/client.ts) posts the bytes there | the *Photo* button is hidden (`imageUploadEnabled`) |
| `/asset` | `AuthedImage` (web) retries through it when the direct fetch throws, which is the redirect case | the image shows its fallback |
| `/media` | `post-video.web.tsx` rewrites R2 segment URLs through it | video is labelled blocked outside Safari |
| `/post/:code` | the third layer of `usePostIdByCode`, after the live cache and the archive. It takes only the id; the post and thread then come from the API by id | the "can't open this share code" state |
| `/group/:slug` | layer 5 of `resolveGroupBySlug` | layer 4 (live search) already resolves slugs |

Checked end to end on 2026-09-28 against a scratch build with the variable set,
the Worker running locally in Node with stubbed upstreams, and the app's own
API answered by the stand-in tab: a share code resolved and opened, and an
image post went out carrying the asset id the Worker returned, the Worker
having sent the token to Sidechat and not to storage.

**For the live site, the URL is a repository variable, not `.env`.**
[deploy.yml](../.github/workflows/deploy.yml) builds on a clean runner that
never sees your `.env`; its build step passes `vars.WORKER_URL` as
`EXPO_PUBLIC_WORKER_URL`. Set it under the repo's *Settings → Secrets and
variables → Actions → Variables* ([SETUP.md](../worker/SETUP.md), step 5). It is
a public URL that ends up in the bundle either way, so it needs no secret.
It has been set since 2026-11-02.

## What was built

Decisions made while writing it, beyond the spec above:

- **One plain-JavaScript file, no dependencies.** The dashboard's editor can't
  install packages, and the owner asked for a dashboard setup. So `devalue`
  isn't imported; its `unflatten` is inlined, about forty lines, handling the
  sentinels (`undefined`, `NaN`, ±`Infinity`, `-0`), shared references and the
  typed forms (`Date`, `Set`, `Map`, `RegExp`, `BigInt`, null-prototype objects).
- **`/asset` follows redirects by hand.** The bearer goes to
  `api.sidechat.lol` only. The redirect target, signed R2 storage, is fetched
  with no `Authorization`, because S3-style storage rejects a request that
  carries both a signature and that header.
- **`/upload` checks before it spends.** Content type and token first, then
  `Content-Length`, then the real body size, and only then a request to
  Sidechat. Sidechat's 401, 403 and 429 pass through as themselves, so the
  client's session handling sees a real 401.
- **`/media` forwards `Range`** for byte-range playlists, and caches only
  whole segments.
- **Workers Logs off.** New Workers log each request by default, which would
  record `/asset` and `/media` URLs. [wrangler.jsonc](../worker/wrangler.jsonc)
  disables it, and SETUP.md step 3 does the same in the dashboard.
- **`/post/:code` is still unverified against a real public-community code.**
  The warning under [`GET /post/:code`](#get-postcode) stands.

**Rebuild with `--clear` after setting it.** `EXPO_PUBLIC_*` variables are
inlined when a file is transformed, and `expo export` reuses its transform cache:
a rebuild after only changing the variable shipped a bundle without it
(measured 2026-09-27). `npx expo export --platform web --clear`.

## Until it's deployed

Only these are missing, and each says so in the app rather than failing
silently:

- Image attachments: the composer has no *Photo* button.
- Video outside Safari: labelled as blocked.
- Images that need the bearer and redirect (some video thumbnails): their
  fallback shows.
- A pasted yikyak.com `/p/<code>` opens only if the post is already cached or
  archived. Links shared from webyak carry the id and always open.

`/g/<slug>` is unaffected: it resolves natively through the search layer,
including for groups outside explore.
