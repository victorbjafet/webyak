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
import { summarizeImageFailures } from '@/lib/image-debug';
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

/* ------------------------------------------------------------------------ *
 * Phase 5 — the image investigation
 * ------------------------------------------------------------------------ */

/**
 * Where do community icons actually come from?
 *
 * The reframing that prompted this: the app shows initials for Virginia Tech,
 * and `GroupAvatar` only does that when `icon_url` is **falsy**. So for the
 * groups we render there was never a URL to load — no amount of work on the
 * image pipeline could have fixed it. `icon.yik-yak.com` was verified public
 * and returning 200, which made the host look innocent and sent the last three
 * rounds hunting a rendering bug that, for community icons, does not exist.
 *
 * The same group is reachable through four endpoints. This asks each one for
 * it and reports which carry `icon_url`, so the fix becomes "read the group
 * from the right place" rather than "make images work".
 */
async function probeGroupIconSource(): Promise<ProbeResult> {
  const base = {
    id: 'group-icons',
    label: 'Images — where do community icons live?',
    question: 'Which endpoint returns a group with icon_url?',
  };
  const rows: string[] = [];

  const describe = (label: string, group: Record<string, unknown> | undefined | null) => {
    if (!group) {
      rows.push(`${label} → no group returned`);
      return;
    }
    const iconish = Object.entries(group)
      .filter(([k, v]) => typeof v === 'string' && (/icon|image|photo|avatar|logo/i.test(k) || /^https?:\/\//.test(v)))
      .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`);
    rows.push(
      `${label} → icon_url ${group.icon_url ? 'YES' : 'no'}` +
        (iconish.length ? `\n    image-ish fields: ${iconish.join(', ')}` : '') +
        `\n    keys: ${Object.keys(group).join(', ')}`,
    );
  };

  try {
    const mine = await fetchUserGroups();
    const target = mine[0];
    if (!target) {
      return { ...base, status: 'fail', detail: 'No groups on this account to test with.' };
    }
    rows.push(`Testing with: ${target.name} (${target.id})`);
    describe('1. getUpdates().groups  [what the app renders]', target as unknown as Record<string, unknown>);

    try {
      const meta = await request<{ group?: Record<string, unknown> }>(
        `/v1/groups/${encodeURIComponent(target.id)}`,
      );
      describe('2. GET /v1/groups/<id>', meta.group ?? (meta as Record<string, unknown>));
    } catch (e) {
      rows.push(`2. GET /v1/groups/<id> → failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const search = await request<{ groups?: Record<string, unknown>[] }>(
        `/v1/groups/explore/search?term=${encodeURIComponent(target.name)}`,
      );
      const hit = search.groups?.find((g) => g.id === target.id) ?? search.groups?.[0];
      describe('3. /v1/groups/explore/search', hit);
    } catch (e) {
      rows.push(`3. search → failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const explore = (await api.getAvailableGroups(true)) as unknown as Record<string, unknown>[];
      const list = Array.isArray(explore) ? explore : [];
      const withIcon = list.filter((g) => g.icon_url).length;
      rows.push(
        `4. explore list → ${list.length} groups, ${withIcon} with icon_url` +
          (list[0] ? `\n    first: ${list[0].name} icon_url ${list[0].icon_url ? 'YES' : 'no'}` : ''),
      );
    } catch (e) {
      rows.push(`4. explore list → failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const anyIcons = rows.some((r) => r.includes('YES'));
    return {
      ...base,
      status: anyIcons ? 'pass' : 'fail',
      detail: anyIcons
        ? 'At least one endpoint carries icon_url — read groups from there and the icons appear.'
        : 'No endpoint returned icon_url for this group. The community may genuinely have no icon.',
      evidence: rows.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
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
    const page = (await api.getGroupPosts(SAMPLE_GROUP_ID, 'hot')) as unknown as {
      posts?: PostOrComment[];
    };
    const withVideo = page.posts?.find((p) => p.assets?.some((a) => a.type === 'video'));
    const asset = withVideo?.assets?.find((a) => a.type === 'video');
    const poster = asset?.thumbnail_asset?.url;

    if (!poster) {
      return {
        ...base,
        status: 'partial',
        detail: 'No video post in the current hot feed to test with. Try again later.',
      };
    }

    const steps = [`poster host → ${new URL(poster).host}`];

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
 * What does a quote-repost actually look like coming back?
 *
 * We send `quote_post_id`; nothing documents what the response carries.
 * `QuotedPostInline` handles both plausible shapes — an inlined post object or
 * the bare id — so reposts render either way, but knowing which is real lets the
 * client stop hedging and drop the extra fetch.
 *
 * Creates a post, quotes it, dumps the quote's keys, deletes both.
 */
async function probeRepostShape(): Promise<ProbeResult> {
  const base = {
    id: 'repost-shape',
    label: 'Phase 5 — quote-repost shape',
    question: 'Does a repost come back with the original inlined, or just its id?',
  };
  const steps: string[] = [];
  const created: string[] = [];

  try {
    const original = await createPost({
      text: `webyak repost test — original ${new Date().toISOString()}`,
      groupId: SAMPLE_GROUP_ID,
      anonymous: true,
    });
    if (!original?.id) {
      return { ...base, status: 'fail', detail: 'Could not create the post to quote.' };
    }
    created.push(original.id);

    const quote = await createPost({
      text: 'webyak repost test — the quote',
      groupId: SAMPLE_GROUP_ID,
      anonymous: true,
      repostId: original.id,
    });
    if (quote?.id) created.push(quote.id);

    const record = quote as unknown as Record<string, unknown> | undefined;
    const quoteKeys = record ? Object.keys(record).filter((k) => /quote|repost|parent|original/i.test(k)) : [];
    steps.push(`quote-ish keys on the created post → ${quoteKeys.join(', ') || '(none)'}`);
    for (const key of quoteKeys) {
      const value = record?.[key];
      steps.push(`  ${key} → ${typeof value === 'object' ? `object, keys: ${Object.keys(value as object).join(', ')}` : String(value)}`);
    }

    // Re-read it: `createPost`'s echo and a normal feed read are not always the
    // same shape, and the feed is what the app actually renders from.
    if (quote?.id) {
      const refetched = (await api.getPost(quote.id)) as unknown as Record<string, unknown>;
      const refKeys = Object.keys(refetched ?? {}).filter((k) => /quote|repost|parent|original/i.test(k));
      steps.push(`after getPost → ${refKeys.join(', ') || '(no quote fields — the link may only exist at creation)'}`);
      for (const key of refKeys) {
        const value = refetched[key];
        steps.push(`  ${key} → ${typeof value === 'object' ? `object, keys: ${Object.keys(value as object).join(', ')}` : String(value)}`);
      }
      steps.push(`full key list → ${Object.keys(refetched ?? {}).join(', ')}`);
    }

    for (const id of created) await deletePostOrComment(id);
    steps.push(`cleaned up ${created.length} test post(s)`);

    return {
      ...base,
      status: steps.some((l) => l.includes('quote')) ? 'pass' : 'partial',
      detail: 'See which key carries the original — that is what the card should read.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return {
      ...base,
      status: 'error',
      detail:
        (e instanceof Error ? e.message : String(e)) +
        (created.length ? ` — LEFTOVER POSTS ${created.join(', ')}, delete by hand.` : ''),
      evidence: steps.join('\n'),
    };
  }
}

/* ------------------------------------------------------------------------ *
 * Phase 5b — the You tab and the For You feed
 * ------------------------------------------------------------------------ */

/**
 * Where does yakarma live?
 *
 * offsides reads `getUpdates(groupId).karma` as `{post, comment, groups: [...]}`
 * (docs/OFFSIDES.md). This confirms the exact keys against our own account, and
 * whether the per-group breakdown arrives on the global call or only when a
 * group id is passed — which decides whether the You tab needs one request or
 * one per community.
 */
async function probeKarma(): Promise<ProbeResult> {
  const base = {
    id: 'karma',
    label: 'You — yakarma shape',
    question: 'Which field carries total and per-community karma?',
  };
  const steps: string[] = [];
  try {
    const global = (await api.getUpdates('')) as Record<string, unknown>;
    steps.push(`getUpdates() top-level keys → ${Object.keys(global ?? {}).join(', ')}`);

    const karma = global?.karma as Record<string, unknown> | undefined;
    if (!karma) {
      steps.push('No `karma` key on the global call.');
    } else {
      steps.push(`karma keys → ${Object.keys(karma).join(', ')}`);
      steps.push(`karma.post = ${String(karma.post)}, karma.comment = ${String(karma.comment)}`);
      const groups = karma.groups as Record<string, unknown>[] | undefined;
      steps.push(
        Array.isArray(groups)
          ? `karma.groups → ${groups.length} entries, first keys: ${Object.keys(groups[0] ?? {}).join(', ')}\n${preview(groups, 700)}`
          : 'karma.groups is absent or not an array',
      );
    }

    // Does passing a group id change the payload?
    const mine = await fetchUserGroups();
    const target = mine.find((g) => g.name !== 'Home') ?? mine[0];
    if (target?.id) {
      const scoped = (await api.getUpdates(target.id)) as Record<string, unknown>;
      const scopedKarma = scoped?.karma as Record<string, unknown> | undefined;
      steps.push(
        `getUpdates("${target.name}").karma → ${scopedKarma ? preview(scopedKarma, 400) : 'absent'}`,
      );
    }

    return {
      ...base,
      status: karma ? 'pass' : 'fail',
      detail: karma
        ? 'Karma found — the You tab can render totals and a per-community breakdown.'
        : 'No karma field. The You tab cannot show it without another source.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/**
 * Does the feed accept `type=unread`?
 *
 * The official app's For You feed defaults to an **unread** filter alongside hot
 * and new. Nothing in sidechat.js or offsides mentions it, so it may be newer
 * than both.
 *
 * Differential, not status-based: unrecognised values are **silently ignored**
 * by this endpoint (that is how the `period` values were pinned down), so a 200
 * proves nothing. Comparing returned ids against `hot` does.
 */
async function probeUnreadFeed(): Promise<ProbeResult> {
  const base = {
    id: 'unread-feed',
    label: 'For You — is there an unread filter?',
    question: 'Does the feed endpoint recognise type=unread, or silently ignore it?',
  };
  try {
    const mine = await fetchUserGroups();
    const home = mine.find((g) => g.name === 'Home') ?? mine[0];
    if (!home?.id) return { ...base, status: 'fail', detail: 'No group to test against.' };

    const idsFor = async (type: string) => {
      const json = await request<{ posts?: PostOrComment[] }>(
        `/v1/posts?group_id=${home.id}&type=${type}&cacheBust=${Date.now()}`,
      );
      return (json.posts ?? []).map((p) => p.id).filter(Boolean);
    };

    const hot = await idsFor('hot');
    const unread = await idsFor('unread');
    const nonsense = await idsFor('definitely-not-a-real-type');

    const same = (a: string[], b: string[]) =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    const unreadIsHot = same(hot, unread);
    const nonsenseIsHot = same(hot, nonsense);

    return {
      ...base,
      status: !unreadIsHot && nonsenseIsHot ? 'pass' : 'fail',
      detail: !unreadIsHot && nonsenseIsHot
        ? 'unread returns a DIFFERENT set while a nonsense value falls back to hot — so unread is real.'
        : nonsenseIsHot
          ? 'unread returned exactly the hot set, same as a nonsense value — the API ignores it.'
          : 'Inconclusive: even the nonsense value differed, so the feed is not stable enough to compare.',
      evidence: [
        `hot      → ${hot.length} posts, first ${hot[0] ?? '(none)'}`,
        `unread   → ${unread.length} posts, first ${unread[0] ?? '(none)'}  ${unreadIsHot ? '(identical to hot)' : '(different)'}`,
        `nonsense → ${nonsense.length} posts, first ${nonsense[0] ?? '(none)'}  ${nonsenseIsHot ? '(identical to hot — the control behaved)' : '(different — control failed)'}`,
      ].join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/** Is there an endpoint for posts I have upvoted, and does explore carry a creation date? */
async function probeYouTabGaps(): Promise<ProbeResult> {
  const base = {
    id: 'you-gaps',
    label: 'You / Explore — upvotes and sort fields',
    question: 'Is there an upvoted-posts endpoint, and can explore sort by newest?',
  };
  const steps: string[] = [];
  try {
    const candidates = [
      '/v1/posts?type=my_upvotes',
      '/v1/posts?type=upvoted',
      '/v1/posts/upvoted',
      '/v1/posts/voted',
      '/v1/users/upvotes',
      '/v1/posts?type=my_votes',
    ];
    for (const path of candidates) {
      try {
        const res = await api.sendRequest(path);
        const text = await res.text();
        steps.push(
          `${path} → ${res.status}` +
            (res.ok ? ` keys=${Object.keys(JSON.parse(text) ?? {}).join(',')}` : ''),
        );
      } catch (e) {
        steps.push(`${path} → threw ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Sorting explore by "newest" needs a date field. The search payload has no
    // obvious one; check what the explore list actually carries.
    const explore = (await api.getAvailableGroups(true)) as unknown as Record<string, unknown>[];
    const first = Array.isArray(explore) ? explore[0] : undefined;
    steps.push(`\nexplore entry keys → ${first ? Object.keys(first).join(', ') : '(none)'}`);
    const dateish = first
      ? Object.keys(first).filter((k) => /created|date|time|added|since/i.test(k))
      : [];
    steps.push(
      dateish.length
        ? `date-ish fields → ${dateish.join(', ')}`
        : 'NO date-ish field — "newest" cannot be sorted client-side.',
    );

    return {
      ...base,
      status: steps.some((l) => / 200/.test(l)) || dateish.length ? 'partial' : 'fail',
      detail: 'See evidence: which upvote route exists, and whether explore carries a creation date.',
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

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

export async function runAllProbes(): Promise<ProbeResult[]> {
  return [
    await probeAuth(),
    await probeMyGroupsShape(),
    await probeProfileShape(),
    await probeVideoShape(),
    await probeGapEndpoints(),
    await probeFeedHygiene(),
    await probeGroupIconSource(),
    await probeVideoPoster(),
    await probeImageFailures(),
    await probeKarma(),
    await probeUnreadFeed(),
    await probeYouTabGaps(),
    await probeMessaging(),
  ];
}

/**
 * Kept out of `runAllProbes` deliberately. These create real content in a real
 * community, so they need a separate, explicit press — nobody should post to
 * Virginia Tech by clicking "run diagnostics".
 */
export async function runWriteProbes(): Promise<ProbeResult[]> {
  return [
    await probeWriteRoundTrip(),
    await probePolls(),
    await probeImageUpload(),
    await probeRepostShape(),
  ];
}
