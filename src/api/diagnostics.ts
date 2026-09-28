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
 * reason, and seven more on 2026-09-27; their answers live in the docs
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
 * | `probeActivity` | alert types with no label yet, what `takedown_data` holds, whose post each type opens (PLAN Q14) |
 * | `probePostLength`, `probeBioLength` | what length does the server enforce? (PLAN Q11) |
 * | `probeChatRead` | what body does `POST /v1/chats/read` want? (PLAN Q19) |
 *
 * The length probes **write** — they post and edit your bio, undoing both — and
 * `probeChatRead` can mark one chat read. Each has its own button behind a
 * confirm.
 */

import { ACTIVITY_TYPES } from './activity';
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

/* ------------------------------------------------------------------------ *
 * Chats — the body `POST /v1/chats/read` wants (PLAN Q19)
 * ------------------------------------------------------------------------ */

interface ChatUnderTest {
  id: string;
  updatedAt?: string;
  latestMessageId?: string;
  deviceId?: string;
}

/**
 * Bodies to try. The first sweep (2026-09-27) sent twelve candidate routes:
 * ten answered `404` exactly like the nonsense control, and
 * `POST /v1/chats/read` answered `500` to both `{chat_id}` and
 * `{chat_id, message_id}`. So the route is real and the body is wrong. An empty
 * body goes first, because the error for "nothing at all" is the likeliest to
 * name the field it misses.
 */
const CHAT_READ_BODIES: { label: string; path?: (id: string) => string; body: (c: ChatUnderTest) => Raw }[] = [
  { label: '{}', body: () => ({}) },
  { label: '{chat_id}', body: (c) => ({ chat_id: c.id }) },
  { label: '{chat_id, message_id}', body: (c) => ({ chat_id: c.id, message_id: c.latestMessageId }) },
  { label: '{chat_id, last_message_id}', body: (c) => ({ chat_id: c.id, last_message_id: c.latestMessageId }) },
  { label: '{chat_id, last_read_message_id}', body: (c) => ({ chat_id: c.id, last_read_message_id: c.latestMessageId }) },
  { label: '{chat_id, message_ids}', body: (c) => ({ chat_id: c.id, message_ids: [c.latestMessageId] }) },
  { label: '{chat_id, last_read_timestamp}', body: (c) => ({ chat_id: c.id, last_read_timestamp: c.updatedAt }) },
  { label: '{chat_id, timestamp}', body: (c) => ({ chat_id: c.id, timestamp: c.updatedAt }) },
  { label: '{chat_id, client_id}', body: (c) => ({ chat_id: c.id, client_id: c.deviceId }) },
  { label: '{chat_ids}', body: (c) => ({ chat_ids: [c.id] }) },
  { label: '{ids}', body: (c) => ({ ids: [c.id] }) },
  { label: '{id}', body: (c) => ({ id: c.id }) },
  { label: '?chat_id= and {}', path: (id) => `/v1/chats/read?chat_id=${encodeURIComponent(id)}`, body: () => ({}) },
  {
    label: '{chat_id} without its -v2 suffix',
    body: (c) => ({ chat_id: c.id.replace(/-v2$/, '') }),
  },
];

/**
 * What a response said, in a form safe to paste: a 2xx by shape, an error by
 * the server's own `error_code` and `message`, with ids masked.
 */
async function describeResponse(res: Response, hide: (text: string) => string) {
  const text = await res.text().catch(() => '');
  if (!text) return 'empty body';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return `${text.length} chars, not JSON`;
  }
  if (res.ok) return `json ${fieldShapes(json)}`;
  const body = (json ?? {}) as Raw;
  const said = [body.error_code, body.message, body.error]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => hide(part).replace(UUID_ANYWHERE, '<uuid>').slice(0, 160));
  return said.length ? `"${said.join(' — ')}"` : `json ${fieldShapes(json)}`;
}

/**
 * What body does `POST /v1/chats/read` want?
 *
 * Opening a thread in webyak doesn't mark it read on the server, so a chat read
 * here stays unread in the official app (webyak keeps its own mark meanwhile,
 * src/lib/chat-reads.ts). This sends each body to the one route known to be
 * real, for one chat the server has unread, and re-reads the list after each.
 * The right body is the one after which that chat's `last_read_timestamp`
 * moves. It stops there.
 *
 * Writes: it can mark one chat read, which is what webyak wants to do anyway.
 * Ids are masked in everything it reports; error messages are the server's own
 * words, which is the point of this round.
 */
async function probeChatRead(deviceId: string | null): Promise<ProbeResult> {
  const base = {
    id: 'chat-read',
    label: 'Chats — what POST /v1/chats/read wants',
    question: 'Which body makes POST /v1/chats/read mark a chat read on the server? (PLAN Q19)',
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
    const target = all.find(unreadOnServer);
    if (!target) {
      return {
        ...base,
        status: 'partial',
        detail:
          "No chat is unread on the server, so there is nothing whose read mark could visibly move. Wait for a new message — one the official app hasn't opened — and run it again.",
        evidence: `/v1/chats → ${all.length} chat(s), none unread by last_read_timestamp`,
      };
    }
    const messages = (Array.isArray(target.messages) ? target.messages : []) as Raw[];
    const latest = [...messages]
      .filter((m) => typeof m.id === 'string' && typeof m.created_at === 'string')
      .sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string))[0];
    const chat: ChatUnderTest = {
      id: target.id as string,
      updatedAt: typeof target.updated_at === 'string' ? target.updated_at : undefined,
      latestMessageId: typeof latest?.id === 'string' ? latest.id : undefined,
      deviceId: deviceId ?? undefined,
    };
    const hide = (text: string) => text.split(chat.id).join('<chat_id>');
    const before = lastRead(target);
    steps.push(
      `/v1/chats → ${all.length} chat(s), ${all.filter(unreadOnServer).length} unread by the server's mark. Testing one of those: a ${target.type === 'group' || target.name ? 'group chat' : 'DM'}, id ${/-v2$/.test(chat.id) ? 'ending -v2' : 'without a suffix'}, ${messages.length} message(s) inlined`,
    );

    let found: string | null = null;
    for (const candidate of CHAT_READ_BODIES) {
      const path = candidate.path?.(chat.id) ?? '/v1/chats/read';
      try {
        const res = await api.sendRequest(path, 'POST', JSON.stringify(candidate.body(chat)));
        const said = await describeResponse(res, hide);
        await pause(600);
        const after = lastRead((await chats()).find((c) => c.id === chat.id));
        const moved = after !== before;
        steps.push(`${candidate.label} → ${res.status}, ${said}${moved ? '  ✓ last_read_timestamp MOVED' : ''}`);
        if (moved) {
          found = candidate.label;
          break;
        }
      } catch (e) {
        steps.push(`${candidate.label} → error: ${e instanceof Error ? hide(e.message) : String(e)}`);
      }
    }

    return {
      ...base,
      status: found ? 'pass' : 'fail',
      detail: found
        ? `POST /v1/chats/read with ${found} marks a chat read on the server. webyak can send it on open and for Mark all read, and the official app will agree.`
        : `None of ${CHAT_READ_BODIES.length} bodies moved last_read_timestamp. The server's error messages above are the next clue; failing that, a capture of the official app's traffic.`,
      evidence: steps.join('\n'),
    };
  } catch (e) {
    return fail(base, e);
  }
}

/**
 * Separate from the read-only run because it writes: it can mark one chat
 * read, in the official app too.
 */
export async function runChatReadProbe(deviceId: string | null): Promise<ProbeResult[]> {
  return [await probeChatRead(deviceId)];
}
