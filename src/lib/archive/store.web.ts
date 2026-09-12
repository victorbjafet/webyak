import { type ArchiveQuery } from './query';
import {
  mergeArchived,
  toArchived,
  tokenize,
  type ArchiveStats,
  type ArchivedContent,
  type CrawlState,
} from './types';

import type { PostOrComment } from '@/api/types';

/**
 * The archive, on IndexedDB.
 *
 * **Why not the storage module used everywhere else:** that is `localStorage` on
 * web, which is ~5 MB, synchronous, and string-only. This has to hold every post
 * a community has ever shown — hundreds of thousands of records plus optional
 * image and video bytes. IndexedDB is the only browser store with the capacity
 * (hundreds of MB to GB, quota-negotiated), real indexes to search on, and
 * native Blob support so media needs no base64 round trip.
 *
 * Written against the raw API rather than a wrapper library: the surface used
 * here is small, and this is the kind of code that outlives its dependencies.
 */

const DB_NAME = 'webyak-archive';
const DB_VERSION = 6;

const CONTENT = 'content';
const MEDIA = 'media';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const upgrade = request.transaction;
      const from = (event as IDBVersionChangeEvent).oldVersion;

      if (!db.objectStoreNames.contains(CONTENT)) {
        const store = db.createObjectStore(CONTENT, { keyPath: 'id' });
        // Every index here exists to answer a question the settings screen or
        // the future search asks. `has_media`/`media_pending` are 0/1 because
        // **IndexedDB cannot index booleans** — a `false` never appears in an
        // index, so the back-fill query would silently return nothing.
        store.createIndex('group_id', 'group_id');
        store.createIndex('created_at', 'created_at');
        store.createIndex('type', 'type');
        store.createIndex('parent_post_id', 'parent_post_id');
        store.createIndex('has_media', 'has_media');
        // The whole reason /p/<code> can work at all: a share code is otherwise
        // unresolvable, but any post this client has *ever* seen is in here.
        store.createIndex('index_code', 'index_code');
        store.createIndex('media_pending', 'media_pending');
        store.createIndex('author', 'author');
        store.createIndex('deleted', 'deleted');
        // A `multiEntry` index puts **one entry per array element**, which is
        // exactly an inverted index — and it is native, so search costs no
        // dependency and no separate table. See `searchArchive`.
        store.createIndex('tokens', 'tokens', { multiEntry: true });
        // Compound, so "the oldest post I hold for this community" is a single
        // cursor step rather than a scan of everything in that group.
        store.createIndex('group_created', ['group_id', 'created_at']);
        store.createIndex('needs_comments', 'needs_comments');
        store.createIndex('is_reply', 'is_reply');
        // "Top posts of all time" and "anything above N" are the first things
        // anyone asks a corpus like this, and both are unanswerable without it:
        // there is no term to look up, so they would otherwise scan everything.
        store.createIndex('vote_total', 'vote_total');
      }

      if (!db.objectStoreNames.contains(MEDIA)) {
        db.createObjectStore(MEDIA, { keyPath: 'asset_id' });
      }

      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }

      /*
        v1 → v2: search and deletion tracking.

        Records written under v1 have no `tokens` and no `deleted`, so they would
        be invisible to both the search index and the deleted filter — silently,
        which is the worst kind of missing. They are rewritten here rather than
        left to be fixed the next time each post happens to be seen again.

        Safe to do inline: an upgrade transaction blocks all other access, and
        the archive is days old, so this is a small walk. A migration on a large
        store would need a background pass instead.
      */
      if (from > 0 && from < 6 && upgrade) {
        const store = upgrade.objectStore(CONTENT);
        if (!store.indexNames.contains('tokens')) {
          store.createIndex('tokens', 'tokens', { multiEntry: true });
        }
        if (!store.indexNames.contains('deleted')) {
          store.createIndex('deleted', 'deleted');
        }

        if (!store.indexNames.contains('group_created')) {
          store.createIndex('group_created', ['group_id', 'created_at']);
        }
        if (!store.indexNames.contains('needs_comments')) {
          store.createIndex('needs_comments', 'needs_comments');
        }
        if (!store.indexNames.contains('is_reply')) {
          store.createIndex('is_reply', 'is_reply');
        }
        if (!store.indexNames.contains('vote_total')) {
          store.createIndex('vote_total', 'vote_total');
        }

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value as ArchivedContent;
          if (
            !record.tokens ||
            record.deleted === undefined ||
            record.needs_comments === undefined ||
            record.is_reply === undefined
          ) {
            cursor.update({
              ...record,
              deleted: record.deleted ?? 0,
              // Posts archived before the comment pass existed: mark the ones
              // with replies as outstanding, so the backfill picks them up
              // rather than skipping the entire existing archive.
              needs_comments:
                record.needs_comments ??
                (record.type === 'post' && (record.comment_count ?? 0) > 0 ? 1 : 0),
              is_reply:
                record.is_reply ??
                (record.reply_post_id && record.parent_post_id
                  ? record.reply_post_id !== record.parent_post_id
                    ? 1
                    : 0
                  : 0),
              tokens: record.tokens ?? tokenize(record.text, record.author, record.alias),
            });
          }
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the archive.'));
    // Another tab holding an old version open. Failing loudly beats hanging.
    request.onblocked = () => reject(new Error('The archive is open in another tab.'));
  });

  return dbPromise;
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode);
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Archive write aborted.'));
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const archiveAvailable = true;

