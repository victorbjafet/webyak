import { useSyncExternalStore } from 'react';

/**
 * A shared ticker, so live-updating timestamps don't each own a timer.
 *
 * A feed can hold a hundred post ages. One `setInterval` per component would be
 * a hundred timers waking the main thread out of phase; this keeps **one timer
 * per interval bucket** no matter how many subscribers there are, and stops it
 * entirely when the last one unmounts.
 */
type Listener = () => void;

interface Bucket {
  listeners: Set<Listener>;
  handle: ReturnType<typeof setInterval> | null;
  now: number;
}

const buckets = new Map<number, Bucket>();

function bucketFor(intervalMs: number): Bucket {
  let bucket = buckets.get(intervalMs);
  if (!bucket) {
    bucket = { listeners: new Set(), handle: null, now: Date.now() };
    buckets.set(intervalMs, bucket);
  }
  return bucket;
}

function subscribe(intervalMs: number) {
  return (listener: Listener) => {
    const bucket = bucketFor(intervalMs);
    bucket.listeners.add(listener);

    if (!bucket.handle) {
      bucket.handle = setInterval(() => {
        bucket.now = Date.now();
        bucket.listeners.forEach((l) => l());
      }, intervalMs);
    }

    return () => {
      bucket.listeners.delete(listener);
      if (bucket.listeners.size === 0 && bucket.handle) {
        clearInterval(bucket.handle);
        bucket.handle = null;
      }
    };
  };
}

/**
 * Current time, re-rendering the caller every `intervalMs`.
 *
 * Pass 1000 only where seconds are actually shown; 30000 is plenty for a
 * relative age that reads in minutes.
 */
export function useNow(intervalMs: number): number {
  return useSyncExternalStore(
    subscribe(intervalMs),
    () => bucketFor(intervalMs).now,
    // Server render has no clock to share; a fixed read is fine because the
    // first client tick corrects it.
    () => bucketFor(intervalMs).now,
  );
}
