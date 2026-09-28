import { useSyncExternalStore } from 'react';

import { accountKey } from './account-scope';
import { cacheStorage } from './storage';

/**
 * How far this device has read each chat.
 *
 * Opening a thread, or *Mark all read* on Chats, writes a mark here first, and
 * the UI reads it, so a chat clears the moment it's read. The server hears
 * next: `useChatReadSync` (src/api/chat-read-sync.ts) sends it each mark it
 * doesn't have yet, and the official app agrees
 * (docs/API.md#marking-a-chat-read). Until 2026-09-28 that call wasn't known,
 * and these marks were all there was.
 *
 * A chat is unread only when something arrived after both this mark and the
 * server's, so one the server refused still reads as read here.
 *
 * A mark is the chat's own `updated_at` when it was read, never this device's
 * clock, so a clock running fast can't swallow a message. That also makes it
 * the right value to send. Marks are kept per account too, since friends at
 * one school share its group chats (src/lib/account-scope.ts).
 */

const STORAGE_KEY = 'webyak.chatReads';
/** Far more chats than an account has. It only stops the blob growing forever. */
const MAX_CHATS = 500;

/**
 * Chat id → the `updated_at` it was read up to, oldest-marked first for
 * trimming. **Replaced, never mutated**: each change builds a new map, so the
 * map itself is the snapshot `useChatReads` hands out.
 */
let reads: ReadonlyMap<string, string> = new Map();
/** Whose marks are loaded: `undefined` until the first restore. */
let restoredFor: string | null | undefined;
/** Where they persist. Nothing is written until an account has been restored. */
let storageKey: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function later(current: string | undefined, next: string) {
  return current && Date.parse(current) >= Date.parse(next) ? current : next;
}

function persist() {
  if (storageKey) void cacheStorage.setItem(storageKey, JSON.stringify([...reads]));
}

/**
 * Loads `userId`'s marks, or swaps to them from another account's. `null` is
 * a session with no known id, which keeps the old unscoped key.
 */
export async function restoreChatReads(userId: string | null) {
  if (restoredFor === userId) return;
  const previous = restoredFor;
  restoredFor = userId;
  const key = userId ? await accountKey(STORAGE_KEY, userId) : STORAGE_KEY;
  if (restoredFor !== userId) return; // another restore started meanwhile
  if (previous !== undefined) reads = new Map();
  storageKey = key;
  const pending = reads.size > 0;
  try {
    const raw = await cacheStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const stored = new Map<string, string>();
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        stored.set(entry[0], entry[1]);
      }
    }
    // Anything marked while the restore was in flight is newer than the disk.
    for (const [id, at] of reads) {
      const mark = later(stored.get(id), at);
      stored.delete(id);
      stored.set(id, mark);
    }
    reads = stored;
  } catch {
    /* corrupt entry — start clean rather than failing the app */
  }
  if (pending) persist();
  emit();
}

/**
 * Marks each chat read up to `at`, its `updated_at` at the time. A mark never
 * moves backwards, so an older copy of a thread can't make it unread again.
 */
export function markChatsRead(entries: { id: string; at: string | undefined }[]) {
  const next = new Map(reads);
  let changed = false;
  for (const { id, at } of entries) {
    if (!id || !at || !Number.isFinite(Date.parse(at))) continue;
    const current = next.get(id);
    const mark = later(current, at);
    if (mark === current) continue;
    next.delete(id);
    next.set(id, mark);
    changed = true;
  }
  if (!changed) return;
  for (const id of next.keys()) {
    if (next.size <= MAX_CHATS) break;
    next.delete(id);
  }
  reads = next;
  persist();
  emit();
}

/** Outside render only. A render reads `useChatReads()`, or it won't update. */
export function chatReadAt(id: string): string | undefined {
  return reads.get(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return reads;
}

/**
 * Every mark, as a map that is a new object whenever one changes. Read from
 * it directly, `reads.get(id)`. A version number wouldn't work here: the React
 * Compiler drops a hook result that nothing reads, and the list never
 * recomputed (docs/ARCHITECTURE.md#an-external-store-hands-out-its-data-not-a-version).
 */
export function useChatReads(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
