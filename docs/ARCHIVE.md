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
| Storage contract | [src/lib/archive/contract.ts](../src/lib/archive/contract.ts) | The interface both platform files assert against, so a missing export is a compile error rather than a runtime one |
| Feed crawl + comment pass | [src/lib/archive/crawler.ts](../src/lib/archive/crawler.ts) | `startCrawl`, `startCommentCrawl` |
| Gap detection | [src/lib/archive/integrity.ts](../src/lib/archive/integrity.ts) | `analyseArchive` |
| UI | [src/app/settings.tsx](../src/app/settings.tsx) | Both jobs, per-community |

There are **two separate jobs**, and they are separate on purpose:

- **The feed crawl** pages a community's `recent` feed. One request returns ~24
  posts, so a community's entire history is a few thousand requests.
- **The comment pass** fetches one thread per post. Measured 2026-09-11 on the
  reference archive: 157k posts, ~49% carrying replies, so ~77k requests —
  days at the configured pacing, against a feed crawl of a few hundred. Folding
  it into the feed crawl would have turned a twenty-minute job into a multi-day
  one without saying so.

**Figures in this document are dated measurements, not constants.** The archive
grows every run — the same reference archive reported 181k outstanding threads
five days later — so treat the Settings screen as the live number and these as
orders of magnitude.

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
  window = listPostsNeedingComments(250, groupId?, behind)
  if window empty           → done
  for each post in window:
      comments = getPostComments(post.id)
      archiveContent(comments)          ← comments written first
      markCommentsFetched(post.id, n)   ← flag cleared only after
      sleep 1200ms + up to 500ms jitter
      on failure: behind++, and after 3 in a row, probe ahead (below)
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
flagged, and the pass moves on after a backoff.

401 and 429 hard-stop instead, because those are facts about the session rather
than about the post: one means the token is gone, the other means we are already
being told to slow down, and retrying either is how an account gets flagged.

