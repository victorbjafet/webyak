# offsides — our reference implementation

[github.com/micahlt/offsides](https://github.com/micahlt/offsides) is a
third-party Yik Yak/Sidechat client for Android, written by **the same author as
sidechat.js**. It is the closest thing to documentation this API has.

**Check offsides before debugging anything.** If a request shape looks wrong, a
field is missing, or a response is surprising, the odds are good that they hit it
first and the fix is sitting in their source. Every hour spent reading it is an
hour not spent guessing at a private API.

Read files directly, no clone needed:

```
https://raw.githubusercontent.com/micahlt/offsides/main/<path>
```

## Where things live

| Path | What's in it |
|---|---|
| `src/screens/LoginScreen.jsx` | The whole auth state machine. Source for [API.md § Auth flow](API.md#auth-flow) |
| `src/screens/HomeScreen.jsx` | Feed, sorting, cursor pagination, the defensive filters below |
| `src/screens/ThreadScreen.jsx` | Post detail + comments |
| `src/screens/WriterScreen.jsx` | Compose: posts, comments, polls, image upload |
| `src/screens/ExploreGroupsScreen.jsx` | Group discovery |
| `src/components/Post.jsx` | Post card, voting |
| `src/components/Comment.jsx` | Comment card, reply threading |
| `src/components/Poll.jsx` | Poll render + vote |
| `src/components/GroupPicker.jsx` | Group switching — and where the user's groups come from |
| `src/components/AutoImage.jsx` | Image loading |
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

### Voting: the server returns the authoritative total

`Post.jsx` keeps local `vote` and `voteCount` state, then reconciles:

```js
API.setVote(postID, action).then(res => {
  setVote(action);
  setVoteCount(res.post.vote_total);  // server's number wins
});
```

Optimistic update, then overwrite with `res.post.vote_total`. Don't compute the
new total client-side.

### The user's own groups come from `getUpdates`, not explore

`GroupPicker.jsx`:

```js
const updates = await API.getUpdates(appState.schoolGroupID);
setGroups(updates.groups);   // the user's joined groups
```

This matters for [Blocker 2](API.md#blocker-2--group-slug--group_id): explore
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
| List virtualization | `@shopify/flash-list` | TBD in Phase 3 | Web has different tradeoffs |
| Group search | unused — explore list only | plan to use `searchAvailableGroups` | They never needed slug resolution; we do |

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

**Share links.** The AndroidManifest registers only custom schemes
(`com.micahlindley.offsides`, `exp+offsides`) — there is **no `https` intent
filter for yikyak.com**. offsides never opens a shared web link, and
`ThreadScreen.jsx` is always handed a `postID` (a UUID) it already has from the
feed.

So they never had to resolve a share code, and there is no prior art here for
[Blocker 1](API.md#blocker-1--index_code--post_id). That one is ours to solve.
