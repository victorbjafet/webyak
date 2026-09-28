import { accountKey } from './account-scope';
import { cacheStorage } from './storage';

/**
 * Which posts this device has already shown you.
 *
 * The For You feed's **unread** filter is client-side, and has to be. The API
 * rejects it outright: `type=unread` returns `400 Invalid post type: unread`.
 * Worth noting the contrast with `period`, which is *silently ignored* when
 * unrecognised — so `type` is validated and `period` is not, and a probe has to
 * be designed differently for each (docs/API.md#unread-is-ours-not-theirs).
 *
 * Deliberately per-device. There is no server-side read state to sync with, so
 * a second browser starts fresh. That is the honest behaviour rather than a
 * bug, and the empty state says as much.
 *
 * And per account: a friend scrolling the same school feed on your laptop
 * would otherwise empty your Unread (src/lib/account-scope.ts).
 */

const STORAGE_KEY = 'webyak.seenPosts';

/**
 * How many ids to keep. A feed page is 24 posts, so this is a few hundred pages
 * of scrollback — far more than "what's new since I last looked" needs, and
 * small enough that the serialized blob stays well under any storage limit.
 */
const MAX_IDS = 4000;

/** Oldest-first insertion order, so trimming drops the least recently seen. */
let seen: string[] = [];
let index = new Set<string>();
/** Whose seen posts are loaded: `undefined` until the first restore. */
let restoredFor: string | null | undefined;
/** Where they persist. Nothing is written until an account has been restored. */
let storageKey: string | null = null;
/**
 * Told when the set is **replaced** (restored for an account, or cleared), not
 * on every mark. Marks happen as posts scroll into view, and the feed
 * deliberately doesn't react to those (`snapshotSeenPosts`).
 */
const replacedListeners = new Set<() => void>();

function replaced() {
  for (const listener of replacedListeners) listener();
}

let persistHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced. Marking happens on scroll, so writing through on every viewability
 * change would serialize thousands of ids many times a second.
 */
function persistSoon() {
  const key = storageKey;
  if (!key) return;
  if (persistHandle) clearTimeout(persistHandle);
  persistHandle = setTimeout(() => {
    persistHandle = null;
    // Dropped if the account changed meanwhile, rather than written to the new one.
    if (storageKey === key) void cacheStorage.setItem(key, JSON.stringify(seen));
  }, 1000);
}

/**
 * Loads `userId`'s seen posts, or swaps to them from another account's.
 * `null` is a session with no known id, which keeps the old unscoped key.
 */
export async function restoreSeenPosts(userId: string | null) {
  if (restoredFor === userId) return;
  const previous = restoredFor;
  restoredFor = userId;
  const key = userId ? await accountKey(STORAGE_KEY, userId) : STORAGE_KEY;
  if (restoredFor !== userId) return; // another restore started meanwhile
  if (previous !== undefined) {
    seen = [];
    index = new Set();
  }
  storageKey = key;
  const pending = seen.length > 0;
  try {
    const raw = await cacheStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      const stored = parsed.filter((id): id is string => typeof id === 'string');
      // Anything marked while this loaded is newer than the disk, so it goes last.
      seen = [...stored.filter((id) => !index.has(id)), ...seen].slice(-MAX_IDS);
      index = new Set(seen);
    }
  } catch {
    /* corrupt entry — start clean rather than failing the app */
  }
  if (pending) persistSoon();
  replaced();
}

/** No-ops for ids already known, so scrolling over the same rows costs nothing. */
export function markPostsSeen(ids: string[]) {
  let added = false;
  for (const id of ids) {
    if (!id || index.has(id)) continue;
    index.add(id);
    seen.push(id);
    added = true;
  }
  if (!added) return;

  if (seen.length > MAX_IDS) {
    const dropped = seen.splice(0, seen.length - MAX_IDS);
    for (const id of dropped) index.delete(id);
  }
  persistSoon();
}

export function hasSeenPost(id: string) {
  return index.has(id);
}

export function clearSeenPosts() {
  seen = [];
  index = new Set();
  persistSoon();
  replaced();
}

/**
 * A copy of the seen set as it is now, for the Unread filter to hold still.
 *
 * The feed takes one when it comes into view and filters against it until it
 * leaves and returns. Filtering against the live set would pull each post out
 * from under the reader the moment it scrolled into view and was marked
 * (docs/ARCHITECTURE.md#an-external-store-hands-out-its-data-not-a-version).
 */
export function snapshotSeenPosts(): ReadonlySet<string> {
  return new Set(index);
}

/** Calls `listener` whenever the set is restored or cleared. Returns the unsubscribe. */
export function onSeenPostsReplaced(listener: () => void) {
  replacedListeners.add(listener);
  return () => {
    replacedListeners.delete(listener);
  };
}
