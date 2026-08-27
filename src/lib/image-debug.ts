/**
 * A record of images that failed to render.
 *
 * The image bug survived three rounds of investigation because every failure
 * looked identical from the outside: `AuthedImage` returned `null`, so a 404, a
 * decode failure, a blocked fetch and a URL that was never supplied all produced
 * the same empty box. There was no way to tell which had happened, and the
 * investigation kept re-probing the API when the answer was sometimes in the
 * component.
 *
 * This is deliberately a ring buffer in memory, not a log line: it has to
 * survive long enough to be read from `/diagnostics` on the same page load, and
 * it must never grow without bound in a feed that renders hundreds of images.
 */

export type ImageFailureReason =
  /** The caller had no URL to give — the data is missing, not the render. */
  | 'no-url'
  /** The authed fetch came back non-2xx. `status` says which. */
  | 'http'
  /** The authed fetch threw: CORS, offline, or a blocked request. */
  | 'network'
  /** The bytes arrived but the element refused to decode them. */
  | 'decode';

export interface ImageFailure {
  at: number;
  reason: ImageFailureReason;
  /** Host only. A full asset URL can be a credential (docs/OPEN-SOURCE.md). */
  host: string;
  /** Where in the UI it was, e.g. "group-icon", "profile-photo", "video-poster". */
  context: string;
  status?: number;
  detail?: string;
}

const MAX = 60;
const failures: ImageFailure[] = [];

export function recordImageFailure(failure: Omit<ImageFailure, 'at'>) {
  failures.push({ ...failure, at: Date.now() });
  if (failures.length > MAX) failures.splice(0, failures.length - MAX);
}

export function getImageFailures(): readonly ImageFailure[] {
  return failures;
}

export function clearImageFailures() {
  failures.length = 0;
}

/** Host only — never the path or query, which carry signatures and ids. */
export function hostOf(url: string | undefined): string {
  if (!url) return '(none)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

/** Groups the buffer into a report: which contexts fail, and how. */
export function summarizeImageFailures() {
  const byKey = new Map<string, { count: number; sample: ImageFailure }>();
  for (const failure of failures) {
    const key = `${failure.context} · ${failure.reason}${failure.status ? ` ${failure.status}` : ''} · ${failure.host}`;
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { count: 1, sample: failure });
  }
  return [...byKey.entries()].map(([key, { count, sample }]) => ({ key, count, sample }));
}
