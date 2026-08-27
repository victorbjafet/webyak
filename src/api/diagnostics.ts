/**
 * One-shot probes for open questions that can only be answered with a live
 * token. Run from /diagnostics. Everything here is read-only.
 *
 * Round 1 (settled, no longer probed):
 *   - Q2 images — PASS, assets are pre-signed R2 URLs
 *   - Blocker 1 share codes — FAIL, no native endpoint exists at all
 *   - Q6 slug convention — PASS, the slug is `index_name`
 *
 * Round 2 (below) closes out the group resolver and verifies the feed defences
 * we inherited from offsides against our own data.
 */

import { fetchUserGroups } from './groups';
import { api } from './client';
import { feedHygieneStats } from './feed';
import type { PostOrComment } from './types';

export const SAMPLE_GROUP_ID = '602fb305-4ec2-4d01-83be-4d80c6636a56';

export type ProbeStatus = 'pass' | 'fail' | 'partial' | 'error';

export interface ProbeResult {
  id: string;
  label: string;
  question: string;
  status: ProbeStatus;
  detail: string;
  evidence?: string;
}

function preview(value: unknown, max = 420) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function fail(base: Omit<ProbeResult, 'status' | 'detail'>, e: unknown): ProbeResult {
  return { ...base, status: 'error', detail: e instanceof Error ? e.message : String(e) };
}

