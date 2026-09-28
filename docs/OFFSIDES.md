# offsides — our reference implementation

[github.com/micahlt/offsides](https://github.com/micahlt/offsides) is a
third-party Yik Yak/Sidechat client for Android, written by **the same author as
sidechat.js**. It is the closest thing to documentation this API has.

**Check offsides before debugging anything.** If a request shape looks wrong, a
field is missing, or a response is surprising, the odds are good that they hit it
first and the fix is sitting in their source. Every hour spent reading it is an
hour not spent guessing at a private API.

> **Status as of 2026-09-27: deprecated.** offsides shipped **1.0.0** on
> 2026-09-13 — its first release since 0.9.4 in December 2025 — and on
> 2026-09-14 its README announced it is being retired *"in favor of the upcoming
> official YikYak app for Android"*, with code and downloads staying up but
> *"support is not guaranteed"* ([the announcement](https://www.reddit.com/r/Offsides/comments/1unue0p/offsides_likely_shutting_down_soon);
> Reddit refuses automated reads, so only the README's summary is recorded here).
>
> What that means for us:
>
> - **Still check it first.** Everything it learned up to September 2026 is in
>   its source, and it is still the best prior art there is.
> - **It is now a snapshot, not a moving reference.** Anything the API does
>   after this point will not show up there. The arrival of an official Android
>   app is exactly when an API is most likely to move.
> - **sidechat.js is frozen with it.** Same author, and the README now says
>   changes to how the API is accessed belong upstream in sidechat.js — whose
>   latest release is still **2.6.6** (2026-07-10), the version we pin. Every
>   defect in [API.md](API.md#sidechatjs-266-defects) still applies, and none
>   should be expected to be fixed. Owning the API layer, as `src/api/client.ts`
>   increasingly does, is the only path forward.
>
> Reviewed at commit `504329a` (2026-09-14). The rounds below were read against
> `2e3922b` (2026-07-09), which was `main` until the 1.0 work landed.

Read files directly, no clone needed:

```
https://raw.githubusercontent.com/micahlt/offsides/main/<path>
```

## Where things live

| Path | What's in it |
|---|---|
| `src/screens/LoginScreen.jsx` | The whole auth state machine. Source for [API.md § Auth flow](API.md#auth-flow) |
| `src/screens/HomeScreen.jsx` | Feed, sorting, cursor pagination, the defensive filters below, and the post button that picks the target group |
| `src/components/CommentModal.jsx` | **Post detail + comments** — the `Comments` route |
| `src/screens/ThreadScreen.jsx` | **A DM conversation** — the `Thread` route. An earlier version of this table said post detail; that was wrong, and contradicted Round 5 below |
| `src/screens/MessagesScreen.jsx` | The DM list |
| `src/screens/WriterScreen.jsx` | Compose: posts, comments, polls, image upload. The target group arrives as a route param |
| `src/screens/ExploreGroupsScreen.jsx` | Group discovery |
| `src/screens/MyProfileScreen.jsx` | The You tab: identity, bio, karma |
| `src/screens/EditProfileScreen.jsx` | Username, bio, icon |
| `src/screens/UserProfileScreen.jsx` | *New in 1.0.* Someone else's public profile and posts |
| `src/components/Post.jsx` | Post card, voting, profile links |
| `src/components/Comment.jsx` | Comment card, reply threading, the "YOU" badge |
| `src/components/UserContent.jsx` | Your own posts and comments |
| `src/components/Poll.jsx` | Poll render + vote |
| `src/components/GroupPicker.jsx` | Group switching — and where the user's groups come from |
| `src/components/AutoImage.jsx` | Image loading, with the bearer |
| `src/components/AutoVideo.jsx` | HLS video; its poster is loaded without a token |
| `src/components/UserAvatar.jsx`, `GroupAvatar.jsx` | Avatars — the user's emoji, falling back to the **group's** icon |
| `src/utils/voteStore.js` | *New in 1.0.* Shared vote state, and how far to trust the server's total |
| `src/hooks/useUniqueList.jsx` | Feed de-duplication |
| `src/utils/mmkv.js` | Storage |
| `android/app/src/main/AndroidManifest.xml` | Intent filters (and what's *not* there) |

## Patterns worth copying

### The feed needs two defensive filters, not one

`HomeScreen.jsx` does both of these on every page:

```js
setPosts(res.posts.filter(i => i.id));   // drop entries with no id
const uniquePosts = useUniqueList(posts); // then dedupe by id
```

So the feed endpoint returns **entries with no `id`** (almost certainly ad slots)
*and* **duplicates across pages**. Neither is documented anywhere. Phase 3's
infinite scroll needs both filters or it will crash on a missing key and render
repeats. This is the single most valuable thing in the repo for us.

### Voting: the server's total is not authoritative

**Corrected 2026-09-27.** This section used to say the server returns the
authoritative total — offsides applied `res.post.vote_total` after every vote,
and the advice here was *"don't compute the new total client-side."* offsides
1.0 reversed that, for a reason that is a fact about the API:

> Removing a vote on a comment comes back with `vote_status` cleared but the
> **old** `vote_total`, so the arrow lost its colour and the number stayed put.
> — commit `f817472`

So a vote *removal* is answered with a stale total. Their fix, in
`src/utils/voteStore.js`, is a reconciliation rule rather than trust in either
side:

```js
const delta = weight(action) - weight(prevStatus);
publishVote(id, action, (prevTotal ?? 0) + delta);        // optimistic, first
const res = await API.setVote(id, action);
const serverAgrees = res.post.vote_status === action || res.post.vote_status == null;
const totalMoved = res.post.vote_total !== prevTotal;
if (typeof res.post.vote_total === 'number' && serverAgrees && (delta === 0 || totalMoved))
  publishVote(id, action, res.post.vote_total);            // only when it reflects the action
// on error: roll back to prevStatus / prevTotal
```

The commit names comments; `castVote` applies the rule to posts and comments
alike, and we should assume both.

**Where webyak stands:** `useVote` applies the delta optimistically and **never
reads the server's total at all**, rolling back only on error — so it was never
exposed to the stale total, despite this doc recommending the opposite. What it
gives up is offsides' one remaining use of the server number: correcting drift
from other people's votes in the meantime. That only matters until the next
refetch.

offsides 1.0 also made vote state **shared across views** (`8a15ad1`): each card
used to hold its own copy, so voting in the comments screen left the feed card
stale, and tapping it again re-sent the same vote. webyak solved the same problem
differently from the start — `patchPostEverywhere` patches every cached copy of a
post (each feed, sort and period, the post itself, and threads) in one go.

### The user's own groups come from `getUpdates`, not explore

`GroupPicker.jsx`:

```js
const updates = await API.getUpdates(appState.schoolGroupID);
setGroups(updates.groups);   // the user's joined groups
```

This matters for [Blocker 2](API.md#blocker-2--group-slug--group_id---closed): explore
(`getAvailableGroups`) is a *curated, incomplete* list, but `getUpdates` returns
the groups the user is actually in. Different sources, different coverage.

### Poll constraints

`WriterScreen.jsx` enforces **2–4 options**, all non-empty, and blocks submit
otherwise. Those bounds aren't in the API docs; assume the server enforces them
too.

### Comment threading has one signal

`Comment.jsx` distinguishes a top-level comment from a reply-to-reply with:

```js
comment.reply_post_id != comment.parent_post_id
```

Equal means top-level. That's the whole depth model — the thread is two levels,
not arbitrarily nested.

### Storage

They started on AsyncStorage and migrated to MMKV for speed, keeping a one-time
migration path (`src/utils/mmkv.js`). We use AsyncStorage/SecureStore on native
and localStorage on web; MMKV has no web target, so this is a native-only
optimization we'd only want if storage reads ever show up in a profile.

## Where we deliberately differ

| Thing | offsides | webyak | Why |
|---|---|---|---|
| Device ID | `sha256(DeviceInfo.getAndroidId())` | random persisted UUID | No browser equivalent, and we don't want a fingerprint |
| Post-login | `RNRestart.restart()` | update session state in place | Restarting isn't a thing on web |
| School email | flow continues into it | skippable | Token is already valid; interest groups don't need a `.edu` |
| Images | passes `Authorization: Bearer` on every image request | same, via `AuthedImage` | **They were right.** See below |
| List virtualization | `@shopify/flash-list` | React Native `FlatList` (`feed-list.tsx`) | Web has different tradeoffs |
| Group search | unused — explore list only | `/v1/groups/explore/search` called directly | They never needed slug resolution; we do. The library's `searchAvailableGroups` reads a key the endpoint doesn't return ([API.md](API.md#sidechatjs-266-defects)) |
| Vote totals | optimistic, server total accepted only when it agrees | optimistic, server total never read | See [Voting](#voting-the-servers-total-is-not-authoritative) |
| Profile photos | never rendered, anywhere | rendered wherever an avatar appears | See [Where we deliberately differ on avatars](#where-we-deliberately-differ-on-avatars) |

### They were right about image auth

`AutoImage.jsx` attaches the bearer token to every image request:

```js
source={{ uri: src, headers: { Authorization: `Bearer ${token}` } }}
```

We initially read that as defensive and rendered images with a plain source,
having verified that post images are pre-signed. **That verification generalised
from too small a sample.** Video thumbnails and asset-library URLs are served
from `api.sidechat.lol` without a signature and return **401** without the
header — which is why video posters came out blank.

React Native's image loader takes headers, so offsides gets this for free. The
web has no equivalent: `<img>` and `<video poster>` cannot send headers, so
`AuthedImage` fetches those URLs with the token and passes a blob URL instead.
Rules in [API.md](API.md#asset-urls-and-auth--corrected).

Worth generalising: when offsides does something that looks unnecessary,
assume they hit a case we haven't yet.

## What offsides does *not* solve

**Share links.** The AndroidManifest registers only a custom scheme — `exp+offsides`
since 1.0, which dropped `com.micahlindley.offsides` — and there is still **no
`https` intent filter for yikyak.com**. offsides never opens a shared web link, and
`ThreadScreen.jsx` is always handed a `postID` (a UUID) it already has from the
feed.

So they never had to resolve a share code, and there is no prior art here for
[Blocker 1](API.md#blocker-1--index_code--post_id---no-native-endpoint). That one was ours to solve —
and the answer turned out not to be an endpoint at all
([API.md](API.md#blocker-1-resolved--by-changing-the-url-not-the-api)).


## Round 3 — what they told us about images and reposts (2026-08-27)

Consulted after three rounds of failing to render profile photos and reposts.
Both answers were in their source.

### `post.quote_post.post` — a wrapper, not the post

`Post.jsx`:

```jsx
{post.quote_post && !repost && (
  <MemoizedPost post={post.quote_post.post} repost={true} />
)}
```

The quoted original is at **`quote_post.post`**. Reading `quote_post` as the post
itself — the obvious guess, and the one we made — finds nothing and renders
nothing, which is exactly the symptom: a repost showing only its own caption.
sidechat.js's typedefs don't mention quotes at all, so there was no way to get
this from the library.

**We diverge on how it renders.** They recurse into the same `Post` component
with `repost={true}`, giving an outlined card. We render a lighter, read-only
`QuotedPost` summary instead, because a full card inside a card would nest vote
buttons, a delete control and a profile link inside another interactive card —
the nested-control problem that already bit us once
([DESIGN.md](DESIGN.md#never-nest-interactive-elements)). React Native tolerates
that; the web does not.

### Group icons are a plain URI — no token

`GroupAvatar.jsx` renders `source={{ uri: groupImage }}` with **no
Authorization header**, while `AutoImage.jsx` (post assets) does pass one. So
they had already drawn the line we spent three rounds finding: not every asset
on the API host wants a token.

That is what eventually cracked profile photos. `/v1/assets/profile` answers
`302` to a pre-signed R2 URL **with no auth at all**, and sending a bearer to it
breaks the request — the header forces a preflight, and a preflighted request
cannot follow a cross-origin redirect
([API.md](API.md#profile-photos-icon_url-and-the-bearer-was-breaking-it)).
offsides never hit this because CORS does not exist on Android.

### Home gets a home glyph

`GroupAvatar.jsx` special-cases `groupName === 'Home'` to an icon rather than
initials. Copied — "Home" is the synthetic all-communities feed, it has no
`icon_url` anywhere in the API, and a permanent lone "H" is worse than a glyph.

### Where we deliberately differ on avatars

Their `UserAvatar` shows the `conversation_icon` emoji (or a numbered alias such
as `#2`) and, failing that, falls back to **the group's icon** — not the user's
photo. *Corrected 2026-09-27: this used to say it fell back to "the image",
which read as the profile photo.* offsides never renders a user's profile photo
anywhere; even the public profile screen added in 1.0 shows the emoji or a
generic glyph.

We prefer the photo when an account has one. `@snoopyvt` carries *both* an
`icon_url` and a `conversation_icon` emoji — a defensible product call on a
phone, and the wrong one for a client whose users asked to see profile pictures.


## Round 4 — the You tab and the Home feed (2026-08-27)

### Karma lives on `getUpdates`

`MyProfileScreen.jsx` reads `API.getUpdates(currentGroup?.id)` and takes
`updates.karma`, shaped `{post, comment, groups: [...]}`, rendering post karma,
comment karma and a card per community. That answered "where is yakarma" without
a single probe — nothing in sidechat.js's typedefs mentions karma at all.

### Home is special, and they enforce it

Two behaviours copied straight across:

- **`top` is refused on Home.** `HomeScreen.jsx` blocks it with "This feature
  isn't supported in your Home group". Our For You feed drops the tab entirely
  and corrects a stale `top` selection rather than sending it.
- **Posting from Home substitutes the school group id** — on `HomeScreen`'s
  post button, which hands it to the composer as a route param:
  `groupID: currentGroup?.name == 'Home' ? appState.schoolGroupID : currentGroup.id`.
  We do the same via `primaryGroup`. Without this, composing from For You would
  post to a group id that isn't a real community.

They identify it by `name == 'Home'`. We check `index_name === 'all'` as well,
since neither is documented and a display-name comparison is the more fragile of
the two.

### Where they don't help

`unread` does not appear anywhere in their source — they offer hot / top /
recent only. So the official app's unread filter is either newer than offsides
or was never reverse-engineered, and we have to settle it ourselves.


## Round 5 — messaging (2026-08-28)

Consulted to answer three questions: do existing DMs and group chats sync, how
are message requests handled, and how is a group chat opened. It answered one
and confirmed the other two are unsolved everywhere.

### They corrected me on `client_id`

`ThreadScreen.jsx`:

```js
const id = await DeviceInfo.getAndroidId();
const deviceID = sha256(id);
await API.sendDM(chatID, messageDraft, deviceID);
```

**One stable value for the life of the install**, sent on every message.

I had reasoned the opposite — that `client_id` was a per-message idempotency
key, because every message in a thread carries its own — and sent a fresh UUID
each time, on the grounds that uniqueness was safe under either reading. That
reasoning was sound but the premise was wrong: if the server deduped on this
value, offsides would only ever deliver one message per thread. It doesn't, so
it isn't a dedup key. Now the session's persisted device id.

### DMs do sync; the list inlines its messages

`MessagesScreen.jsx` calls `getDMs()` (`GET /v1/chats`) and renders
`item.messages[item.messages.length - 1]?.text` with `item.updated_at`. So the
thread list is **server-side state** — a conversation started in the official
app appears here — and the list response carries the messages, not just a
preview. Our list reads `last_message` first and falls back to the same
expression.

### They have not solved message requests either

`MessagesScreen.jsx` has **no `accept_status` handling at all** — no filtering,
no accept, no decline. So the read-only limitation is not our gap, it is the
state of the reverse engineering. We at least separate requests from accepted
threads and say why they can't be actioned.

### They have not solved group chats either

`ThreadScreen.jsx` has no group-chat path, and `leaveChat` is a stub:

```js
const leaveChat = () => {
  return; // Waiting for sidechat.js implementation
};
```

So "joinable but not openable" is where the whole ecosystem is, not a shortfall
on our side. sidechat.js wraps `getGroupChats` and `joinGroupChat` and nothing
else.

**Where joined chats live is still open.** They are not in `/v1/chats`, which is
DMs. The standing guess is `getUpdates().chats` — a top-level key distinct from
`groups` and `activity_items` — which costs nothing to read since we make that
call anyway. Implemented as a lead with an empty-list fallback, and the
messaging probe dumps the key to settle it.

### Poll rate

They poll an open thread every **5s** while focused, and the DM *list* every
**15s**. Our first pass used 12s out
of caution about request rates; that was being careful about the wrong thing —
12s is a noticeably laggy chat, and offsides has been polling this API at 5s for
a long time, which makes it a measured tolerance rather than a guess. Matched.


## Round 6 — share codes: not a gap in their work, an absence of the problem

Checked `App.jsx` for deep links, universal links, URL schemes, or share-code
resolution. There is none — and the distinction worth drawing is **why**.

They are not stuck on this. **They never encounter it.**

A native app navigates by pushing a screen with the object already in hand. Tap
a post in a feed and offsides passes that post — it never holds a bare string and
asks "which post is this?". There is no cold start, no pasted URL, no address
bar. The question simply does not arise, so there is no workaround to copy, no
clever endpoint they found, and no evidence of them failing at it either.

That is different from the other rounds, where they had hit the same wall first
and solved it (`quote_post.post`, the `client_id` device id, group icons as a
plain URI). Here there is nothing to find.

**The general rule:** offsides is ahead on anything about *the API's shape and
behaviour*, and silent on anything the web adds — URLs, cold loads, CORS,
preflights, redirects. Three of this project's hardest problems (image upload,
video thumbnails, share codes) are in that second category, which is why they
kept coming back unsolved from a source that had answered everything else.

The resolution, when it came, was not an endpoint: the share code was a URL-shape
choice we had made ourselves, and post ids were resolvable all along
([API.md](API.md#blocker-1-resolved--by-changing-the-url-not-the-api)).


## Round 7 — the 1.0 release, and the end of the project (2026-09-27)

A fresh pass after offsides' first update in nine months. Read as a diff from
`2e3922b` (2026-07-09, what the rounds above saw) to `504329a` (2026-09-14), then
every existing claim in this document re-checked against the current tree rather
than trusted. 33 files changed; most are Expo 54, the Android build, and
safe-area padding. What bears on the API is below. The deprecation notice is at
the top of this document.

### Vote totals are stale on removal

The most consequential change, and it overturned advice this document gave. See
[Voting](#voting-the-servers-total-is-not-authoritative), corrected in place.

### Public profiles (`98c3fd5`)

`UserProfileScreen.jsx` is new: tap a name or avatar on a post or comment made
with a username, and it loads `getUserProfile(username)` and
`getUserPosts(username)` together with `Promise.allSettled`.

- **A profile can be unavailable.** A rejected or non-object result is shown as
  *"This profile isn't available. The user may have changed their username or
  made their profile private."* So profiles can be **private**, and usernames can
  **change** — a username is not a stable key for a person. Worth knowing for the
  archive, whose `author` field stores the name as it was when seen, and for
  `/u/<username>` links, which can go dead.
- **The bio is `profile.description`**, falling back to `profile.bio`.
- **A profile's post list gets the same missing-`id` filter** as the feeds.
- **Who gets a link:** only posts made with a username, and never
  `identity.name == 'Anonymous'`.
- **Your own name opens your own profile** — they branch on `authored_by_user`
  and push `MyProfile`. webyak linked your name to `/u/<you>`, your public
  profile; **it now opens the You tab too** (2026-09-27), on posts and comments.
- **An unavailable profile is an answer, not an error.** webyak's
  `getUserProfile` now returns `null` for a missing profile and `/u/<name>` says
  it is unavailable, in their words
  ([API.md](API.md#a-user-profile-is-a-group)).

### Bios (`98c3fd5`)

- **Written with `setUserBio`** — `PATCH /v1/users/<id>` with `{bio}`, which is
  exactly what our `updateProfile` sends. Confirmed, not new.
- **Failure is read from the body.** They treat any `message` in the response as
  failure, because the library returns the body whatever the status. Our
  `unwrap` throws on a non-2xx or an `error_code`, so a 200 carrying only a
  `message` would read as success. Whether this endpoint ever answers that way
  is unknown.
- **The bio is not reliably on `getUpdates().user`.** Both the You tab and Edit
  Profile check `user.bio`, then `user.description`, and then fetch the *public
  profile* and read its `description` — commented *"The bio lives on the public
  profile object."* webyak read `identity.bio` from `getUpdates().user` alone.
  **`useMyIdentity` now has the same fallback** (2026-09-27), with their exact
  `typeof === 'string'` tests — an empty string is an answer, `null` is not.
  Which path a real account takes is a diagnostics probe (PLAN Q10).
- **Length:** they cap the field at **200** characters with a counter; we cap at
  **150**. Neither number comes from the server; a write probe now settles it
  (PLAN Q11).

### Karma can name a group you are not in (`98c3fd5`)

*"Also guarded getKarmaInfo against groups missing from the group list."* They
crashed reading `g.name` when a karma entry's group was absent from
`updates.groups` — most likely a community the user has since left, which still
carries the karma they earned there. webyak's `karma-panel.tsx` already resolves
names against the user's groups and falls back to a label, so this confirms that
guard was needed rather than exposing a gap.

### Things the July tree already had that were never recorded

- **A "YOU" badge on your own comments** (`4c6c9be`, January 2026), driven by
  `authored_by_user`. **webyak has one too now** (2026-09-27), shown whether or
  not the comment was posted under your name.
- **Post length.** `WriterScreen` shows `n / 256 chars` and turns red past 256,
  but does **not** block submitting. webyak blocks at **300**. Neither is
  verified against the server; which limit it enforces, if any, is a probe.
- **Video posters load without a token.** `AutoVideo` accepts a `token` prop and
  never uses it: the HLS source and `poster={asset.thumbnail_asset.url}` are both
  plain URIs. That is *consistent* with our finding rather than a counterexample
  — the HLS URL is query-signed so it plays, while the thumbnail is unsigned and
  401s without the bearer ([API.md](API.md#-video-thumbnails-need-the-worker)).
  On that reading their posters are blank too; their runtime is not something we
  can observe. Unchanged since July 2025.

### What did not change

Checked rather than assumed, because a stale "still true" is as misleading as a
stale fact:

- **Auth** — only the phone-number-hint library was swapped. The flow in
  [API.md](API.md#auth-flow) stands.
- **Feeds** — both defensive filters; `getUpdates` for the user's groups; `top`
  refused on Home; posting from Home substituting the school group.
- **Polls** — 2 to 4 options, 80 characters each, all non-empty.
- **Threading** — `reply_post_id != parent_post_id`.
- **DMs** — `client_id` is `sha256` of the Android id; thread polled every 5s.
- **Still unsolved there:** message requests (no `accept_status` handling), group
  chats (`leaveChat` is still `// Waiting for sidechat.js implementation`),
  share links (no `https` intent filter), the `unread` filter (absent), and
  deleted posts (`getPost(id, false)`, never handled —
  [API.md](API.md#deleted-posts-are-omitted-not-tombstoned)).
- **sidechat.js** — pinned `^2.6.6`, resolving to 2.6.6, the latest release.

### SidechatProxy

Credited in offsides' README, before and after 1.0, as *"instrumental in this
app's development"*, and never recorded here until now.
[github.com/OrenKohavi/SidechatProxy](https://github.com/OrenKohavi/SidechatProxy)
is an earlier Kotlin client, declared dead in 2025 and succeeded by offsides. It
calls the auth flow and the three feeds — all already documented — plus one
endpoint we have not seen: **`GET /v1/groups/login_type?email=<email>`**, called
before registering a school email, whose `message` it shows the user. A lead
from a 2025 client, unverified.


## Round 8 — alerts (2026-09-27)

Read before building the Alerts tab, which until now was a placeholder claiming
the list endpoint had not been found. Two files at `main`:
`src/components/ActivityItem.jsx` and `src/components/UserContent.jsx`.

### Where their list comes from

**Not `/v1/activity`.** They never call it; sidechat.js has no method for it.
They read the copy of the same `{items, cursor}` list that `getUpdates()`
carries as `activity_items`, shown in an Activity segment of the profile screen,
**filtered to `!is_seen`**: an inbox that empties as you deal with it.

### What an item carries, by their reading

Everything here is from their source, not from our responses. Our probe had
only seen `{id, timestamp, type, is_seen, text}` on `votes`
([API.md](API.md#the-activity-feed-alerts)):

- **`post_id`** — tapping any item opens that post's comments, for every type.
- **`type`**, rendered with its own icon and label: `votes` ("Votes"),
  `trending_post` ("Popular"), `followed_post` ("Followed post"), anything
  containing `comment` ("Comment", or "Comment reply" for `comment_reply`),
  `new_follower` ("New follower"), `suggested_sidechats` ("Suggested post").
  An unknown type renders **nothing** — their switch has no default branch.
- **`suggested_sidechats_data.group_ids_to_suggest`** — the first id is fetched
  with `getGroupMetadata` and shown as a joinable community card.
- **`conversation_icon`** on `new_follower` — the follower's avatar.
- **`text`** is shown as sent, except a `📈 ` stripped from `trending_post` and
  `followed_post`.
- **`timestamp`** goes to `timesago()`, which takes dates, epoch numbers and
  strings alike, so its format was never pinned down.

### Marking read

`readActivity(id)` — `POST /v1/activity/seen` with `{ids: [id]}` — on **tap**
(then navigate) and on **swipe-away** (the card animates out). Never on sight.
One id per request, though the body is an array.

### Where we deliberately differ

- **We call `/v1/activity` itself.** It pages, and polling it for the tab badge
  costs a fraction of re-downloading the whole `getUpdates()` payload. Whether
  it is the same list as `activity_items` is PLAN Q17.
- **Seen alerts stay listed, dimmed**, with Unread as a filter — the owner's B2.
  Theirs vanish once read.
- **Unknown types still render**, as their type name with a bell, since the
  server's sentence says what happened whatever the type.
- **Mark all read**, one request for every unread id. It relies on the batching
  their single-id calls never tested (PLAN Q16).
- **No swipe-away.** On the web it has no obvious equivalent; tap and Mark all
  read cover it.
- **"Suggested community", not "Suggested post"** — the item suggests
  communities, and opens one.
