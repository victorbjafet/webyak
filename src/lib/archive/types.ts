import type { PostOrComment } from '@/api/types';

/**
 * The local archive: every post and comment this client has ever seen.
 *
 * Deliberately a **separate store from the query cache.** TanStack's cache is
 * working memory — bounded, evicted, and shaped for rendering. This is a record,
 * and a record's job is to still be there after the server has forgotten.
 */

/** One attached image or video, and whether its bytes are held locally. */
export interface ArchivedMedia {
  asset_id: string;
  type: string;
  /** The URL as it was when seen. Signed URLs expire, so this can go stale. */
  url?: string;
  width?: number;
  height?: number;
  /**
   * 0/1 rather than a boolean: **IndexedDB cannot index booleans.** A `false`
   * simply never appears in an index, so "posts with uncached media" would
   * silently return nothing. Same reason `has_media` below is a number.
   */
  cached: 0 | 1;
}

export interface ArchivedContent {
  id: string;
  type: 'post' | 'comment';
  group_id: string;
  group_name?: string;
  /** Comments only — the post this hangs off. */
  parent_post_id?: string;
  index_code?: string;

  text: string;
  /** The per-thread alias: "Anonymous", "OP", "#1". */
  alias?: string;
  /** The real username, when the author posted under one. */
  author?: string;

  created_at: string;
  vote_total: number;
  comment_count?: number;

  media: ArchivedMedia[];
  /** Indexable flag for "has attachments I might want to back-fill". */
  has_media: 0 | 1;
  /** Indexable flag for "has attachments whose bytes are not held yet". */
  media_pending: 0 | 1;

  /** When this client first recorded it, and when it last saw it. */
  first_seen_at: number;
  last_seen_at: number;

  /**
   * Noticed gone. Set the first time the API returns this post as a tombstone
   * after we had already archived it — so the archive records *that* a post was
   * removed, and roughly when, without losing what it said.
   *
   * `0 | 1` rather than a boolean so it can be indexed (IndexedDB drops boolean
   * keys), which makes "show me everything that got deleted" a lookup.
   */
  deleted: 0 | 1;
  deleted_at?: number;

  /**
   * Lowercased word list, used by the `tokens` multiEntry index — IndexedDB's
   * native inverted index. Stored rather than derived at query time because
   * scanning every record to match text is what makes search slow at scale.
   */
  tokens: string[];
}

/**
 * Words to index, from the text and the author.
 *
 * Deliberately simple: lowercase, split on anything non-alphanumeric, drop
 * single characters, dedupe. No stemming and no stopword list — people search a
 * corpus like this for exactly the odd, short, specific words a stopword list
 * would throw away, and stemming would surprise more than it helps.
 */
const MAX_TOKENS = 120;

export function tokenize(...sources: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const raw of source.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 2) continue;
      seen.add(raw);
      // A cap keeps one pathological post from bloating the index. 120 distinct
      // words is far past a 300-character post.
      if (seen.size >= MAX_TOKENS) return [...seen];
    }
  }
  return [...seen];
}

export interface ArchiveStats {
  posts: number;
  comments: number;
  /** Archived, then later seen removed. */
  deleted: number;
  withMedia: number;
  mediaPending: number;
  mediaCached: number;
  /** Rough on-disk usage, when the browser will tell us. */
  bytes?: number;
  quota?: number;
  oldest?: string;
  newest?: string;
}

/**
 * Where a community's crawl got to.
 *
 * **Two frontiers, not one.** A single resume cursor only ever walks backwards,
 * so a community crawled last week would archive older history forever and
 * never see anything posted since. A run therefore does two things:
 *
 * - **catch up** from the newest post until it reaches content already held
 * - **backfill** onward from `tail_cursor`, deeper into history
 *
 * `tail_cursor` is the only durable frontier; the head is found by starting at
 * the top each time, which is correct by construction — whatever is newest now
 * is where catching up has to begin.
 */
