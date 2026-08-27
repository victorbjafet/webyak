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

The rule that actually holds: **a URL on `api.sidechat.lol` without `expires=`
or a signature needs the bearer token.** Encoded in `src/lib/asset-url.ts`.

Neither `<img src>` nor `<video poster>` can send a header, which is why video
posters rendered blank. `AuthedImage` fetches those with the token and hands the
element a blob URL instead; native passes headers to the image loader directly,
which is what offsides does.

> ⛔ **This did not actually fix video thumbnails.** Verified still broken
> 2026-08-27. The auth theory above is sound and the blob path is implemented,
> but the poster is still blank in practice. Grouped with the other unrendered
> images below — see
> [Images that don't render](#-images-that-dont-render--unresolved), because
> they now look like one bug, not three.

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

### ⛔ Images that don't render — unresolved

**Deferred deliberately.** Re-verified still broken 2026-08-27. Three classes of
image do not appear; the emoji / initials / black-box fallbacks are what ships.

| What | URL host | Needs bearer? | Renders? |
|---|---|---|---|
| Profile photos | unknown — field not identified | unknown | ❌ |
| Community icons | `icon.yik-yak.com` | **no** — public, verified 200 | ❌ |
| Video thumbnails | `api.sidechat.lol/v1/assets?post_id=…` | **yes** — 401 without it | ❌ |

**These were three separate investigations and should be one.** The table is the
finding: one of them needs auth, one provably does not, and they fail the same
way. That makes a shared rendering fault more likely than three independent
causes, and it means *the auth work was probably never the blocker*. Start there
next time rather than re-probing endpoints.

Two concrete things to check first, both in the render path rather than the API:

1. **`AuthedImage` returns `null` on any failure**
   ([authed-image.web.tsx:49](../src/components/authed-image.web.tsx)). So a
   failed image renders *nothing* — and the caller has already branched into the
   image path, so its fallback is unreachable. `GroupAvatar` only draws initials
   when `iconUrl` is absent, never when it is present-but-broken
   ([group-avatar.tsx:32](../src/components/group-avatar.tsx)). This guarantees a
   blank box and, worse, no error surface: there is currently **no way to tell a
   404 from a decode failure from a fetch that never fired**. Make it fail loudly
   before theorising further.
2. **Community icons never touch the token path at all.** `assetNeedsAuth()` is
   false for `icon.yik-yak.com`, so the URL goes straight to `<Image>` — the
   blob shim is not involved, and neither is auth. If a public URL in a plain
   `<Image>` does not render, the fault is in expo-image on web or in the style
   (a zero-height box renders as nothing), not in the API.

What is known about profiles specifically:

- Some profiles have **no photo at all**. `rat.brat` returns only
  `conversation_icon: {emoji: "🐀", color: "#9BD46A", …}` — for that account the
  emoji *is* the avatar, and it renders correctly. So an absent photo is not
  evidence of a bug.
- **`@snoopyvt` is the reference case** — that account definitely has one.
  `/u/snoopyvt` locally or on the deploy. Verify any fix against it.
- Which field carries the photo is still unidentified. The diagnostics probe
  targets `@snoopyvt` and dumps **every URL-valued field** on the payload rather
  than guessing a name, which should answer it on the next run.

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
