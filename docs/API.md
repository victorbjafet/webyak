# Sidechat API notes

Everything here was verified against the live API or read out of source, with the
date. Nothing is assumed.

Base URL `https://api.sidechat.lol`, wrapped by
[sidechat.js](https://github.com/micahlt/sidechat.js) 2.6.6. Reference client:
[offsides](https://github.com/micahlt/offsides), the author's own Android client.

## Auth is mandatory

**Product decision (2026-08-26): webyak requires sign-in and does not cater to
logged-out users**, matching how the real app behaves. Consequences that ripple
outward:

- Every screen may assume a token exists. There is no anonymous read path.
- `web.yikyak.com/api` (public, unauthenticated, but **no CORS header**) is not
  used, so no proxy is needed. See [ARCHITECTURE.md](ARCHITECTURE.md).
- Prerendering has no value → `web.output: "single"`.
- Both ID-resolution problems below become solvable, because an authenticated
  client can query the endpoints that resolve them.

## Auth flow

Read out of [offsides `src/screens/LoginScreen.jsx`](https://github.com/micahlt/offsides/blob/main/src/screens/LoginScreen.jsx)
on 2026-08-26. It is a four-phase state machine:

```
sendSMS ──► verifySMS ──┬──► (existing user, has group) ──► done
                        ├──► setAge ──► registerEmail ──► verifyEmail ──► done
                        └──► registerEmail ──► verifyEmail ──► done
```

**1. `sendSMS`** — `API.loginViaSMS(phoneNumber)`. US numbers, no `+1`; the
library adds it. A non-null `res.error_code` means failure and `res.message` is
the user-facing string. This error shape is consistent across every call below.

**2. `verifySMS`** — `API.verifySMSCode(phoneNumber, code)`. Three branches:

| Response contains | Meaning | Next |
|---|---|---|
| `logged_in_user` **and** `logged_in_user.group` | Returning user, fully set up | Store token + user id + group, done |
| `logged_in_user` without a group, **or** `registration_id` | Partially registered | `setAge` if `registration_id` is present, else `registerEmail` |
| neither | Unknown failure | Throw |

On success offsides stores `userToken` (`res.logged_in_user.token`) and `userID`
(`res.logged_in_user.user.id`), plus the user's primary group as both
`group*` and `schoolGroup*` (id, name, color, image). It then **hard-restarts the
app** rather than re-deriving state in place.

**3. `setAge`** — `API.setAge(age, registrationID)`. On success `res.token` is a
real token; store it, then immediately call `API.setDeviceID(deviceID)`.

**4. `registerEmail` / `verifyEmail`** — `API.registerEmail(email)` then poll
`API.checkEmailVerification()` until `res.user` appears, at which point `res.token`
and `res.group` are stored the same way as in step 2. This is the school-email
gate; interest groups do not need it.

### The endpoints, exactly

Read out of sidechat.js 2.6.6 source. webyak calls these directly rather than
through the library — see the defect table below for why.

| Step | Method | Endpoint | Body |
|---|---|---|---|
| Send SMS | POST | `/v1/login_register` | `{phone_number: "+1XXXXXXXXXX", version: 3}` |
| Verify SMS | POST | `/v1/verify_phone_number` | `{phone_number, code}` (code upper-cased) |
| Age gate | POST | `/v1/complete_registration` | `{age, registration_id}` |
| Device token | POST | `/v1/register_device_token` | `{build_type: "release", bundle_id: "com.flowerave.sidechat", device_token}` |
| School email | POST | **`/v2/users/register_email`** | `{email}` |
| Poll verification | GET | `/v1/users/check_email_verified` | — |

Two things that are easy to get wrong: the email registration is on **v2** while
everything else is v1, and `check_email_verified` returns the payload under
either `verified_email_updates_response` or
`changing_phone_number_verified_email_user` depending on the path taken.

The `bundle_id` is the real Sidechat app's. We send it because the endpoint
appears to expect a known client; nothing about it is webyak-specific.

### Error shape

Verified live 2026-08-26 by sending deliberately invalid requests (neither sends
an SMS):

| Request | Status | Body |
|---|---|---|
| `verify_phone_number`, bad code | 400 | `{"message":"Code has expired. Please request a new code.","error_code":"EXPIRED_CODE_ERROR"}` |
| `complete_registration`, bad registration id | 400 | `{"message":"Invalid registration"}` |

Two things to handle, and **both** are needed: `error_code` is not always present,
and the status is not always what signals failure. `unwrap()` in
[src/api/client.ts](../src/api/client.ts) throws when `error_code` is present
*or* when the response is non-2xx and carries a `message`, using `message` as the
user-facing string. That is what makes the login form able to say "Code has
expired" instead of "Failed".

### What we copy, and one thing we deliberately don't

Copy: the phase machine, the branch table, the `error_code`/`message` convention,
storing the primary group at login so the home feed has somewhere to point.

**Diverge — device ID.** offsides uses
`sha256(DeviceInfo.getAndroidId())`, a stable hardware-derived identifier. The
browser has no equivalent and we do not want a fingerprint. webyak generates a
random UUID once and persists it (`webyak.deviceId`, see
[src/api/session.tsx](../src/api/session.tsx)). It is stable per browser profile,
which is all the DM endpoints appear to need. **Unverified**: whether the API
cares that this value is not hardware-derived, and whether it must stay stable
across sessions for DMs to work. First test in Phase 6.

**Diverge — restart on login.** A hard restart is not a thing on web. The session
provider updates state in place and lets React re-render.

**Diverge — school email is skippable.** The token is already valid before the
email step; verification only unlocks the school feed. Interest communities work
without it, so webyak offers "Skip for now" rather than dead-ending someone who
has no `.edu` address.

## Two ID-resolution blockers

Both come from the same root cause: **our URLs carry human-readable identifiers,
but the API takes UUIDs.** Neither blocks in-app navigation — a post or group
object reached from a feed already carries both forms. Both bite only on a **cold
load**: someone opens a shared link, or refreshes, with an empty cache.

Probed unauthenticated, then again with a live token on 2026-08-26. Both are now
**answered**.

### Blocker 1 — `index_code` → `post_id` — ❌ no native endpoint

`/p/0ESz5N3t` carries the post's `index_code` (the short share code). Every
post-fetch path in sidechat.js takes the UUID `post_id`.

**Authenticated probe result:**

| Attempt | Status | Body |
|---|---|---|
| `/v1/posts/get?index_code=0ESz5N3t` | 500 | `{"message":"The provided key element does not match the schema","error_code":"ValidationException"}` |
| `/v1/posts/get?post_id=0ESz5N3t` | 404 | `{}` |

That 500 is a **DynamoDB** `GetItem` error, and it is the informative one: passing
`index_code` produced a *malformed key*, meaning the endpoint read `post_id`
(absent) and ignored `index_code` entirely. The 404 then shows the route happily
accepts an arbitrary string as `post_id` and simply finds nothing. So posts are
keyed by UUID in DynamoDB and `/v1/posts/get` queries only that key —
`index_code` is at best a secondary index this endpoint never touches.

Unauthenticated path sweep found no alternative: `/v2/posts/get`, `/v2/posts`,
`/v1/posts/by_code/…`, `/v1/posts/lookup`, `/v1/posts/resolve`,
`/v1/index_codes/…`, `/v1/links/…`, `/v1/deeplink` all 404. `share_code=` and
`code=` on the known route are just the same route, so they say nothing.

**Conclusion: the authenticated API cannot resolve a share code. Confirmed, not
suspected.** offsides is no help — it has no `https` intent filter and never
opens a shared link ([OFFSIDES.md](OFFSIDES.md#what-offsides-does-not-solve)).

#### But the public web client can, and it needs almost nothing

```
https://web.yikyak.com/cy/<group>/comments/<CODE>/<title>/__data.json?x-sveltekit-invalidated=01
```

Verified: **the code alone resolves the post.** Byte-identical 200s with the
wrong group slug, a wrong title slug, and a group that doesn't exist. Only the
leading segment matters, and it must be the literal `cy` — `us`, `uk`, `ca`,
`all`, `c`, `g`, `x` all 404. So `cy` is a hardcoded constant in their routing,
not a region (**this closes Q1**).

The response carries the post *and* its comments, unauthenticated. Two costs:
- **no CORS header**, so a browser can't call it directly
- the payload is **devalue-flattened** (numeric-pointer array), needing
  `devalue.parse()` to rehydrate

Both are solved by a single small Cloudflare Worker route that fetches,
unflattens, and re-serves as clean JSON with CORS — which is exactly the
"small worker for CORS and any other issues" already sanctioned in
[ARCHITECTURE.md](ARCHITECTURE.md#where-serverless-stops-working). It would also
make real Yik Yak share links openable in webyak.

**Status: awaiting a decision on standing up that worker.** Until then `/p/<code>`
works from in-app navigation (the UUID is in cache) and fails on cold load.

**Bites at: Phase 3, `src/app/p/[code].tsx`.**

### Blocker 2 — group slug → `group_id` — ✅ CLOSED

`/g/wordle` carries a slug; `getGroupPosts` needs
`602fb305-4ec2-4d01-83be-4d80c6636a56`. **Resolved end to end on 2026-08-27.**

**Q6 answered: the URL slug is the group's `index_name`.** Confirmed three ways —
the explore convention (`Tinder Tales` → `tinder-tales`), fetching the Wordle
group directly (`index_name: "wordle"`), and the resolver returning the right
UUID.

`index_name` is not derivable from the display name (`Who Would Win?` →
`who-would-win-meun`, `Yakle !` → `yakle`). Fine — we only go slug → group.

#### What each layer covers

| Layer | Source | Coverage |
|---|---|---|
| 1 | persisted map | slugs resolved before on this install |
| 2 | `getUpdates().groups` | the user's own groups — 3 on the test account |
| 3 | `getAvailableGroups()` | 4237 groups, **curated — misses Wordle** |
| 4 | `/v1/groups/explore/search?term=` | **the hole-filler. Found Wordle.** |
| 5 | the Worker | inert; no longer needed for groups, see below |
| — | `GET /v1/groups/<slug>` | ❌ `NOT_FOUND_ERROR`, UUID only. Confirmed dead, no shortcut |

Layer 4 is what closes it, and it only worked after the library defect below was
bypassed.

#### The defect that hid layer 4 for two rounds

sidechat.js's `searchAvailableGroups` ends with `return json.results`. **The
endpoint responds with `{groups: [...]}`** — confirmed, top-level key is `groups`
and nothing else. So the wrapper returned `undefined` on every call, and our
first probe called `.some()` on it and threw, which reported a *library bug* as a
*missing capability*. Two rounds of "no layer works" were one wrong key.

Lesson worth keeping: when a wrapper returns nothing, dump the envelope before
concluding the endpoint is unusable.

`coerceGroupList` in `src/api/groups.ts` now reads `groups` first and falls back
through other plausible keys.

#### Slugs are not ASCII

Live search returned `index_name: "wsu-wordle-🧩"` next to ordinary ones like
`nyt-word-games`. So slugs can carry emoji and arbitrary Unicode.

Rules, implemented in `src/api/groups.ts`:
- build hrefs with `groupHref()`, which percent-encodes — never interpolate a raw
  slug into a path
- `useLocalSearchParams` hands back the **decoded** value
- compare and key the map with `slugKey()` (decode + lowercase) so an encoded and
  a decoded form never miss each other

#### `memberships` and `getUpdates` disagree

`/v1/users/me` reports **4** memberships; `getUpdates` returned **3** groups. One
id is in the former and not the latter:
`3e27b02b-39bb-41f9-a0c0-b23644beed6e`.

Unexplained. Not blocking — layer 4 covers anything the user's own list misses —
but it means **`getUpdates().groups` is not a complete membership list**, so
don't treat it as one when Phase 5 builds "your groups". Use `memberships[]` for
the authoritative set and resolve each id if a complete list is ever needed.

**Bites at: nothing in Phase 3.** `/g/<slug>` now resolves for any group,
including cold loads.

### Feed hygiene — needed, though a clean sample

Two live pages (48 entries) came back with **0 id-less and 0 duplicate** entries,
so the junk offsides guards against did not appear on this account and group.

The filters stay. offsides added them against a much larger sample than ours, ad
slots plausibly vary by account and group, and the cost of keeping them is a
`Set` per page. Absence of evidence over 48 posts is not evidence of absence —
but it does mean **we should not assume the shape of what we have not seen**.
`src/api/feed.ts` therefore drops anything without an `id` rather than trying to
recognise an ad.

## Top time ranges

The `top` feed accepts a **`period`** query param. Found by differential probing:
send a candidate, compare the returned post ids against the control.

| Value | Effect |
|---|---|
| *(omitted)* | same as `day` |
| `day` | last ~24h |
| `week` | verified: reaches back 11 days, top vote 439 vs 46 for `day` |
| `all_time` | verified: reaches back 1080 days, top vote 15333 |

**Only those three are recognized.** `month`, `year`, `all`, `alltime`,
`forever`, `today`, `hour`, `7d`, `30d`, `weekly`, `monthly` and a deliberate
`bogus` all returned results byte-identical to the default — the server silently
falls back rather than erroring, which is exactly why this needed differential
testing rather than status codes.

`period` is meaningless for `hot` and `recent`, so we only send it for `top`.

sidechat.js's `getGroupPosts` has no parameter for this, so `getGroupPosts` in
`src/api/client.ts` builds the request itself.

## Asset URLs and auth — corrected

> **This supersedes the earlier Q2 answer**, which said post assets are always
> pre-signed and therefore need no proxy or blob shim. That was true of the
> sample it was drawn from (images, via the public web API) and **wrong as a
> general rule**. The API is not consistent.

Verified 2026-08-27 by requesting each form unauthenticated:

| URL form | Auth | Used by |
|---|---|---|
| `sidechat-assets-*.r2.cloudflarestorage.com/…X-Amz-Signature=…` | none | post images |
| `icon.yik-yak.com/…` | none (200) | group icons |
| `api.sidechat.lol/v1/assets/video.m3u8?…&expires=…` | none — signed via query | video streams |
| `api.sidechat.lol/v1/assets?post_id=…&asset_id=…` | **401** | video thumbnails |
| `api.sidechat.lol/v1/assets/library/…` | **401** | asset library, `uploadAsset` output |
| `api.sidechat.lol/v1/assets/profile?…` | **none — 302** to a signed R2 URL | profile photos. Do **not** send the bearer; see below |

The rule that actually holds: **a URL on `api.sidechat.lol` without `expires=`
or a signature needs the bearer token.** Encoded in `src/lib/asset-url.ts`.

Neither `<img src>` nor `<video poster>` can send a header, which is why video
posters rendered blank. `AuthedImage` fetches those with the token and hands the
element a blob URL instead; native passes headers to the image loader directly,
which is what offsides does.

> ⛔ **This did not actually fix video thumbnails.** Verified still broken
> 2026-08-27. The auth theory above is sound and the blob path is implemented,
> but the poster is still blank in practice. **This is the only one of the three
> unrendered image classes that is genuinely a pipeline problem** — see
> [Images that don't render](#-images-that-dont-render--under-investigation-phase-5).

## Video

Confirmed against a live asset, not just offsides:

```jsonc
{
  "id": "2298546f-…",
  "type": "video",
  "content_type": "mov",              // not a MIME type — a container name
  "width": 636, "height": 1280,
  "url": "https://api.sidechat.lol/v1/assets/video.m3u8?asset_id=…&expires=…&post_id=…",
  "thumbnail_asset": {
    "id": "368c131a-…", "type": "image", "width": 636, "height": 1280,
    "url": "https://api.sidechat.lol/v1/assets?post_id=…&post_context=feed&asset_id=…"
  }
}
```

Two things to note: `content_type` is `"mov"`, a container name rather than a
MIME type, so don't feed it to anything expecting `video/…`. And the stream URL
is query-signed while **the thumbnail is not** — the poster needs the bearer.
The stream plays; the thumbnail does not (see above).

**The stream is HLS**, which is why video "didn't work at all" on web: Safari
plays `.m3u8` natively, Chrome and Firefox do not. Our `<Image>` was also being
handed a video URL, which rendered a blank frame.

`post-video.web.tsx` checks `canPlayType('application/vnd.apple.mpegurl')` first
and only falls back to a lazily-imported `hls.js` when the browser can't cope —
so Safari never downloads the shim, and it code-splits out of the main bundle.
Native uses `expo-video`, where the platform handles HLS.

## Attachments are link previews

`attachments` is not another asset array. Confirmed from live payloads:

```jsonc
{ "id": "…", "type": "link", "created_at": "…",
  "link_url": "https://…", "display_url": "www…", "title": "…" }
```

offsides also references a `youtube` type in a commented-out branch, so `type` is
an open set. We render `link` and ignore the rest rather than guessing.

## A user profile is a group

`getUserProfile` hits **`/v1/groups/username?username=<name>`** and returns
`json.group`. That is not a quirk of the wrapper — the API genuinely models a
user's public profile as a group object, which is why the profile typedef carries
`group_join_type: "account"` and `group_visibility`.

Consequence: anything that renders a group renders a profile. Worth reusing
rather than building a parallel component.

### ⛔ Images that don't render — under investigation (Phase 5)

**Re-framed 2026-08-27.** The previous entry here called this "one bug, not
three" on the grounds that a public URL and an authenticated one failed
identically. Reading the components rather than the API showed that was wrong.
There are **three separate causes**, and two of them were never in the image
pipeline at all:

| What | Real cause | Status |
|---|---|---|
| Community icons | **No `icon_url` in the data.** The endpoints the app reads groups from omit the field | ✅ **Fixed** — see below |
| Profile photos | **No render path existed**, and the field was unknown | ✅ **Both found** — see below |
| Video thumbnails | **Almost certainly the same redirect bug as profile photos** — see below | ⛔ Open, deferred by decision |

#### Community icons: the field is missing, not the image

Probed 2026-08-27. The same group is reachable four ways and **they do not
return the same fields**:

| Endpoint | `icon_url` |
|---|---|
| `getUpdates().groups` — *what the app rendered* | key absent for some groups |
| `GET /v1/groups/<id>` | key absent for the same ones |
| `/v1/groups/explore/search?term=` | ✅ present |
| explore list | ✅ present on all 4237 groups |

Virginia Tech and Home come back with **no `icon_url` key at all**, while Class
of 2029 comes back *with* one (`https://icon.yik-yak.com/class-of-2029.png`).
That inconsistency is what made this look like a flaky renderer.

Fixed in [src/api/group-icons.ts](../src/api/group-icons.ts): when a group has
no `icon_url`, look it up via search and **match on `id`**. Matching on id is
not optional — a term like "Home" returns many groups that are not the one
asked for. Cached for a day; icons do not move.

Note that `icon.yik-yak.com` really is public, as originally recorded. That fact
was true and misleading at the same time: it made the host look innocent and
sent three rounds of investigation after a rendering bug, when nobody had
checked whether the app had a URL to render at all.

#### Profile photos: `icon_url`, and the bearer was breaking it

```
icon_url = https://api.sidechat.lol/v1/assets/profile?user_id=<uuid>&asset_id=<uuid>
```

It looks like it needs the bearer — API host, no `expires=`, no signature — and
that inference is what broke it. Requested **unauthenticated**, it answers:

```
HTTP/2 302
location: https://sidechat-icon-assets-prod.<hash>.r2.cloudflarestorage.com/<asset_id>
          ?X-Amz-Signature=…&X-Amz-Expires=3600
```

**No auth required.** It hands out a pre-signed R2 URL.

Sending the bearer to it is actively harmful in a browser, and the failure is a
three-step chain worth remembering:

1. An `Authorization` header makes the request **non-simple**, so the browser
   sends a CORS preflight. That part succeeds — the host returns
   `access-control-allow-headers: *`.
2. The real `GET` then answers **302**.
3. **A preflighted request cannot follow a cross-origin redirect.** The browser
   aborts with `TypeError: Failed to fetch`.

Which is exactly what the image-failure log recorded:
`profile-photo · network · api.sidechat.lol · Failed to fetch`. The CORS headers
on the API host made this look impossible, because the block is not on the API
host at all — it is on the redirect.

Fixed by *removing* auth: `assetNeedsAuth()` returns false for
`/v1/assets/profile`, so the URL goes straight into the element, which follows
the redirect itself and never applies CORS to it. offsides passes group icons as
a plain URI for the same underlying reason.

**The general lesson:** on the web, a URL that redirects is best given to the
element rather than to `fetch`. `fetch` + `Authorization` is the combination
that cannot follow a redirect; `<img src>` has no such restriction. Check
whether an asset endpoint *actually* rejects an unauthenticated request before
assuming it needs a token — this one never did.

`@snoopyvt` carries **both** an `icon_url` and a `conversation_icon` emoji (🚬),
which is why "does this account have a photo" was ambiguous for so long: the
emoji is a real, populated field even on accounts that also have a photo. The
emoji is the *fallback*, not the answer.

⛔ **Still open:** post cards show emoji, not photos. The `identity` object on a
post carries no photo URL — only `conversation_icon` — so rendering avatars in a
feed would mean a profile lookup per distinct author. `IdentityAvatar` accepts a
`photoUrl` for when that is worth doing; the profile screen already has the URL
and renders it.

#### ⛔ Video thumbnails need the worker

**Settled 2026-08-27. Not fixable from a browser.** Both routes are closed:

| Attempt | Result |
|---|---|
| No `Authorization` header | `/v1/assets?post_id=…&asset_id=…` → **401**. Verified directly, with and without `post_context`. Unlike `/v1/assets/profile`, this one really does want the token |
| With the header | Forces a CORS preflight; the endpoint then answers **302** to signed storage, and a preflighted request **cannot follow a cross-origin redirect** |

The failure log is what proves the second row: it records
`video-poster · network · Failed to fetch` — a **network** failure, not
`http · 401`. If the token were being rejected we would see a 401 response. We
see no response at all, which means the request succeeded far enough to be
redirected somewhere the browser refused to follow.

This is the same wall as image upload, and it wants the same fix: an
authenticated **asset relay** in the worker, which forwards the bearer and
follows the redirect server-side where CORS does not apply
([WORKER.md](WORKER.md#get-asset)).

Until then the poster renders a neutral panel with a video glyph rather than
nothing, so a video reads as a video. The `AuthedImage` call is left in place —
it costs nothing and starts working the moment the relay exists.

> This is the third time the same underlying rule has bitten: **on the web,
> `fetch` + `Authorization` cannot follow a redirect.** Profile photos escaped it
> because that endpoint needs no auth; upload and video posters cannot, because
> theirs do.

#### ⛔ Videos are not preloading

**Not fixed. Deferred by decision 2026-08-27.**

`FeedList` computes a `preloadRange` two rows either side of the viewport and
passes `preload` to each card, which reaches `post-video.web.tsx`. Reported not
to work in practice. Unverified guesses, in the order worth checking:

- `preload` may reach the element only after the source is already attached, so
  it never changes the `<video preload>` attribute that mattered.
- HLS is not a single file — with `hls.js`, buffering is controlled by the
  library's own config, not by the element's `preload` attribute, so setting the
  attribute may be inert for exactly the sources we serve.

Both are cheap to check with the network panel: scroll a feed and watch whether
segment requests start before the video is on screen.

### Quote-reposts

Creating one sends `quote_post_id`. **What comes back is undocumented** — the
sidechat.js typedefs don't mention quotes at all, which is why reposts rendered
as a bare caption with the original missing: the client was reading neither
possible shape.

**The shape came from offsides**: the original lives at **`post.quote_post.post`**
— `quote_post` is a *wrapper*, not the post. Reading `quote_post` directly finds
nothing, which is why a repost rendered as its own caption with the original
missing.

[`QuotedPostInline`](../src/components/post/quoted-post-inline.tsx) reads that,
and keeps a `quote_post_id` fetch as a fallback for responses that carry only the
id. The *Phase 5 — quote-repost shape* write probe confirms which the API
actually sends, so the fallback can be dropped once known.

### Deleted posts render as bare text

Low priority, recorded so it isn't rediscovered: a deleted post still comes back
in feeds and comment threads, with its text replaced by the literal string
`"Deleted Post"`. We render that as if it were ordinary body text, so it reads
like someone typed it.

It should be styled as what it is — muted, italic, no vote or reply controls,
probably an icon. The API gives no explicit `deleted` flag that has been found,
so detection currently means matching that string, which is fragile and worth
probing before building on. Not scheduled.

The lesson worth keeping: `icon.yik-yak.com` was verified public and returning
200, which made the *host* look innocent and sent three rounds of investigation
after a rendering bug. Nobody checked whether the app had a URL to render in the
first place. **Confirm the data exists before debugging the thing that displays
it.**

#### Failures are no longer silent

`AuthedImage` used to `return null` on any problem, so a 404, a blocked request,
a decode failure and a missing URL were indistinguishable — and because the
caller had already branched into the image path, its own placeholder was
unreachable. Every failure now renders the caller's `fallback` and is recorded
with a reason (`no-url` / `http` / `network` / `decode`), readable from
`/diagnostics` → *Images — what actually failed*. Only the host is recorded,
never the full URL, since a pre-signed asset URL is a credential.

Every call site passes a `context` (`group-icon`, `profile-photo`,
`video-poster`, `post-image`) so a failure names the place it happened.

#### What is known about profiles

- Some accounts have **no photo at all**. `rat.brat` returns only
  `conversation_icon: {emoji: "🐀", color: "#9BD46A", …}` — for that account the
  emoji *is* the avatar, and it renders correctly. An absent photo is not
  evidence of a bug.
- **`@snoopyvt` is the reference case** — that account definitely has one.
  `/u/snoopyvt`. Verify any fix against it.
- Which field carries it is still unidentified; the probe dumps every
  URL-valued field rather than guessing a name.

Paths that do **not** exist, swept: `/v1/users/<name>`, `/v1/users/profile`,
`/v1/users/aliases/<name>`, `/v1/aliases/<name>`, `/v1/users/<name>/profile`,
`/v1/profiles/<name>`, `/v1/users/by_username`. `getUserPosts` is separate and
uses `/v1/users/posts?username=<name>`.

## Endpoints that exist but sidechat.js doesn't wrap

Found by the 404-vs-401 sweep. These were previously recorded as "no endpoint
exists", which was wrong — the library simply has no method for them:

| Endpoint | Status | Note |
|---|---|---|
| `/v1/posts/saved` | ✅ 200 | `{posts, cursor}` — **the same shape as a feed**, so it can reuse the feed query and card directly |
| `/v1/activity` | ✅ 200 | `{items, cursor}`, items are `{id, timestamp, type, is_seen, text}` where `id` is `"votes~<uuid>~25"` and `text` is a ready-made human string like *"Your post reached 25 karma: …"*. Pairs with the existing `readActivity` |

The activity `type` seen so far is `votes`; treat it as an open set. Because
`text` is pre-rendered server-side, the notifications screen can ship without
knowing every type.

Still not found:

- **How to follow.** Swept `posts/follow`, `posts/set_follow`,
  `posts/set_follow_status`, `users/follow`, `users/set_follow`, `/v1/follow` —
  all 404.
- **How to save.** The *list* works, but the write path does not exist on any of
  `posts/set_saved`, `posts/save`, `posts/save_post`, `posts/bookmark`,
  `posts/set_bookmark`, `posts/saved/add`, `users/saved`,
  `posts/set_save_status` — all 404.
- **Awards.** Posts carry `awards[]`; no endpoint found and none looked for in
  depth. Lowest priority on the list, deliberately not built.

All three are readable-but-not-writable. The UI shows these controls dimmed with
a tooltip explaining why, rather than hiding them — a bookmark that appears only
on already-saved posts reads as a bug.

## sidechat.js 2.6.6 defects

Read from source. Workarounds live in
[src/api/client.ts](../src/api/client.ts); all of them use `client.sendRequest()`,
which the library added in 2.4.9 for exactly this.

| Method | Defect | Status |
|---|---|---|
| `getUserContent()` | Builds `/v1/posts&type=…` — missing `?`. Always fails. | Worked around |
| `getGroupChats()` | Builds `/v1/chats/explore&cacheBust=…` — missing `?`. | Worked around |
| `viewPollResults()` | Builds `/v1/polls/view_results&cacheBust=…` — missing `?`. **Third instance of the same typo.** | Worked around (Phase 4) |
| `uploadAsset()` | Uses React Native's `FormData` `{uri, type, name}` object shape, then `PUT`s the raw object. On web this uploads the string `[object Object]`. | Worked around (`uploadAssetWeb` takes a real `Blob`) |
| `registerEmail()` | `throw`s the API's message from *inside* its own `try`, so its own `catch` replaces it with the constant `"Failed to request email verification."` | Bypassed — we call `/v2/users/register_email` directly |
| `checkEmailVerification()` | Same self-swallowing pattern: every failure, including a 401, surfaces as `"Email is not verified."` | Bypassed |
| `setAge()` | Throws a hardcoded `"You're too young to use Offsides."` — a different app's name, shown to our users | Bypassed |
| `searchAvailableGroups()` | Returns `json.results` unconditionally; the endpoint does not use that key, so it silently returns `undefined` rather than a list | Bypassed — `coerceGroupList` in `src/api/groups.ts` reads any envelope |
| — | No methods at all for save, follow, activity list, report, or awards, though posts carry `is_saved`, `follow_status` and `awards[]`. | Phase 8 |

Worth upstreaming the URL and upload bugs as a PR. The three swallowing bugs
share one root cause — `throw` inside `try` with a catch-all `catch` — and are
the reason a login form built on the library can only ever say "Failed".

Also note: the library swallows HTTP status codes — every method just calls
`.json()`, so a 401 surfaces as a malformed object rather than an error. Our
`request()` helper checks `res.ok` and throws `ApiError` with the status, which is
what makes expired-token detection possible.

### Why every write bypasses the library (Phase 4)

That last point is an annoyance for reads and disqualifying for writes. Every
write method in 2.6.6 ends the same way:

```js
const res = await fetch(…);
const json = await res.json();
return json;              // a 400 and a 200 are indistinguishable here
```

A rejected vote therefore *resolves*. With optimistic UI that is not a cosmetic
problem: the rollback is triggered by a rejected promise, so a vote the server
refused would stay on screen looking accepted until something else refetched it,
and the user would have no idea. Every write in
[src/api/client.ts](../src/api/client.ts) — `setVote`, `createPost`,
`createComment`, `deletePostOrComment`, `voteOnPoll` — goes through `request()`
for this reason, not for tidiness.

## Write endpoints

**Verified live 2026-08-27** by round trip from `/diagnostics` → *Run write
probes*: create → vote → comment → vote on comment → delete, then a separate
poll round trip. Both PASS. Voting and commenting were also confirmed to sync
**both ways with the official Yik Yak app**, which is the real proof that the
request shapes are right rather than merely accepted.

| Action | Endpoint | Body |
|---|---|---|
| Vote | `POST /v1/posts/set_vote` | `{post_id, vote_status}` — takes a **comment** id equally |
| Create post | `POST /v1/posts` | `{type: "post", group_ids: [id], text, assets, attachments, dms_disabled, comments_disabled, using_identity, quote_post_id?, poll_request?}` |
| Create comment | `POST /v1/posts` | same endpoint, `{type: "comment", …, reply_post_id, reply_comment_post_id, parent_post_id}` |
| Delete | `POST /v1/posts/delete` | `{post_id}` — posts and comments both |
| Vote on poll | `POST /v1/polls/vote` | `{poll_id, choice}` — `choice` is the **index** |
| Mark results viewed | `POST /v1/polls/view_results` | `{poll_id}` — note the corrected path |

Three things worth knowing before touching this code:

- **`using_identity` is the inverse of the anonymous toggle.** The API models it
  as "post as yourself", the UI asks "post anonymously". Inverting it by accident
  deanonymises the user, which is the worst available bug in a Yik Yak client, so
  the flip happens in exactly one place — `createPost`/`createComment` in
  `client.ts` — and the UI never sends `using_identity` itself.
- **Posts and comments are the same endpoint**, distinguished only by `type`.
  The response envelope differs: a post comes back as `{posts: [...]}` and a
  comment as `{comment: {...}}`.
- **A poll is not a field, it is a request.** Creating one means sending
  `poll_request: {allows_view_results, choices}`, and the created post comes back
  with a populated `poll` object — confirmed, with `choices` echoed back as
  `{count: 0, text, selected: false}` and a `poll.id` distinct from the post id.
  `/v1/polls/view_results` returns `{}` on success at the corrected path, which
  is why the library's broken `&` version failed silently rather than loudly.

One thing settled that had been an open assumption: **`createPost` returns an
`index_code`** on the new post (observed: `eVYkniqy`). New posts are therefore
shareable immediately, with no refetch needed to get a URL.

### ⛔ Image upload is blocked by CORS

**Found 2026-08-27, unresolved.** Attaching an image fails with `Failed to
fetch`, with or without caption text.

The two-step upload works like this, and only the first step succeeds:

1. `GET /v1/assets/upload_url?content_type=<png|jpeg|gif>` → **201**, returns
   `{upload_url, asset_id}`. Fine — this is on `api.sidechat.lol`, which sends
   `access-control-allow-origin: *`.
2. `PUT <upload_url>` with the bytes → **the request never leaves the browser.**

That second URL is a pre-signed URL on the asset storage host, not on the API
host. A thrown `fetch` (rather than an HTTP error) means the browser refused to
send it, and the reason is structural:

- **`PUT` is not a CORS-simple method.** Only `GET`, `HEAD` and `POST` are, so a
  `PUT` always triggers a preflight `OPTIONS` — no combination of headers avoids
  it. `Content-Type: image/*` would force one on its own anyway; only
  `application/x-www-form-urlencoded`, `multipart/form-data` and `text/plain`
  are safelisted.
- **The storage bucket must therefore answer an `OPTIONS` from our origin**, and
  there is no reason for it to. Yik Yak's clients are native apps, where CORS
  does not exist. `mode: 'no-cors'` is not an escape either — it permits only
  simple methods, so it cannot send a `PUT` at all.

**This is why sidechat.js's `uploadAsset` was never written for the web**, and
why offsides never hit it: on Android the request is native and unrestricted.
Our `uploadAssetWeb` fixed the *body* (the library PUTs `[object Object]`), which
was a real bug, but the body was never the thing standing in the way.

Run `/diagnostics` → *Run write probes* → **Phase 4 — image upload CORS** for the
actual host, the exact failure, and a sweep for an upload route on the API host
that would avoid the problem. The probe reports signature parameters **by name
only** — a pre-signed URL is a credential.

**This is the first thing that genuinely requires the Worker** rather than merely
benefiting from it. Share-code resolution (Blocker 1) is a missing convenience;
this is a feature that cannot work from a static origin at all. See
[docs/WORKER.md](WORKER.md).

### Untested: a poll and an image on the same post

The API has never been asked for both at once. The composer makes them mutually
exclusive, matching the official app — this is a deliberate guess, not a known
limit, and the note is here so nobody later reads the UI as evidence the API
refuses it.

## Data shape corrections

The library's own typedefs are missing fields that live payloads actually return.
Corrected in [src/api/types.ts](../src/api/types.ts) and marked `(observed)`:

- `PostOrComment.index_code` — the share code; the whole basis of `/p/<code>`
- `PostOrComment.awards[]` — always present, contents undocumented
- `Identity.conversation_icon` — `{emoji, color, secondary_color}`, present when
  the author posts under a username
- `Identity.is_following`
- `Asset.signed_url` — pre-signed R2 URL, loads in a plain `<img>`

Feed responses are `{posts: [...], cursor: "persisted~<uuid>"}`, 24 posts per
page. Cursor pagination confirmed working with zero overlap between pages.


## "Home" is not a community — it is the For You feed

The API calls it `Home` with `index_name: "all"`. It is the combined feed of
everything you belong to, and it is **not a group you can treat like the others**:

| | Behaviour |
|---|---|
| Icon | none anywhere in the API — renders a glyph, never initials |
| `top` sort | **not supported.** offsides refuses it outright with "This feature isn't supported in your Home group" |
| Posting | **you cannot post to it.** offsides substitutes the school group's id when composing from Home, and so do we — posting to the Home id would either fail or land somewhere unexpected |

Displayed as **For You**, matching the official app. `isForYouFeed()` and
`groupDisplayName()` in [src/api/groups.ts](../src/api/groups.ts) are the single
place that decides; both the name and `index_name` are checked, because neither
is documented and either could change.

### Every post is labelled with its community

Yik Yak shows the community name on every post — including inside that
community's own feed, where it is strictly redundant. Copied deliberately: it is
the parity behaviour, and it is what makes the For You feed legible when
consecutive posts come from different places.

### Unread is ours, not theirs

**Settled 2026-08-28.** `type=unread` returns:

```
400  Invalid post type: unread
```

There is no server-side unread filter. The official app must be tracking read
state on the device, so we do the same: `src/lib/seen-posts.ts` records ids as
rows reach the viewport, persists them, and the Unread tab filters `hot` by what
is unseen.

Consequences worth knowing:

- **Read state is per-device.** There is nothing to sync with, so a second
  browser starts fresh. The empty state says so rather than implying data loss.
- **Filtering client-side can empty a page.** 24 posts you have already read
  collapse to nothing, so `useGroupFeed` pulls further pages automatically while
  the unread result is too short to fill a screen, bounded by `hasNextPage`.
- Marking happens on **viewability**, not on render or on tap. Rendering would
  mark the whole prefetched window including posts never actually shown;
  tapping would mark almost nothing.

#### ⚠️ `type` is validated; `period` is not

This is worth remembering before designing the next probe. The same endpoint
treats its two parameters differently:

| Parameter | Unrecognised value |
|---|---|
| `type` | **400 with a message.** Cheap to probe — just ask |
| `period` | **Silently ignored**, falls back to `day`. Needs a differential probe comparing returned ids against a control |

The `unread` probe was built the expensive differential way on the assumption
that `type` behaved like `period`. It did not, and the 400 answered it outright.
Check for the cheap signal first.

## Yakarma

`getUpdates().karma`, confirmed from offsides:

```jsonc
{
  "post": 0,          // total karma from posts
  "comment": 0,       // total karma from comments
  "groups": [ … ]     // per-community breakdown
}
```

One request covers both the total and the per-community split, so the You tab
does not need a call per community.

⚠️ **The per-community entries carry no name.** Observed live: every row rendered
as the fallback label until the id was joined against the user's own group list.
Which key holds that id is also unconfirmed, so `KarmaGroup` accepts both
`group_id` and `id`, and `karma-panel.tsx` resolves the display name and colour
from `useCurrentGroup().groups` rather than trusting the payload.

Rendered in [karma-panel.tsx](../src/components/me/karma-panel.tsx): a total row
plus one row per community, each expanding to the post/comment split. Collapsed
by default because the split is the interesting part and a wall of numbers is
not.

## Posts you upvoted

**Found 2026-08-28.** `GET /v1/posts/upvoted` → **200**, `{posts, cursor}`.

It resisted earlier sweeps because it is a **path, not a `type` value**:

```
/v1/posts?type=my_upvotes  → 400
/v1/posts?type=upvoted     → 400
/v1/posts?type=my_votes    → 400
/v1/posts/upvoted          → 200 ✅
/v1/posts/voted            → 404
/v1/users/upvotes          → 404
```

Because `my_posts` and `my_comments` *are* `type` values, the assumption was that
everything user-scoped worked that way. Saved posts were the same shape
(`/v1/posts/saved`) and should have been the hint. sidechat.js wraps neither.

## ⛔ Explore cannot sort by newest

An explore entry carries: `id, name, index_name, analytics_name,
membership_type, color, group_join_type, group_visibility, description,
icon_url, asset_library_visibility, member_count, disable_ads, can_join`.

**None of those is a timestamp**, so "newest" cannot be computed client-side and
the endpoint offers no sort parameter. The control is shown disabled with a
tooltip rather than omitted — a missing option looks like an oversight, a
disabled one with a reason does not.

Sorting by **member count** is the default, matching the official app: with
4,237 communities, any other order buries everything anyone uses.

## Saved posts are readable, not writable

`GET /v1/posts/saved` → `{posts, cursor}`, the same envelope as a feed, so the
results drop straight into the feed components. Wired into the You tab.

The asymmetry stands: there is still **no write path** — thirteen candidate
endpoints swept, all 404 — so posts can be listed here but only saved from the
official app. The empty state says so rather than implying the list is broken.


## What else is in `getUpdates()`

The full top-level key list, captured 2026-08-28. Recorded because this one
response carries most of the app's state, and several of these answer questions
filed elsewhere as blocked:

```
user, hasWrapped, hasGames, hasGamesBadge, device_tokens, token, user_properties,
new_posts, hot_posts, user_posts, user_comments, user_chatboard_posts,
recent_chatboard_posts, top_posts, activity_items, chats, group, groups,
group_referrals, karma, quarterly_karma, season_karma, season,
skip_sign_in_verification, skip_sign_in_verification_v2, waitlist_launch_form,
unacknowledged_removed_post_ids, incoming_freshmen_enabled,
create_group_application_enabled, community_picker_required_groups_count, flags,
experiments, ads_settings, dynamic_feed_announcement, dynamic_chat_announcement,
dynamic_explore_announcement, home_f_a_b_config, app_icons,
home_announcement_config
```

Three things stand out:

- **`unacknowledged_removed_post_ids`** — this is the moderation signal that
  [B3](../PLAN.md) was blocked on. "Show a warning when your post is taken down"
  was filed as *needs a probe, and realistically needs a post to actually get
  removed*. It does not: the ids arrive here, and "unacknowledged" implies a
  matching acknowledge call to find. **B3 is unblocked.**
- **`quarterly_karma`, `season_karma`, `season`** — karma has more dimensions
  than the lifetime total the You tab shows. Relevant to [B5](../PLAN.md)
  (karma over time), which assumed only a current value existed; there may be
  period-scoped values to read instead of sampling.
- **`new_posts`, `hot_posts`, `top_posts`, `user_posts`, `user_comments`** — the
  updates call appears to carry pre-fetched feeds. If those are usable, a cold
  start could render without a second request. Unverified; the shapes have not
  been inspected.

Not chased now — recorded so the next session starts from the answer instead of
the question.

## Messaging (Phase 6)

| Action | Endpoint | Envelope |
|---|---|---|
| List DM threads | `GET /v1/chats` | `{chats: [{chat, cursor}], cursor}` |
| One thread | `GET /v1/chats/messages?chat_id=` | `{chat}` |
| Send | `POST /v1/chats/send` | `{chat_id, text, client_id, anonymous, assets}` |
| Start | `POST /v1/chats/start` | `{text, client_id, post_id, anonymous, post_context}` |
| Explore group chats | `GET /v1/chats/explore` | `{chats}` — library builds this with `&` |
| Join a group chat | `POST /v1/chats/groups/join` | `{chat_id, identity{display_name, emoji, color, secondary_color}}` |

### ⚠️ Everything in the chat API is wrapped

Confirmed 2026-08-28. The list endpoints do **not** return arrays of threads:

```jsonc
// GET /v1/chats
{ "chats": [ { "chat": { … }, "cursor": "…" } ], "cursor": "…" }
```

Each entry is an envelope holding the thread under `chat`, with its own
per-thread cursor. `/v1/chats/explore` is the same, and `getUpdates().chats` is
**doubly** nested — `updates.chats.chats[].chat`.

Reading `chats[]` directly yields objects whose every field is `undefined`,
which is what the first implementation did: `accept_status` came back
`undefined` for all 19 threads, and the UI silently classified every one of them
as a request. Nothing errored.

This is the **third** place this API nests a payload one level deeper than the
obvious reading — after `quote_post.post` and `{group}` on the profile endpoint.
Treat a list endpoint here as wrapped until proven otherwise.

**The list does inline messages** — that was only invisible while reading the
wrapper. Unwrapped, each thread carries its full `messages` array, so previews
and even a whole conversation need no extra request.

### DMs and group chats are one list

`/v1/chats` returns **both kinds together** — 19 mixed threads on the test
account — in one shape:

```
id, name, type, updated_at, last_read_timestamp, messages,
joinability, joinable_group_ids, notification_state, group_dm_state,
icon_url, member_count, user, accept_status
```

Only some fields are populated per kind, so they are told apart structurally:
**a group chat has `member_count` or `joinability`**, a DM has `accept_status`
(`accepted` / `pending`) and a `post_id`. Not by `name` alone — the list
contains unnamed group chats, which would be misfiled as DMs.

`getUpdates().chats.chats` returns **the same list**, identical ids and order.
Group chats were never stored separately; reading both sources into two lists is
what rendered every conversation twice. `/v1/chats` is the source; the updates
copy is a fallback only.

Consequences:

- **Group chats are readable.** Their messages arrive inlined, so the earlier
  "joinable but not openable" limitation was an artefact of the wrapper, not a
  missing endpoint.
- **Unread state is `updated_at > last_read_timestamp`.** There is no
  `unread_count` on this payload.
- **Group-chat messages carry an `identity`** — `{display_name, emoji, color,
  secondary_color}` — so senders are attributable. DM messages don't, being
  anonymous unless the sender chose otherwise.
- Sorting is by `updated_at`, which moves with the last message.

### A DM's `post_id` can point at a *comment*

Conversations start from replies as often as from posts, and `/v1/chats/start`
stores whatever id it was given. So a thread's `post_id` may resolve to a
comment — and `/p/<code>` only understands posts, so opening the comment's own
`index_code` renders a reply as a top-level post, complete with its own empty
comment section.

The thread header detects this (`type === 'comment'`, or a `parent_post_id` is
present) and links to the **parent** post instead, labelling the quoted block as
a reply.

### Group chats carry membership events in the message stream

"X left the chat", "Y rejoined the chat", "Ghost Spirit is now Purple Dagger"
arrive as ordinary entries in `messages`. They are not messages anyone sent and
render as centred grey lines rather than bubbles.

⚠️ **Detected heuristically.** `DirectMessage.type` exists but its values have
never been dumped, so the current test is: no `identity`, not authored by the
user, and the whole text matching an event phrasing. The messaging probe now
reports the distinct `type` values; once known, this should key on the field and
drop the pattern.

A group-chat message with no `identity` is genuinely anonymous and is labelled
**Anonymous**, rather than left unattributed — an unlabelled bubble reads as
belonging to whoever spoke last.

### A DM is always about a post or comment

`/v1/chats/start` **requires** `post_id`. There is no way to message a user out
of nowhere, which is why the entry point is an action on a post rather than a
button in the chats screen, and why every thread carries a `post_id`. It matches
how Yik Yak works — you message someone about something they wrote — so this is
parity, not a limitation.

`dms_disabled` on a post is the author opting out. Honoured client-side rather
than letting the request fail.

### `client_id` is the device id — corrected

The JSDoc says "alphanumeric device ID". I initially disbelieved it, because
every *message* carries its own `client_id`, which is the shape of an
idempotency key — and sent a fresh UUID per message.

**offsides settles it**: it sends `sha256(androidId)`, one stable value for the
life of the install, on every message. If the server deduped on this field that
client would deliver one message per thread and no more. It doesn't. So the
field is what it says it is, and we send the session's persisted device id
(docs/OFFSIDES.md#round-5--messaging-2026-08-28).

### Polling, because there is nothing else

No websocket or push channel exists in this API, so "live" means polling. An
open thread refreshes every 12s and only while the tab is visible; the thread
list every 60s. Those numbers are deliberately unhurried — this is a private API
hit with a real account, so a chatty client is an account-risk decision as much
as a performance one (PLAN §8).

Sends are **not optimistic**. A DM that appears and then vanishes is worse than
one that takes a moment: unlike a vote there is no counter to reconcile against,
and the sender has no way to tell whether it arrived.

### ⛔ Message requests are read-only

Threads carry `accept_status`, and a value other than `accepted` means someone
you don't know has written to you about your post. **Nothing writes that field**
— sidechat.js has no method, no candidate route has been confirmed, and
**offsides doesn't handle `accept_status` at all**, so this is the state of the
reverse engineering rather than a gap on our side. The
thread view says so rather than rendering an accept button that does nothing;
replying may accept it implicitly, which is untested.

#### The sweep that looked like an answer, and wasn't

A first sweep reported `/v1/chats/accept`, `/v1/chats/requests`,
`/v1/chats/decline` **and** `/v1/chats/groups` all answering **200** — four
discovered endpoints, enough to close both messaging gaps.

**All four were false.** Re-run with a control, 2026-08-29:

```
CONTROL /v1/chats/webyak-control-1788018081666 → 200, empty body
  /v1/chats/groups   → 200  identical to control
  /v1/chats/accept   → 200  identical to control
  /v1/chats/requests → 200  identical to control
  /v1/chats/decline  → 200  identical to control
```

`/v1/chats/:anything` is a catch-all returning 200 with an empty body. The
single-vs-two-segment asymmetry in the first sweep (`/v1/chats/request/accept`
404'd) was the tell.

**The first probe had no control**, which is the same mistake the `period` probe
exists to prevent — a lesson already learned, written down, and then not applied.
Any sweep that concludes "this route exists" from a status code needs a nonsense
path in the same run.

### Group chats: joinable *and* openable

`/v1/chats/explore` lists them and `/v1/chats/groups/join` joins them — both
work. But a joined group chat does **not** appear in `/v1/chats`, which returns
DM threads, and no endpoint for reading a group chat's messages has been found.

**Resolved 2026-08-29 — they were never separate.** Joined group chats are in
`/v1/chats` alongside DMs, with their messages inlined, so they open like any
other conversation. The limitation was a misreading of the envelope, not a
missing endpoint.

offsides never got here: it has no group-chat path and its `leaveChat` is a stub
marked *"Waiting for sidechat.js implementation."*
