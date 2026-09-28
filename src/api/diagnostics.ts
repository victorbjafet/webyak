/**
 * Probes for questions that are **still open**, run from /diagnostics against a
 * live token.
 *
 * ## Keep this list short
 *
 * A probe earns its place by being able to change a decision. Once its question
 * is answered and the answer is in `docs/API.md`, re-running it only produces
 * output nobody reads — and a long report makes the two results that matter
 * easy to miss. Twelve settled probes were retired on 2026-09-11 for that
 * reason, `probeIncludeDeleted` on 2026-09-27 after one run, and `probeMessaging`
 * the same day once both of its questions were answered; their answers live in
 * the docs, not here.
 *
 * ## Two rules, both learned the hard way
 *
 * 1. **Every sweep needs a control.** This API has catch-all routes that answer
 *    `200` with an empty body, so a status code alone proves nothing. Four
 *    "discovered" chat endpoints turned out to be a catch-all only after a
 *    nonsense path was sent alongside them.
 * 2. **Some parameters are validated and some are ignored.** `type` rejects an
 *    unknown value with a `400`; `period` silently falls back. A probe designed
 *    for the wrong one of those reads as a pass either way.
 *
 * ## What's here
 *
 * | Probe | Open question |
 * |---|---|
 * | `probeAuth` | control — is the token live at all? |
 * | `probeShareCode` | Blocker 1: can an `index_code` be resolved without the worker? |
 * | `probeVideoPoster` | are video thumbnails reachable, or worker-only? |
 * | `probeImageFailures` | what actually failed to render this page load |
 * | `probeImageUpload` | is there an upload route on the CORS-open host? |
 * | `probeBioSource` | is your bio on `getUpdates().user`, or only on your public profile? (PLAN Q10) |
 * | `probeActivity` | alert types with no label yet, what `takedown_data` holds, whose post each type opens (PLAN Q14) |
 * | `probePostLength`, `probeBioLength` | what length does the server enforce? (PLAN Q11) |
 * | `probeChatRead` | which request marks a chat read on the server? (PLAN Q19) |
 *
 * `probeImageUpload` is not read-only — it requests an upload URL — the two
 * length probes **write**: they post and edit your bio, undoing both — and
 * `probeChatRead` marks one chat read. Each set has its own button behind a
 * confirm. The earlier write round-trip probes were
 * retired once writes were verified against the live app.
 */

import { ACTIVITY_TYPES } from './activity';
import { fetchUserGroups } from './groups';
import {
  ApiError,
  api,
  createPost,
  deletePostOrComment,
  getUpdates,
  getUserProfile,
  lookupPost,
  PostGone,
  request,
  updateProfile,
} from './client';
import { summarizeImageFailures } from '@/lib/image-debug';
import type { Asset, PostOrComment } from './types';

/** A large public community, used wherever a probe needs a busy feed. */
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

/* ------------------------------------------------------------------------ *
 * Phase 4 — writes
 * ------------------------------------------------------------------------ */

/**
 * Why does attaching an image fail with "Failed to fetch"?
 *
 * `GET /v1/assets/upload_url` succeeds (201) and hands back a pre-signed URL;
 * the `PUT` to that URL is what dies. In a browser, "Failed to fetch" on a
 * cross-origin PUT means the request never left — it was blocked before the
 * server saw it — and a PUT **always** triggers a CORS preflight, so the
 * storage bucket has to answer an `OPTIONS` from our origin for this to work
 * at all. Native clients like offsides never hit this; CORS does not exist
 * there, which is why sidechat.js's own upload path was never written for it.
 *
 * This reports the host we are actually being pointed at, the exact failure,
 * and whether any upload route exists on `api.sidechat.lol` instead — that
 * host sends `access-control-allow-origin: *`, so an endpoint there would
 * sidestep the problem completely and save building a proxy.
 *
 * Signature and credential params are reported by **name only**. The URL is a
 * bearer credential in its own right (docs/OPEN-SOURCE.md).
 */
