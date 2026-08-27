/**
 * Feed hygiene.
 *
 * The feed endpoint returns two kinds of junk that offsides guards against in
 * HomeScreen.jsx, neither documented anywhere:
 *
 *   - entries with **no `id`**, almost certainly ad slots
 *   - **duplicates across pages**, so cursor paging can repeat a post
 *
 * Both would break an infinite list — the first on the key extractor, the second
 * visibly. See docs/OFFSIDES.md#the-feed-needs-two-defensive-filters-not-one.
 */

import type { PostOrComment } from './types';

/** Drops id-less entries and de-duplicates by id, preserving first-seen order. */
export function sanitizePosts(posts: PostOrComment[] | undefined | null): PostOrComment[] {
  if (!Array.isArray(posts)) return [];
  const seen = new Set<string>();
  const out: PostOrComment[] = [];
  for (const post of posts) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    out.push(post);
  }
  return out;
}

/** Flattens paged results, then applies the same guarantees across page joins. */
export function mergeFeedPages(pages: { posts?: PostOrComment[] }[]): PostOrComment[] {
  return sanitizePosts(pages.flatMap((page) => page.posts ?? []));
}

/** What sanitizePosts removed — used by diagnostics to confirm this is needed. */
export function feedHygieneStats(posts: PostOrComment[] | undefined | null) {
  const raw = Array.isArray(posts) ? posts : [];
  const missingId = raw.filter((p) => !p?.id).length;
  const ids = raw.filter((p) => p?.id).map((p) => p.id);
  const duplicates = ids.length - new Set(ids).size;
  return { total: raw.length, missingId, duplicates, kept: sanitizePosts(raw).length };
}
