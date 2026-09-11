import {
  mergeArchived,
  toArchived,
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
const DB_VERSION = 1;

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

    request.onupgradeneeded = () => {
      const db = request.result;

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
      }

      if (!db.objectStoreNames.contains(MEDIA)) {
        db.createObjectStore(MEDIA, { keyPath: 'asset_id' });
      }

      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
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

  const [posts, comments, withMedia, mediaPending, mediaCached] = await Promise.all([
    asPromise(content.index('type').count(IDBKeyRange.only('post'))),
    asPromise(content.index('type').count(IDBKeyRange.only('comment'))),
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

  return { posts, comments, withMedia, mediaPending, mediaCached, bytes, quota, oldest, newest };
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