/**
 * Records posts and comments, merging with anything already held.
 *
 * Read-then-write inside **one** transaction, so a feed refresh and a crawl page
 * landing together cannot interleave into a lost update. Returns how many rows
 * were new, which is what makes the crawler able to say "this page was all
 * duplicates" and stop.
 */
export async function archiveContent(
  items: (PostOrComment | null | undefined)[],
): Promise<{ added: number; updated: number }> {
  const records = items
    .map((item) => (item ? toArchived(item) : null))
    .filter((r): r is ArchivedContent => Boolean(r));
  if (records.length === 0) return { added: 0, updated: 0 };

  const db = await openDb();
  const transaction = tx(db, [CONTENT], 'readwrite');
  const store = transaction.objectStore(CONTENT);

  let added = 0;
  let updated = 0;

  await Promise.all(
    records.map(async (record) => {
      const existing = (await asPromise(store.get(record.id))) as ArchivedContent | undefined;
      if (existing) {
        updated += 1;
        store.put(mergeArchived(existing, record));
      } else {
        added += 1;
        store.put(record);
      }
    }),
  );

  await done(transaction);
  return { added, updated };
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  const db = await openDb();
  const transaction = tx(db, [CONTENT, MEDIA], 'readonly');
  const content = transaction.objectStore(CONTENT);
  const media = transaction.objectStore(MEDIA);

  const [posts, comments, deleted, needsComments, withMedia, mediaPending, mediaCached] =
    await Promise.all([
    asPromise(content.index('type').count(IDBKeyRange.only('post'))),
    asPromise(content.index('type').count(IDBKeyRange.only('comment'))),
    asPromise(content.index('deleted').count(IDBKeyRange.only(1))),
    asPromise(content.index('needs_comments').count(IDBKeyRange.only(1))),
    asPromise(content.index('has_media').count(IDBKeyRange.only(1))),
    asPromise(content.index('media_pending').count(IDBKeyRange.only(1))),
    asPromise(media.count()),
  ]);

  // Oldest and newest by walking one index from each end — cheap, no full scan.
  const edge = async (direction: IDBCursorDirection) => {
    const cursor = await asPromise(content.index('created_at').openCursor(null, direction));
    return (cursor?.value as ArchivedContent | undefined)?.created_at;
  };
  const [oldest, newest] = await Promise.all([edge('next'), edge('prev')]);

  let bytes: number | undefined;
  let quota: number | undefined;
  try {
    const estimate = await navigator.storage?.estimate?.();
    bytes = estimate?.usage;
    quota = estimate?.quota;
  } catch {
    /* not supported, or blocked — the counts above are the useful part anyway */
  }

  return {
    posts,
    comments,
    deleted,
    needsComments,
    withMedia,
    mediaPending,
    mediaCached,
    bytes,
    quota,
    oldest,
    newest,
  };
}

/** Crawl progress, per community, so a run resumes instead of restarting. */
export async function getCrawlState(groupId: string): Promise<CrawlState | undefined> {
  const db = await openDb();
  const store = tx(db, [META], 'readonly').objectStore(META);
  const row = (await asPromise(store.get(`crawl:${groupId}`))) as
    | { key: string; value: CrawlState }
    | undefined;
  return row?.value;
}

export async function setCrawlState(state: CrawlState): Promise<void> {
  const db = await openDb();
  const transaction = tx(db, [META], 'readwrite');
  transaction.objectStore(META).put({ key: `crawl:${state.group_id}`, value: state });
  await done(transaction);
}

