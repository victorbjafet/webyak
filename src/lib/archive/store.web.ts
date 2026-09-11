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
const DB_VERSION = 4;

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
      if (from > 0 && from < 4 && upgrade) {
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

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value as ArchivedContent;
          if (
            !record.tokens ||
            record.deleted === undefined ||
            record.needs_comments === undefined
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

export interface SearchOptions {
  groupId?: string;
  /** `post`, `comment`, or both when omitted. */
  type?: 'post' | 'comment';
  author?: string;
  includeDeleted?: boolean;
  limit?: number;
}

/**
 * Keyword search over the whole archive.
 *
 * ## Why an index and not a scan
 *
 * The two options were scanning every record at query time, or building a token
 * index at write time. Scanning costs nothing to write and is O(n) per query —
 * and n here is intended to reach hundreds of thousands of records, each of
 * which IndexedDB must deserialize into a JS object before a single character
 * can be compared. That is seconds per keystroke, and it gets worse exactly as
 * the archive becomes worth searching.
 *
 * The index costs a tokenize per post — microseconds, on a write already
 * happening — and roughly the size of the text again on disk, which is nothing
 * beside the media it sits next to. In exchange a query touches only matching
 * records.
 *
 * No dependency was needed: **IndexedDB's `multiEntry` index is an inverted
 * index.** One index entry per array element means `tokens` maps word → records
 * natively.
 *
 * ## Why keys first, then records
 *
 * Each term is resolved with `getAllKeys` — ids only. Those sets are intersected
 * in memory, and only the surviving ids are read as full records. Deserializing
 * is the expensive part of IndexedDB, so this pays it once for the answer rather
 * than once per term for everything that matched any term.
 *
 * Terms are matched as **prefixes** (`hokie` finds `hokies`) via a bounded key
 * range, which is the one piece of stemming that surprises nobody.
 */
export async function searchArchive(
  query: string,
  options: SearchOptions = {},
): Promise<ArchivedContent[]> {
  const terms = tokenize(query);
  const limit = options.limit ?? 200;

  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);

  let ids: string[] | null = null;

  if (terms.length > 0) {
    const tokenIndex = store.index('tokens');

    for (const term of terms) {
      // Prefix range: everything from `term` up to `term￿`.
      const range = IDBKeyRange.bound(term, `${term}￿`, false, false);
      const keys = (await asPromise(tokenIndex.getAllKeys(range))) as string[];

      if (ids === null) {
        ids = [...new Set(keys)];
      } else {
        // AND across terms, and each intersection can only shrink the set —
        // so an impossible query gives up immediately rather than reading rows.
        const next = new Set(keys);
        ids = ids.filter((id) => next.has(id));
      }
      if (ids.length === 0) return [];
    }
  }

  // No terms: fall back to filtering by the structured options alone, which is
  // a legitimate query ("everything deleted in this community").
  const records: ArchivedContent[] = [];

  if (ids === null) {
    const source = options.groupId
      ? store.index('group_id').openCursor(IDBKeyRange.only(options.groupId), 'prev')
      : store.index('created_at').openCursor(null, 'prev');

    await new Promise<void>((resolve, reject) => {
      const request = source;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || records.length >= limit) {
          resolve();
          return;
        }
        const record = cursor.value as ArchivedContent;
        if (matches(record, options)) records.push(record);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } else {
    for (const id of ids) {
      const record = (await asPromise(store.get(id))) as ArchivedContent | undefined;
      if (record && matches(record, options)) records.push(record);
      if (records.length >= limit) break;
    }
  }

  // Newest first — for a corpus of social posts that is the order people expect,
  // and relevance ranking over prefix-matched tokens would be mostly noise.
  return records.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function matches(record: ArchivedContent, options: SearchOptions): boolean {
  if (options.groupId && record.group_id !== options.groupId) return false;
  if (options.type && record.type !== options.type) return false;
  if (options.author && record.author?.toLowerCase() !== options.author.toLowerCase()) return false;
  if (!options.includeDeleted && record.deleted) return false;
  return true;
}


/**
 * The oldest post held for a community.
 *
 * This is the crawler's **target**: everything newer than this is territory the
 * archive already covers, so duplicates there are expected rather than a reason
 * to stop. Only once a crawl gets past this line is it into history we don't
 * have.
 *
 * One cursor step on a compound `[group_id, created_at]` index — no scan, so it
 * stays free as the archive grows.
 */
export async function getOldestArchived(groupId: string): Promise<string | undefined> {
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);
  const range = IDBKeyRange.bound([groupId, ''], [groupId, '\uffff']);
  const cursor = await asPromise(store.index('group_created').openCursor(range, 'next'));
  return (cursor?.value as ArchivedContent | undefined)?.created_at;
}


/**
 * Archived posts whose comment threads have not been fetched.
 *
 * An index lookup on `needs_comments`, not a scan — at 157k posts a scan would
 * deserialize the entire archive to find the few thousand that still need work.
 *
 * Only ids and comment counts are returned: the comment crawler needs nothing
 * else, and carrying full records for thousands of posts through memory would be
 * waste on a job that is already long.
 */
export async function listPostsNeedingComments(
  limit = 500,
): Promise<{ id: string; comment_count: number }[]> {
  const db = await openDb();
  const store = tx(db, [CONTENT], 'readonly').objectStore(CONTENT);
  const out: { id: string; comment_count: number }[] = [];

  await new Promise<void>((resolve, reject) => {
    const request = store.index('needs_comments').openCursor(IDBKeyRange.only(1));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || out.length >= limit) {
        resolve();
        return;
      }
      const record = cursor.value as ArchivedContent;
      out.push({ id: record.id, comment_count: record.comment_count ?? 0 });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  return out;
}

/**
 * Marks a post's thread as collected.
 *
 * Records the count at fetch time rather than a boolean, so a post that later
 * gains replies comes back around instead of being permanently considered done.
 */
export async function markCommentsFetched(postId: string, count: number): Promise<void> {
  const db = await openDb();
  const transaction = tx(db, [CONTENT], 'readwrite');
  const store = transaction.objectStore(CONTENT);
  const record = (await asPromise(store.get(postId))) as ArchivedContent | undefined;
  if (record) {
    store.put({ ...record, needs_comments: 0, comments_fetched_count: count });
  }
  await done(transaction);
}
