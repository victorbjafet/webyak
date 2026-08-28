import { useSyncExternalStore } from 'react';

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
let restored = false;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

let persistHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced. Marking happens on scroll, so writing through on every viewability
 * change would serialize thousands of ids many times a second.
 */
function persistSoon() {
  if (persistHandle) clearTimeout(persistHandle);
  persistHandle = setTimeout(() => {
    persistHandle = null;
    void cacheStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  }, 1000);
}

export async function restoreSeenPosts() {
  if (restored) return;
  restored = true;
  try {
    const raw = await cacheStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    seen = parsed.filter((id): id is string => typeof id === 'string').slice(-MAX_IDS);
    index = new Set(seen);
    emit();
  } catch {
    /* corrupt entry — start clean rather than failing the app */
  }
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
  emit();
}

export function hasSeenPost(id: string) {
  return index.has(id);
}

export function clearSeenPosts() {
  seen = [];
  index = new Set();
  persistSoon();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A version counter rather than the set itself: the store mutates in place, so
 * returning `index` would give `useSyncExternalStore` an unchanged reference
 * and it would never re-render.
 */
function getSnapshot() {
  return version;
}

export function useSeenVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
