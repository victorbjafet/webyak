/**
 * The optional Cloudflare Worker (docs/WORKER.md).
 *
 * Unconfigured by default. Everything that depends on it degrades to a
 * documented behaviour rather than an error, so an unset `EXPO_PUBLIC_WORKER_URL`
 * is a supported configuration, not a broken one.
 *
 * Two features hang off this, and they are not equally optional:
 *
 * - **Share-code resolution** (layer 5 of the slug resolver) — a *fallback*.
 *   Layer 4 closed Blocker 2 natively on 2026-08-27, so this only matters when
 *   live search is unavailable.
 * - **Image upload** — a *hard dependency*. The pre-signed `PUT` to the storage
 *   host is blocked by CORS and cannot be issued from a browser at all, so
 *   without the worker there is no upload path
 *   (docs/API.md#-image-upload-is-blocked-by-cors).
 */

export const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL ?? '';

export function workerEndpoint(path: string) {
  if (!WORKER_URL) return null;
  return `${WORKER_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Whether to offer image attachments at all.
 *
 * Gated on the worker rather than hardcoded off, so deploying the worker and
 * setting the env var is the whole of turning this back on — there is no flag
 * to remember to flip, and no way for the UI to offer an upload that provably
 * cannot complete. Disabled 2026-08-27 after the CORS wall was confirmed.
 */
export const imageUploadEnabled = Boolean(WORKER_URL);