/** Control — is the token live at all? */
async function probeAuth(): Promise<ProbeResult> {
  const base = {
    id: 'auth',
    label: 'Control — token is live',
    question: 'Does an authenticated request succeed?',
  };
  try {
    const res = await api.sendRequest('/v1/users/me');
    if (!res.ok) {
      return {
        ...base,
        status: 'fail',
        detail: `Got ${res.status}. Everything below is meaningless — sign in again.`,
      };
    }
    const me = (await res.json()) as { id?: string; memberships?: { groupId: string }[] };
    return {
      ...base,
      status: 'pass',
      detail: `Authenticated. ${me.memberships?.length ?? 0} group memberships on this account.`,
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** Verify offsides' two feed defences are actually needed against our data. */
async function probeFeedHygiene(): Promise<ProbeResult> {
  const base = {
    id: 'feed-hygiene',
    label: 'Feed — are the offsides filters needed?',
    question: 'Does the feed really return id-less entries and cross-page duplicates?',
  };
  try {
    const first = (await api.getGroupPosts(SAMPLE_GROUP_ID, 'hot')) as unknown as {
      posts?: PostOrComment[];
      cursor?: string;
    };
    const second = first.cursor
      ? ((await api.getGroupPosts(SAMPLE_GROUP_ID, 'hot', first.cursor)) as unknown as {
          posts?: PostOrComment[];
        })
      : { posts: [] };

    const combined = [...(first.posts ?? []), ...(second.posts ?? [])];
    const stats = feedHygieneStats(combined);
    const needed = stats.missingId > 0 || stats.duplicates > 0;

    return {
      ...base,
      status: 'pass',
      detail: needed
        ? `Confirmed against live data: ${stats.missingId} id-less and ${stats.duplicates} duplicate entries across two pages. Both filters are load-bearing.`
        : `Two clean pages this time (${stats.total} entries, no junk). Keep the filters — offsides added them for a reason and the sample is small.`,
      evidence: preview(stats),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/**
 * Find a real video asset so the model can be checked against live data.
 * offsides says `type: "video"`, an m3u8 `url`, and a poster at
 * `thumbnail_asset.url` — this confirms or corrects that.
 */
async function probeVideoShape(): Promise<ProbeResult> {
  const base = {
    id: 'video-shape',
    label: 'Video — asset shape',
    question: 'What does a video asset actually look like?',
  };
  try {
    const groups = await fetchUserGroups();
    const targets = [SAMPLE_GROUP_ID, ...groups.slice(0, 3).map((g) => g.id)];

    for (const groupId of targets) {
      for (const sort of ['hot', 'top'] as const) {
        const page = (await api.getGroupPosts(groupId, sort)) as unknown as {
          posts?: PostOrComment[];
        };
        const post = page.posts?.find((p) => p.assets?.some((a) => a.type !== 'image'));
        const asset = post?.assets?.find((a) => a.type !== 'image');
        if (asset) {
          return {
            ...base,
            status: 'pass',
            detail: `Found a "${asset.type}" asset. content_type=${asset.content_type}, thumbnail=${asset.thumbnail_asset?.url ? 'yes' : 'no'}, url ends .m3u8=${String((asset.url || '').split('?')[0].endsWith('.m3u8'))}`,
            evidence: preview({ ...asset, url: (asset.url || '').slice(0, 160) }, 600),
          };
        }
      }
    }
    return {
      ...base,
      status: 'partial',
      detail:
        'No non-image assets in the sampled feeds. Open a post you know has a video and re-run, or paste its asset JSON.',
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** /v1/posts/saved and /v1/activity both exist (401, not 404). What do they return? */
async function probeGapEndpoints(): Promise<ProbeResult> {
  const base = {
    id: 'gap-endpoints',
    label: 'Gaps — saved posts and activity',
    question: 'sidechat.js has no methods for these, but the routes exist. What is their shape?',
  };
  const notes: string[] = [];
  let anyOk = false;

  for (const endpoint of ['/v1/posts/saved', '/v1/activity']) {
    try {
      const res = await api.sendRequest(endpoint);
      const text = await res.text();
      if (res.ok) {
        anyOk = true;
        let keys = '<non-json>';
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          keys = Array.isArray(json) ? `array(${json.length})` : Object.keys(json).join(', ');
        } catch {
          /* keep placeholder */
        }
        notes.push(`${endpoint}: 200, keys = ${keys}\n  ${text.slice(0, 220)}`);
      } else {
        notes.push(`${endpoint}: HTTP ${res.status} — ${text.slice(0, 120)}`);
      }
    } catch (e) {
      notes.push(`${endpoint}: error — ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    ...base,
    status: anyOk ? 'pass' : 'partial',
    detail: anyOk
      ? 'At least one works. These close Phase 8 gaps that were recorded as "no endpoint exists".'
      : 'Neither returned data. They exist as routes but may need parameters.',
    evidence: notes.join('\n\n'),
  };
}

/**
 * #3 — profile pictures don't render. The Profile type says the icon is
 * emoji + color, but that typedef came from sidechat.js's JSDoc, which has been
 * wrong before. This dumps what the endpoint actually returns.
 */
async function probeProfileShape(): Promise<ProbeResult> {
  const base = {
    id: 'profile-shape',
    label: 'Profile — icon fields',
    question: 'What does getUserProfile return for a user icon?',
  };
  try {
    // Find a username from a real post rather than guessing one.
    const groups = await fetchUserGroups();
    let username: string | undefined;
    for (const groupId of [SAMPLE_GROUP_ID, ...groups.slice(0, 3).map((g) => g.id)]) {
      const page = (await api.getGroupPosts(groupId, 'hot')) as unknown as {
        posts?: PostOrComment[];
      };
      const named = page.posts?.find((p) => p.identity?.posted_with_username && p.identity?.name);
      if (named) {
        username = named.identity.name;
        break;
      }
    }
    if (!username) {
      return {
        ...base,
        status: 'partial',
        detail: 'No posts by a named user in the sampled feeds — nothing to look up.',
      };
    }

    // A profile is a *group* object: getUserProfile hits /v1/groups/username and
    // returns json.group. That's also why profiles carry icon_url.
    const res = await api.sendRequest(
      `/v1/groups/username?username=${encodeURIComponent(username)}`,
    );
    const text = await res.text();
    if (!res.ok) {
      return {
        ...base,
        status: 'fail',
        detail: `Looked up "${username}": HTTP ${res.status}.`,
        evidence: preview(text.slice(0, 300)),
      };
    }
    const json = JSON.parse(text) as { group?: Record<string, unknown> };
    const group = json.group ?? (json as Record<string, unknown>);
    const iconUrl = typeof group.icon_url === 'string' ? group.icon_url : undefined;
    return {
      ...base,
      status: iconUrl ? 'pass' : 'partial',
      detail: iconUrl
        ? `"${username}" has icon_url — that is the profile picture, and icon.yik-yak.com is public.`
        : `"${username}" returned no icon_url. Keys: ${Object.keys(group).join(', ')}.`,
      evidence: preview(group, 700),
    };
  } catch (e) {
    return fail(base, e);
  }
}

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeProfileShape(),
    await probeVideoShape(),
    await probeGapEndpoints(),
    await probeFeedHygiene(),
  ];
}
