/**
 * Which asset URLs need the bearer token.
 *
 * Verified 2026-08-27 — the API is not consistent about this:
 *
 * | URL form | Auth |
 * |---|---|
 * | `sidechat-assets-*.r2.cloudflarestorage.com/…X-Amz-Signature=…` | none, pre-signed |
 * | `icon.yik-yak.com/…` | none, public (group icons) |
 * | `api.sidechat.lol/v1/assets/video.m3u8?…expires=…` | none, signed via query |
 * | `api.sidechat.lol/v1/assets?post_id=…&asset_id=…` | **bearer required (401)** |
 * | `api.sidechat.lol/v1/assets/library/…` | **bearer required (401)** |
 * | `api.sidechat.lol/v1/assets/profile?…` | none — **302** to a signed R2 URL |
 *
 * The last two cannot go in an `<img src>` or a `<video poster>`, because
 * neither can send a header. That is why video posters were blank.
 */
const API_HOST = 'api.sidechat.lol';

/**
 * `/v1/assets/profile` is **not** authenticated, despite living on the API host
 * with no signature in the URL. Verified 2026-08-27 with an unauthenticated
 * request: it answers `302` and redirects to a pre-signed R2 URL carrying its
 * own `X-Amz-Signature` and a one-hour expiry.
 *
 * Sending the bearer to it is actively harmful on the web. An `Authorization`
 * header makes the request non-simple, so the browser preflights it; the actual
 * `GET` then answers `302`, and a preflighted request cannot follow a
 * cross-origin redirect. The fetch dies as `TypeError: Failed to fetch` — which
 * is exactly what the image-failure log recorded for `profile-photo`.
 *
 * Loaded plainly, an `<img>` follows the redirect itself and never applies CORS
 * to it, so the photo just works. offsides passes group icons as a plain URI for
 * the same reason (docs/OFFSIDES.md).
 */
function isUnauthenticatedRedirect(url: string): boolean {
  return url.includes('/v1/assets/profile');
}

export function assetNeedsAuth(url: string | undefined): boolean {
  if (!url) return false;
  if (!url.includes(API_HOST)) return false;
  // Query-signed URLs carry their own credentials.
  if (url.includes('expires=') || url.includes('X-Amz-Signature')) return false;
  if (isUnauthenticatedRedirect(url)) return false;
  return true;
}

/** Prefer whichever variant the API gave us that can be used directly. */
export function bestAssetUrl(asset: {
  url?: string;
  signed_url?: string;
}): string | undefined {
  if (asset.signed_url && !assetNeedsAuth(asset.signed_url)) return asset.signed_url;
  return asset.signed_url || asset.url;
}