**That stop only started working once `getPostComments` stopped being
sidechat.js's.** Theirs throws on any body without a `posts` array — a deleted
post is enough — and its catch rethrows a bare `SidechatAPIError` carrying **no
HTTP status**, so a 401 or 429 arrived looking exactly like one unreadable
thread. A dead session would have been retried for the length of the run
([API.md](API.md#sidechatjs-getpostcomments-throws-on-an-unexpected-body)). Ours
goes through `request()`, which checks the status, and reads a missing `posts`
array as an empty thread rather than an exception.

### Getting past a run of unreadable posts

Leaving a failed post flagged is what makes the pass resumable, and it has a
consequence that only shows up after a few runs: **unreadable posts accumulate at
the head of the queue.** Every readable post ahead of them gets cleared and
leaves the index; they do not. So the front of the queue slowly becomes the set
of posts that always fail, and every resume spends its first minutes re-failing
them in the same order.

The obvious fix — mark a post as bad and stop offering it — was rejected. That
makes a **second source of truth** about what the queue contains, it is wrong the
moment a post becomes readable again, and it has to be migrated, exported and
reasoned about forever.

Instead the pass finds the end of the bad stretch by probing:

```
1. WORKING     …fail, fail, fail            → 3 consecutive failures
2. BRACKETING  jump +8, +16, +32, +64…      → until one reads cleanly
                 (clamped to the window end)
3. BISECTING   binary search the bracket     → where does the bad stretch end?
4. WORKING     resume just past the boundary
```

Cost goes from O(n) failures to O(log n) probes. Measured against a simulated
queue, driving the real `startCommentCrawl` with a stubbed archive:

| Shape | Requests (naive) | Requests (actual) | Readable posts skipped |
|---|---|---|---|
| 120 unreadable in a row, 200 total | 200 | **93** | 0 |
| 400 unreadable in a row, 600 total | 600 | **226** | 0 |
| Whole 80-post queue unreadable | 80 | **7** | 0 |
| 8 scattered unreadable, 120 total | 120 | 123 | 0 |
| Alternating bad/good, 100 total | 100 | 100 | 0 |

The last two matter as much as the first three: **a stretch that is not actually
a run must not trigger skipping.** A success resets the streak, so alternating
failures never reach the threshold and nothing is jumped over — the recovery is
inert unless there is a real run to escape.

#### Why guessing the boundary is safe

The predicate being bisected — *is this post unreadable* — is **not guaranteed
monotonic**. A bisect over a non-monotonic predicate finds *a* boundary, not
necessarily *the* boundary.

That is acceptable here because **the flag is the queue**. Anything jumped over
stays flagged and is offered again on the next run, so a mis-placed boundary
defers work rather than losing it. The failure mode is "a few posts read next
time instead of this time", which is the same thing that happens when you press
stop.

Two details keep it tighter than it needs to be:

- Bracketing **clamps to the last post in the window** rather than overshooting
  it. Probing the far end turns *the rest of this window is unknown* into *the
  rest of this window is bad*, on evidence — so skipping it is a measurement, not
  a guess. That is why a wholly unreadable 80-post queue costs 7 requests.
- Successful probes are **not wasted**. A thread read while bracketing or
  bisecting is archived and cleared like any other, which is why the request
  counts above beat the naive ones rather than merely matching them.

#### The queue offset

Skipping means the pass can no longer rely on "flagged posts, from the top" — the
posts it just skipped are still flagged and would be handed straight back.

So `listPostsNeedingComments` takes an **offset**, and the pass keeps a `behind`
counter: the number of flagged posts it has passed without clearing. Successes do
not increment it, because a success removes the post from the index and the queue
shifts up by one on its own. Failures and skips do.

This is exact rather than approximate, and the simulation asserts it: `behind`
equals the number of still-flagged posts at the end of every run.

Unfiltered, the offset uses IndexedDB's `cursor.advance()`. Filtered by
community it cannot — `advance` counts raw index entries while the offset counts
*matching* ones, so a second community's posts would throw the count off. The
filtered path walks and counts instead, which is exact and cheap, because the
offset is the number of unreadable posts rather than the size of the queue.

#### What it looks like when it happens

The monitor names the mode — *Jumping ahead past unreadable posts*, then
*Narrowing down where the bad stretch ends* — and reports `Left behind`,
`Jumped`, `Recoveries`, `Probes`, the current and worst error streak, and a
success rate over attempts. A run that finishes with posts left behind says so
explicitly, and says that a **stable count across runs is the expected outcome**:
deleted and moderated threads are never going to become readable.


#### `remaining`, `behind`, and what the ETA promises

Three numbers that look interchangeable and are not:

| Number | Means |
|---|---|
| `remaining` | Still flagged in the archive. Decremented only by a thread actually stored. |
| `behind` | Flagged posts *this run* has passed without clearing — failures and jumps. Also the offset the next window is read from. |
| `reachable` | `remaining - behind`: what this run can still get to. |

The ETA is built from `reachable`, not `remaining`. Putting a countdown on posts
the run has already given up on would be a promise it cannot keep, and the
countdown would stall at a floor equal to `behind` and never reach zero.

A run that finishes with `behind > 0` reports it plainly rather than claiming
completion. **A count that is stable across runs is the expected outcome**, not a
fault: a deleted or moderated thread is never going to become readable, and the
alternative — clearing the flag to make the number look good — would throw away
the only record that the post ever had replies.

### An empty thread still clears the flag

A post can claim replies and return none — the replies were deleted. The flag is
cleared anyway and the run counts it in `empty`, because asking again every run
would loop on it forever. A high `empty` count relative to `threads` is worth
noticing, but a low one is normal.

---

## 6. Refreshing what is already archived

A record is a **snapshot**, and snapshots go stale: scores move for days after a
post lands, threads keep growing, and things get taken down. The two frontiers
only ever *extend* the archive. Refreshing is the third kind of work — walking
ground already held, on purpose.

Posts and comments refresh **separately**, one job at a time, for the same
reason they are collected separately: a feed page refreshes ~24 posts in one
request, while a thread costs one request each. Mixing them would hide a
multi-day job inside a twenty-minute one.

### The update window

The unit of work is a **date range**, and where it starts is remembered per
community *and* per kind — refreshing posts says nothing about whether comments
were refreshed, and one watermark for both would claim it did.

```
UpdateState { group_id, kind: 'posts' | 'comments', window_start, updated_at }
```

**`window_start` is where the *next* run begins, not when the last one ran.** A
finished pass records a month before itself, so every refresh re-covers the month
its predecessor already did. That overlap is the point: a post that gained votes
or replies right at the old boundary gets read again instead of being sealed off
by a date.

Worked through, with the dates that motivated it:

| | |
|---|---|
| First scrape ever | 15 Aug |
| Plain catch-up runs since, archive current to | 21 Sep |
| Last run that actually **refreshed** anything | 15 Aug |
| So today's window covers | **15 Jul → now** (a month before that) |
| And it records, for next time | **21 Aug** (a month before today) |

The watermark is written **only by a pass that reached the end of its window**.
A stopped or failed run recording coverage it does not have would seal off the
part it never read — permanently, and silently, since nothing afterwards would
ever look there again. Verified by simulation: a run stopped mid-window writes
nothing.

`setMonth` is not used naively for this. Stepping the month back from 31 March
asks for "31 February", which JavaScript rolls forward to **3 March** — a lookback
of four days wearing the label of a month. The day is clamped to the target
month's length, and every field is read and written in UTC so the watermark
cannot drift by a day depending on where it was computed.

### The default is the recorded window, and it says so

The From box is **pre-filled with the watermark**, not left to a placeholder.
`<input type="date">` ignores placeholders — it renders `mm/dd/yyyy` whatever you
pass — so a defaulted field looked empty, and the only concrete date on screen
belonged to the full re-scrape control. The cheap, normal option was invisible
and the expensive, rare one looked like the default.

So: the fields show the window that will actually run, the summary line names it
as the default and where it came from, and full re-scrape is a separate checkbox
that says what it costs. Re-reading years of history against a private API is a
thing to reach for knowingly. That checkbox is derived from the dates rather than
held as its own flag, so the two cannot disagree — ticking it widens the window
to the whole archive, and editing either date unticks it.

**The panel needs a community before a run starts.** The community chips *are*
the start button, so the screen had nothing to look a window up for until one was
pressed — and reported "none recorded" even where one existed. It falls back to
the community being viewed, and names whose window it is showing, so a
multi-community archive cannot be misread. Whichever chip is pressed still runs
against its own recorded window.

"Custom" means *differing from the watermark*, not merely set, and is compared on
the date rather than the instant — a watermark carries a real time of day and a
picker can only produce midnight, so choosing the day that is already the default
is not an override.

### A missing window is asked about, never guessed

An archive built before refresh tracking has no watermark, and there is nothing
on disk to derive one from: `first_seen_at` says when a record was archived, not
when it was last *checked*.

So the UI says the window is missing and asks for a start date. Picking one
silently would declare everything before it current — the one error that cannot
be noticed later, because the skipped range never gets read again. A custom range
is available regardless; the end defaults to now.

The watermarks travel in the **export header** alongside the crawl states, so a
restored archive knows how current it is. On import the **older** window wins a
conflict: the importing browser may hold records the export predates, and taking
the later date would seal off the gap between them. Older exports carry none,
which reads as "no window recorded" rather than as a guess.

### Refreshing posts

A phase in front of the feed crawl. It pages `recent` from the top exactly like
catch-up does, but stops on a **date** rather than on duplicates — duplicates are
the *expected* result of re-reading, so they carry no signal here. Everything it
sees goes through `mergeArchived`, which is where the actual updating happens:
scores and reply counts overwrite, tombstones are recorded without destroying
text, and a changed reply count re-arms `needs_comments`.

It runs **first** because it is the only phase with a deadline — the window ends
at "now", and every minute spent backfilling first is a minute of new posts
arriving behind it. Like catch-up, it does not touch `tail_cursor`: it is
re-reading ground the backfill already passed.

Cost is the window's posts ÷ ~24. A month of a busy community is a few hundred
requests.

### The watermark moves only on a completed rescrape

Two conditions, both necessary:

1. **Rescrape was enabled.** A plain catch-up or backfill run never calls
   `recordUpdate` — it is reached only from inside the `if (update)` branch. A
   new-posts-only scrape leaves the watermark exactly where it was, which is
   what makes the worked example above come out right: the window is measured
   from the last run that actually *refreshed* something, not from the last run.
2. **The window was finished.** A stopped or failed pass records nothing.
   Claiming coverage it does not have would seal off the unread part
   permanently, since nothing afterwards would look there again.

Verified by simulation for both passes, in both states.

### Two things a date window cannot reach

A window is a good proxy for where change happens, and it is wrong in two
specific, predictable ways. Both are handled as extra queues rather than by
widening the window, because widening it multiplies the cost of the common case
to catch a rare one.

**The all-time top posts.** A community's best posts keep collecting votes and
replies long after everything around them has gone quiet — they get linked,
screenshotted and resurfaced. So a post refresh begins by sweeping `top` with
`period=all_time` for at least a hundred posts, regardless of age. It is a
handful of requests, and it happens *first*, because a pass that is stopped
early should still have done the cheap high-value part.

**Posts that newer posts quote.** A quote-repost is evidence of renewed
attention on something old: it has been deliberately resurfaced, which is
exactly when a post that had gone quiet starts moving again. Its own date puts
it outside the window, so nothing else would ever go back for it.

- Post refresh gets this for free: `expandQuoted` archives the embedded original
  on sight, and that copy is a current snapshot.
- Comment refresh needs a query, `listQuotedTargets` — on the `quote_post_id`
  index added in v7 — which collects the targets referenced from inside the
  window and keeps the ones older than it. They are drained as a third phase
  after the window itself.

### Pausing is not losing

A refresh saves where it got to, per window, in `UpdateState.resume`.

Without it a refresh restarts from the top of the feed every time. Over a month
that is wasteful; over a **full re-scrape of several years it is fatal** — the
job could only ever finish in one uninterrupted sitting, which for a
multi-hundred-thousand-record archive is not a thing that happens.

| | |
|---|---|
| Posts | the feed cursor, plus the oldest date reached, saved every page |
| Comments | the queue position, saved every window of 250 |

Three rules keep it honest:

- **The window is stored with the position.** A resume is only valid for the
  range it was taken from; ask for different dates and it is discarded rather
  than silently resuming into the wrong place.
- **A resume never moves the watermark.** Only completing the window does that,
  so an interrupted run cannot invent coverage.
- **Completing clears it.** A stale position would make the next run skip
  everything before it.

### Refreshing comments

Threads cost one request each, so this is the expensive one. It walks archived
posts whose `created_at` falls in the window — the compound
`[group_id, created_at]` index makes that a bounded cursor walk rather than a
scan — and re-reads each thread.

It shares the **skip-ahead recovery** with the backlog pass, and has to: a run of
unreadable posts is a property of *those posts*, not of the queue they arrived
in, so a refresh walking the same posts by date hits the same wall.

One thing it cannot share is how the queue empties.

> **The backlog is self-consuming; a date range is not.** Clearing
> `needs_comments` removes a post from the index, so the next window naturally
> starts after the work just done. Re-reading a post does not move it out of a
> date range, so asking again from the same offset returns the same rows —
> forever. The refresh phase walks a position that advances by every row handled;
> the backlog walks one that advances only past rows left unread.

That distinction was found by simulation rather than by reading: the first
version of the shared loop spun on its first window indefinitely.

When the window is done the pass falls through into the ordinary backlog, so one
run brings the recent past up to date and then continues working through
whatever has never been collected.

### A full re-scrape of an archive that predates quote linkage

The reference archive was built before `quote_post_id` existed, so none of its
records carry it. Re-reading everything is the only way to fill that in, and it
is safe to do — what follows is what actually happens to a record on the way
through, because "re-read everything" is an alarming sentence to act on without
knowing that.

| Field | On a re-read |
|---|---|
| `quote_post_id` | **Written.** `mergeArchived` spreads the incoming record, and the v7 index picks each record up as it is rewritten |
| The quoted original | **Archived**, from the copy embedded in the quoting post |
| `text`, `vote_total`, `tokens` | Overwritten — *unless* the incoming copy is a tombstone, in which case the originals are kept |
| `deleted` / `deleted_at` | Preserved once set. A post already known removed stays removed |
| `first_seen_at` | Preserved. Only `last_seen_at` moves |
| `comments_fetched_*` | Preserved, so a re-scrape of posts does not discard comment progress |
| Cached media | Preserved, including assets that have since vanished from the payload |

**Nothing is destroyed by a re-read.** The one thing to expect is a **larger
comment backlog**: re-reading a post updates `comment_count`, which re-arms
`needs_comments` wherever it has moved since the thread was collected. That is
the system working, but on a corpus this size it can add tens of thousands of
threads to the queue, which is days of comment collection.

Run it from the Full re-scrape preset, which sets the window to the archive's
oldest post, and expect to pause and resume it several times.

### Counting comments is not enough

`comment_count` cannot tell you a thread changed.

A thread that **loses one comment and gains another reports the same count.** A
count comparison calls it unchanged, and the new comment is never collected —
quietly, and permanently, since nothing would look again.

Two things fix it:

- `comments_last_comment_at` — the newest comment's timestamp, stored with the
  count. A comment posted now sorts after every comment already seen, so the pair
  catches an addition, a removal, and one of each together.
- The flag re-arms on **any** movement in the count, not only a rise. Only a rise
  used to, which assumed the only thing that happens to a thread is growth.

Neither can be evaluated without fetching the thread, which is exactly why the
refresh pass works off a date window instead of the flag.

`comments_fetched_count` also now records **what was actually stored** rather than
what the post claimed. The two diverge the moment a thread is moderated between
the post being archived and its thread being read, and the claimed number would
re-arm the flag forever against a thread that can never reach it.

### Deleted comments are flagged, not dropped

The archive's rule — a removal is recorded, not applied — was only half true for
comments. A post gets it for free, because the API returns a tombstone in its
place. A comment just stops appearing.

So a re-read compares the thread that came back against what is held, and marks
anything missing `deleted` / `deleted_at`, keeping its text. Only on a **re-read**:
a first read has nothing archived that could have gone missing, and the check is
a cursor walk per thread, not worth paying 180,000 times to learn nothing.

It is also only ever called with a thread that was **fetched successfully**. An
empty or failed response reaching it would mark an entire thread deleted over a
network blip.

---

## 7. Import, export, and merging archives

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

## 8. What is stale and why

**This section is what the refresh pass was built from.** Some of it is now
closed; what remains is marked, and the distinction matters — a closed gap still
tells you what the data looked like before it closed.

The sentence that used to describe the whole archive:

> The archive is a **record of sightings**, and almost nothing is ever sighted
> twice. A record's `vote_total` and `comment_count` are frozen at whatever they
> were the moment the crawler happened to walk past.

That is now true only of history **outside the refreshed window**. Everything a
refresh has covered is current as of that pass, and §6 says how far back that
reaches.

### G1: Scores freeze at first sighting — CLOSED inside the window

This is the one that broke "top posts of all time".

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

Any "top posts all time" feature had to fix this first, or it would confidently
report that nothing good had been posted since the archive started.

**Closed for anything a refresh has covered** (§6). It is *not* closed for
history older than every window ever run: a post from two years ago still carries
the score it had when the backfill walked past it, and no automatic pass goes
back that far. A custom window can, one slice at a time, and that is the only way
deep history gets corrected.

### G2: Nothing revisits an archived post — CLOSED

A refresh pass is exactly this mechanism. Before it existed, the only second
looks that happened at all:

1. The **3-page head overlap** each catch-up run — roughly **72 posts** past the
   frontier, and no further.
2. Whatever you happen to **open in the app**, via the passive write path.

That was the entire refresh surface: a post 80 positions below the frontier at
the time of a run was never read again by any automated path.

### G3: Comment counts freeze the same way — CLOSED

`needs_comments` is set from `comment_count > 0` **at archive time**. A post
caught fresh by the catch-up pass has no comments yet, so it is flagged `0` —
*not needing comments* — and the comment pass will never request its thread.

It re-arms only if something re-sees the post with a higher count, which means
only if it falls inside that same ~72-post head overlap on a later run.

**The practical consequence was:** posts archived by catch-up largely never got
their comments collected, and the comment archive was therefore biased toward the
older, backfilled part of the corpus. The `Threads to fetch` figure in Settings
counts only posts *known* to have replies, so it still understates the real
outstanding work.

Closed two ways: a post refresh re-reads `comment_count` and re-arms the flag, and
a comment refresh ignores the flag entirely inside its window. The subtler half —
a count that did not move because one comment was deleted and another added — is
covered in §6 under [counting comments is not
enough](#counting-comments-is-not-enough).

### G4: Deletions are almost never noticed — CLOSED inside the window

`deleted` is set when a tombstone is re-seen for a post already held. When
nothing revisited archived posts, that meant a post was only ever marked deleted
if it came down within minutes of being archived, while still inside the head
overlap. The `deleted` count was a **severe undercount** and `is:deleted`
searched a small, unrepresentative sample.

A refresh re-reads posts, so tombstones inside its window are now caught. Two
caveats worth keeping:

- **Comments needed separate machinery.** They have no tombstone — a deleted
  comment simply stops appearing — so they are detected by comparing a re-read
  thread against what is held (§6).
- **Absence is still not treated as deletion for posts.** A post missing from a
  re-paged feed could have been removed, or the page could have been served
  inconsistently. Inferring deletion from absence would mass-flag on a single bad
  page, so only an actual tombstone counts. Deletions of posts too old for any
  window therefore remain unknown.

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

### G6: `markCommentsFetched` recorded a stale count — CLOSED

It was called with `post.comment_count` as read from the **archive record**,
rather than with the number of comments actually returned. If comments had been
deleted so the thread came back shorter, the recorded count was too high and the
post could never re-arm — it would have had to exceed a number that was never
real.

It now records `comments.length`, plus `comments_fetched_at` and
`comments_last_comment_at`. See §6.

### G7: No index supports "what have I not refreshed recently"

The 15 indexes cover `group_id`, `created_at`, `type`, `parent_post_id`,
`has_media`, `index_code`, `media_pending`, `author`, `deleted`, `tokens`,
`[group_id, created_at]`, `needs_comments`, `is_reply`, `vote_total` and
`quote_post_id`.

**`last_seen_at` and `first_seen_at` are not indexed**, so *which records have
not been checked since X* is a full scan.

**The refresh pass sidesteps this rather than closing it.** It selects by
`created_at` — when the post was written — using the existing compound
`[group_id, created_at]` index, not by when it was last checked. That is a
different question with a useful answer: recency of *authorship* is a good proxy
for where change happens, since scores and threads move for days after a post
lands and rarely after that.

The remaining cost is that a refresh cannot skip what it already refreshed
minutes ago, so overlapping runs redo work. Closing it properly is still a
`DB_VERSION` bump and a migration over a large live store, and is still worth
doing **once**, deliberately, rather than twice.

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

## 9. What the refresh pass decided, and what it left open

The open questions §8 posed, and how they were answered:

1. **What to re-read.** Posts are re-paged from `recent` rather than fetched by
   id. `getPost` per post would have cost one request each — comment-pass
   pricing for feed-pass work — where a page refreshes ~24 at once. Re-paging
   `top` with a `period` was the cheaper-still option and was rejected: it only
   ever returns what the server still ranks, so it would have refreshed the
   popular posts and silently skipped everything else.
2. **How to choose.** By `created_at`, on the existing compound index, rather
   than by when a record was last checked — see
   [G7](#g7-no-index-supports-what-have-i-not-refreshed-recently). The migration
   that would answer the better question is still unpaid, and still worth paying
   once rather than twice.
3. **What a re-read implies.** Nothing new: `mergeArchived` already handled
   scores, tombstones and the comment flag, and the pass only had to feed it.
   That prediction held — the merge rules were not touched.
4. **Quote links back-fill for free.** Confirmed: a re-read writes
   `quote_post_id` and archives the embedded original, so a refreshed window
   gains quote linkage that the pre-v7 archive never had
   ([G5](#g5-quote-linkage-exists-now-but-only-going-forward--closed-with-a-tail)).
5. **Comments re-arm for free.** Also confirmed, and it turned out to be the
   weaker half of the answer: re-reading a post updates `comment_count`, but a
   count is not evidence a thread is unchanged. That is what forced
   `comments_last_comment_at` and the thread-diff for removals (§6).
6. **How far back to go.** A month of overlap per run, rolling. Deliberately not
   "everything": scores stop moving after days, comment counts after longer,
   deletions never. A rolling window keeps the recent past honest at bounded
   cost, and a custom range exists for the cases it cannot reach.

### Still open

- **Deep history is never refreshed automatically.** Anything older than every
  window ever run keeps the score it was archived with. Only a custom range
  reaches it, one slice at a time.
- **Post deletions outside a window are unknowable**, and absence from a feed is
  deliberately not treated as evidence ([G4](#g4-deletions-are-almost-never-noticed--closed-inside-the-window)).
- **Overlapping runs redo work**, because selection is by authorship date rather
  than by when a record was last checked ([G7](#g7-no-index-supports-what-have-i-not-refreshed-recently)).
- **No scheduler.** A refresh happens when someone starts one. The watermark
  makes an occasional run correct, not automatic — and a run that never happens
  leaves a window that only grows.
