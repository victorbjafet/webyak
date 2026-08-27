/**
 * One-shot probes for open questions that can only be answered with a live
 * token. Run from /diagnostics.
 *
 * Most probes are read-only. The Phase 4 write round is **not** — see
 * `probeWriteRoundTrip`, which creates real content and deletes it again.
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
import {
  api,
  createComment,
  createPost,
  deletePostOrComment,
  request,
  setVote,
} from './client';
import { feedHygieneStats } from './feed';
import type { PostOrComment } from './types';

export const SAMPLE_GROUP_ID = '602fb305-4ec2-4d01-83be-4d80c6636a56';
/** Known to have a real profile photo, unlike emoji-only accounts. */
export const SAMPLE_PROFILE = 'snoopyvt';

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
    question: `Which field carries @${SAMPLE_PROFILE}'s profile photo?`,
  };
  try {
    // A profile is a group object: getUserProfile reads /v1/groups/username.
    const res = await api.sendRequest(
      `/v1/groups/username?username=${encodeURIComponent(SAMPLE_PROFILE)}`,
    );
    const text = await res.text();
    if (!res.ok) {
      return { ...base, status: 'fail', detail: `HTTP ${res.status}.`, evidence: preview(text.slice(0, 300)) };
    }
    const json = JSON.parse(text) as { group?: Record<string, unknown> };
    const group = json.group ?? (json as Record<string, unknown>);

    // Report every field whose value looks like an image URL, so we stop
    // guessing at the field name.
    const urlish = Object.entries(group)
      .filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v))
      .map(([k, v]) => `${k} = ${String(v).slice(0, 90)}`);

    return {
      ...base,
      status: urlish.length > 0 ? 'pass' : 'fail',
      detail:
        urlish.length > 0
          ? `Found ${urlish.length} URL-valued field(s) — that's where the photo lives.`
          : `No URL-valued fields. Keys: ${Object.keys(group).join(', ')}. This account may render its photo from something other than the profile payload.`,
      evidence: preview({ urlFields: urlish, group }, 900),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** Why doesn't switching communities take effect? Dump what getUpdates returns. */
async function probeMyGroupsShape(): Promise<ProbeResult> {
  const base = {
    id: 'my-groups',
    label: 'Communities — switcher source',
    question: 'What exactly does getUpdates().groups contain?',
  };
  try {
    const groups = await fetchUserGroups();
    const ids = groups.map((g) => g.id);
    const distinct = new Set(ids.filter(Boolean)).size;
    const missingId = ids.filter((id) => !id).length;

    return {
      ...base,
      status: missingId === 0 && distinct === groups.length ? 'pass' : 'fail',
      detail:
        missingId > 0
          ? `${missingId} of ${groups.length} have no id — selection cannot work by id.`
          : distinct !== groups.length
            ? `Only ${distinct} distinct ids across ${groups.length} groups.`
            : `${groups.length} groups, all with distinct ids. Selection by id is sound.`,
      evidence: preview(
        groups.map((g) => ({
          id: g.id,
          name: g.name,
          index_name: g.index_name,
          icon_url: g.icon_url ?? null,
        })),
        900,
      ),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/* ------------------------------------------------------------------------ *
 * Phase 4 — writes
 * ------------------------------------------------------------------------ */

/**
 * The one probe here that is **not** read-only.
 *
 * Every write path in one pass: create a post, comment on it, vote on both,
 * then delete the post. It is a round trip rather than four separate probes
 * because the interesting failures are in the *sequence* — a comment needs a
 * real parent id, and a vote needs something that exists.
 *
 * It posts anonymously into the sample group, marked as a test, and deletes
 * what it made. If it reports a leftover id, that post is live and needs
 * deleting by hand.
 */
async function probeWriteRoundTrip(): Promise<ProbeResult> {
  const base = {
    id: 'writes',
    label: 'Phase 4 — write round trip',
    question: 'Do create, comment, vote and delete all work with our request shapes?',
  };
  const steps: string[] = [];
  let postId: string | undefined;

  try {
    const post = await createPost({
      text: `webyak write test ${new Date().toISOString()} — deleting this automatically`,
      groupId: SAMPLE_GROUP_ID,
      anonymous: true,
    });
    postId = post?.id;
    steps.push(
      postId
        ? `createPost → ok, id ${postId}, index_code ${post?.index_code ?? '(none)'}`
        : `createPost → returned no post: ${preview(post, 200)}`,
    );
    if (!postId) {
      return { ...base, status: 'fail', detail: 'createPost returned nothing usable.', evidence: steps.join('\n') };
    }

    try {
      await setVote(postId, 'upvote');
      const after = (await api.getPost(postId)) as unknown as PostOrComment;
      steps.push(
        `setVote(upvote) → vote_status ${after?.vote_status}, vote_total ${after?.vote_total}`,
      );
    } catch (e) {
      steps.push(`setVote → FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    let commentId: string | undefined;
    try {
      const comment = await createComment({
        parentPostId: postId,
        text: 'webyak write test comment',
        groupId: SAMPLE_GROUP_ID,
        anonymous: true,
      });
      commentId = comment?.id;
      steps.push(
        commentId
          ? `createComment → ok, id ${commentId}`
          : `createComment → returned no comment: ${preview(comment, 200)}`,
      );
    } catch (e) {
      steps.push(`createComment → FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (commentId) {
      try {
        await setVote(commentId, 'downvote');
        steps.push('setVote on comment → ok (comments accept the same endpoint)');
      } catch (e) {
        steps.push(`setVote on comment → FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await deletePostOrComment(postId);
    steps.push('deletePostOrComment → ok, test post removed');
    postId = undefined;

    const failed = steps.filter((s) => s.includes('FAILED')).length;
    return {
      ...base,
      status: failed === 0 ? 'pass' : 'partial',
      detail:
        failed === 0
          ? 'Post, comment, vote and delete all round-tripped. Cleaned up after itself.'
          : `${failed} step(s) failed — see evidence.`,
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return {
      ...base,
      status: 'error',
      detail:
        (e instanceof Error ? e.message : String(e)) +
        (postId ? ` — LEFTOVER POST ${postId} still live, delete it by hand.` : ''),
      evidence: steps.join('\n'),
    };
  }
}

/**
 * Does a poll survive a round trip, and does the library's broken
 * `view_results` path work once the `&`/`?` typo is corrected?
 */
async function probePolls(): Promise<ProbeResult> {
  const base = {
    id: 'polls',
    label: 'Phase 4 — polls',
    question: 'Does poll_request create a poll, and is view_results reachable at the fixed path?',
  };
  const steps: string[] = [];
  let postId: string | undefined;

  try {
    const post = await createPost({
      text: `webyak poll test ${new Date().toISOString()}`,
      groupId: SAMPLE_GROUP_ID,
      anonymous: true,
      pollOptions: ['first', 'second'],
    });
    postId = post?.id;
    steps.push(`createPost(poll) → id ${postId ?? '(none)'}, poll ${preview(post?.poll, 300)}`);

    const pollId = post?.poll?.id;
    if (pollId) {
      // The library sends `/v1/polls/view_results&cacheBust=…`, which is a path
      // that cannot exist. This is the corrected `?` form.
      try {
        const res = await request<unknown>('/v1/polls/view_results', 'POST', { poll_id: pollId });
        steps.push(`view_results (fixed path) → ${preview(res, 200)}`);
      } catch (e) {
        steps.push(`view_results → FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      steps.push('No poll came back on the created post — poll_request may be wrong.');
    }

    if (postId) {
      await deletePostOrComment(postId);
      steps.push('deleted the test poll post');
      postId = undefined;
    }

    const failed = steps.filter((s) => s.includes('FAILED')).length;
    return {
      ...base,
      status: post?.poll ? (failed === 0 ? 'pass' : 'partial') : 'fail',
      detail: post?.poll
        ? 'Poll created and cleaned up.'
        : 'The post was created but carried no poll.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return {
      ...base,
      status: 'error',
      detail:
        (e instanceof Error ? e.message : String(e)) +
        (postId ? ` — LEFTOVER POST ${postId} still live, delete it by hand.` : ''),
      evidence: steps.join('\n'),
    };
  }
}

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

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeMyGroupsShape(),
    await probeProfileShape(),
    await probeVideoShape(),
    await probeGapEndpoints(),
    await probeFeedHygiene(),
  ];
}

/**
 * Kept out of `runAllProbes` deliberately. These create real content in a real
 * community, so they need a separate, explicit press — nobody should post to
 * Virginia Tech by clicking "run diagnostics".
 */
export async function runWriteProbes(): Promise<ProbeResult[]> {
  return [await probeWriteRoundTrip(), await probePolls(), await probeImageUpload()];
}
