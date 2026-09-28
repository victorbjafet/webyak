import { request } from './client';
import type { ConversationIcon } from './types';

/**
 * Alerts: the activity feed, and marking items seen.
 *
 * sidechat.js can mark an item seen (`readActivity`) but has no way to list
 * them. The list endpoint, `/v1/activity`, was found by the 2026-08-28 sweep
 * (docs/API.md#the-activity-feed-alerts). offsides never called it either: it
 * reads the copy of the same `{items, cursor}` list that `getUpdates()` carries
 * as `activity_items` (docs/OFFSIDES.md#round-8--alerts-2026-09-27) — the same
 * list, confirmed. We call the endpoint itself, because it pages and is a
 * fraction of the size of the updates payload a poll would otherwise
 * re-download.
 *
 * The shape below was first borrowed from offsides' `ActivityItem`, then
 * checked against a live account on 2026-09-27: 60 alerts over two pages.
 */

/**
 * Types webyak has a label for (components/alerts/activity-row.tsx).
 *
 * Seen live: `votes`, `trending_post`, `followed_post`, `comment`, and two that
 * offsides never handled, `quote` and `takedown`. From offsides only, not yet
 * seen here: `comment_reply`, `new_follower`, `suggested_sidechats`. Any other
 * type still renders, and the Alerts probe lists it.
 */
export const ACTIVITY_TYPES = [
  'votes',
  'trending_post',
  'followed_post',
  'comment',
  'comment_reply',
  'quote',
  'takedown',
  'new_follower',
  'suggested_sidechats',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityItem {
  /** `<type>~<uuid>…`. For `comment` the UUID is not the post — most likely the comment. */
  id: string;
  /** An open set — see `ACTIVITY_TYPES`. */
  type: string;
  /** An ISO string on every type seen so far. Read through `activityDate`. */
  timestamp?: string | number;
  is_seen?: boolean;
  /** A finished sentence, rendered by the server — "Your post reached 25 karma: …". */
  text?: string;
  /** The post the alert is about. On every type seen except `takedown`, and always a post. */
  post_id?: string;
  /** `comment` and `followed_post`: the comment in question. Not yet used. */
  comment_id?: string;
  /** `followed_post`: the reply in question. Not yet used. */
  comment_reply_id?: string;
  /** `takedown` only, in place of `post_id`. Its shape is unrecorded (PLAN Q14). */
  takedown_data?: unknown;
  /** `suggested_sidechats` only, per offsides: the communities it suggests. */
  suggested_sidechats_data?: { group_ids_to_suggest?: string[] };
  /** `new_follower` only, per offsides: the follower's icon. */
  conversation_icon?: ConversationIcon;
}

export interface ActivityPage {
  items: ActivityItem[];
  cursor: string | null;
}

function isActivityItem(value: unknown): value is ActivityItem {
  const item = value as ActivityItem | null;
  return Boolean(item && typeof item.id === 'string' && typeof item.type === 'string');
}

/** One page of 30, newest first. `cursor` continues it. */
export async function getActivity(cursor?: string | null): Promise<ActivityPage> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  const json = await request<{ items?: unknown; cursor?: unknown }>(
    `/v1/activity${query ? `?${query}` : ''}`,
  );
  return {
    items: Array.isArray(json?.items) ? json.items.filter(isActivityItem) : [],
    cursor: typeof json?.cursor === 'string' && json.cursor ? json.cursor : null,
  };
}

/**
 * When an alert happened, as an ISO string, or null when it can't be read.
 *
 * Every type seen so far sends an ISO string. Epoch seconds and milliseconds
 * are still accepted, because three types have not been seen yet, and offsides
 * handed the field to a library that takes all three.
 */
export function activityDate(item: ActivityItem): string | null {
  const raw = item.timestamp;
  const epoch =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)
        ? Number(raw)
        : null;
  const ms =
    epoch !== null
      ? epoch < 1e12
        ? epoch * 1000
        : epoch
      : typeof raw === 'string' && raw
        ? Date.parse(raw)
        : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Marks alerts seen, many per request: `POST /v1/activity/seen` with
 * `{ids: [...]}`, answered by a 200 and `{}`.
 *
 * Confirmed 2026-09-27 to stick and to batch: seven ids marked, five of them
 * in one request, all read back as seen — though sidechat.js's `readActivity`
 * only ever sends one.
 */
export async function markActivitySeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await request<unknown>('/v1/activity/seen', 'POST', { ids });
}