export async function listCrawlStates(): Promise<CrawlState[]> {
  const db = await openDb();
  const store = tx(db, [META], 'readonly').objectStore(META);
  const rows = (await asPromise(store.getAll())) as { key: string; value: CrawlState }[];
  return rows.filter((r) => r.key.startsWith('crawl:')).map((r) => r.value);
}

/**
 * Streams the whole archive out as NDJSON — one JSON object per line.
 *
 * **Not one big JSON array.** An array has to be complete before it is valid, so
 * exporting hundreds of thousands of records would mean holding the entire
 * serialized blob in memory at once and would produce a file nothing can read
 * incrementally. NDJSON streams, survives truncation, and every line is
 * independently parseable — which is what a corpus you intend to search later
 * actually wants.
 *
 * A cursor walks the store so records are serialized in batches rather than all
 * at once.
 */
export async function exportArchive(onProgress?: (rows: number) => void): Promise<Blob> {
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);

  const parts: string[] = [
    JSON.stringify({
      _format: 'webyak-archive/ndjson-v1',
      _exported_at: new Date().toISOString(),
      _note: 'One JSON object per line after this header.',
    }) + '\n',
  ];

  let rows = 0;
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      parts.push(JSON.stringify(cursor.value) + '\n');
      rows += 1;
      if (rows % 500 === 0) onProgress?.(rows);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  onProgress?.(rows);
  return new Blob(parts, { type: 'application/x-ndjson' });
}

/** Wipes everything. Used by the settings screen, behind a confirm. */
export async function clearArchive(): Promise<void> {
  const db = await openDb();
  const transaction = tx(db, [CONTENT, MEDIA, META], 'readwrite');
  transaction.objectStore(CONTENT).clear();
  transaction.objectStore(MEDIA).clear();
  transaction.objectStore(META).clear();
  await done(transaction);
}


/**
 * Resolve a share code against everything ever archived.
 *
 * This is what makes `/p/<code>` work across reloads. The API cannot look a code
 * up (docs/API.md#blocker-1), and the previous approach — scanning the in-memory
 * query cache — only worked within a single session, and only for posts still
 * held in a live query.
 *
 * The archive is indexed on `index_code`, so this is a single index lookup over
 * the entire corpus rather than a scan.
 */
export async function findArchivedByCode(code: string): Promise<ArchivedContent | undefined> {
  if (!code) return undefined;
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);
  return (await asPromise(store.index('index_code').get(code))) as ArchivedContent | undefined;
}

export async function findArchivedById(id: string): Promise<ArchivedContent | undefined> {
  if (!id) return undefined;
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);
  return (await asPromise(store.get(id))) as ArchivedContent | undefined;
}

/* ------------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------------ */

export interface SearchResult {
  records: ArchivedContent[];
  /** How many rows were examined — the honest cost of the query. */
  scanned: number;
  /** Which index served it, so a slow query can be understood rather than guessed at. */
  strategy: string;
  truncated: boolean;
  ms: number;
}

/**
 * Runs a parsed query.
 *
 * ## Two strategies, chosen by what the query contains
 *
 * **With search terms**, the `tokens` multiEntry index does the work: each term
 * resolves to a set of ids via `getAllKeys`, the sets are intersected, and
 * excluded terms are *subtracted* — also an index lookup, so a `-word` narrows
 * the candidate set instead of forcing a scan. Only the survivors are read as
 * full records, because deserializing is the expensive part of IndexedDB.
 *
 * **Without terms** — `from:someone since:2026-01-01`, say — there is nothing to
 * look up, so the query rides the most selective index it can:
 *
 * | Query contains | Index used |
 * |---|---|
 * | community + dates | `[group_id, created_at]`, bounded both ends |
 * | an author | `author` |
 * | `is:deleted` | `deleted` |
 * | `has:media` | `has_media` |
 * | dates only | `created_at`, bounded |
 * | nothing selective | `created_at` descending, stopping at the limit |
 *
 * The last row is the only one that can touch a lot of rows, and it walks
 * newest-first and stops at the limit, so it is bounded by the result count
 * rather than by the archive size.
 *
 * Terms are matched as **prefixes** (`hokie` finds `hokies`); phrases are
 * verified against the record text, since a token index knows which words are
 * present but not their order.
 */
