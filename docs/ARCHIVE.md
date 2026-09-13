# The archive and its scrapers

Everything about how posts and comments get into the local archive, how a run
resumes, what re-seeing something changes, and — the part that matters most for
what comes next — **what the current design does not keep up to date.**

The last section, [What is stale and why](#what-is-stale-and-why), is written for
the planned refresh pass. Read it before designing that.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) covers the IndexedDB schema, search
and integrity checking; [API.md](API.md) covers endpoint behaviour.

---

## 1. The pieces

| Piece | File | Job |
|---|---|---|
| Record shape, merge rules | [src/lib/archive/types.ts](../src/lib/archive/types.ts) | `toArchived`, `mergeArchived`, `CrawlState` |
| Storage | [src/lib/archive/store.web.ts](../src/lib/archive/store.web.ts) | IndexedDB, indexes, export/import |
| Feed crawl + comment pass | [src/lib/archive/crawler.ts](../src/lib/archive/crawler.ts) | `startCrawl`, `startCommentCrawl` |
| Gap detection | [src/lib/archive/integrity.ts](../src/lib/archive/integrity.ts) | `analyseArchive` |
| UI | [src/app/settings.tsx](../src/app/settings.tsx) | Both jobs, per-community |

There are **two separate jobs**, and they are separate on purpose:

- **The feed crawl** pages a community's `recent` feed. One request returns ~24
  posts, so a community's entire history is a few thousand requests.
- **The comment pass** fetches one thread per post. At 157k archived posts with
  ~49% carrying replies, that is ~77k requests — roughly three days at the
  configured pacing. Folding it into the feed crawl would have turned a
  twenty-minute job into a multi-day one without saying so.

### Three write paths

Everything reaches the archive through `archiveContent(items)`:

| Path | Trigger | Notes |
|---|---|---|
| Feed crawl | Settings → Backfill | Bulk, paced, resumable |
| Comment pass | Settings → Collect comments | Bulk, paced, resumable |
| **Passive browsing** | Any feed, post or thread you open | Fire-and-forget, in `queries.ts` |

The third is easy to forget and matters for reasoning about freshness: **just
looking at a post updates its archived record.** A post you open today has a
current score; the one next to it in the archive may be a year stale.

---

## 2. The record, and how things link to each other

One object store, `content`, holding posts and comments together. A record is
keyed by the API's `id` (a UUID).

### Post vs comment

`type` is set by the API, but `toArchived` does not trust it alone:

```ts
const isComment = item.type === 'comment' || Boolean(item.parent_post_id);
```

The structural fact — a comment hangs off a parent — is the stronger signal. A
comment misfiled as a post would be invisible to the comment pass while quietly
inflating the post count, and that is a corruption you would not notice for
months.

### Thread linkage

Yik Yak threads are **two levels deep**: comments on a post, and replies to a
comment. Three fields carry it:

| Field | Meaning |
|---|---|
| `parent_post_id` | The post this comment belongs to. Indexed — a whole thread is one lookup. |
| `reply_post_id` | What this is a reply *to*. **Equal to `parent_post_id`** for a top-level comment; **different** for a reply to another comment. |
| `reply_comment_post_id` | The specific comment replied to, when the API distinguishes it. |
| `is_reply` | Derived `0|1`, indexed. |

The ids are kept rather than only the flag, because an exported archive has to be
able to **rebuild the tree**. A boolean says a comment is a reply without saying
to what, which is unrecoverable once the export leaves the browser.

```
post  A  (parent_post_id: —,  reply_post_id: —)
├── comment B  (parent_post_id: A,  reply_post_id: A)   is_reply 0
│   └── reply C  (parent_post_id: A,  reply_post_id: B)   is_reply 1
└── comment D  (parent_post_id: A,  reply_post_id: A)   is_reply 0
```

Siblings are not stored as such — B and D are siblings because they share a
`parent_post_id` and neither is a reply. Ordering within a thread is **not**
stored either; it is reconstructed from `created_at`, or from the API's own
ordering when a thread is fetched live.

### Quote posts

A quote-repost carries `quote_post_id` and an embedded `quote_post.post` — the
whole original post, inline in the response. Both are kept:

