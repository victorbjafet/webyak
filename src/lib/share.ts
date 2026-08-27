import type { PostOrComment } from '@/api/types';

/**
 * Where webyak is deployed. **This is the canonical public base URL** — shared
 * links, deep links and anything else user-facing build from it.
 *
 * Overridable with EXPO_PUBLIC_BASE_URL for a preview deploy or a local test.
 */
export const BASE_URL = process.env.EXPO_PUBLIC_BASE_URL ?? 'https://webyak.vbjfr.xyz';

/**
 * The URL we hand to other people.
 *
 * Points at webyak, not yikyak.com. An earlier version shared a yikyak.com link
 * on the reasoning that `/p/<code>` can't be opened cold — but the public web
 * client has no auth, so a yikyak.com link to a school-community post is
 * useless to whoever receives it. A webyak link at least works for anyone signed
 * in who reached the post through a feed, and becomes fully cold-loadable once
 * the Worker lands (docs/WORKER.md).
 */
export function shareUrlForPost(post: PostOrComment): string | null {
  if (!post.index_code) return null;
  return `${BASE_URL}/p/${encodeURIComponent(post.index_code)}`;
}

/** Canonical link to a community feed. */
export function shareUrlForGroup(slug: string): string {
  return `${BASE_URL}/g/${encodeURIComponent(slug)}`;
}
