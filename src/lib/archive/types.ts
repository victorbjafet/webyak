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
  /**
   * Comments only — the post this hangs off. Indexed, so a thread can be
   * reassembled from the archive without touching the network.
   */
  parent_post_id?: string;
  /**
   * Comments only — what this is a reply *to*.
   *
   * Threading is two levels, and offsides distinguishes them by comparing this
   * against `parent_post_id`: equal means a top-level comment on the post,
   * different means a reply to another comment (docs/OFFSIDES.md). Both are kept
   * rather than just a boolean, because the id is what lets an exported archive
   * rebuild the tree — a flag would say a comment is a reply without saying to
   * what.
   */
  reply_post_id?: string;
  /** The specific comment replied to, when the API distinguishes it. */
  reply_comment_post_id?: string;
  /**
   * Posts only — the post this one quote-reposts.
   *
   * Indexed, so "what quoted this" is a lookup rather than a scan. The quoted
   * post itself is archived separately: the API embeds a **complete copy** of it
   * at `quote_post.post`, and `expandQuoted` below pulls that out so it is
   * stored as a record in its own right rather than discarded with the envelope.
   */
  quote_post_id?: string;
  /** Derived: `reply_post_id` differs from `parent_post_id`. */
  is_reply: 0 | 1;
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
   * Posts only: this post's comments have not been fetched yet.
   *
   * Indexed, so the comment backfill is a lookup rather than a scan over
   * hundreds of thousands of rows. `0` once fetched — and set back to `1` if the
   * post is later seen with more comments than were captured.
   */
  needs_comments: 0 | 1;
  /** `comment_count` at the moment the comments were fetched. */
  comments_fetched_count?: number;
  /** When the thread was last collected. */
  comments_fetched_at?: number;
  /**
   * `created_at` of the newest comment seen in this post's thread.
   *
   * **Counting is not enough to notice change.** A thread that loses one comment
   * and gains another reports the same `comment_count`, so a count comparison
   * calls it unchanged and the new comment is never collected. A newly posted
   * comment always sorts after every comment already seen, so the pair
   * (count, newest) catches an addition, a removal, and one of each at once —
   * which a count alone cannot.
   */
  comments_last_comment_at?: string;

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

/**
 * Expands a batch to include the posts embedded inside quote-reposts.
 *
 * A quote-repost's response carries the **entire original post** inline. Keeping
 * only the quoting post threw away a complete record we had already paid the
 * request for — and if the original is later deleted, or predates the archive,
 * that copy was the only one we were ever going to get.
 *
 * One level deep on purpose. A quote of a quote yields its own embedded copy on
 * its own sighting, and recursing would let a malformed or circular payload walk
 * as far as the response nested.
 *
 * Ids are deduped here because a page of the feed can easily quote the same post
 * twice, and `archiveContent` writes one transaction per batch — two records
 * with the same key in one `Promise.all` would race on read-then-write.
 */
export function expandQuoted<T extends PostOrComment>(
  items: (T | null | undefined)[],
): (PostOrComment | null | undefined)[] {
  const out: (PostOrComment | null | undefined)[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item?.id) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    out.push(item);

    const quoted = item?.quote_post?.post;
    if (quoted?.id && !seen.has(quoted.id)) {
      seen.add(quoted.id);
      out.push(quoted);
    }
  }
  return out;
}

export interface ArchiveStats {
  posts: number;
  comments: number;
  /** Posts with replies whose threads have not been fetched. */
  needsComments: number;
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
  /** Progress of the separate comment pass, which walks archived posts. */
  comments_done?: number;
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

  /*
    `parent_post_id` decides it, not `type` alone.

    `type` is what the API sends and it has been right everywhere observed — but
    it is one field from an undocumented payload, and a comment filed as a post
    would be invisible in the comment count while quietly inflating the post
    count. The structural fact (a comment hangs off a parent) is the stronger
    signal, so both are checked.
  */
  const isComment = item.type === 'comment' || Boolean(item.parent_post_id);
  const commentCount = item.comment_count ?? 0;

