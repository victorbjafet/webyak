import { useEffect, useSyncExternalStore } from 'react';

import { accountKey } from './account-scope';
import { cacheStorage } from './storage';

/**
 * Your karma over time, as sampled on this device (the owner's B5).
 *
 * The server keeps no history: `getUpdates()` has the lifetime total and this
 * quarter's and season's, all current values (probed 2026-09-28,
 * docs/API.md#what-else-is-in-getupdates). So the only series is one kept
 * here, a sample each time webyak reads your karma: at boot, when the
 * communities list refreshes, and when the You tab or Alerts reads it. That
 * makes it **sparse and irregular** — nothing is known about the gaps, when
 * webyak wasn't open — and the chart draws points, not a line, so it doesn't
 * pretend otherwise.
 *
 * Per account, per device. A second browser starts its own.
 *
 * The hook returns the samples themselves, a new array on every change, not a
 * version number: the React Compiler drops a version that is only `void`ed
 * (docs/ARCHITECTURE.md#an-external-store-hands-out-its-data-not-a-version).
 */

export interface KarmaSample {
  /** ISO time the sample was taken. */
  at: string;
  post: number;
  comment: number;
}

const STORAGE_KEY = 'webyak.karmaHistory';

/** A flat stretch still gets a point this often, so a quiet week is visible as one. */
const QUIET_SAMPLE_MS = 6 * 60 * 60 * 1000;

/** Two years of daily samples, well under any storage limit. */
const MAX_SAMPLES = 730;

const EMPTY: KarmaSample[] = [];
/** Replaced, never mutated: it is the store's snapshot. */
let state: { userId: string | null; samples: KarmaSample[] } = { userId: null, samples: EMPTY };
let storageKey: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function load(userId: string) {
  if (state.userId === userId) return;
  const key = await accountKey(STORAGE_KEY, userId);
  let restored: KarmaSample[] = EMPTY;
  try {
    const raw = await cacheStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      restored = parsed.filter(
        (s): s is KarmaSample =>
          Boolean(s) &&
          typeof s.at === 'string' &&
          typeof s.post === 'number' &&
          typeof s.comment === 'number',
      );
    }
  } catch {
    // A corrupt entry starts the history over rather than breaking the tab.
  }
  storageKey = key;
  state = { userId, samples: restored };
  emit();
}

/**
 * Records the karma just read. Kept when the total moved, or when the last
 * sample is old enough that a flat stretch deserves a point of its own.
 */
export async function recordKarma(userId: string, post: number, comment: number, now = Date.now()) {
  await load(userId);
  if (state.userId !== userId || !storageKey) return;
  const key = storageKey;
  const last = state.samples[state.samples.length - 1];
  const moved = !last || last.post !== post || last.comment !== comment;
  const quiet = last ? now - Date.parse(last.at) >= QUIET_SAMPLE_MS : true;
  if (!moved && !quiet) return;
  const samples = [...state.samples, { at: new Date(now).toISOString(), post, comment }].slice(
    -MAX_SAMPLES,
  );
  state = { userId, samples };
  emit();
  await cacheStorage.setItem(key, JSON.stringify(samples));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** This account's samples, oldest first. Empty until loaded, or for another account. */
export function useKarmaHistory(userId: string | null): KarmaSample[] {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (userId) void load(userId);
  }, [userId]);
  return userId && snapshot.userId === userId ? snapshot.samples : EMPTY;
}