| Field | Meaning |
|---|---|
| `quote_post_id` | The post this one quotes. Indexed, so **"what quoted this"** is a lookup. |

The forward direction (*what did this quote*) is answerable from the record you
already hold. The reverse (*what quoted this*) is not, which is the only reason
the index exists.

The embedded original is **archived as a record in its own right**, by
`expandQuoted` in [types.ts](../src/lib/archive/types.ts), which flattens a batch
before it is written. That copy is free — the request was already paid for — and
if the original is deleted, or predates the archive, it is the only copy we were
ever going to get.

Expansion is **one level deep**. A quote of a quote brings its own embedded copy
when it is itself sighted, and recursing would let a malformed or circular
payload walk as deep as the response nested. Ids are deduped in the same pass,
because a feed page can quote the same post twice and `archiveContent` writes one
transaction per batch — two records with the same key in one `Promise.all` would
race on read-then-write.

Quote linkage only exists from v7 onward — see
[G5](#g5-quote-linkage-exists-now-but-only-going-forward--closed-with-a-tail).

### What is deliberately not stored

Vote status, saved state, follow status. Those are facts about **this account
right now**, not about the post. An archive that records them ages badly and
starts lying the moment you vote on something.

---

## 3. The feed crawl

### Two frontiers, not one

The central design decision. A crawler that resumes from a single saved cursor
walks *backwards forever*: run it today, stop, run it next week, and it politely
continues digging into 2024 while everything posted in the intervening week is
never seen at all. The gap between "newest archived" and "newest posted" only
grows.

So a run does two things, in this order:

```
       newest ─────────────────────────────────────── oldest
          │                                              │
   ┌──────┴──────┐                              ┌────────┴────────┐
   │  PHASE 1    │  walks back until it meets   │    PHASE 2      │
   │  catch-up   │  already-held content        │    backfill     │
   │  (no cursor)│                              │  (tail_cursor)  │
   └─────────────┘                              └─────────────────┘
        new posts since last run                 deeper into history
```

**Head first on purpose**: recent posts are the ones most likely to be deleted
before the next run, so they are the ones worth securing first.

### The durable state

One `CrawlState` record per community, in the `meta` store under
`crawl:<group_id>`:

| Field | Meaning |
|---|---|
| `tail_cursor` | How deep the backfill has walked. **The only durable frontier.** |
| `tail_exhausted` | The backfill reached the end of the feed. |
| `pages`, `archived` | Lifetime counters for this community. |
| `group_name`, `updated_at` | Labelling, and the community picker's source. |

**There is no head cursor, and that is correct by construction.** The head is
found by starting at the top of the feed every time — whatever is newest *now* is
where catching up has to begin. Storing a head cursor would mean resuming from a
position that is already stale.

`tail_cursor` is written **after every page**, so an interrupted run loses at
most one page of position.

### Phase 1 — catch up

Skipped entirely on a first run: with nothing archived, "walk until duplicates"
and "walk until exhausted" are the same walk, so phase 2 does all of it.

Otherwise: start at the top with no cursor, page backwards, and stop after
`HEAD_DUPLICATE_PAGES = 3` **consecutive pages that added nothing new**. Not 1 —
a single overlapping page is normal at any frontier.

Three pages is also, incidentally, the **entire refresh window** of the whole
system. See [G2](#g2-nothing-revisits-an-archived-post).

This pass deliberately does **not** move `tail_cursor`. It is walking a region
the backfill has already passed; letting it write the tail would throw away real
progress.

### Phase 2 — backfill

Resume from `tail_cursor` and keep going. **Backfill never stops for
duplicates** — crossing ground already held is exactly how it reaches ground it
does not hold.

That was learned the hard way. An earlier version stopped when pages came back
all-duplicate and reported "caught up — everything from here back is already
archived". The claim was not supportable: a run fetching the same pages
repeatedly produces nothing but duplicates and looks identical from outside. In
practice the same crawl, restarted by hand, pushed straight through and kept
finding new posts. The stall was **transient**, and stopping made the operator do
by hand what the loop should do itself.

What replaced it is a **progress budget**:

> A page counts as progress if it archived something new **or** reached further
> back in time.

Either kind of forward motion resets the budget. Duplicate counting alone cannot
tell "I already archived this stretch" from "the server keeps serving me the same
stretch"; a timestamp moving backwards can.

| Condition | Response |
|---|---|
| 5 pages without progress, or a repeated cursor | Pause `8s`, doubling to `30s`, keep going |
| 40 pages without progress | Give up: `stalled`. Something is actually wrong. |
| No cursor, or an empty page | `exhausted` — genuinely the end |

A `stalled` or looping ending **does not** set `tail_exhausted`. That is the
server's limit right now, not proof that history ends there, so the cursor is
kept for a later attempt.

### Pacing

This is a private, reverse-engineered API being hit with a real personal account.
[PLAN.md §8](../PLAN.md) names an over-eager client as an **account risk** rather
than a performance problem, so the pacing is slower than it needs to be:

| Setting | Value |
|---|---|
| Between pages | `1500ms` + up to `600ms` jitter |
| After an error | `5s`, doubling to `60s` |
| On 401 or 429 | **Hard stop.** No retry. |

The jitter exists so the traffic is not a metronome. The hard stop exists because
401 means the session is gone and 429 means we are already being told to slow
down — retrying either is how an account gets flagged.

---

## 4. What re-seeing something changes

Every write goes through `mergeArchived(existing, incoming)`. This is the part to
understand before building anything that refreshes.

### Overwritten on every sighting

- `vote_total`
- `comment_count`
- `text` and `tokens` (unless the incoming copy is a tombstone)
- `media` (with cached bytes preserved)
- `alias`, `author`, `group_name`
- `last_seen_at`

### Never overwritten

- `first_seen_at` — when this client first recorded it
- `text` / `vote_total` / `tokens`, **when the incoming copy is a tombstone**
- `cached` media flags, and any asset whose bytes are held even if it has since
  vanished from the payload

### Deletion is recorded, not applied

Once a post is removed, the API returns its text as the literal string
`"Deleted Post"`. Writing that over the record would destroy the thing the
archive exists to keep. So:

```
incoming.text === 'Deleted Post' && existing.text !== 'Deleted Post'
   → keep the original text, score and tokens
   → set deleted = 1, deleted_at = now
```

The archive then answers both *what did this say* and *was it taken down
afterwards*. `deleted_at` is when we **noticed**, not when it happened — the API
gives no removal timestamp — so treat it strictly as an upper bound.

Tombstone detection is a **string comparison against `"Deleted Post"`**. If the
API ever changes that string, detection fails silently and tombstones overwrite
real text. Worth a probe if deletions start looking wrong.

### The comment flag re-arms itself

```ts
needs_comments = comment_count > comments_fetched_count ? 1 : 0
```

`comments_fetched_count` records the count **at the moment the thread was
fetched**, rather than a boolean. So a post that gains replies later comes back
around for another pass instead of being permanently considered done — but only
if something re-sees the post and notices the higher count. That "if" is
[G3](#g3-comment-counts-freeze-the-same-way).

---

## 5. The comment pass

### It works off the archive, not the network

This is what makes it resumable for free. It does not page anything; it asks the
archive for posts flagged `needs_comments = 1` — an index lookup, not a scan over
157k rows — and works through them.

```
loop:
  batch = listPostsNeedingComments(250, groupId?)
  if batch empty            → done
  for each post in batch:
      comments = getPostComments(post.id)
      archiveContent(comments)          ← comments written first
      markCommentsFetched(post.id, n)   ← flag cleared only after
      sleep 1200ms + up to 500ms jitter
```

**The ordering is the whole resumption story.** A post's flag is cleared only
after its thread is stored, so:

- an interrupted run finds exactly the same work waiting
- a thread that fails mid-way stays flagged and is retried on a later run
- the failure direction is always a **duplicate fetch, never a gap**

Posts with no replies are never requested at all, which removes about half the
corpus from the job before it starts.

### Per-thread failures

A single unreadable thread — deleted, moderated, private — must not end a run
spanning a hundred thousand posts. It is counted in `errors`, the post stays
flagged, and the pass moves on after a backoff. 401 and 429 still hard-stop.

This is also why `getPostComments` is our own implementation rather than
sidechat.js's: theirs throws on any body without a `posts` array and rethrows
without the HTTP status, so the 401/429 stop could never fire for this endpoint
([API.md](API.md#sidechatjs-getpostcomments-throws-on-an-unexpected-body)).

### An empty thread still clears the flag

A post can claim replies and return none — the replies were deleted. The flag is
cleared anyway and the run counts it in `empty`, because asking again every run
would loop on it forever. A high `empty` count relative to `threads` is worth
noticing, but a low one is normal.

---

## 6. Import, export, and merging archives

Export is NDJSON — a header line of metadata, then one record per line, streamed
from a cursor so 157k records never exist in memory at once.

Import streams it back through `Blob.stream()` and a `TextDecoder`, and merges by
**recency rather than by file order**:

```ts
existing.last_seen_at >= record.last_seen_at
  ? mergeArchived(record, existing)   // existing is newer — it wins
  : mergeArchived(existing, record)   // imported is newer — it wins
```

So importing an old export into a current archive cannot roll anything back, and
importing a newer export into a stale one upgrades it. Records an older export
predates (missing tokens, missing linkage) are rebuilt on the way in.

---

## 7. What is stale and why

**This is the section for the refresh pass.** Everything below is a real gap in
the current design, not a hypothetical.

The single sentence version:

> The archive is a **record of sightings**, and almost nothing is ever sighted
> twice. A record's `vote_total` and `comment_count` are frozen at whatever they
> were the moment the crawler happened to walk past.

### G1: Scores are systematically wrong in a direction that matters

This is the one that breaks "top posts of all time".

The two phases archive posts at **completely different ages**:

| Phase | Post age when archived | Score recorded |
|---|---|---|
| Backfill | Months to years old | Mature. Near-final. |
| Catch-up | **Minutes to hours old** | **Near zero.** |

A post archived by the catch-up pass was caught within minutes of being posted,
before anyone voted on it, and nothing ever goes back to look at it again. Its
archived score is approximately zero *forever*.

So `sort:top` over the archive is not a ranking of the best posts — it is a
ranking of the best posts **that happened to be old when the crawler first ran**.
There is a discontinuity in the data at the date the first crawl happened, and
everything newer than it is scored near zero.

Any "top posts all time" feature has to fix this first, or it will confidently
report that nothing good has been posted since the archive started.

### G2: Nothing revisits an archived post

There is no mechanism that re-fetches an archived post. The only second looks
that happen at all:

1. The **3-page head overlap** each catch-up run — roughly **72 posts** past the
   frontier, and no further.
2. Whatever you happen to **open in the app**, via the passive write path.

That is the entire refresh surface. A post 80 positions below the frontier at the
time of a run is never read again by any automated path.

### G3: Comment counts freeze the same way

`needs_comments` is set from `comment_count > 0` **at archive time**. A post
caught fresh by the catch-up pass has no comments yet, so it is flagged `0` —
*not needing comments* — and the comment pass will never request its thread.

It re-arms only if something re-sees the post with a higher count, which means
only if it falls inside that same ~72-post head overlap on a later run.

**The practical consequence:** posts archived by catch-up largely never get their
comments collected, and the comment archive is therefore biased toward the older,
backfilled part of the corpus. The `Threads to fetch` figure in Settings counts
only posts *known* to have replies, so it understates the real outstanding work.

### G4: Deletions are almost never noticed

`deleted` is set only when a tombstone is re-seen for a post already held. Since
nothing revisits archived posts ([G2](#g2-nothing-revisits-an-archived-post)),
in practice a post is only marked deleted if it is removed within minutes of
being archived, while it is still inside the head overlap.

The `deleted` count is therefore a **severe undercount**, and `is:deleted`
searches a small and unrepresentative sample. The archive is good at preserving
deleted content; it is bad at *knowing* the content was deleted.

### G5: Quote linkage exists now, but only going forward — CLOSED, with a tail

Fixed: `quote_post_id` is stored and indexed, and the embedded original is
archived alongside the post that quotes it (see [Quote posts](#quote-posts)).

**What the fix cannot do is reach backwards.** `quote_post_id` was never written,
so it is not recoverable from what is on disk — the v6 → v7 migration adds the
index and deliberately rewrites no records, because there is nothing to write
them from. Every quote-repost archived before this change is still an unlinked
post, and the originals they quoted are held only if they were separately
crawled.

The link appears on a **fresh sighting**, so this is one more thing the refresh
pass repairs for free as it re-reads posts. Until then expect `quotes linked` in
the integrity report to be small relative to the archive, and to grow with each
run.

`orphanQuotes` in the same report counts quote-reposts whose target is not held.
It should stay near zero now that the inline copy is archived; a non-zero count
means the API returned an id with no embedded post, so those originals are
fetchable but missing — a closeable gap rather than a corruption.

### G6: `markCommentsFetched` records a stale count

It is called with `post.comment_count` as read from the **archive record**, not
with the number of comments actually returned:

```ts
await markCommentsFetched(post.id, post.comment_count);
```

If the post gained replies between being archived and its thread being fetched,
the recorded `comments_fetched_count` is too low — harmless, it just re-arms
later. If comments were deleted so the thread returned fewer, the recorded count
is too high, and the post will not re-arm until it exceeds a count that was never
real.

### G7: No index supports "what have I not refreshed recently"

The 15 indexes cover `group_id`, `created_at`, `type`, `parent_post_id`,
`has_media`, `index_code`, `media_pending`, `author`, `deleted`, `tokens`,
`[group_id, created_at]`, `needs_comments`, `is_reply`, `vote_total` and
`quote_post_id`.

**`last_seen_at` and `first_seen_at` are not indexed.** So the most natural
question a refresh pass asks — *which records have not been checked since X* — is
a full scan of 157k rows today.

A refresh pass almost certainly wants an index on `last_seen_at`, or a compound
`[group_id, last_seen_at]`. That is a `DB_VERSION` bump and a migration over a
large live store, so it is worth deciding the shape **once**, before writing the
pass, rather than discovering a second migration is needed.

### G8: Coverage can only be checked statistically

Nothing records which posts arrived on which page, or which cursor produced them.
There is no provenance, so contiguity cannot be *proved* — a page the server
silently skipped leaves no trace.

[`analyseArchive`](../src/lib/archive/integrity.ts) compensates by judging each
day's volume against the median of its surrounding ±14 days, which catches
dropouts without flagging every university summer as data loss. It is a good
proxy and it has found nothing on the reference archive, but it is inference, not
a receipt.

---

## 8. What a refresh pass needs to decide

Not a design, just the questions this document says are open:

1. **What to re-read.** Post ids are re-fetchable individually (`getPost`), but
   that is one request each, at comment-pass cost. Re-paging `top` with a
   `period` window is far cheaper per post and naturally targets the posts whose
   scores matter most — at the cost of only ever seeing what the server still
   ranks.
2. **How to choose.** With [G7](#g7-no-index-supports-what-have-i-not-refreshed-recently)
   unfixed there is no cheap "oldest sighting first" query. Decide the index
   before the pass.
3. **What a re-read implies.** `mergeArchived` already does the right thing for
   scores, tombstones and the comment flag — a refresh pass needs **no changes to
   the merge rules**, only something that feeds it. That is the good news in all
   of this.
4. **That a refresh also back-fills quote links.** A re-read writes
   `quote_post_id` and archives the embedded original, which is the only way the
   pre-v7 part of the archive ever gains quote linkage
   ([G5](#g5-quote-linkage-exists-now-but-only-going-forward--closed-with-a-tail)).
5. **Whether a refresh can re-arm comments.** Re-reading a post updates
   `comment_count`, which re-arms `needs_comments` automatically. So a score
   refresh also repairs [G3](#g3-comment-counts-freeze-the-same-way) for free, and
   the two passes should probably share a schedule.
6. **How far back to go.** Refreshing everything forever is not finite work.
   Scores stop moving after a few days; comment counts move for longer; deletions
   happen at any time. Those three want different cadences and probably different
   passes.
