import { ApiError, api, request, unwrap } from './client';
import type { ConversationIcon } from './types';

/**
 * Alerts: the activity feed, and marking items seen.
 *
 * sidechat.js can mark an item seen (`readActivity`) but has no way to list
 * them. The list endpoint, `/v1/activity`, was found by the 2026-08-28 sweep
 * (docs/API.md#the-activity-feed-alerts). offsides never called it either: it
 * reads the copy of the same `{items, cursor}` list that `getUpdates()` carries
 * as `activity_items` (docs/OFFSIDES.md#round-8--alerts-2026-09-27). We call the endpoint
 * itself, because it pages and is a fraction of the size of the updates payload
 * a poll would otherwise re-download.
 *
 * **Most of the item shape is borrowed, not observed.** Our own probe saw
 * `{id, timestamp, type, is_seen, text}` on `votes` items. `post_id`, the other
 * types and their extra fields come from offsides' `ActivityItem`. The Alerts
 * probe in /diagnostics reports what really arrives (PLAN Q14–Q18), and
 * everything below degrades to the server's own sentence when a guess is wrong.
 */

export interface ActivityItem {
  /** e.g. `votes~<post uuid>~25`: the kind, what it is about, and a threshold. */
  id: string;
  /** An open set. See `activityKind` in components/alerts. */
  type: string;
  /** Format unconfirmed, so it is only ever read through `activityDate`. */
  timestamp?: string | number;
  is_seen?: boolean;
  /** A finished sentence, rendered by the server — "Your post reached 25 karma: …". */
  text?: string;
  /** The post the alert is about. Read by offsides for every type. */
  post_id?: string;
  /** `suggested_sidechats` only: the communities it suggests. */
  suggested_sidechats_data?: { group_ids_to_suggest?: string[] };
  /** `new_follower` only: the follower's icon. */
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

/** One page, newest first. `cursor` continues it. */
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
 * offsides hands `timestamp` to a library that takes dates, epoch numbers and
 * strings alike, so its format was never pinned down. This takes all three:
 * a number or digit string under 10^12 is epoch seconds, anything larger is
 * milliseconds, and anything else is parsed as a date.
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

/* ------------------------------------------------------------------------ *
 * Marking seen
 * ------------------------------------------------------------------------ */

/**
 * What each mark-seen request did, this page load — read by the Alerts probe
 * (PLAN Q16). In memory and capped, like the image failure log: it only has to
 * live long enough to be read from /diagnostics.
 */
export interface SeenCall {
  at: number;
  /** How many ids went in one request. More than one tests batching. */
  count: number;
  /** Kept in memory to read back; the probe reports counts, never ids. */
  ids: readonly string[];
  outcome: 'ok' | 'http' | 'network';
  status?: number;
  /** The response body's keys, never its values. */
  bodyKeys?: string[];
}

const MAX_CALLS = 20;
const seenCalls: SeenCall[] = [];
/** Every id this page load asked the server to mark seen. */
const markedIds = new Set<string>();

function logSeenCall(call: Omit<SeenCall, 'at'>) {
  seenCalls.push({ ...call, at: Date.now() });
  if (seenCalls.length > MAX_CALLS) seenCalls.splice(0, seenCalls.length - MAX_CALLS);
}

export function getSeenLog(): { calls: readonly SeenCall[]; ids: readonly string[] } {
  return { calls: seenCalls, ids: [...markedIds] };
}

/**
 * Marks alerts seen, several per request.
 *
 * The body is `{ids: [...]}` — an array, though sidechat.js's `readActivity`
 * only ever sends one. Batching is unverified; the probe reads back whether a
 * multi-id request stuck.
 *
 * Any 2xx counts as success whatever the body says. `request()` treats a body
 * that isn't JSON as a failure, and whether this endpoint answers with one is
 * exactly what is unknown. A non-2xx still goes through `unwrap`, for the API's
 * own error message and the sign-out on an expired token.
 */
export async function markActivitySeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) markedIds.add(id);

  let res: Response;
  try {
    res = await api.sendRequest('/v1/activity/seen', 'POST', JSON.stringify({ ids }));
  } catch (error) {
    logSeenCall({ count: ids.length, ids, outcome: 'network' });
    throw error;
  }

  if (res.ok) {
    let bodyKeys: string[] | undefined;
    try {
      const body = (await res.json()) as unknown;
      bodyKeys = body && typeof body === 'object' ? Object.keys(body).sort() : [];
    } catch {
      bodyKeys = undefined;
    }
    logSeenCall({ count: ids.length, ids, outcome: 'ok', status: res.status, bodyKeys });
    return;
  }

  logSeenCall({ count: ids.length, ids, outcome: 'http', status: res.status });
  await unwrap(res, 'POST /v1/activity/seen');
  throw new ApiError(`POST /v1/activity/seen failed with ${res.status}`, res.status);
}
