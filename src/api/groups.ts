/**
 * Slug → group resolution.
 *
 * Our URLs carry `/g/wordle`; the API needs a UUID. Confirmed 2026-08-26: the
 * slug is the group's `index_name`. See docs/API.md#blocker-2.
 *
 * No single source covers every group, so this is layered cheapest-first:
 *
 *   1. in-memory + persisted map of slugs already resolved this install
 *   2. the user's own groups, from getUpdates — where offsides' GroupPicker
 *      reads them, and the common case (you browse groups you're in)
 *   3. explore, from getAvailableGroups — 4237 groups, but *curated*: it does
 *      not include everything (Wordle, 442 members, is missing)
 *   4. live search, which is the hole-filler for anything explore omits
 */

import { api, request } from './client';
import type { Group } from './types';

import { cacheStorage } from '@/lib/storage';
import { workerEndpoint } from '@/lib/worker';

const SLUG_MAP_KEY = 'webyak.slugMap';
/** Bounded so the persisted map can't grow without limit. */
const MAX_PERSISTED = 300;

/** The fields we need to render a group header without refetching. */
export interface GroupRef {
  id: string;
  name: string;
  slug: string;
  color?: string;
  icon_url?: string;
  description?: string;
  member_count?: number;
  /** Carried so the header can show join state without a second request. */
  membership_type?: Group['membership_type'];
  can_join?: boolean;
}

const memo = new Map<string, GroupRef>();
let persistedLoaded = false;

/**
 * "Home" is **not a community.** It is the combined feed of everything you're in
 * — what the official app calls **For You** — and it behaves differently
 * everywhere it matters:
 *
 *  - it has no icon anywhere in the API, so it renders a glyph
 *  - it has no `top` sort; offsides refuses it outright with "This feature
 *    isn't supported in your Home group"
 *  - **you cannot post to it.** offsides substitutes the school group's id when
 *    composing from Home, and so do we — posting to the Home id would either
 *    fail or land somewhere unexpected
 *
 * The API calls it "Home" with `index_name: "all"`; we display "For You" to
 * match the official app. Both identifiers are checked because neither is
 * documented and either could change.
 */
export const FOR_YOU_LABEL = 'For You';

export function isForYouFeed(group?: { name?: string; index_name?: string } | null): boolean {
  if (!group) return false;
  return group.name === 'Home' || group.index_name === 'all';
}

/** What to show the user. Differs from `group.name` only for the For You feed. */
export function groupDisplayName(group?: { name?: string; index_name?: string } | null): string {
  if (!group) return '';
  return isForYouFeed(group) ? FOR_YOU_LABEL : (group.name ?? '');
}

export function groupSlug(group: Group): string | null {
  return group.index_name || group.analytics_name || null;
}

/**
 * Slugs are not ASCII. Confirmed in live search results: `wsu-wordle-🧩` is a
 * real `index_name`, alongside ordinary ones like `nyt-word-games`.
 *
 * So any slug going into a URL must be percent-encoded, and anything coming out
 * of `useLocalSearchParams` is already decoded — compare and store the decoded
 * form, build hrefs with the encoded one. Never interpolate a raw slug into a
 * path.
 */
export function groupHref(slug: string) {
  return `/g/${encodeURIComponent(slug)}` as const;
}

/** Normalizes a slug for map keys and comparison. */
export function slugKey(slug: string) {
  return decodeURIComponent(slug).toLowerCase();
}

function toRef(group: Group): GroupRef | null {
  const slug = groupSlug(group);
  if (!slug || !group.id) return null;
  return {
    id: group.id,
    name: group.name,
    slug,
    color: group.color,
    icon_url: group.icon_url,
    description: group.description,
    member_count: group.member_count,
    membership_type: group.membership_type,
    can_join: group.can_join,
  };
}

/** Adds groups to the in-memory index. Returns the ref matching `wanted`, if any. */
export function indexGroups(groups: Group[], wanted?: string): GroupRef | null {
  let hit: GroupRef | null = null;
  for (const g of groups) {
    const ref = toRef(g);
    if (!ref) continue;
    memo.set(slugKey(ref.slug), ref);
    if (wanted && slugKey(ref.slug) === wanted) hit = ref;
  }
  return hit;
}

async function loadPersisted() {
  if (persistedLoaded) return;
  persistedLoaded = true;
  const raw = await cacheStorage.getItem(SLUG_MAP_KEY);
  if (!raw) return;
  try {
    const entries = JSON.parse(raw) as GroupRef[];
    for (const ref of entries) {
      if (!memo.has(slugKey(ref.slug))) memo.set(slugKey(ref.slug), ref);
    }
  } catch {
    /* corrupt cache is not worth failing over */
  }
}

