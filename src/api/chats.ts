import { request } from './client';
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
 * | Action | Endpoint |
 * |---|---|
 * | List threads | `GET /v1/chats` → `{chats}` |
 * | One thread | `GET /v1/chats/messages?chat_id=` → `{chat}` |
 * | Send | `POST /v1/chats/send` |
 * | Start | `POST /v1/chats/start` |
 * | Explore group chats | `GET /v1/chats/explore` → `{chats}` |
 * | Join a group chat | `POST /v1/chats/groups/join` |
 */

export async function getDMThreads(): Promise<DirectThread[]> {
  const json = await request<{ chats?: DirectThread[] }>('/v1/chats');
  return json.chats ?? [];
}

export async function getDMThread(chatId: string): Promise<DirectThread | null> {
  const json = await request<{ chat?: DirectThread }>(
    `/v1/chats/messages?chat_id=${encodeURIComponent(chatId)}`,
  );
  return json.chat ?? null;
}

/**
 * A fresh id per message, not the device id.
 *
 * sidechat.js's JSDoc calls this parameter an "alphanumeric device ID", but
 * every *message* in a thread carries its own `client_id`, which is the shape
 * of a client-generated idempotency key rather than a device identifier.
 *
 * The two readings fail in opposite directions and only one is safe: if the
 * server dedupes on this value and we sent the device id every time, the second
 * message in a thread would silently vanish. If it really is a device id and we
 * send something unique, the server almost certainly just stores it. So unique
 * per message it is — the failure mode of being wrong that way is nothing.
 */
function newClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Older WebViews have no randomUUID. Uniqueness is all that matters here.
  return `webyak-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendDM(chatId: string, text: string, anonymous = false) {
  return request<unknown>('/v1/chats/send', 'POST', {
    chat_id: chatId,
    text,
    client_id: newClientId(),
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
  anonymous = false,
  postContext = 'feed',
) {
  return request<{ chat?: DirectThread }>('/v1/chats/start', 'POST', {
    text,
    client_id: newClientId(),
    post_id: postId,
    anonymous,
    post_context: postContext,
  });
}

/** Joinable group chats for the user's school. The library builds this URL with `&`. */
export async function getGroupChats(): Promise<GroupChat[]> {
  const json = await request<{ chats?: GroupChat[] }>('/v1/chats/explore');
  return json.chats ?? [];
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