export async function searchArchive(query: ArchiveQuery): Promise<SearchResult> {
  const startedAt = Date.now();
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);

  let candidates: Set<string> | undefined;
  let strategy = '';
  let scanned = 0;

  const keysFor = async (term: string): Promise<string[]> =>
    (await asPromise(
      store.index('tokens').getAllKeys(IDBKeyRange.bound(term, `${term}\uffff`)),
    )) as string[];

  // Positive terms: intersect. A phrase also contributes its words, so the
  // index narrows before the text is checked.
  const required = [...query.terms, ...query.phrases.flatMap((phrase) => tokenize(phrase))];

  // Explicit loops rather than spread-and-filter: intersecting sets this way
  // avoids allocating an intermediate array per term, which matters when a
  // common word matches tens of thousands of ids.
  const intersect = (into: Set<string>, keys: Set<string>) => {
    const next = new Set<string>();
    for (const id of into) if (keys.has(id)) next.add(id);
    return next;
  };

  for (const term of required) {
    const keys = new Set(await keysFor(term));
    candidates = candidates ? intersect(candidates, keys) : keys;
    if (candidates.size === 0) {
      return {
        records: [],
        scanned: 0,
        strategy: 'tokens (no match)',
        truncated: false,
        ms: Date.now() - startedAt,
      };
    }
  }

  // Negative terms: subtract, also via the index — so `-word` narrows the
  // candidate set rather than forcing a scan to reject rows afterwards.
  if (candidates) {
    for (const term of query.excludedTerms) {
      const keys = new Set(await keysFor(term));
      const next = new Set<string>();
      for (const id of candidates) if (!keys.has(id)) next.add(id);
      candidates = next;
    }
    strategy = `tokens (${required.length} term${required.length === 1 ? '' : 's'})`;
  }

  const records: ArchivedContent[] = [];
  let truncated = false;

  if (candidates) {
    for (const id of candidates) {
      const record = (await asPromise(store.get(id))) as ArchivedContent | undefined;
      scanned += 1;
      if (record && matchesQuery(record, query)) records.push(record);
    }
  } else {
    // No terms — pick the most selective index available.
    let source: IDBRequest<IDBCursorWithValue | null>;
    // Set when the cursor already yields rows in the requested order, which is
    // what lets the walk stop at the limit instead of ranking afterwards.
    let preSorted = query.sort === 'old' || query.sort === 'new';

    if (query.sort === 'top' || query.minScore !== undefined) {
      // Descending by score: `sort:top` arrives pre-ranked, and `min_score`
      // becomes a bounded range rather than a predicate applied to everything.
      strategy = 'vote_total index';
      source = store
        .index('vote_total')
        .openCursor(
          IDBKeyRange.bound(query.minScore ?? -Infinity, query.maxScore ?? Infinity),
          'prev',
        );
      preSorted = query.sort === 'top';
    } else if (query.group === undefined && query.author) {
      strategy = 'author index';
      source = store.index('author').openCursor(IDBKeyRange.only(query.author));
    } else if (query.deleted === 'only') {
      strategy = 'deleted index';
      source = store.index('deleted').openCursor(IDBKeyRange.only(1));
    } else if (query.hasMedia) {
      strategy = 'has_media index';
      source = store.index('has_media').openCursor(IDBKeyRange.only(1));
    } else if (query.since || query.until) {
      strategy = 'created_at range';
      source = store
        .index('created_at')
        .openCursor(
          IDBKeyRange.bound(query.since ?? '', query.until ?? '\uffff'),
          query.sort === 'old' ? 'next' : 'prev',
        );
    } else {
      strategy = 'created_at scan';
      source = store.index('created_at').openCursor(null, query.sort === 'old' ? 'next' : 'prev');
    }

    await new Promise<void>((resolve, reject) => {
      source.onsuccess = () => {
        const cursor = source.result;
        if (!cursor) {
          resolve();
          return;
        }
        scanned += 1;
        const record = cursor.value as ArchivedContent;
        if (matchesQuery(record, query)) records.push(record);
        // Only safe to stop early when the cursor is already in the requested
        // order — otherwise the best results might still be ahead.
        if (preSorted && records.length >= query.limit) {
          truncated = true;
          resolve();
          return;
        }
        cursor.continue();
      };
      source.onerror = () => reject(source.error);
    });
  }

  records.sort((a, b) => {
    if (query.sort === 'top') return (b.vote_total ?? 0) - (a.vote_total ?? 0);
    if (query.sort === 'old') return a.created_at < b.created_at ? -1 : 1;
    return a.created_at > b.created_at ? -1 : 1;
  });

  if (records.length > query.limit) {
    truncated = true;
    records.length = query.limit;
  }

  return { records, scanned, strategy, truncated, ms: Date.now() - startedAt };
}