  return {
    id: item.id,
    type: isComment ? 'comment' : 'post',
    group_id: item.group_id,
    group_name: item.group?.name,
    parent_post_id: item.parent_post_id,
    reply_post_id: item.reply_post_id,
    reply_comment_post_id: (item as { reply_comment_post_id?: string }).reply_comment_post_id,
    // The wrapper is `quote_post`, the post is at `quote_post.post`
    // (docs/API.md). `quote_post_id` is the fallback for responses that carry
    // only the id.
    quote_post_id: item.quote_post?.post?.id ?? item.quote_post_id,
    is_reply:
      isComment &&
      Boolean(item.reply_post_id) &&
      Boolean(item.parent_post_id) &&
      item.reply_post_id !== item.parent_post_id
        ? 1
        : 0,
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
    // Only a post with replies is worth fetching a thread for.
    needs_comments: !isComment && commentCount > 0 ? 1 : 0,
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
    // Fetched comments stay fetched — unless the post has gained replies since,
    // in which case there is genuinely more to collect.
    comments_fetched_count: existing.comments_fetched_count,
    comments_fetched_at: existing.comments_fetched_at,
    comments_last_comment_at: existing.comments_last_comment_at,
    needs_comments: needsComments(existing, incoming),
  };
}

function needsComments(existing: ArchivedContent, incoming: ArchivedContent): 0 | 1 {
  if (incoming.type === 'comment') return 0;
  const count = incoming.comment_count ?? 0;
  if (count === 0) return 0;
  // Never collected: obviously outstanding.
  if (existing.comments_fetched_at === undefined && existing.comments_fetched_count === undefined) {
    return 1;
  }
  const fetched = existing.comments_fetched_count ?? 0;
  /*
    Any movement in the count re-arms it, in **either** direction. Only a rise
    used to, which quietly assumed the only thing that happens to a thread is
    growth — a drop means a comment was removed, and the archive wants to record
    that rather than keep serving a thread it knows is stale.

    A count that has not moved is still not proof of stillness: one comment
    deleted and one added leaves it identical. That case is caught after the
    fetch, by comparing the newest comment's timestamp — see
    `comments_last_comment_at`. It cannot be caught from the post payload alone,
    which is why the refresh pass works off a date window rather than this flag.
  */
  return count === fetched ? 0 : 1;
}

/**
 * A post queued for its thread to be read.
 *
 * `fetched_at` is what tells the pass whether this is a **re-read**. On a first
 * read there is nothing archived that could have gone missing, so the check for
 * removed comments — a cursor walk per thread — is skipped; on a re-read it is
 * the only way a deleted comment is ever noticed.
 */
export interface QueuedPost {
  id: string;
  comment_count: number;
  fetched_at?: number;
}

/* ------------------------------------------------------------------------ *
 * Update windows
 * ------------------------------------------------------------------------ */

/** A pass that re-reads what is already archived, rather than extending it. */
export type UpdateKind = 'posts' | 'comments';

/**
 * How far back the next refresh of a community should reach.
 *
 * Stored **per community and per kind**, because the two passes run
 * independently: refreshing posts says nothing about whether comments were
 * refreshed, and a single watermark would claim both.
 *
 * `window_start` is the start of the *next* window, not the date of the last
 * run. After a successful pass it is set to a month before that run, so every
 * refresh re-covers the month the previous one already did. That overlap is the
 * point: a post that gained votes or replies right at the old boundary is seen
 * again instead of being sealed off by a date.
 */
export interface UpdateState {
  group_id: string;
  kind: UpdateKind;
  /** ISO. The start of the window the next run should cover. */
  window_start: string;
  /** When the last successful pass finished. */
  updated_at: number;
  /** What that pass covered, for display. */
  last_window_start?: string;
  last_window_end?: string;
}

/** The overlap every refresh re-covers. */
export const UPDATE_OVERLAP_MONTHS = 1;

/**
 * A month before `at` — the watermark a finished pass leaves behind.
 *
 * The day is **clamped to the target month's length**, and every field is read
 * and written in UTC. Both matter more than they look:
 *
 * - Naively stepping the month back from 31 March asks for "31 February", which
 *   JavaScript rolls forward to **3 March** — a lookback of four days wearing
 *   the label of a month. Clamping gives 28 February.
 * - Mixing local getters with `toISOString()` shifts the result by a day either
 *   side of UTC, so a watermark would drift by a day every run depending on
 *   where it was computed.
 */
export function nextWindowStart(at: number | Date = Date.now()): string {
  const from = new Date(at);
  const day = from.getUTCDate();

  const target = new Date(from);
  // Move off the end of the month before changing it, so the month arithmetic
  // cannot overflow on the way.
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - UPDATE_OVERLAP_MONTHS);

  // Day 0 of the following month is the last day of this one.
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));

  return target.toISOString();
}
