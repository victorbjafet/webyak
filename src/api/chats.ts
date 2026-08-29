import { getUpdates, request } from './client';
import type { DirectThread, GroupChat, JoinChatIdentity } from './types';

/**
 * Direct messages and group chats.
 *
 * All of these go through `request` rather than sidechat.js's own methods, for
 * the usual reason — every write in the library reads the response body without
 * checking the status, so a refusal resolves as success
 * (docs/API.md#why-every-write-bypasses-the-library).
 *
 * Endpoints, read from the library source:
 *
 * ## Everything here is wrapped
 *
 * Confirmed by probe 2026-08-28: the list endpoints do **not** return arrays of
 * threads. They return `{chats: [{chat, cursor}], cursor}` — each entry is an
 * envelope holding the thread under `chat`, with its own per-thread cursor
 * (presumably for paging that conversation's messages).
 *
 * Reading `chats[]` directly gives objects whose every field is `undefined`,
 * which is exactly what the first pass did: `accept_status` came back
 * `undefined` for all 19 threads. It is the same wrapper pattern as
 * `quote_post.post`, and it is now the third place this API nests a payload one
 * level deeper than the obvious reading.
 *
 * | Action | Endpoint |
 * |---|---|
 * | List threads | `GET /v1/chats` → `{chats: [{chat}], cursor}` |
 * | One thread | `GET /v1/chats/messages?chat_id=` → `{chat}` |
 * | Send | `POST /v1/chats/send` |
 * | Start | `POST /v1/chats/start` |
 * | Explore group chats | `GET /v1/chats/explore` → `{chats}` |
 * | Join a group chat | `POST /v1/chats/groups/join` |
 */

/**
 * Pulls threads out of the `{chat}` envelopes, tolerating an unwrapped entry in
 * case the shape ever changes back.
 */
function unwrapChats<T>(entries: unknown): T[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const wrapper = entry as { chat?: unknown };
      return (wrapper.chat ?? entry) as T;
    })
    .filter((value): value is T => Boolean(value));
}

export async function getDMThreads(): Promise<DirectThread[]> {
  const json = await request<{ chats?: unknown }>('/v1/chats');
  return unwrapChats<DirectThread>(json.chats);
}

export async function getDMThread(chatId: string): Promise<DirectThread | null> {
  const json = await request<{ chat?: DirectThread }>(
    `/v1/chats/messages?chat_id=${encodeURIComponent(chatId)}`,
  );
  return json.chat ?? null;
}

/**
 * `client_id` really is the device id — **corrected 2026-08-28 from offsides.**
 *
 * I had reasoned it was a per-message idempotency key, because every message in
 * a thread carries its own `client_id`, and sent a fresh UUID each time on the
 * grounds that uniqueness was safe under either reading.
 *
 * offsides settles it: `ThreadScreen.jsx` sends `sha256(androidId)` — one
 * stable value for the life of the install — and their messages send fine. So
 * the server does **not** dedupe on it, which was the whole basis for the
 * guess, and the field is what the JSDoc says it is.
 *
 * Now the session's persisted device id, matching a client proven against this
 * API rather than a plausible theory about one (docs/OFFSIDES.md).
 */
export async function sendDM(
  chatId: string,
  text: string,
  deviceId: string,
  anonymous = false,
) {
  return request<unknown>('/v1/chats/send', 'POST', {
    chat_id: chatId,
    text,
    client_id: deviceId,
    anonymous,
    assets: [],
  });
}

/**
 * Opens a new thread.
 *
 * A DM cannot be started out of nowhere — it hangs off a **post or comment**,
 * which is why `post_id` is required and why the entry point is an action on a
 * post rather than a "new message" button. That is also how the official app
 * works: you message someone *about* something they wrote.
 */
export async function startDM(
  text: string,
  postId: string,
  deviceId: string,
  anonymous = false,
  postContext = 'feed',
) {
  return request<{ chat?: DirectThread }>('/v1/chats/start', 'POST', {
    text,
    client_id: deviceId,
    post_id: postId,
    anonymous,
    post_context: postContext,
  });
}

/** Joinable group chats for the user's school. The library builds this URL with `&`. */
export async function getGroupChats(): Promise<GroupChat[]> {
  const json = await request<{ chats?: unknown }>('/v1/chats/explore');
  return unwrapChats<GroupChat>(json.chats);
}

/**
 * Joins a group chat under a chosen identity.
 *
 * The identity is required and per-chat — a group chat shows a display name and
 * icon that need not match your profile. Defaults come from the account so the
 * common case is one tap, matching what the library's docstring recommends.
 */
export async function joinGroupChat(chatId: string, identity: JoinChatIdentity) {
  return request<unknown>('/v1/chats/groups/join', 'POST', {
    chat_id: chatId,
    identity: {
      display_name: identity.displayName,
      emoji: identity.emoji,
      color: identity.color,
      secondary_color: identity.secondaryColor,
    },
  });
}

/**
 * Group chats you have already joined.
 *
 * **They do not come from `/v1/chats`** — that returns DM threads. offsides
 * doesn't read them at all (its `leaveChat` is a stub marked "waiting for
 * sidechat.js"), so this is not solved anywhere upstream.
 *
 * ⚠️ **Redundant.** Confirmed 2026-08-29: `getUpdates().chats.chats` returns the
 * *same list* as `/v1/chats` — identical ids, identical order. Group chats were
 * never in a separate place; `/v1/chats` was always returning both kinds, and
 * reading the two sources into two lists is what rendered every conversation
 * twice.
 *
 * Kept only as a fallback for the case where `/v1/chats` fails, since the
 * updates call is made anyway. Nothing routine should use it.
 */
export async function getJoinedGroupChats(): Promise<GroupChat[]> {
  const updates = await getUpdates();
  const container = (updates as { chats?: { chats?: unknown } })?.chats;
  // Tolerates both the observed `{chats: [...]}` envelope and a bare array.
  const entries = Array.isArray(container) ? container : container?.chats;
  return unwrapChats<GroupChat>(entries);
}