export interface CrawlState {
  group_id: string;
  group_name?: string;
  /** How deep into history the backfill has walked. */
  tail_cursor?: string;
  /** Set when the backfill reaches the beginning of the feed. */
  tail_exhausted?: boolean;
  pages: number;
  archived: number;
  updated_at: number;
}

/** The text the API substitutes once a post is removed. */
const DELETED_PLACEHOLDER = 'Deleted Post';

/**
 * Turns an API object into an archive record.
 *
 * Note what is *not* copied: vote status, saved state, follow state. Those are
 * facts about this account right now, not about the post, and an archive that
 * records them ages badly.
 */
export function toArchived(item: PostOrComment, seenAt = Date.now()): ArchivedContent | null {
  if (!item?.id) return null;

  const media: ArchivedMedia[] = (item.assets ?? []).map((asset) => ({
    asset_id: asset.id,
    type: asset.type,
    url: asset.url ?? asset.signed_url,
    width: asset.width,
    height: asset.height,
    cached: 0,
  }));

  return {
    id: item.id,
    type: item.type === 'comment' ? 'comment' : 'post',
    group_id: item.group_id,
    group_name: item.group?.name,
    parent_post_id: item.parent_post_id,
    index_code: item.index_code,
    text: item.text ?? '',
    alias: item.alias,
    author: item.identity?.posted_with_username ? item.identity?.name : undefined,
    created_at: item.created_at,
    vote_total: item.vote_total ?? 0,
    comment_count: item.comment_count,
    media,
    has_media: media.length > 0 ? 1 : 0,
    media_pending: media.length > 0 ? 1 : 0,
    first_seen_at: seenAt,
    last_seen_at: seenAt,
    deleted: 0,
    tokens: tokenize(item.text, item.identity?.name, item.alias),
  };
}

/**
 * Folds a fresh sighting into an existing record.
 *
 * Two rules that matter more than they look:
 *
 * 1. **A deletion never erases the archive, but it is recorded.** Once a post is
 *    removed the API returns its text as the literal string "Deleted Post".
 *    Writing that over a record would destroy the thing the archive exists to
 *    keep — so the original text and score are held, and the removal is noted
 *    separately in `deleted` / `deleted_at`. The archive then answers both
 *    "what did this say" and "was it taken down afterwards".
 * 2. **Cached media survives.** Re-seeing a post must not reset `cached` flags
 *    and orphan blobs we already hold.
 */
export function mergeArchived(
  existing: ArchivedContent,
  incoming: ArchivedContent,
): ArchivedContent {
  const incomingIsTombstone =
    incoming.text === DELETED_PLACEHOLDER && existing.text !== DELETED_PLACEHOLDER;

  const media = incoming.media.map((asset) => {
    const held = existing.media.find((m) => m.asset_id === asset.asset_id);
    return held?.cached ? { ...asset, cached: held.cached } : asset;
  });
  // Keep any asset we hold bytes for even if it has vanished from the payload.
  for (const held of existing.media) {
    if (held.cached && !media.some((m) => m.asset_id === held.asset_id)) media.push(held);
  }

  return {
    ...existing,
    ...incoming,
    text: incomingIsTombstone ? existing.text : incoming.text,
    // A tombstone has no votes; keep the last real count.
    vote_total: incomingIsTombstone ? existing.vote_total : incoming.vote_total,
    // Tokens follow the text that is kept, or a deletion would make the post
    // unfindable by the words it actually contained.
    tokens: incomingIsTombstone ? existing.tokens : incoming.tokens,
    media,
    has_media: media.length > 0 ? 1 : 0,
    media_pending: media.some((m) => !m.cached) ? 1 : 0,
    first_seen_at: existing.first_seen_at,
    last_seen_at: incoming.last_seen_at,
    // Record the removal once. `deleted_at` is when we *noticed*, not when it
    // happened — the API gives no removal timestamp — so it is an upper bound.
    deleted: incomingIsTombstone || existing.deleted ? 1 : 0,
    deleted_at: existing.deleted_at ?? (incomingIsTombstone ? incoming.last_seen_at : undefined),
  };
}