/**
 * Every filter the index could not apply.
 *
 * Phrases are checked here rather than in the index: a token index knows which
 * words a record contains, not the order they appear in, so `"grey market"`
 * needs the text itself to distinguish it from a post containing both words
 * apart.
 */
function matchesQuery(record: ArchivedContent, query: ArchiveQuery): boolean {
  if (query.deleted === 'only' && !record.deleted) return false;
  if (!query.deleted && record.deleted) return false;

  if (query.type && record.type !== query.type) return false;
  if (query.isReply !== undefined && Boolean(record.is_reply) !== query.isReply) return false;

  if (query.author && record.author?.toLowerCase() !== query.author.toLowerCase()) return false;
  if (query.group && !(record.group_name ?? '').toLowerCase().includes(query.group)) return false;

  if (query.since && record.created_at < query.since) return false;
  if (query.until && record.created_at > query.until) return false;

  if (query.minScore !== undefined && (record.vote_total ?? 0) < query.minScore) return false;
  if (query.maxScore !== undefined && (record.vote_total ?? 0) > query.maxScore) return false;

  if (query.hasMedia !== undefined) {
    const has = Boolean(record.has_media);
    if (has !== query.hasMedia) return false;
    if (query.hasMedia && query.mediaType) {
      if (!record.media?.some((m) => m.type === query.mediaType)) return false;
    }
  }

  const text = record.text.toLowerCase();
  for (const phrase of query.phrases) if (!text.includes(phrase)) return false;
  for (const phrase of query.excludedPhrases) if (text.includes(phrase)) return false;

  // Excluded single words, for the no-term path where the index did not subtract
  // them. Prefix-matched, to stay consistent with how terms are included.
  for (const term of query.excludedTerms) {
    if (record.tokens?.some((token) => token.startsWith(term))) return false;
  }

  return true;
}

/* ------------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------------ */

export interface ImportProgress {
  lines: number;
  added: number;
  merged: number;
  skipped: number;
  bytes: number;
  totalBytes: number;
  finished?: boolean;
  error?: string;
}

/** Rows per transaction. Large enough to be fast, small enough to stay responsive. */
const IMPORT_BATCH = 500;

/**
 * Fills in whatever a record from an older export is missing.
 *
 * Exports are a durable format and older ones must keep working, so every field
 * added since is derived here rather than assumed. `tokens` in particular: a
 * v1 export predates search entirely, and importing without regenerating them
 * would put records in the archive that are invisible to every query — the
 * quiet kind of broken.
 */
function normalizeImported(raw: Record<string, unknown>): ArchivedContent | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;

  const parentPostId = typeof raw.parent_post_id === 'string' ? raw.parent_post_id : undefined;
  const replyPostId = typeof raw.reply_post_id === 'string' ? raw.reply_post_id : undefined;
  const isComment = raw.type === 'comment' || Boolean(parentPostId);
  const commentCount = typeof raw.comment_count === 'number' ? raw.comment_count : undefined;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const seen = typeof raw.last_seen_at === 'number' ? raw.last_seen_at : Date.now();

  return {
    id,
    type: isComment ? 'comment' : 'post',
    group_id: typeof raw.group_id === 'string' ? raw.group_id : '',
    group_name: typeof raw.group_name === 'string' ? raw.group_name : undefined,
    parent_post_id: parentPostId,
    reply_post_id: replyPostId,
    reply_comment_post_id:
      typeof raw.reply_comment_post_id === 'string' ? raw.reply_comment_post_id : undefined,
    is_reply:
      (raw.is_reply as 0 | 1) ??
      (isComment && replyPostId && parentPostId && replyPostId !== parentPostId ? 1 : 0),
    index_code: typeof raw.index_code === 'string' ? raw.index_code : undefined,
    text,
    alias: typeof raw.alias === 'string' ? raw.alias : undefined,
    author: typeof raw.author === 'string' ? raw.author : undefined,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    vote_total: typeof raw.vote_total === 'number' ? raw.vote_total : 0,
    comment_count: commentCount,
    media: Array.isArray(raw.media) ? (raw.media as ArchivedContent['media']) : [],
    has_media: (raw.has_media as 0 | 1) ?? (Array.isArray(raw.media) && raw.media.length ? 1 : 0),
    media_pending:
      (raw.media_pending as 0 | 1) ?? (Array.isArray(raw.media) && raw.media.length ? 1 : 0),
    first_seen_at: typeof raw.first_seen_at === 'number' ? raw.first_seen_at : seen,
    last_seen_at: seen,
    deleted: (raw.deleted as 0 | 1) ?? 0,
    deleted_at: typeof raw.deleted_at === 'number' ? raw.deleted_at : undefined,
    needs_comments:
      (raw.needs_comments as 0 | 1) ?? (!isComment && (commentCount ?? 0) > 0 ? 1 : 0),
    comments_fetched_count:
      typeof raw.comments_fetched_count === 'number' ? raw.comments_fetched_count : undefined,
    tokens: Array.isArray(raw.tokens)
      ? (raw.tokens as string[])
      : tokenize(text, typeof raw.author === 'string' ? raw.author : undefined,
          typeof raw.alias === 'string' ? raw.alias : undefined),
  };
}