async function probeImageUpload(): Promise<ProbeResult> {
  const base = {
    id: 'upload',
    label: 'Phase 4 — image upload CORS',
    question: 'Where does upload_url point, and can a browser PUT to it?',
  };
  const steps: string[] = [];

  try {
    const { upload_url, asset_id } = await request<{ upload_url: string; asset_id: string }>(
      '/v1/assets/upload_url?content_type=png',
    );
    if (!upload_url) {
      return { ...base, status: 'fail', detail: 'No upload_url came back.', evidence: steps.join('\n') };
    }

    const parsed = new URL(upload_url);
    steps.push(`upload_url host → ${parsed.host}`);
    steps.push(`  scheme ${parsed.protocol.replace(':', '')}, path depth ${parsed.pathname.split('/').filter(Boolean).length}`);
    steps.push(`  query params (names only) → ${[...parsed.searchParams.keys()].join(', ') || '(none)'}`);
    steps.push(`  asset_id returned → ${asset_id ? 'yes' : 'no'}`);
    steps.push(`  same origin as the API? → ${parsed.host === new URL(api.apiRoot).host ? 'YES' : 'no'}`);

    // 1x1 PNG, small enough that a successful upload costs nothing.
    const png = await (
      await fetch(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      )
    ).blob();

    try {
      const put = await fetch(upload_url, {
        method: 'PUT',
        body: png,
        headers: { 'Content-Type': 'image/png' },
      });
      steps.push(`PUT with Content-Type → HTTP ${put.status} ${put.ok ? '(WORKS)' : '(rejected by the server, not by CORS)'}`);
    } catch (e) {
      steps.push(
        `PUT with Content-Type → BLOCKED: ${e instanceof Error ? e.message : String(e)}` +
          '\n    (a thrown fetch here = the browser refused it; the server never replied)',
      );
    }

    // Content-Type is not CORS-safelisted at image/*, so it forces a preflight
    // on its own. Dropping it proves whether the method or the header is the
    // trigger — PUT alone should still preflight, and if this also fails the
    // bucket simply has no CORS policy for us.
    try {
      const put = await fetch(upload_url, { method: 'PUT', body: png });
      steps.push(`PUT without Content-Type → HTTP ${put.status}`);
    } catch (e) {
      steps.push(`PUT without Content-Type → BLOCKED: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Is there an upload route on the CORS-open API host instead?
    const candidates = ['/v1/assets', '/v1/assets/upload', '/v1/assets/library'];
    for (const path of candidates) {
      try {
        const res = await api.sendRequest(path, 'POST', JSON.stringify({}));
        steps.push(`POST ${path} → ${res.status} ${res.status === 404 ? '(no such route)' : '(EXISTS — worth pursuing)'}`);
      } catch (e) {
        steps.push(`POST ${path} → threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const blocked = steps.some((line) => line.includes('BLOCKED'));
    return {
      ...base,
      status: blocked ? 'fail' : 'pass',
      detail: blocked
        ? `Browser uploads are blocked by CORS on ${parsed.host}. This needs the Worker — see docs/WORKER.md.`
        : 'The PUT was not blocked; the failure is something else.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/* ------------------------------------------------------------------------ *
 * Phase 5 — the image investigation
 * ------------------------------------------------------------------------ */

/**
 * Finds a video asset to test against.
 *
 * Searches several groups and both rankings. The retired shape probe did this
 * and found videos; the poster probe looked at one group's hot feed only and
 * kept reporting "no video to test with" — in the same run where the other
 * found one. Videos are rare enough in any single feed that a narrow search
 * mostly measures luck.
 */
async function findVideoAsset(): Promise<Asset | undefined> {
  const groups = await fetchUserGroups();
  const targets = [SAMPLE_GROUP_ID, ...groups.slice(0, 3).map((g) => g.id)];

  for (const groupId of targets) {
    for (const sort of ['hot', 'top'] as const) {
      const page = (await api.getGroupPosts(groupId, sort)) as unknown as {
        posts?: PostOrComment[];
      };
      const asset = page.posts
        ?.flatMap((post) => post.assets ?? [])
        .find((a) => a.type === 'video');
      if (asset) return asset;
    }
  }
  return undefined;
}

/**
 * Is the video thumbnail 401 real, and does the bearer actually fix it?
 *
 * `assetNeedsAuth` says these URLs need the token and `AuthedImage` fetches them
 * with it, yet posters stayed blank. This separates the two possibilities that
 * were never distinguished: the fetch is refused (auth or CORS), or it succeeds
 * and the *element* refuses the bytes.
 */
async function probeVideoPoster(): Promise<ProbeResult> {
  const base = {
    id: 'video-poster',
    label: 'Images — video thumbnail fetch',
    question: 'Does fetching a poster with the bearer actually return an image?',
  };
  try {
    const asset = await findVideoAsset();
    const poster = asset?.thumbnail_asset?.url;

    if (!poster) {
      return {
        ...base,
        status: 'partial',
        detail: 'No video in any sampled feed right now. Re-run when one is visible.',
      };
    }

    const steps = [
      `asset → content_type=${asset?.content_type}, ${asset?.width}x${asset?.height}, ` +
        `stream is .m3u8=${String((asset?.url || '').split('?')[0].endsWith('.m3u8'))}`,
      `poster host → ${new URL(poster).host}`,
    ];

    // `/v1/assets/profile` turned out to answer 302 to a signed R2 URL with no
    // auth at all, which is why sending the bearer *broke* profile photos: a
    // preflighted request cannot follow a cross-origin redirect. If posters
    // behave the same way the fix is identical — stop sending the header.
    const bare = await fetch(poster, { redirect: 'manual' });
    steps.push(
      `without bearer, redirect:manual → HTTP ${bare.status} type=${bare.type}` +
        (bare.type === 'opaqueredirect'
          ? '  ← IT REDIRECTS. Load it plainly in an <img> and drop the bearer.'
          : ''),
    );

    const authed = await fetch(poster, {
      headers: { Authorization: `Bearer ${api.userToken}` },
    });
    steps.push(`with bearer → HTTP ${authed.status}`);
    if (authed.ok) {
      const blob = await authed.blob();
      steps.push(`  content-type ${blob.type || '(none)'}, ${blob.size} bytes`);
      steps.push(
        blob.size > 0 && blob.type.startsWith('image/')
          ? '  → real image bytes, so the fetch is NOT the problem; the element is'
          : '  → not image bytes, which is why the element renders nothing',
      );
    }

    return {
      ...base,
      status: authed.ok ? 'pass' : 'fail',
      detail: authed.ok
        ? 'The authed fetch works. The failure is downstream of the request.'
        : `The authed fetch returns ${authed.status} — the bearer is not enough for this URL.`,
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/**
 * Whatever failed to render since this page loaded.
 *
 * Browse the app first, then run this — the buffer is in memory and per page
 * load. This is the thing that was missing: a failure used to be a blank box
 * with no reason attached.
 */
async function probeImageFailures(): Promise<ProbeResult> {
  const base = {
    id: 'image-failures',
    label: 'Images — what actually failed',
    question: 'Which images failed to render, and for what reason?',
  };
  const summary = summarizeImageFailures();
  if (summary.length === 0) {
    return {
      ...base,
      status: 'partial',
      detail:
        'Nothing recorded. Either every image loaded, or nothing has been rendered yet this page load — browse a feed and a profile first, then run this again.',
    };
  }
  return {
    ...base,
    status: 'fail',
    detail: `${summary.length} distinct failure(s). "no-url" means the API gave us nothing to load; "http"/"network" mean the request failed; "decode" means the bytes arrived and the element rejected them.`,
    evidence: summary
      .map((row) => `${row.count}x  ${row.key}${row.sample.detail ? `\n      ${row.sample.detail}` : ''}`)
      .join('\n'),
  };
}

/**
 * Can a share code be resolved to a post? (Blocker 1, re-attacked.)
 *
 * `/p/<code>` only works today for posts already in the query cache, because
 * the API is UUID-keyed and nothing was found that accepts an `index_code`. That
 * sweep predated two things worth applying: **always include a control**, and
 * the discovery that this API has catch-all routes returning 200 with empty
 * bodies.
 *
 * offsides cannot help here — it is a native app with no URLs at all and no
 * deep-link handling, so it never needed to resolve a code (docs/OFFSIDES.md).
 *
 * Differential by construction: every candidate is tried with a **real** code
 * pulled from the live feed *and* a well-formed fake one. A route only counts if
 * it returns the real post for the real code and something different for the
 * fake. A 200 for both means a catch-all; a failure for both means no route.
 */
async function probeShareCode(): Promise<ProbeResult> {
  const base = {
    id: 'share-code',
    label: 'Blocker 1 — share code → post',
    question: 'Does any endpoint resolve an index_code, or is the worker still required?',
  };
  const steps: string[] = [];

  try {
    const page = (await api.getGroupPosts(SAMPLE_GROUP_ID, 'hot')) as unknown as {
      posts?: PostOrComment[];
    };
    const sample = page.posts?.find((p) => p.index_code);
    if (!sample?.index_code) {
      return { ...base, status: 'partial', detail: 'No post with an index_code in the feed to test with.' };
    }

    const real = sample.index_code;
    // Same alphabet and length, so a route that validates the *format* still
    // accepts it and answers "not found" rather than "bad request".
    const fake = 'Zz9Qx7Lm'.slice(0, real.length);
    steps.push(`real code → ${real} (expect it to resolve to post ${sample.id.slice(0, 8)}…)`);
    steps.push(`fake code → ${fake} (expect not-found)`);

    const candidates = [
      (c: string) => `/v1/posts?index_code=${c}`,
      (c: string) => `/v1/posts/${c}`,
      (c: string) => `/v1/posts/get?index_code=${c}`,
      (c: string) => `/v1/posts/by_code?code=${c}`,
      (c: string) => `/v1/posts/share/${c}`,
      (c: string) => `/v1/posts?share_code=${c}`,
      (c: string) => `/v1/share/${c}`,
    ];

    for (const build of candidates) {
      const path = build(real);
      try {
        const [realRes, fakeRes] = await Promise.all([
          api.sendRequest(build(real)),
          api.sendRequest(build(fake)),
        ]);
        const realBody = (await realRes.text()).slice(0, 240);
        const fakeBody = (await fakeRes.text()).slice(0, 120);

        const identical = realRes.status === fakeRes.status && realBody.slice(0, 120) === fakeBody;
        const resolves = realRes.ok && realBody.includes(sample.id);

        steps.push(
          `\n${path.replace(real, '<code>')}` +
            `\n  real → ${realRes.status}   fake → ${fakeRes.status}` +
            (resolves
              ? '\n  ✅ RESOLVES — the real code returned the real post id. Blocker 1 is closed.'
              : identical
                ? '\n  ✗ identical for both codes — catch-all or a fixed response, not a lookup'
                : `\n  ~ differs but no post id in the body: ${realBody}`),
        );
      } catch (e) {
        steps.push(`\n${path.replace(real, '<code>')} → threw ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const solved = steps.some((l) => l.includes('RESOLVES'));
    return {
      ...base,
      status: solved ? 'pass' : 'fail',
      detail: solved
        ? 'A route resolves share codes — the worker is not needed for this after all.'
        : 'No route resolves a share code. Cold-loading /p/<code> still needs the worker.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/* ------------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------------ */

/** How a value looked, never what it said. */
function shape(value: unknown) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return value ? `a string, ${value.length} chars` : 'an empty string';
  return typeof value;
}

/**
 * Where does your bio live?
 *
 * offsides 1.0 falls back from `getUpdates().user` to your public profile's
 * `description` — *"The bio lives on the public profile object"* — and
 * `useMyIdentity` now does the same. This settles whether that fallback is ever
 * the path taken, by the shape of each field. The bio itself stays out of the
 * report.
 */
async function probeBioSource(): Promise<ProbeResult> {
  const base = {
    id: 'bio-source',
    label: 'Profile — where your bio lives',
    question: 'Is your bio on getUpdates().user, or only on your public profile?',
  };
  try {
    const user = ((await getUpdates())?.user ?? {}) as Record<string, unknown>;
    const steps = [
      `getUpdates().user.bio → ${shape(user.bio)}`,
      `getUpdates().user.description → ${shape(user.description)}`,
      `getUpdates().user keys: [${Object.keys(user).sort().join(', ')}]`,
    ];
    const username = typeof user.username === 'string' ? user.username : undefined;
    let profile: Record<string, unknown> | null = null;
    if (username) {
      profile = (await getUserProfile(username)) as Record<string, unknown> | null;
      steps.push(
        profile
          ? `public profile description → ${shape(profile.description)}, bio → ${shape(profile.bio)}`
          : 'public profile → none (private, or no username)',
      );
    } else {
      steps.push('no username, so there is no public profile to read');
    }

    const onUpdates = typeof user.bio === 'string' || typeof user.description === 'string';
    const onProfile = typeof profile?.description === 'string' && profile.description !== '';
    const status: ProbeStatus = onUpdates || onProfile ? 'pass' : 'partial';
    return {
      ...base,
      status,
      detail: onUpdates
        ? 'getUpdates() carries the bio. The profile fallback is never taken for this account.'
        : onProfile
          ? 'Only the public profile carries it — getUpdates() does not. Without the fallback the You tab showed "No bio yet".'
          : username
            ? 'Neither carries a bio. Set one in Edit Profile and run this again to tell the two apart.'
            : 'Neither carries a bio, and getUpdates().user has no username either — so there is no public profile to fall back to. This account cannot settle it; one with a bio can.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/* ------------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------------ */

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** An id's structure, not its values: `votes~<uuid>~<n>`. */
function idShape(id: string) {
  return id
    .replace(UUID_ANYWHERE, '<uuid>')
    .replace(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{12,}\b/g, '<token>')
    .replace(/\d+/g, '<n>');
}

type Raw = Record<string, unknown>;

function rawItems(page: { items?: unknown } | null | undefined): Raw[] {
  return (Array.isArray(page?.items) ? page.items : []) as Raw[];
}

/** An object's keys and the types of their values — never the values. */
function fieldShapes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return shape(value);
  const fields = Object.entries(value as Raw).map(
    ([key, v]) => `${key}: ${Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v}`,
  );
  return `{${fields.sort().join(', ')}}`;
}

/**
 * Alerts — the types webyak has no label for, and the fields it doesn't read.
 *
 * The first run (2026-09-27) answered the rest, and those checks were retired
 * (docs/API.md#the-activity-feed-alerts). The feed pages, 30 at a time. Marking
 * read sticks, and batches. `getUpdates().activity_items` is the same list.
 * Timestamps are ISO, and every `post_id` opens a post. What's left: any type
 * outside `ACTIVITY_TYPES`, what `takedown_data` holds, and whose post each
 * type opens — yours or someone else's, and whether it quotes another — which
 * decides what tapping a `quote` alert should show.
 *
 * Read-only. Types, keys and counts only: an alert's text quotes posts.
 */
async function probeActivity(): Promise<ProbeResult> {
  const base = {
    id: 'activity',
    label: 'Alerts — unmapped types and fields',
    question:
      'Which alert types have no label yet, what does takedown_data hold, and whose post does each type open? (PLAN Q14)',
  };
  const steps: string[] = [];
  try {
    // Two pages, for more types to look at.
    const first = await request<Raw>('/v1/activity');
    const items = rawItems(first);
    if (typeof first?.cursor === 'string' && first.cursor) {
      items.push(
        ...rawItems(await request<Raw>(`/v1/activity?cursor=${encodeURIComponent(first.cursor)}`)),
      );
    }

    interface Stats {
      count: number;
      keys: Set<string>;
      ids: Set<string>;
      takedown: Set<string>;
      samplePostId?: string;
    }
    const byType = new Map<string, Stats>();
    for (const item of items) {
      const type = typeof item.type === 'string' ? item.type : `(type ${shape(item.type)})`;
      const stats: Stats = byType.get(type) ?? {
        count: 0,
        keys: new Set(),
        ids: new Set(),
        takedown: new Set(),
      };
      stats.count += 1;
      for (const key of Object.keys(item)) stats.keys.add(key);
      if (typeof item.id === 'string') stats.ids.add(idShape(item.id));
      if (item.takedown_data !== undefined) stats.takedown.add(fieldShapes(item.takedown_data));
      if (typeof item.post_id === 'string' && item.post_id) stats.samplePostId ??= item.post_id;
      byType.set(type, stats);
    }

    const known = new Set<string>(ACTIVITY_TYPES);
    const types = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b));
    const unmapped = types.filter(([type]) => !known.has(type)).map(([type]) => type);
    steps.push(`/v1/activity, two pages → ${items.length} alert(s) of ${types.length} type(s)`);
    for (const [type, stats] of types) {
      steps.push(
        `  ${type}${known.has(type) ? '' : ' — NO LABEL YET'}: ${stats.count} · id ${[...stats.ids].join(' | ')} · keys [${[...stats.keys].sort().join(', ')}]`,
      );
      if (stats.takedown.size) steps.push(`    takedown_data → ${[...stats.takedown].join(' | ')}`);
    }

    // Whose post each type opens. One lookup per type.
    for (const [type, stats] of types) {
      if (!stats.samplePostId) continue;
      try {
        const post = await lookupPost(stats.samplePostId);
        steps.push(
          `  ${type} post_id → ${post.authored_by_user ? 'your own post' : "someone else's post"}${post.quote_post_id ? ', which quotes another post' : ''}`,
        );
      } catch (e) {
        steps.push(
          `  ${type} post_id → ${e instanceof PostGone ? 'gone (404)' : `error: ${e instanceof Error ? e.message : String(e)}`}`,
        );
      }
    }

    return {
      ...base,
      status: items.length === 0 ? 'partial' : unmapped.length ? 'fail' : 'pass',
      detail:
        items.length === 0
          ? 'No alerts on this account right now. Run it again once something has happened.'
          : unmapped.length
            ? `${unmapped.length} type(s) with no label yet: ${unmapped.join(', ')}. They still render, under their own name.`
            : `Every type on two pages has a label: ${types.map(([type, stats]) => `${type} ${stats.count}`).join(', ')}.`,
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeShareCode(),
    await probeActivity(),
    await probeVideoPoster(),
    await probeImageFailures(),
    await probeBioSource(),
  ];
}

/* ------------------------------------------------------------------------ *
 * Length limits — writes, behind their own button (PLAN Q11)
 * ------------------------------------------------------------------------ */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Filler of an exact length that says what it is. ASCII, so characters, UTF-16 units and bytes agree. */
function filler(length: number, what: string) {
  const head = `webyak ${what} length test, ${length} chars, removed automatically. `;
  return (head + 'x'.repeat(Math.max(0, length - head.length))).slice(0, length);
}

function describeError(e: unknown) {
  if (e instanceof ApiError) {
    return [e.status, e.code, e.message.slice(0, 120)].filter(Boolean).join(' · ');
  }
  return e instanceof Error ? e.message : String(e);
}

const isRateLimit = (e: unknown) => e instanceof ApiError && e.status === 429;

/**
 * How long can a post be?
 *
 * webyak blocks at 300; offsides counts to 256 and lets you post past it.
 * Neither number came from the server. 257 separates the two, and 300/301
 * pins webyak's exactly. Anonymous, in `groupId`, and each accepted post is
 * deleted before the next is tried — a probe that leaves posts behind is the
 * reason the old write probes were retired.
 */
async function probePostLength(groupId: string): Promise<ProbeResult> {
  const base = {
    id: 'post-length',
    label: 'Limits — post length',
    question: 'What does the server enforce? webyak blocks at 300; offsides counts to 256.',
  };
  const steps: string[] = [];
  const accepted: number[] = [];
  let rejectedAt: number | undefined;
  let leftBehind = 0;

  for (const length of [257, 300, 301]) {
    let id: string | undefined;
    try {
      id = (await createPost({ text: filler(length, 'post'), groupId, anonymous: true }))?.id;
    } catch (e) {
      if (isRateLimit(e)) {
        steps.push(`${length} chars → rate-limited, stopped: ${describeError(e)}`);
        return { ...base, status: 'partial', detail: 'Rate-limited before an answer. Try again later.', evidence: steps.join('\n') };
      }
      steps.push(`${length} chars → rejected: ${describeError(e)}`);
      rejectedAt = length;
      break;
    }
    accepted.push(length);
    steps.push(`${length} chars → accepted`);
    if (id) {
      try {
        await deletePostOrComment(id);
        steps.push('  deleted');
      } catch (e) {
        leftBehind += 1;
        steps.push(`  ⚠ NOT deleted (${describeError(e)}) — remove it from your profile by hand`);
      }
    } else {
      leftBehind += 1;
      steps.push('  ⚠ no post came back to delete — check your profile and remove it by hand');
    }
    await pause(2500);
  }

  const most = accepted[accepted.length - 1];
  const detail =
    rejectedAt === 257
      ? 'The limit is 256 or lower. webyak lets 257–300 through to a server error — lower MAX_LENGTH in compose.tsx.'
      : rejectedAt === 300
        ? 'The limit is between 257 and 299. Narrow it down before changing MAX_LENGTH.'
        : rejectedAt === 301
          ? 'Exactly 300. webyak is right, and offsides’ 256 counter is stale.'
          : `More than ${most}. webyak’s 300 is stricter than the server; raising it needs a longer probe.`;
  return {
    ...base,
    status: leftBehind > 0 ? 'error' : 'pass',
    detail: leftBehind > 0 ? `${detail} ⚠ ${leftBehind} test post(s) could not be deleted — see below.` : detail,
    evidence: steps.join('\n'),
  };
}

/**
 * Your bio exactly as the You tab reads it, or `undefined` if it cannot be read
 * with certainty — in which case the bio probe does not run, since restoring a
 * bio it could not read would be a guess.
 */
async function readOwnBio(): Promise<string | undefined> {
  const user = ((await getUpdates())?.user ?? {}) as Record<string, unknown>;
  if (typeof user.bio === 'string') return user.bio;
  if (typeof user.description === 'string') return user.description;
  if (typeof user.username !== 'string' || !user.username) return undefined;
  const profile = (await getUserProfile(user.username)) as Record<string, unknown> | null;
  if (typeof profile?.description === 'string') return profile.description;
  if (typeof profile?.bio === 'string') return profile.bio;
  return undefined;
}

/**
 * How long can a bio be? webyak allows 150, offsides 200. Sets three test bios
 * and **always** puts the original back, then reads it back to prove it.
 */
async function probeBioLength(userId: string): Promise<ProbeResult> {
  const base = {
    id: 'bio-length',
    label: 'Limits — bio length',
    question: 'What does the server enforce? webyak allows 150; offsides 200.',
  };
  let original: string | undefined;
  try {
    original = await readOwnBio();
  } catch (e) {
    return { ...fail(base, e), detail: `Couldn't read your current bio, so it wasn't touched: ${describeError(e)}` };
  }
  if (original === undefined) {
    return {
      ...base,
      status: 'partial',
      detail:
        "Couldn't read your current bio with certainty, so it wasn't touched — restoring it afterwards would have been a guess. Set a bio in Edit Profile and run this again.",
    };
  }

  const steps: string[] = [`original bio: ${shape(original)} (kept, not shown)`];
  const accepted: number[] = [];
  let rejectedAt: number | undefined;
  try {
    for (const length of [151, 200, 201]) {
      try {
        await updateProfile(userId, { bio: filler(length, 'bio') });
      } catch (e) {
        steps.push(`${length} chars → ${isRateLimit(e) ? 'rate-limited' : 'rejected'}: ${describeError(e)}`);
        if (!isRateLimit(e)) rejectedAt = length;
        break;
      }
      accepted.push(length);
      steps.push(`${length} chars → accepted`);
      await pause(1500);
    }
  } finally {
    try {
      await updateProfile(userId, { bio: original });
      const after = await readOwnBio();
      steps.push(after === original ? 'original bio restored, and read back unchanged' : `⚠ restored, but it reads back as ${shape(after)} — check Edit Profile`);
    } catch (e) {
      steps.push(`⚠ COULD NOT RESTORE your bio (${describeError(e)}) — set it again in Edit Profile`);
    }
  }

  const most = accepted[accepted.length - 1];
  const restored = steps[steps.length - 1].startsWith('original bio restored');
  const detail =
    rejectedAt === 151
      ? 'The limit is 150 or lower. webyak’s 150 holds; offsides’ 200 is wrong.'
      : rejectedAt === 200
        ? 'The limit is between 151 and 199. Narrow it down before changing MAX_BIO.'
        : rejectedAt === 201
          ? 'Exactly 200. Raise MAX_BIO in me/edit.tsx to match offsides.'
          : most
            ? `More than ${most}. webyak’s 150 is stricter than the server.`
            : 'No answer — see below.';
  return {
    ...base,
    status: !restored ? 'error' : rejectedAt || most ? 'pass' : 'partial',
    detail: restored ? detail : `${detail} ⚠ Your bio may not be restored — see below.`,
    evidence: steps.join('\n'),
  };
}

/**
 * The two length probes. Kept behind their own confirm: they post to a real
 * community and change your public bio, both for seconds, both undone.
 */
export async function runLengthProbes(groupId: string, userId: string | null): Promise<ProbeResult[]> {
  const posts = await probePostLength(groupId);
  const bio: ProbeResult = userId
    ? await probeBioLength(userId)
    : {
        id: 'bio-length',
        label: 'Limits — bio length',
        question: 'What does the server enforce?',
        status: 'partial',
        detail: 'Not signed in.',
      };
  return [posts, bio];
}

/**
 * Kept out of `runAllProbes` deliberately. These create real content in a real
 * community, so they need a separate, explicit press — nobody should post to
 * Virginia Tech by clicking "run diagnostics".
 */
/**
 * Kept separate from the read-only run because it isn't a plain read — it asks
 * for an upload URL and PUTs bytes at it. Nothing is posted and nothing becomes
 * visible to anyone.
 *
 * This used to hold the Phase 4 write round-trip (create a post, comment, vote,
 * delete) and the poll round-trip. Both were retired on 2026-09-11 once writing
 * was verified against the live API *and* confirmed to sync both ways with the
 * official app — at which point a probe that posts real content to a real
 * community every run is a liability rather than evidence.
 */
export async function runUploadProbe(): Promise<ProbeResult[]> {
  return [await probeImageUpload()];
}

/* ------------------------------------------------------------------------ *
 * Chats — the mark-read route, behind its own button (PLAN Q19)
 * ------------------------------------------------------------------------ */

interface ChatUnderTest {
  id: string;
  updatedAt?: string;
  lastMessageId?: string;
}

interface ChatReadCandidate {
  method: 'GET' | 'POST' | 'PATCH';
  path: (id: string) => string;
  body?: (chat: ChatUnderTest) => Raw;
}

/**
 * Where a chat might be marked read. No client has this call — sidechat.js,
 * offsides and the official web client all lack it — so these are guesses in
 * the API's own style, `/v1/<thing>/<verb>` with the id as `chat_id`. They are
 * ordered by likeness to the one read call that does exist:
 * `POST /v1/activity/seen {ids}`.
 */
const CHAT_READ_CANDIDATES: ChatReadCandidate[] = [
  { method: 'POST', path: () => '/v1/chats/seen', body: (c) => ({ chat_id: c.id }) },
  { method: 'POST', path: () => '/v1/chats/seen', body: (c) => ({ ids: [c.id] }) },
  { method: 'POST', path: () => '/v1/chats/read', body: (c) => ({ chat_id: c.id }) },
  { method: 'POST', path: () => '/v1/chats/mark_read', body: (c) => ({ chat_id: c.id }) },
  { method: 'POST', path: () => '/v1/chats/messages/seen', body: (c) => ({ chat_id: c.id }) },
  { method: 'POST', path: () => '/v1/chats/messages/read', body: (c) => ({ chat_id: c.id }) },
  {
    method: 'POST',
    path: () => '/v1/chats/read',
    body: (c) => ({ chat_id: c.id, message_id: c.lastMessageId }),
  },
  {
    method: 'POST',
    path: () => '/v1/chats/last_read',
    body: (c) => ({ chat_id: c.id, last_read_timestamp: c.updatedAt }),
  },
  {
    method: 'POST',
    path: () => '/v1/chats/update',
    body: (c) => ({ chat_id: c.id, last_read_timestamp: c.updatedAt }),
  },
  { method: 'PATCH', path: (id) => `/v1/chats/${id}`, body: (c) => ({ last_read_timestamp: c.updatedAt }) },
  { method: 'POST', path: (id) => `/v1/chats/${id}/read`, body: () => ({}) },
  { method: 'GET', path: (id) => `/v1/chats/messages?chat_id=${id}&mark_read=true` },
];

/** A response body, described by shape: `empty`, `json {…}`, or its length. */
async function bodyShape(res: Response) {
  const text = await res.text().catch(() => '');
  if (!text) return 'empty';
  try {
    return `json ${fieldShapes(JSON.parse(text))}`;
  } catch {
    return `${text.length} chars`;
  }
}

/**
 * Chats — which request marks a chat read on the server?
 *
 * Opening a thread in webyak doesn't mark it read: `last_read_timestamp` only
 * moves when the official app reads it, so a chat stayed unread here, and
 * still does in the official app (webyak now keeps its own mark,
 * src/lib/chat-reads.ts). Every path under `/v1/chats/` answers `200`, so a
 * status proves nothing. This sends each candidate for one unread chat and
 * re-reads the list after each; the route is the one after which that chat's
 * `last_read_timestamp` moves. It stops at the first that works.
 *
 * Writes: it marks one chat read, which is what webyak wants to do anyway.
 * Paths are reported with the id replaced, and bodies by their keys.
 */
async function probeChatRead(): Promise<ProbeResult> {
  const base = {
    id: 'chat-read',
    label: 'Chats — the mark-read route',
    question: 'Which request marks a chat read on the server, so the official app agrees? (PLAN Q19)',
  };
  const steps: string[] = [];
  const chats = async () =>
    ((await request<{ chats?: unknown[] }>('/v1/chats'))?.chats ?? []).map(
      (entry) => ((entry as { chat?: unknown })?.chat ?? entry) as Raw,
    );
  const lastRead = (chat: Raw | undefined) =>
    typeof chat?.last_read_timestamp === 'string' ? chat.last_read_timestamp : null;
  const unreadOnServer = (chat: Raw) =>
    typeof chat.updated_at === 'string' &&
    (!lastRead(chat) || Date.parse(chat.updated_at) > Date.parse(lastRead(chat) as string));

  try {
    const all = (await chats()).filter((chat) => typeof chat.id === 'string');
    const target = all.find(unreadOnServer) ?? all[0];
    if (!target) {
      return { ...base, status: 'partial', detail: 'No chats on this account to test with.' };
    }
    const unread = unreadOnServer(target);
    const messages = (Array.isArray(target.messages) ? target.messages : []) as Raw[];
    const last = messages[messages.length - 1];
    const chat: ChatUnderTest = {
      id: target.id as string,
      updatedAt: typeof target.updated_at === 'string' ? target.updated_at : undefined,
      lastMessageId: typeof last?.id === 'string' ? last.id : undefined,
    };
    const before = lastRead(target);
    steps.push(
      `/v1/chats → ${all.length} chat(s), ${all.filter(unreadOnServer).length} unread by the server's mark. Testing one that is ${unread ? 'unread' : 'already read, so a miss proves less'}; its last_read_timestamp is ${before ? 'set' : 'unset'}`,
    );

    const hide = (path: string) => path.split(chat.id).join('<chat_id>');
    const control = await api.sendRequest(
      `/v1/chats/webyak-control-${Date.now()}`,
      'POST',
      JSON.stringify({ chat_id: chat.id }),
    );
    const controlBody = await bodyShape(control);
    steps.push(`CONTROL POST /v1/chats/webyak-control-… → ${control.status}, body ${controlBody}`);

    let found: string | null = null;
    for (const candidate of CHAT_READ_CANDIDATES) {
      const path = candidate.path(chat.id);
      const body = candidate.body?.(chat);
      const label = `${candidate.method} ${hide(path)}${body ? ` {${Object.keys(body).join(', ')}}` : ''}`;
      try {
        const res = await api.sendRequest(
          path,
          candidate.method,
          body === undefined ? undefined : JSON.stringify(body),
        );
        const shapeOf = await bodyShape(res);
        await pause(600);
        const after = lastRead((await chats()).find((c) => c.id === chat.id));
        const moved = after !== before;
        steps.push(
          `${label} → ${res.status}, body ${shapeOf}${res.status === control.status && shapeOf === controlBody ? ' (same as control)' : ''}${moved ? '  ✓ last_read_timestamp MOVED' : ''}`,
        );
        if (moved) {
          found = label;
          break;
        }
      } catch (e) {
        steps.push(`${label} → error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      ...base,
      status: found ? 'pass' : 'fail',
      detail: found
        ? `${found} marks a chat read on the server. webyak can send it on open and for Mark all read, and the official app will agree.`
        : `None of ${CHAT_READ_CANDIDATES.length} candidates moved last_read_timestamp${unread ? '' : ' — though the chat was already read, which makes a miss less telling'}. The route is elsewhere; a capture of the official app's traffic would find it.`,
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/**
 * Separate from the read-only run because it writes: it marks one chat read,
 * in the official app too if a candidate works.
 */
export async function runChatReadProbe(): Promise<ProbeResult[]> {
  return [await probeChatRead()];
}
