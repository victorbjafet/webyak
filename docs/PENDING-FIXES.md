# Pending fixes — a queue to apply

Written 2026-09-27 as a handoff, so the fixes can be applied in a later session
with none of the conversation that found them. **Nothing here has been applied
yet.** Everything below was verified against the code as it stood at commit
`dde71fa`; if the code has moved, re-check the line numbers, not the reasoning.

Two sources:

- **Comments** — deleted comments are never flagged, and a re-read overwrites
  their text. Found by measuring the user's own archive exports
  ([API.md](API.md#deleted-comments-stay-in-the-thread-as-comment-deleted)).
- **offsides 1.0** — a fresh pass after its first release in nine months
  ([OFFSIDES.md](OFFSIDES.md#round-7--the-10-release-and-the-end-of-the-project-2026-09-27)).

**How to use this file:** work top to bottom — the order matters for the
comment fixes. Delete each section as it lands, updating the docs it names in
the same commit. When the file is empty, delete it along with its pointers: the
row in [CLAUDE.md](../CLAUDE.md), the line at the top of [PLAN.md](../PLAN.md),
and the memory entry `pending-fixes-queue`.

---

## Before touching any code

1. **Take a fresh export** from Settings → Archive. The in-browser archive holds
   ~600k records and the user cannot recreate it; the export is the only backup.
2. **Make sure no scrape is running.** Saving any source file hot-reloads the
   dev server, which kills an in-progress crawl. Ask first.
3. **No comment refreshes until F1 lands.** Every re-read of a comment deleted
   since it was archived overwrites its real text with the placeholder.
4. **Rebuild the test harness** ([Appendix A](#appendix-a--rebuilding-the-test-harness)).
   The scratchpad it lived in does not survive between sessions. Every data fix
   below gets a harness test that **fails without the fix** before it is
   trusted — a green `tsc`/lint/build has shipped two runtime failures in this
   project already.

---

## Critical — comments (data loss)

### F1 — Recognise `"Comment Deleted"` as a tombstone

**Problem.** A deleted comment stays in its thread with its text replaced by
`"Comment Deleted"`, zero votes and the username stripped (it keeps replies
attached). The archive only recognises `"Deleted Post"`, which nothing has ever
been seen to send. So deleted comments are never flagged, and a re-read of a
comment archived *before* its deletion overwrites the real text.

**Evidence** (2026-09-27 export, 232,062 comments): 309 comments with text
exactly `"Comment Deleted"`, all with `vote_total` 0, none with an author, 170
still anchoring replies; 0 comments flagged deleted; 0 records anywhere with
`"Deleted Post"`; no placeholder-shaped post texts at all (posts are omitted,
never tombstoned). One comment's real text was already overwritten — it survives
only in an older export (F4).

**Change** — `src/lib/archive/types.ts`:

- Replace `const DELETED_PLACEHOLDER = 'Deleted Post'` (line 280) with a set and
  a helper, exported so the UI can use it too (F5):

  ```ts
  /** Texts the API substitutes for removed content. "Comment Deleted" is
   *  confirmed from 309 archived placeholders; "Deleted Post" was never seen,
   *  and is kept only so nothing that ever did send it is lost. */
  const TOMBSTONE_TEXTS = new Set(['Comment Deleted', 'Deleted Post']);
  export function isTombstoneText(text: string | undefined): boolean {
    return Boolean(text && TOMBSTONE_TEXTS.has(text));
  }
  ```

- `toArchived` (lines 346–348): use `isTombstoneText(item.text)` in all three
  places.
- `mergeArchived`, `incomingIsTombstone` (line 381–382):
  `isTombstoneText(incoming.text) && !isTombstoneText(existing.text)`.
- **Also keep attachments on a tombstone.** `mergeArchived` rebuilds `media`
  from `incoming.media`, keeping only *cached* held assets — so a placeholder,
  which carries no attachments, erases the record of the original's image. When
  `incomingIsTombstone`, use `existing.media` (and derive `has_media` /
  `media_pending` from it as now).

Already correct, no change needed: text, `vote_total` and `tokens` are kept on
`incomingIsTombstone`; `author` falls back through `keep()` because the
placeholder has none.

**Test** (harness): archive a comment with real text and an image; merge in the
same id with text `"Comment Deleted"`, `vote_total` 0, no identity, no assets.
Expect: text, score, tokens, author and media kept; `deleted: 1`,
`deleted_via: 'tombstone'`. A first sighting that is already `"Comment Deleted"`
must be flagged.

**Docs after:** API.md — replace the "⛔ The archive does not recognise this
yet" paragraph with what the archive now does. ARCHIVE.md §4 — the `tombstone`
row of the `deleted_via` table; the "Deleted comments are flagged, not dropped"
section's ⛔ note. PLAN — tick the comment item in the archive interlude.

### F2 — Placeholder text counts as deletion when merging archives

**Problem.** `mergeArchived`'s deletion block (line 408) keys off
`incoming.deleted`. On import, the record already in the browser can carry
placeholder text with `deleted: 0` — archived before F1 — so the merge would
restore nothing and flag nothing.

**Change** — line 408: `if (incoming.deleted || isTombstoneText(incoming.text))`,
with `deleted_via` falling back to `'tombstone'` when the incoming record has
none. `deleted_at` already falls back to `incoming.last_seen_at`.

**Test**: base record with real text and `last_seen_at` 1000, incoming record
with `"Comment Deleted"`, `deleted: 0`, `last_seen_at` 2000 — expect real text
kept and `deleted: 1`. This is exactly what F4's import does.

### F3 — Flag the placeholders already in the archive

**Problem.** F1 only acts on new sightings. The 309 records already stored as
`"Comment Deleted"` stay unflagged until something re-reads them, and most never
will be.

**Change** — `src/lib/archive/store.web.ts`: a `flagTombstonedRecords()` that
returns how many it flagged.

- Text is not indexed, so it is one full read. Do it as **two transactions**: a
  read-only cursor collecting `{id, last_seen_at}` for records with
  `isTombstoneText(text) && !deleted`, *then* a read-write pass over only those
  ids. Never hold a read-write transaction open across the full scan (it would
  block the crawler), and never await something else while holding one
  ([ARCHITECTURE.md](ARCHITECTURE.md#open-a-transaction-only-when-the-next-thing-you-do-is-use-it)).
- Set `deleted: 1`, `deleted_via: 'tombstone'`, `deleted_at: last_seen_at` (the
  tightest honest upper bound — we saw the placeholder then), and
  `needs_comments: 0` if the record is a post.
- **No `DB_VERSION` bump.** Nothing in the schema changes, and an upgrade
  transaction would lock a 600k-record store at startup.
- Add it to `contract.ts` and a no-op in `store.ts` — the contract assertion
  fails `tsc` otherwise, which is the point of it.
- Run it **once, automatically, in the background** — e.g. from the Settings
  screen's initial load, gated by a meta key such as `repair:tombstones:1` so it
  never scans twice — and surface the count. Pair with L2 so it stays visible.

**Test**: seed placeholder records with `deleted: 0`; run it; expect them
flagged with `deleted_at` equal to their `last_seen_at`, and a second run to flag
nothing.

### F4 — Recover the one comment whose text was overwritten

Only after F1–F3. The original text survives in
`~/Downloads/webyak/webyak-archive-2026-09-16 (5).ndjson`.

1. Run [Appendix B](#appendix-b--measuring-and-recovering-from-exports) with
   `--extract recovery.ndjson`. It finds every placeholder in the newest export
   whose real text exists in an older one, and writes just those records.
2. Import `recovery.ndjson` from Settings. The import merges by recency: the
   browser's record (placeholder, newer) becomes the incoming side, the file's
   (real text, older) the base, so F1 keeps the base's text and F2 flags it.
3. **The recovery file must not carry `_update_windows`.** Import restores
   watermarks and the *older* one wins a conflict — an old export's header would
   silently widen the next refresh window to that export's date. The script
   writes a bare header for this reason.

**Test first** in the harness: browser record = placeholder, `last_seen_at`
newer; import a file whose record has real text, older → text restored,
`deleted: 1`, watermark untouched.

The ids are deliberately not written here — this repo is public, and the script
finds them.

### F5 — Render deleted comments as deleted (PLAN B6)

**Live threads** — `src/components/post/comment-item.tsx`: when
`isTombstoneText(comment.text)`, render a muted, italic "Comment deleted" in
place of the text (line 72) and drop the `VoteControl` (line 78) and reply
action (line 85). Replies under it still render — that is what the placeholder
is for.

**Archived view** — `src/components/archive/archived-post.tsx` already tags
flagged comments "removed". For a placeholder with no original text captured,
show "Deleted before it was archived" rather than the literal placeholder.

Archive search needs nothing: once F3 flags them, deleted records are hidden
unless `is:deleted` / `include:deleted` is used.

---

## From the offsides 1.0 re-analysis

### O1 — Profile queries resolve `undefined` for private or renamed users

**Problem.** `useUserProfile` (`src/api/queries.ts`) and `useAuthorPhoto`
(`src/api/profile-photos.ts`, line 48) both return
`api.getUserProfile(username)`, which is sidechat.js returning `json.group` —
`undefined` whenever the API omits it. TanStack v5 rejects `undefined` as query
data and logs *"Query data cannot be undefined"* in development — the same
overlay deleted posts caused. offsides 1.0 handles an unavailable profile
explicitly (*"The user may have changed their username or made their profile
private"*), which implies the API does omit it for those. So `/u/<name>` for such
a user shows a confusing error, and every feed card by one fires the overlay.

*Evidence level:* the undefined path is certain from the code; that private and
renamed profiles take it is inferred from offsides, not observed.

**Change:**

- Add one fetcher to `src/api/client.ts` and use it in **both** hooks — they
  share `queryKeys.profile`, and two different query functions on one key means
  whichever mounts first wins:

  ```ts
  export async function getUserProfile(username: string): Promise<Profile | null> {
    const params = new URLSearchParams({ username });
    const json = await request<{ group?: Profile }>(`/v1/groups/username?${params}`);
    return json.group ?? null;
  }
  ```

  Going through `request()` also fixes the library defects on this method
  (status swallowed, `console.error`, a wrong error message — API.md's defect
  table), and makes a 401 sign the user out properly instead of looking like
  "unavailable".
- `src/app/u/[username].tsx`: `profile.data === null` → an empty state reading
  *"This profile isn't available — they may have changed their username or made
  it private."*
- `useAuthorPhoto` already reads `query.data?.icon_url`, so `null` just means no
  photo.

**Docs after:** API.md defect table — mark `getUserProfile()` bypassed.

### O2 — The bio may not load (PLAN Q10)

**Verify first:** does the You tab show the user's real bio, or "No bio yet"?
offsides reads the bio from `getUpdates().user` and falls back to the public
profile's `description` — commented *"The bio lives on the public profile
object"*. webyak reads `getUpdates().user.bio` only.

**Change, if confirmed** — in `useMyIdentity` (`src/api/queries.ts:382`): when
`user.bio` and `user.description` are both absent and `user.username` is set,
fetch the profile with O1's fetcher and use `description ?? bio`. That keeps
`identity.data.bio` the single source for the three readers
(`src/app/me/index.tsx:92`, `src/app/me/edit.tsx:59` and `:297`), and
`edit.tsx`'s `bioChanged` then compares against the real bio, so an unchanged
bio is still not re-sent.

### O3 — A "You" badge on your own comments

offsides has marked your own comments since January 2026. In
`comment-item.tsx`, show a small "You" chip beside the byline when
`comment.authored_by_user` — whether or not the comment was posted with a
username.

### O4 — Your own name links to the You tab

`src/components/post/post-card.tsx:107` and `comment-item.tsx:52` push
`/u/[username]` unconditionally. When `authored_by_user`, push `/me` instead —
your public profile is a page about you, the You tab is yours.

### O5 — Length limits (PLAN Q11): probe, then set

| | webyak | offsides | Server |
|---|---|---|---|
| Post | 300, blocks (`src/app/compose.tsx:32`) | 256 counter, does **not** block | unknown |
| Bio | 150, hard `maxLength` (`src/app/me/edit.tsx:30`) | 200 | unknown |

Extend the `/diagnostics` write probes: post 257 and 300 characters, then set a
151- and a 200-character bio; record only accept/reject with status and
`error_code`; delete the posts and **restore the original bio**. Set both
constants to what the server enforces.

---

## Probes — no code change until they answer

### P1 — `include_deleted=true`

The archive holds 800 posts flagged `deleted_via: 'missing'`; use one.

- `GET /v1/posts/get?include_deleted=true&post_id=<id>` — record the status, the
  body's top-level keys, and the post's keys (never values). If it returns the
  post with a deletion marker, deletion checks gain a direct signal instead of
  inferring one from an empty answer.
- `GET /v1/posts?group_id=<id>&type=recent&include_deleted=true` — does the
  *feed* then include deleted posts? If so, the refresh sees deletions on the
  pages it already reads, and per-post lookups disappear.

### P2 — `GET /v1/groups/login_type?email=`

From SidechatProxy, dead since 2025 (PLAN Q12). Only worth probing if
school-email registration is revisited.

---

## Low priority

### L1 — The empty-thread guard

`fetchThread` skips the removed-comment diff when a re-read thread comes back
empty, so a deleted post's comments are not all marked individually deleted.
Since deleted comments stay as placeholders, a thread whose comments were all
deleted is *not* empty, so this only matters if comments can also be removed
outright. If evidence of that appears: on an empty re-read with comments held,
look the parent up by id — gone means flag the post; live means the comments
went.

### L2 — Integrity report: unflagged placeholders

Add a structural count to `analyseArchive` (`src/lib/archive/integrity.ts`) of
records with tombstone text but `deleted: 0`, shown in the integrity panel. It
should read 0 after F3, and would catch a future placeholder the list does not
know.

---

## Checked and not needed

So nobody re-derives them:

- **Vote totals.** offsides found that removing a vote returns the *old* total.
  `useVote` never reads the returned total — it applies the delta and only
  rolls back on error — so webyak is not affected.
- **Karma entries naming a group you are not in.** offsides crashed on it;
  `karma-panel.tsx` already falls back to a label.
- **The pinned-post filter** in the crawler. Pinned posts reportedly no longer
  exist; the filter is a no-op, kept as defensive.
- **Upstreaming fixes to sidechat.js.** Its author deprecated offsides on
  2026-09-14; 2.6.6 looks final. Bypass instead.

---

## When everything above has landed

Run [Appendix B](#appendix-b--measuring-and-recovering-from-exports) against a
fresh export. Expect: no unflagged placeholders; every `"Comment Deleted"` record
flagged `deleted_via: 'tombstone'`; the recovered comment showing its real text;
and nothing left for `--extract` to write.

---

## Appendix A — rebuilding the test harness

Nothing in the repo tests the archive, so fixes are verified by running the
**real** store and crawler under Node against a real IndexedDB implementation.
Use the session scratchpad, never the repo:

```sh
mkdir -p "$SCRATCH/idb" && cd "$SCRATCH/idb"
npm init -y >/dev/null && npm install fake-indexeddb
```

Transpile the real modules, pointing their imports at local copies and at a fake
API — run from the repo root:

```js
// transpile.js — save anywhere, run FROM THE REPO ROOT: node <path>/transpile.js "$SCRATCH/idb"
// TypeScript is resolved from the working directory, not from where this file lives —
// saved in the scratchpad, a plain require('typescript') finds nothing.
const ts = require(require.resolve('typescript', { paths: [process.cwd()] }));
const fs = require('fs'), out = process.argv[2];
const opts = { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } };
const fix = (js) => js
  .replace(/require\("\.\/store"\)/g, 'require("./store.js")')
  .replace(/require\("\.\/types"\)/g, 'require("./types.js")')
  .replace(/require\("\.\/query"\)/g, 'require("./query.js")')
  .replace(/require\("\.\/contract"\)/g, '({})')
  .replace(/require\("@\/api\/types"\)/g, '({})')
  .replace(/require\("@\/api\/client"\)/g, 'require("./fakeapi.js")');
for (const [src, dst] of [['src/lib/archive/store.web.ts', 'store.js'], ['src/lib/archive/types.ts', 'types.js'],
                          ['src/lib/archive/query.ts', 'query.js'], ['src/lib/archive/crawler.ts', 'crawler.js']])
  fs.writeFileSync(`${out}/${dst}`, fix(ts.transpileModule(fs.readFileSync(src, 'utf8'), opts).outputText));
```

`fakeapi.js` exports whatever the crawler imports from `@/api/client`:
`getGroupPosts(groupId, type, cursor)`, `getPostComments(id)`, `lookupPost(id)`
and a `PostGone` class. Back them with an in-memory "world" — a list of posts,
a set of deleted ids — so a test states what Yik Yak would serve.

Four things that cost time last round:

- **Fresh database per scenario:**
  `global.indexedDB = new (require('fake-indexeddb').IDBFactory)()` before
  re-requiring the store. `deleteDatabase` blocks forever on the previous
  scenario's still-open connection.
- **Collapse the pacing:** `global.setTimeout = (fn) => realSetTimeout(fn, 0)`.
- **A test must fail without its fix.** Run it against `git show HEAD:<file>` of
  the old version once; a test that passes either way proves nothing.
- If you patch `Module._resolveFilename`, resolve every path *before* patching —
  `require.resolve` inside the hook recurses into itself.

## Appendix B — measuring and recovering from exports

The user's exports are in `~/Downloads/webyak/`. The newest holds the current
state; the older ones hold text that may since have been overwritten. Read-only
— never modify an export.

```python
# python3 tombstones.py <newest.ndjson> [--extract recovery.ndjson]
import json, sys, os, glob
TOMB = {'Comment Deleted', 'Deleted Post'}
newest = sys.argv[1]
extract = sys.argv[sys.argv.index('--extract') + 1] if '--extract' in sys.argv else None

held, flagged = {}, 0
with open(newest, encoding='utf-8') as f:
    f.readline()                                   # header
    for line in f:
        r = json.loads(line)
        if r.get('text') in TOMB:
            held[r['id']] = r
            flagged += bool(r.get('deleted'))
print(f'placeholders: {len(held)} · flagged: {flagged} · unflagged: {len(held) - flagged}')

recovered = {}
for path in sorted(glob.glob(os.path.join(os.path.dirname(newest), '*.ndjson'))):
    if os.path.samefile(path, newest): continue
    with open(path, encoding='utf-8') as f:
        f.readline()
        for line in f:
            if '"comment"' not in line and '"post"' not in line: continue
            r = json.loads(line)
            i = r.get('id')
            if i in held and i not in recovered and r.get('text') and r['text'] not in TOMB:
                recovered[i] = r
print(f'real text recoverable from older exports: {len(recovered)}')

if extract and recovered:
    with open(extract, 'w', encoding='utf-8') as out:
        # A bare header: no _update_windows, or the import would restore an old,
        # wider watermark — older windows win conflicts on import.
        out.write(json.dumps({'_format': 'webyak-archive/ndjson-v1', '_note': 'tombstone recovery'}) + '\n')
        for r in recovered.values():
            out.write(json.dumps(r) + '\n')
    print(f'wrote {len(recovered)} record(s) to {extract} — import it from Settings')
```

Print counts and placeholder strings only. The exports hold other people's
posts; none of their content belongs in a doc or a commit.
