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

import {
  coerceGroupList,
  fetchExploreGroups,
  fetchUserGroups,
  lookupGroupDirect,
  resolveGroupBySlug,
  searchGroups,
} from './groups';
import { api } from './client';
import { feedHygieneStats } from './feed';
import type { Group, PostOrComment } from './types';

export const SAMPLE_GROUP_ID = '602fb305-4ec2-4d01-83be-4d80c6636a56';
export const SAMPLE_GROUP_SLUG = 'wordle';

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

/** Does the layered resolver actually resolve a group explore omits? */
async function probeResolver(): Promise<ProbeResult> {
  const base = {
    id: 'resolver',
    label: 'Blocker 2 — slug resolver end to end',
    question: `Does resolveGroupBySlug("${SAMPLE_GROUP_SLUG}") return the right UUID?`,
  };
  try {
    const ref = await resolveGroupBySlug(SAMPLE_GROUP_SLUG);
    if (!ref) {
      return {
        ...base,
        status: 'fail',
        detail:
          'No layer resolved the slug. /g/<slug> cannot work as designed — the resolver needs another source.',
      };
    }
    const correct = ref.id === SAMPLE_GROUP_ID;
    return {
      ...base,
      status: correct ? 'pass' : 'partial',
      detail: correct
        ? `Resolved to ${ref.id}, matching the known UUID. /g/<slug> works — Blocker 2 closed.`
        : `Resolved to ${ref.id} but expected ${SAMPLE_GROUP_ID}. Investigate before relying on it.`,
      evidence: preview(ref),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** Which layer does the work? Explore is known to miss this group. */
async function probeLayers(): Promise<ProbeResult> {
  const base = {
    id: 'layers',
    label: 'Blocker 2 — which layer hits',
    question: 'User groups, explore, or live search?',
  };
  // Must tolerate undefined: round 2 crashed here because sidechat.js's search
  // wrapper returned undefined, which turned a miss into an exception and hid
  // whether the layer works at all.
  const found = (groups: Group[] | undefined | null) =>
    Array.isArray(groups) &&
    groups.some((g) => g.index_name === SAMPLE_GROUP_SLUG || g.analytics_name === SAMPLE_GROUP_SLUG);

  try {
    const notes: string[] = [];
    let anyHit = false;

    try {
      const userGroups = await fetchUserGroups();
      const hit = found(userGroups);
      anyHit ||= hit;
      notes.push(`user groups (getUpdates): ${userGroups.length} groups, ${hit ? 'HIT' : 'miss'}`);
    } catch (e) {
      notes.push(`user groups: error — ${e instanceof Error ? e.message : e}`);
    }

    try {
      const explore = await fetchExploreGroups();
      const hit = found(explore);
      anyHit ||= hit;
      notes.push(`explore: ${explore.length} groups, ${hit ? 'HIT' : 'miss (expected)'}`);
    } catch (e) {
      notes.push(`explore: error — ${e instanceof Error ? e.message : e}`);
    }

    try {
      const results = await searchGroups(SAMPLE_GROUP_SLUG);
      const hit = found(results);
      anyHit ||= hit;
      notes.push(`search: ${results?.length ?? 0} results, ${hit ? 'HIT' : 'miss'}`);
    } catch (e) {
      notes.push(`search: error — ${e instanceof Error ? e.message : e}`);
    }

    return {
      ...base,
      status: anyHit ? 'pass' : 'fail',
      detail: anyHit
        ? 'At least one layer covers a group explore omits, which is what the resolver needs.'
        : 'No layer found it. The resolver has no working hole-filler.',
      evidence: notes.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** Does GET /v1/groups/<slug> accept a slug where it expects a UUID? */
async function probeDirectLookup(): Promise<ProbeResult> {
  const base = {
    id: 'direct-lookup',
    label: 'Blocker 2 — direct slug lookup',
    question: 'Does GET /v1/groups/<slug> work, collapsing layers 3–4?',
  };
  try {
    const group = await lookupGroupDirect(SAMPLE_GROUP_SLUG);
    if (group?.id === SAMPLE_GROUP_ID) {
      return {
        ...base,
        status: 'pass',
        detail: 'Accepts a slug. The resolver can short-circuit to a single request.',
        evidence: preview({ id: group.id, name: group.name, index_name: group.index_name }),
      };
    }
    return {
      ...base,
      status: 'partial',
      detail: group
        ? `Returned a group but not the expected one (${group.id}).`
        : 'UUID only — keep the layered resolver. Not a problem, just not a shortcut.',
    };
  } catch (e) {
    return {
      ...base,
      status: 'partial',
      detail: `UUID only — keep the layered resolver. (${e instanceof Error ? e.message : e})`,
    };
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
 * What does the search endpoint actually return? sidechat.js assumes
 * `json.results` and got undefined, so this dumps the envelope instead of
 * assuming anything.
 */
async function probeSearchShape(): Promise<ProbeResult> {
  const base = {
    id: 'search-shape',
    label: 'Search — response shape',
    question: 'What envelope does /v1/groups/explore/search actually use?',
  };
  try {
    const res = await api.sendRequest(
      `/v1/groups/explore/search?term=${encodeURIComponent(SAMPLE_GROUP_SLUG)}`,
    );
    const text = await res.text();
    if (!res.ok) {
      return {
        ...base,
        status: 'fail',
        detail: `HTTP ${res.status}. The endpoint may not be usable by this account.`,
        evidence: preview(text.slice(0, 300)),
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ...base, status: 'fail', detail: 'Response was not JSON.', evidence: preview(text.slice(0, 300)) };
    }

    const groups = coerceGroupList(json);
    const keys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json) : ['<array>'];
    const hit = groups.some((g) => g.index_name === SAMPLE_GROUP_SLUG);

    return {
      ...base,
      status: groups.length > 0 ? (hit ? 'pass' : 'partial') : 'fail',
      detail: [
        `Top-level keys: ${keys.join(', ') || '(none)'}.`,
        `Extracted ${groups.length} groups.`,
        groups.length === 0
          ? 'Nothing usable — search cannot be the hole-filler and the Worker is the remaining option.'
          : hit
            ? `Found "${SAMPLE_GROUP_SLUG}" — search works once the envelope is read correctly.`
            : `Did not include "${SAMPLE_GROUP_SLUG}", so search covers the same curated set as explore.`,
      ].join(' '),
      evidence: preview(
        {
          keys,
          sample: groups.slice(0, 4).map((g) => ({ name: g.name, index_name: g.index_name, id: g.id })),
          rawHead: typeof json === 'object' ? preview(json, 220) : String(json).slice(0, 220),
        },
        700,
      ),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** getUpdates returned 3 groups but /v1/users/me reported 4 memberships. */
async function probeMembershipGap(): Promise<ProbeResult> {
  const base = {
    id: 'membership-gap',
    label: 'Groups — memberships vs getUpdates',
    question: 'Why does /v1/users/me report more memberships than getUpdates returns groups?',
  };
  try {
    const res = await api.sendRequest('/v1/users/me');
    const me = (await res.json()) as { memberships?: { groupId: string; type: string }[] };
    const memberships = me.memberships ?? [];
    const groups = await fetchUserGroups();
    const groupIds = new Set(groups.map((g) => g.id));
    const missing = memberships.filter((m) => !groupIds.has(m.groupId));

    return {
      ...base,
      status: missing.length === 0 ? 'pass' : 'partial',
      detail:
        missing.length === 0
          ? 'They agree — getUpdates covers every membership.'
          : `${missing.length} membership(s) are absent from getUpdates. If those are resolvable by id, memberships is a better seed for the slug map than getUpdates.`,
      evidence: preview({
        membershipCount: memberships.length,
        getUpdatesGroups: groups.length,
        missingGroupIds: missing.map((m) => m.groupId),
      }),
    };
  } catch (e) {
    return fail(base, e);
  }
}

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeSearchShape(),
    await probeMembershipGap(),
    await probeResolver(),
    await probeLayers(),
    await probeDirectLookup(),
    await probeFeedHygiene(),
  ];
}
