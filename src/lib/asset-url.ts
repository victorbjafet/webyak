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
 *
 * The last two cannot go in an `<img src>` or a `<video poster>`, because
 * neither can send a header. That is why video posters were blank.
 */
const API_HOST = 'api.sidechat.lol';

export function assetNeedsAuth(url: string | undefined): boolean {
  if (!url) return false;
  if (!url.includes(API_HOST)) return false;
  // Query-signed URLs carry their own credentials.
  if (url.includes('expires=') || url.includes('X-Amz-Signature')) return false;
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