async function persist() {
  const entries = Array.from(memo.values()).slice(-MAX_PERSISTED);
  await cacheStorage.setItem(SLUG_MAP_KEY, JSON.stringify(entries));
}

/* --- the layers, each usable on its own so diagnostics can test them --- */

/** Layer 2 — the user's joined groups. */
export async function fetchUserGroups(primaryGroupId?: string): Promise<Group[]> {
  const updates = (await api.getUpdates(primaryGroupId ?? '')) as unknown as {
    groups?: Group[];
  };
  return updates.groups ?? [];
}

/** Layer 3 — the curated explore directory. */
export async function fetchExploreGroups(): Promise<Group[]> {
  return (await api.getAvailableGroups(true)) as unknown as Group[];
}

/**
 * Layer 4 — live search: GET /v1/groups/explore/search?term=
 *
 * sidechat.js returns `json.results` unconditionally, which came back
 * `undefined` in probing — so the real response uses some other key. Until the
 * shape is known (see the raw-shape probe in diagnostics) this accepts any of
 * the plausible ones and never returns undefined, because the previous version
 * crashed the caller rather than reporting a miss.
 */
export async function searchGroups(term: string): Promise<Group[]> {
  const json = await request<unknown>(
    `/v1/groups/explore/search?term=${encodeURIComponent(term)}`,
  );
  return coerceGroupList(json);
}

/**
 * Pulls a group array out of whatever envelope the endpoint used.
 *
 * Confirmed 2026-08-27: search responds with `{groups: [...]}`. sidechat.js
 * reads `json.results`, which is why its wrapper silently returned undefined.
 * `groups` is tried first; the rest are kept as cheap insurance against the
 * envelope changing.
 */
export function coerceGroupList(json: unknown): Group[] {
  if (Array.isArray(json)) return json as Group[];
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  for (const key of ['groups', 'results', 'items', 'data', 'explore_groups']) {
    if (Array.isArray(obj[key])) return obj[key] as Group[];
  }
  // last resort: the first array-of-objects value on the envelope
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.every((v) => v && typeof v === 'object')) {
      return value as Group[];
    }
  }
  return [];
}

/**
 * Layer 5 — the optional Cloudflare Worker (docs/WORKER.md). Config lives in
 * `src/lib/worker.ts`, shared with the image-upload path.
 *
 * No longer load-bearing: layer 4 (live search) was confirmed on 2026-08-27 to
 * resolve groups outside explore, which closed Blocker 2 natively. Kept as a
 * redundant fallback for the case where search is unavailable or rate-limited.
 */
export async function lookupGroupViaWorker(slug: string): Promise<Group | null> {
  const endpoint = workerEndpoint(`/group/${encodeURIComponent(slug)}`);
  if (!endpoint) return null;
  const res = await fetch(endpoint);
  if (!res.ok) return null;
  const json = (await res.json()) as { group?: Group };
  return json.group ?? null;
}

/**
 * Layer 4b — `getGroupMetadata` is `GET /v1/groups/<id>`. Whether that `:param`
 * route also accepts a slug is unverified; if it does it collapses layers 3–4.
 */
export async function lookupGroupDirect(slugOrId: string): Promise<Group | null> {
  const json = await request<{ group?: Group }>(`/v1/groups/${encodeURIComponent(slugOrId)}`);
  return json.group ?? null;
}

/**
 * Resolve a URL slug to a group. Returns null when nothing anywhere matches.
 * `primaryGroupId` just seeds the getUpdates call; it's optional.
 */
export async function resolveGroupBySlug(
  slug: string,
  primaryGroupId?: string,
): Promise<GroupRef | null> {
  const key = slugKey(slug);

  await loadPersisted();
  const cached = memo.get(key);
  if (cached) return cached;

  // 2 — the user's own groups
  try {
    const hit = indexGroups(await fetchUserGroups(primaryGroupId), key);
    if (hit) {
      await persist();
      return hit;
    }
  } catch {
    /* fall through */
  }

  // 3 — explore
  try {
    const hit = indexGroups(await fetchExploreGroups(), key);
    if (hit) {
      await persist();
      return hit;
    }
  } catch {
    /* fall through */
  }

  // 4 — live search, for what explore omits
  try {
    const hit = indexGroups(await searchGroups(slug), key);
    if (hit) {
      await persist();
      return hit;
    }
  } catch {
    /* fall through */
  }

  // 5 — the Worker, if one is configured
  try {
    const group = await lookupGroupViaWorker(slug);
    if (group) {
      const hit = indexGroups([group], key);
      if (hit) {
        await persist();
        return hit;
      }
    }
  } catch {
    /* fall through */
  }

  return null;
}

/** Seeds the map from any group object we happen to already hold. */
export function rememberGroup(group: Group) {
  const ref = toRef(group);
  if (ref) {
    memo.set(slugKey(ref.slug), ref);
    void persist();
  }
}
