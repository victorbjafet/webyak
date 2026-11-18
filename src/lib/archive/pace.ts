import { cacheStorage } from '../storage';

/**
 * How long one comment thread actually takes, for estimating a run before it
 * starts.
 *
 * The estimate used to be the configured delay: 1.2 s plus half the 0.5 s
 * jitter, 1.45 s a thread. That leaves out the request itself and the archive
 * writes after it. Measured on 2026-11-16 from 20,125 thread fetches in the
 * owner's archive, the median gap was 2.0 s and whole runs averaged 2.1–2.7 s,
 * so runs took 1.5–1.9× what they were quoted.
 *
 * Now each run records its own average: elapsed time over threads actually
 * handled (stored, or their post found deleted), so retries, backoff,
 * recovery and the deletion lookups all count. The next estimate uses
 * it. Stored per device, not per account, because the pace depends on the
 * connection and the machine.
 */
const STORAGE_KEY = 'webyak.threadPace';

/** Until a run on this device has measured one: the whole-run average above. */
export const DEFAULT_MS_PER_THREAD = 2400;

/** Enough threads that a slow first request or two doesn't set the pace. */
export const MIN_THREADS_FOR_PACE = 50;

export async function readThreadPace(): Promise<number> {
  try {
    const raw = Number(await cacheStorage.getItem(STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MS_PER_THREAD;
  } catch {
    return DEFAULT_MS_PER_THREAD;
  }
}

/**
 * Records a run's pace, if it has read enough threads to have one. Overwrites
 * rather than averaging with older runs: the latest run is the best guess at
 * the connection the next one will have.
 */
export async function writeThreadPace(progress: {
  startedAt: number;
  threads: number;
  gone: number;
  lastAt?: number;
}): Promise<void> {
  const handled = progress.threads + progress.gone;
  if (handled < MIN_THREADS_FOR_PACE || !progress.lastAt) return;
  const msPerThread = (progress.lastAt - progress.startedAt) / handled;
  if (!(msPerThread > 0)) return;
  try {
    await cacheStorage.setItem(STORAGE_KEY, String(Math.round(msPerThread)));
  } catch {
    /* an estimate is not worth an error */
  }
}

/** Rounded coarsely, because it is an estimate. */
export function estimateDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} hours`;
  return `${Math.round(hours / 24)} days`;
}
