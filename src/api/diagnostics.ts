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
 * reason; their answers live in the docs, not here.
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
 * | `probeMessaging` | the `message.type` values the system-message heuristic needs |
 * | `probeVideoPoster` | are video thumbnails reachable, or worker-only? |
 * | `probeImageFailures` | what actually failed to render this page load |
 * | `probeImageUpload` | is there an upload route on the CORS-open host? |
 *
 * Only `probeImageUpload` is not read-only — it requests an upload URL. It does
 * not post anything; the write round-trip probes were retired once writes were
 * verified against the live app.
 */

import { fetchUserGroups } from './groups';
import { api, request } from './client';
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

/* ------------------------------------------------------------------------ *
 * Phase 5b — the You tab and the For You feed
 * ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ *
 * Phase 6 — messaging
 * ------------------------------------------------------------------------ */

/**
 * The DM and group-chat surface, and the two gaps in it.
 *
 * Everything in Phase 6 was built against shapes read out of sidechat.js's
 * source rather than observed, because this account may have no threads. This
 * reports what the endpoints actually return, and sweeps for the two routes the
 * UI currently has to apologise for: accepting a message request, and reading a
 * group chat's messages.
 *
 * Read-only — it lists and inspects, and never sends or joins.
 */
async function probeMessaging(): Promise<ProbeResult> {
  const base = {
    id: 'messaging',
    label: 'Phase 6 — DMs and group chats',
    question: 'What is inside the chat envelopes, and which /v1/chats routes are real?',
  };
  const steps: string[] = [];

  // Round 1 established the envelope: entries are `{chat, cursor}`, not threads.
  // This unwraps before reporting, so the keys below are the real ones.
  const inner = (entry: unknown): Record<string, unknown> => {
    if (!entry || typeof entry !== 'object') return {};
    const wrapper = entry as { chat?: unknown };
    return ((wrapper.chat ?? entry) as Record<string, unknown>) ?? {};
  };

  try {
    try {
      const dms = await request<{ chats?: unknown[] }>('/v1/chats');
      const list = dms?.chats ?? [];
      steps.push(`/v1/chats → ${list.length} thread(s)`);
      if (list[0]) {
        const thread = inner(list[0]);
        steps.push(`  UNWRAPPED thread keys → ${Object.keys(thread).join(', ')}`);
        steps.push(`  accept_status values → ${[...new Set(list.map((t) => String(inner(t).accept_status)))].join(', ')}`);
        const msgs = thread.messages as unknown[] | undefined;
        steps.push(
          Array.isArray(msgs) && msgs[0]
            ? `  message keys → ${Object.keys(msgs[0] as object).join(', ')}`
            : '  no messages inlined — the list is metadata only, so previews need another source',
        );
        steps.push(`  sample thread → ${preview(thread, 700)}`);

        // The system-message heuristic (X left the chat) matches on text
        // because these values have never been dumped. With them it can key on
        // the field instead — see isSystemMessage in types.ts.
        const allTypes = new Set<string>();
        for (const entry of list) {
          for (const m of (inner(entry).messages as { type?: string }[] | undefined) ?? []) {
            if (m?.type) allTypes.add(m.type);
          }
        }
        steps.push(`  distinct message.type values → ${[...allTypes].join(', ') || '(none)'}`);
      }
    } catch (e) {
      steps.push(`/v1/chats → FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const explore = await request<{ chats?: unknown[] }>('/v1/chats/explore');
      const list = explore?.chats ?? [];
      steps.push(`\n/v1/chats/explore → ${list.length} chat(s)`);
      if (list[0]) steps.push(`  UNWRAPPED chat keys → ${Object.keys(inner(list[0])).join(', ')}`);
    } catch (e) {
      steps.push(`/v1/chats/explore → FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const updates = (await api.getUpdates('')) as { chats?: { chats?: unknown[] } };
      const entries = Array.isArray(updates?.chats) ? updates.chats : (updates?.chats?.chats ?? []);
      steps.push(`\ngetUpdates().chats.chats → ${entries.length} joined chat(s)`);
      if (entries[0]) {
        steps.push(`  UNWRAPPED keys → ${Object.keys(inner(entries[0])).join(', ')}`);
        steps.push(`  sample → ${preview(inner(entries[0]), 500)}`);
      }
    } catch (e) {
      steps.push(`getUpdates().chats → FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    /*
     * ⚠️ The control this probe was missing.
     *
     * Round 1 reported /v1/chats/accept, /v1/chats/requests, /v1/chats/decline
     * and /v1/chats/groups all answering 200, which read as four discovered
     * endpoints. But every *two*-segment path 404'd, which is the signature of a
     * catch-all matching /v1/chats/:something — under which a 200 means nothing.
     *
     * A nonsense single-segment path settles it. Without this control the whole
     * sweep is uninterpretable, which is the same mistake the `period` probe was
     * built to avoid and I repeated here.
     */
    const controlPath = `/v1/chats/webyak-control-${Date.now()}`;
    let controlStatus = 0;
    let controlBody = '';
    try {
      const res = await api.sendRequest(controlPath);
      controlStatus = res.status;
      controlBody = (await res.text()).slice(0, 160);
    } catch {
      controlStatus = -1;
    }
    steps.push(
      `\nCONTROL ${controlPath} → ${controlStatus}` +
        (controlStatus === 200
          ? `\n  ⚠️ 200 on a nonsense path — /v1/chats/:x is a catch-all, so every 200 below is meaningless.\n  body: ${controlBody}`
          : '\n  ✅ a nonsense path does not 200, so a 200 below is a real route.'),
    );

    steps.push('\nRoutes (compare each against the control):');
    for (const path of [
      '/v1/chats/groups',
      '/v1/chats/accept',
      '/v1/chats/requests',
      '/v1/chats/decline',
    ]) {
      try {
        const res = await api.sendRequest(path);
        const body = (await res.text()).slice(0, 200);
        steps.push(
          `  ${path} → ${res.status}` +
            (res.status === controlStatus && body === controlBody
              ? '  (identical to control — not a real route)'
              : `  body: ${body}`),
        );
      } catch (e) {
        steps.push(`  ${path} → threw ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      ...base,
      status: steps.some((l) => l.includes('FAILED')) ? 'partial' : 'pass',
      detail:
        controlStatus === 200
          ? 'A nonsense path also returns 200 — treat every route result here as unproven and compare the bodies.'
          : 'Control behaved, so the route results below are real.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
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

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeShareCode(),
    await probeMessaging(),
    await probeVideoPoster(),
    await probeImageFailures(),
  ];
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