/**
 * Restores an exported archive, merging into whatever is already held.
 *
 * **Streamed, not read into memory.** A real export is ~94 MB; `file.text()`
 * would materialise all of it as one string before a single record was written,
 * and the parsed objects on top of that. This reads the blob in chunks, splits
 * on newlines, and writes in batches, so peak memory is a batch rather than a
 * corpus.
 *
 * Merging respects *recency, not argument order*: whichever copy was seen more
 * recently wins the fields that change, so importing an old export over a newer
 * archive cannot roll back vote counts or resurrect a post already recorded as
 * deleted.
 *
 * Unparseable lines are counted and skipped rather than aborting — a truncated
 * export should restore everything up to the truncation, which is most of the
 * reason NDJSON was chosen over a single JSON array.
 */
export async function importArchive(
  file: Blob,
  onProgress?: (progress: ImportProgress) => void,
  shouldStop?: () => boolean,
): Promise<ImportProgress> {
  const progress: ImportProgress = {
    lines: 0,
    added: 0,
    merged: 0,
    skipped: 0,
    bytes: 0,
    totalBytes: file.size,
  };

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let batch: ArchivedContent[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const db = await openDb();
    const transaction = tx(db, [CONTENT], 'readwrite');
    const store = transaction.objectStore(CONTENT);

    await Promise.all(
      batch.map(async (record) => {
        const existing = (await asPromise(store.get(record.id))) as ArchivedContent | undefined;
        if (!existing) {
          progress.added += 1;
          store.put(record);
          return;
        }
        progress.merged += 1;
        // Older observation first, so the newer one wins the mutable fields.
        store.put(
          existing.last_seen_at >= record.last_seen_at
            ? mergeArchived(record, existing)
            : mergeArchived(existing, record),
        );
      }),
    );

    await done(transaction);
    batch = [];
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    progress.lines += 1;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      // The header line carries metadata, not a record.
      if (parsed._format || !parsed.id) return;
      const record = normalizeImported(parsed);
      if (record) batch.push(record);
      else progress.skipped += 1;
    } catch {
      progress.skipped += 1;
    }
  };

  try {
    for (;;) {
      if (shouldStop?.()) break;
      const { done: finished, value } = await reader.read();
      if (finished) break;

      progress.bytes += value.byteLength;
      carry += decoder.decode(value, { stream: true });

      const lines = carry.split('\n');
      // The last piece may be a partial line; hold it for the next chunk.
      carry = lines.pop() ?? '';
      for (const line of lines) handleLine(line);

      if (batch.length >= IMPORT_BATCH) {
        await flush();
        onProgress?.({ ...progress });
      }
    }

    handleLine(carry);
    await flush();
    progress.finished = true;
  } catch (error) {
    progress.error = error instanceof Error ? error.message : String(error);
  } finally {
    reader.releaseLock();
  }

  onProgress?.({ ...progress });
  return progress;
}


/**
 * Walks every record once, in primary-key order.
 *
 * A callback rather than a returned array: the integrity check reads the whole
 * archive, and materialising 157,000 objects to hand back would cost more memory
 * than the analysis itself. The visitor accumulates counters and lets each
 * record go.
 */
export async function forEachRecord(
  visit: (record: ArchivedContent) => void,
  onProgress?: (seen: number) => void,
): Promise<void> {
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);
  let seen = 0;

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      visit(cursor.value as ArchivedContent);
      seen += 1;
      if (seen % 5000 === 0) onProgress?.(seen);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  onProgress?.(seen);
}
