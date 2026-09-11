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
 * **Carries the post id, not the share code.** The code was a URL-shape choice
 * copied from yikyak.com, and it is the one identifier their API cannot resolve
 * — so a `/p/<code>` link could only ever open if the recipient already had the
 * post cached, which is nearly never for a link someone was just sent.
 *
 * The id has no such problem: `getPost` is UUID-keyed, so an id link opens cold
 * for anyone signed in. That turns the flagship symptom of Blocker 1 — "shared
 * links don't work" — from a worker dependency into a choice we were making
 * ourselves (docs/API.md#blocker-1).
 *
 * Uglier, and worth it. `/p/` still accepts a code, so yikyak.com codes keep
 * working exactly as well as they did; and if the worker is ever built, share
 * links can move back to the short form with no route change.
 */
export function shareUrlForPost(post: PostOrComment): string | null {
  if (!post.id) return null;
  return `${BASE_URL}/p/${encodeURIComponent(post.id)}`;
}

/** Canonical link to a community feed. */
export function shareUrlForGroup(slug: string): string {
  return `${BASE_URL}/g/${encodeURIComponent(slug)}`;
}
