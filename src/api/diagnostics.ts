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
 * reason, seven more on 2026-09-27, and the chat read probe on 2026-09-28;
 * their answers live in the docs
 * (docs/API.md#probes-what-is-still-asked-and-what-was-retired), not here.
 *
 * ## Two rules, both learned the hard way
 *
 * 1. **Every sweep needs a control.** This API has catch-all routes: a `GET`
 *    under `/v1/chats/` answers `200` with an empty body whatever the path, and
 *    a `POST` there answers `404`. A status code alone proves nothing until a
 *    nonsense path has been sent alongside. That is how `POST /v1/chats/read`
 *    showed up as real: a `500` where the control got a `404`.
 * 2. **Some parameters are validated and some are ignored.** `type` rejects an
 *    unknown value with a `400`; `period` silently falls back. A probe designed
 *    for the wrong one of those reads as a pass either way.
 *
 * ## What's here
 *
 * | Probe | Open question |
 * |---|---|
 * | `probeAuth` | control — is the token live at all? |
 * | `probeActivity` | alert types with no label yet, and whether a fresh takedown's id lands in `unacknowledged_removed_post_ids` (PLAN Q14) |
 * | `probePostLength`, `probeBioLength` | what length does the server enforce? (PLAN Q11) |
 *
 * The length probes **write** — they post and edit your bio, undoing both — so
 * they have their own button behind a confirm.
 */

import { ACTIVITY_TYPES } from './activity';
import {
  ApiError,
  api,
  createPost,
  deletePostOrComment,
  getPostComments,
  getUpdates,
  getUserProfile,
  lookupPost,
  PostGone,
  request,
  updateProfile,
} from './client';
import type { PostOrComment } from './types';

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

/** How a value looked, never what it said. */
function shape(value: unknown) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return value ? `a string, ${value.length} chars` : 'an empty string';
  return typeof value;
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
 * The first run (2026-09-27) answered paging, marking read and the shared list,
 * and those checks were retired (docs/API.md#the-activity-feed-alerts). The
 * second (2026-09-28) answered whose post and comment each type names and what
 * `takedown_data` holds. What's left: any type outside `ACTIVITY_TYPES`
 * (`new_follower` and `suggested_sidechats` have never been seen), and whether
 * a takedown not yet acknowledged shows up in `unacknowledged_removed_post_ids`.
 * The lookups stay, so a new type arrives already described.
 *
 * Read-only. Types, keys and counts only: an alert's text quotes posts.
 */
async function probeActivity(): Promise<ProbeResult> {
  const base = {
    id: 'activity',
    label: 'Alerts — unmapped types and fields',
    question:
      'Which alert types have no label yet, what do their ids name, and does a takedown show up in the removed ids? (PLAN Q14)',
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
      /** The first alert of this type with a `post_id`, for the lookups below. */
      sample?: Raw;
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
      if (typeof item.post_id === 'string' && item.post_id) stats.sample ??= item;
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

    const whose = (post: PostOrComment) =>
      post.authored_by_user ? 'your own post' : "someone else's post";
    const lookupError = (e: unknown) =>
      e instanceof PostGone ? 'gone (404)' : `error: ${e instanceof Error ? e.message : String(e)}`;

    // Whose post each type opens, and where its comment ids point. One lookup
    // per type. The first run read only `quote_post_id` and reported that a
    // `quote` alert's post quotes nothing, but the original usually arrives
    // inline at `quote_post.post` instead, so both are checked now.
    for (const [type, stats] of types) {
      const postId = stats.sample?.post_id as string | undefined;
      if (!postId) continue;
      let post: PostOrComment;
      try {
        post = await lookupPost(postId);
      } catch (e) {
        steps.push(`  ${type} post_id → ${lookupError(e)}`);
        continue;
      }
      const quoted = post.quote_post?.post;
      const quotes = quoted
        ? `, which quotes ${whose(quoted)} (inline)`
        : post.quote_post_id
          ? ', which quotes another post (by id only)'
          : '';
      steps.push(`  ${type} post_id → ${whose(post)}${quotes}`);

      const commentIds = (['comment_id', 'comment_reply_id'] as const).filter(
        (key) => stats.sample?.[key] !== undefined,
      );
      if (!commentIds.length) continue;
      let thread: PostOrComment[] | undefined;
      try {
        thread = await getPostComments(postId);
      } catch (e) {
        steps.push(`    comments → ${lookupError(e)}`);
      }
      for (const key of commentIds) {
        const value = stats.sample?.[key];
        const comment =
          typeof value === 'string' && value ? thread?.find((c) => c.id === value) : undefined;
        steps.push(
          `    ${key} → ${shape(value)}${
            typeof value === 'string' && value && thread
              ? comment
                ? `, a comment in this thread, ${comment.authored_by_user ? 'yours' : "someone else's"}${comment.reply_post_id && comment.reply_post_id !== postId ? ', a reply' : ''}`
                : `, not among the thread's ${thread.length} comment(s)`
              : ''
          }`,
        );
      }
    }

    // What a takedown names. `takedown_data.id` is checked against the post
    // lookup and against `getUpdates().unacknowledged_removed_post_ids`, the
    // other place a removal shows up. That response also carries the session
    // token, so only that one key is read from it. `type` is printed only when
    // it looks like an enum value.
    const takedowns = items.filter((item) => item.type === 'takedown').slice(0, 3);
    if (takedowns.length) {
      let removed: unknown;
      try {
        removed = (await getUpdates())?.unacknowledged_removed_post_ids;
      } catch (e) {
        steps.push(`  getUpdates → ${lookupError(e)}`);
      }
      // Named like a list, but the first run found an object: either a map
      // keyed by id or a wrapper. Its keys and value types say which.
      let removedIds: unknown[] | undefined;
      if (Array.isArray(removed)) {
        removedIds = removed;
        steps.push(`  unacknowledged_removed_post_ids → an array of ${removed.length}`);
      } else if (removed && typeof removed === 'object') {
        const entries = Object.entries(removed as Raw);
        removedIds = entries.flatMap(([key, v]) => (Array.isArray(v) ? [key, ...v] : [key]));
        const keys = new Set(entries.map(([key]) => idShape(key)));
        const values = new Set(
          entries.map(([, v]) => (Array.isArray(v) ? `an array of ${v.length}` : fieldShapes(v))),
        );
        steps.push(
          `  unacknowledged_removed_post_ids → an object of ${entries.length} key(s)${entries.length ? `: keys ${[...keys].join(' | ')} · values ${[...values].join(' | ')}` : ''}`,
        );
      } else {
        steps.push(`  unacknowledged_removed_post_ids → ${shape(removed)}`);
      }
      for (const item of takedowns) {
        const data = (item.takedown_data ?? {}) as Raw;
        const id = typeof data.id === 'string' ? data.id : undefined;
        const enumLike = (v: unknown) =>
          typeof v === 'string' && /^[a-z_]{1,24}$/.test(v) ? `"${v}"` : shape(v);
        const facts = [
          `type ${enumLike(data.type)}`,
          `is_acknowledged ${String(data.is_acknowledged)}`,
          `is_seen ${String(item.is_seen)}`,
          `id ${id ? idShape(id) : shape(data.id)}`,
          `alert id ${typeof item.id === 'string' && id && item.id.includes(id) ? 'contains it' : 'does not contain it'}`,
          `in the removed ids: ${removedIds ? (id && removedIds.includes(id) ? 'yes' : 'no') : 'unknown'}`,
        ];
        if (id) {
          try {
            facts.push(`as a post: ${whose(await lookupPost(id))}`);
          } catch (e) {
            facts.push(`as a post: ${lookupError(e)}`);
          }
        }
        steps.push(`  takedown → ${facts.join(' · ')}`);
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
  return [await probeAuth(), await probeActivity()];
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
