import { SidechatAPIClient } from 'sidechat.js';

import type {
  AuthToken,
  Cursor,
  TopPeriod,
  CurrentUser,
  FeedCategory,
  Group,
  NewPostAsset,
  PostOrComment,
  PostsAndCursor,
  Profile,
  VoteStatus,
} from './types';

/**
 * One client for the whole app. sidechat.js keeps the bearer token on the
 * instance, so this must stay a singleton — see `SessionProvider`, which owns
 * loading the token from storage and calling `setAuthToken` here.
 *
 * Verified 2026-08-26: api.sidechat.lol responds with `access-control-allow-origin: *`
 * on both simple requests and OPTIONS preflight, so these calls work directly
 * from the browser with no proxy.
 */
export const api = new SidechatAPIClient();

export function setAuthToken(token: AuthToken) {
  api.setToken(token);
}

export function clearAuthToken() {
  api.setToken('');
}

export function hasAuthToken() {
  return Boolean(api.userToken);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Called whenever any request comes back 401. `SessionProvider` registers its
 * sign-out here so an expired token drops the session from wherever it is
 * noticed, rather than each caller having to check.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Raw request helper for endpoints sidechat.js gets wrong or doesn't cover.
 * Unlike the library's methods this checks the HTTP status, which is how we
 * detect an expired token.
 */
export async function request<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await api.sendRequest(
    endpoint,
    method,
    body === undefined ? undefined : JSON.stringify(body),
  );
  return unwrap<T>(res, `${method} ${endpoint}`);
}

/**
 * Unauthenticated request, for the login endpoints that run before a token
 * exists. `request` above always attaches an Authorization header, which these
 * endpoints don't want.
 *
 * Also surfaces the API's own `{error_code, message}` body. sidechat.js throws
 * these away — several of its auth methods throw from inside their own `try`,
 * so the catch replaces the real message with a generic one. A login form that
 * can only say "Failed" is not usable.
 */
export async function publicRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${api.apiRoot}${endpoint}`, {
    method,
    headers: api.defaultHeaders as unknown as HeadersInit,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res, `${method} ${endpoint}`);
}

/**
 * The API signals failure two different ways: a non-2xx status, and a 200 whose
 * body carries `error_code`/`message`. Both have to be checked.
 */
export async function unwrap<T>(res: Response, label: string): Promise<T> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(`${label} failed with ${res.status}`, res.status);
    throw new ApiError(`${label} returned a malformed response`);
  }
  const body = json as { error_code?: string; message?: string } | null;
  if (body && typeof body === 'object' && (body.error_code || (!res.ok && body.message))) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(body.message || body.error_code || `${label} failed`, res.status);
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(`${label} failed with ${res.status}`, res.status);
  }
  return json as T;
}

/* ------------------------------------------------------------------------ *
 * Workarounds for sidechat.js 2.6.6 defects (see PLAN.md §2.5)
 * ------------------------------------------------------------------------ */

/**
 * The library builds `/v1/posts&type=...` (missing `?`), so its version always
 * fails. Same endpoint, correct query string.
 */
export async function getUserContent(contentType: 'posts' | 'comments') {
  const type = contentType === 'posts' ? 'my_posts' : 'my_comments';
  const json = await request<{ posts: PostOrComment[] }>(`/v1/posts?type=${type}`);
  return json.posts ?? [];
}

/**
 * The library builds `/v1/polls/view_results&cacheBust=...` (missing `?`), so
 * its version hits a path that doesn't exist. Third instance of this same typo
 * in sidechat.js 2.6.6 — see docs/API.md#sidechatjs-defects.
 */
export async function viewPollResults(pollId: string) {
  return request<unknown>('/v1/polls/view_results', 'POST', { poll_id: pollId });
}

/** The library builds `/v1/chats/explore&cacheBust=...` (missing `?`). */
export async function getGroupChats() {
  const json = await request<{ chats: unknown[] }>('/v1/chats/explore');
  return json.chats ?? [];
}

/**
 * The library's `uploadAsset` uses React Native's `FormData` `{uri, type, name}`
 * shape and then PUTs the raw object, which uploads "[object Object]" on web.
 * This takes a real Blob/File and PUTs the bytes.
 */
export async function uploadAssetWeb(file: Blob, mimeType: string) {
  const imageType = mimeType.split('/')[1];
  if (!['png', 'jpeg', 'gif'].includes(imageType)) {
    throw new ApiError(`Unsupported image format: ${mimeType}`);
  }
  const { upload_url, asset_id } = await request<{ upload_url: string; asset_id: string }>(
    `/v1/assets/upload_url?content_type=${imageType}`,
  );
  let put: Response;
  try {
    put = await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': mimeType },
    });
  } catch {
    // A thrown fetch means the request never left the browser. For a
    // cross-origin PUT that is almost always CORS: PUT is not a simple method,
    // so it preflights, and the storage bucket has to answer an OPTIONS from
    // our origin. "Failed to fetch" tells the user nothing they can act on.
    throw new ApiError(
      "The image couldn't be uploaded: the storage host refuses uploads straight from a browser. " +
        'This needs the proxy described in docs/WORKER.md — see docs/API.md#image-upload-is-blocked-by-cors.',
    );
  }
  if (!put.ok) {
    throw new ApiError(`Asset upload failed with ${put.status}`, put.status);
  }
  return { assetId: asset_id, url: `${api.apiRoot}/v1/assets/library/${asset_id}` };
}

/* ------------------------------------------------------------------------ *
 * Typed wrappers over the library's working methods
 * ------------------------------------------------------------------------ */

export async function getUpdates(groupId?: string) {
  return (await api.getUpdates(groupId ?? '')) as {
    groups?: Group[];
    user?: unknown;
    [key: string]: unknown;
  };
}

export async function getCurrentUser() {
  return (await api.getCurrentUser()) as unknown as CurrentUser;
}

/**
 * Feed page. Not sidechat.js's `getGroupPosts`, because that has no way to send
 * `period` — the time window for the `top` feed (docs/API.md#top-time-ranges).
 */
export async function getGroupPosts(
  groupId: string,
  category: FeedCategory,
  cursor?: Cursor,
  period?: TopPeriod,
) {
  const params = new URLSearchParams({ group_id: groupId, type: category });
  if (cursor) params.set('cursor', cursor);
  // Only meaningful for `top`; harmless elsewhere, but don't send noise.
  if (period && category === 'top') params.set('period', period);
  params.set('cacheBust', String(Date.now()));
  return request<PostsAndCursor>(`/v1/posts?${params.toString()}`);
}

export async function getPost(postId: string) {
  return (await api.getPost(postId)) as unknown as PostOrComment;
}

export async function getPostComments(postId: string) {
  return (await api.getPostComments(postId)) as unknown as PostOrComment[];
}

/**
 * Vote on a post or comment. Not `api.setVote`, which reads the response body
 * without checking the status — so a rejected vote resolves as success and the
 * optimistic update would never roll back. Every write here goes through
 * `request` for that reason.
 */
export async function setVote(postId: string, action: VoteStatus) {
  return request<unknown>('/v1/posts/set_vote', 'POST', {
    post_id: postId,
    vote_status: action,
  });
}

export async function getAvailableGroups(onePage = true) {
  return (await api.getAvailableGroups(onePage)) as unknown as Group[];
}

/*
 * Group search lives in `groups.ts` as `searchGroups` — it needs
 * `coerceGroupList`, and importing that here would make client ↔ groups
 * circular. `api.searchAvailableGroups` is unusable regardless: it reads
 * `json.results`, a key this endpoint does not use.
 */

/**
 * Join or leave. `POST /v1/groups/join` and `/v1/groups/leave`, both taking
 * `{group_id}`. Through `request` rather than the library's method so a refusal
 * rejects instead of resolving — the membership toggle is optimistic.
 */
export async function setGroupMembership(groupId: string, isMember: boolean) {
  return request<unknown>(`/v1/groups/${isMember ? 'join' : 'leave'}`, 'POST', {
    group_id: groupId,
  });
}

export async function getGroupMetadata(groupId: string) {
  return (await api.getGroupMetadata(groupId)) as unknown as Group;
}

export async function getUserProfile(username: string) {
  return (await api.getUserProfile(username)) as unknown as Profile;
}

/* ------------------------------------------------------------------------ *
 * Writes
 *
 * None of these use the library's own methods. Every write in sidechat.js 2.6.6
 * ends with `const json = await res.json(); return json;` — no status check — so
 * a 400 or a 401 resolves as if it succeeded. That is survivable for a
 * fire-and-forget call and fatal for optimistic UI, which needs a rejected
 * promise to know it must roll back.
 * ------------------------------------------------------------------------ */

export interface CreatePostInput {
  text: string;
  groupId: string;
  assets?: NewPostAsset[];
  anonymous?: boolean;
  disableDMs?: boolean;
  disableComments?: boolean;
  /** Quote-repost: the id of the post being quoted. */
  repostId?: string;
  /** 2–4 choices. Omit for a normal post. */
  pollOptions?: string[];
}

export async function createPost(input: CreatePostInput) {
  const body: Record<string, unknown> = {
    type: 'post',
    assets: input.assets ?? [],
    group_ids: [input.groupId],
    text: input.text,
    attachments: [],
    dms_disabled: input.disableDMs ?? false,
    comments_disabled: input.disableComments ?? false,
    // The API models this as "posting as yourself", so it is the inverse of the
    // anonymous toggle the UI shows.
    using_identity: !(input.anonymous ?? true),
  };
  if (input.repostId) body.quote_post_id = input.repostId;
  if (input.pollOptions?.length) {
    body.poll_request = { allows_view_results: true, choices: input.pollOptions };
  }

  const json = await request<{ posts?: PostOrComment[] }>('/v1/posts', 'POST', body);
  return json.posts?.[0];
}

export interface CreateCommentInput {
  /** The post being commented on — always the root, even for a reply. */
  parentPostId: string;
  text: string;
  groupId: string;
  /** Set when replying to a comment rather than the post itself. */
  replyCommentId?: string;
  /**
   * The *top-level* comment of the thread being replied to. Threading is two
   * levels, so a reply to a reply still hangs off the top-level comment — see
   * docs/OFFSIDES.md. Defaults to `replyCommentId` when the target is itself
   * top-level.
   */
  topLevelReplyId?: string;
  assets?: NewPostAsset[];
  anonymous?: boolean;
  disableDMs?: boolean;
}

export async function createComment(input: CreateCommentInput) {
  const json = await request<{ comment?: PostOrComment }>('/v1/posts', 'POST', {
    type: 'comment',
    assets: input.assets ?? [],
    group_ids: [input.groupId],
    text: input.text,
    reply_post_id: input.topLevelReplyId || input.replyCommentId || input.parentPostId,
    reply_comment_post_id: input.replyCommentId || input.parentPostId,
    parent_post_id: input.parentPostId,
    dms_disabled: input.disableDMs ?? false,
    using_identity: !(input.anonymous ?? true),
  });
  return json.comment;
}

/** Works for both posts and comments — the API takes either id. */
export async function deletePostOrComment(id: string) {
  return request<unknown>('/v1/posts/delete', 'POST', { post_id: id });
}

export async function voteOnPoll(pollId: string, choiceIndex: number) {
  return request<unknown>('/v1/polls/vote', 'POST', { poll_id: pollId, choice: choiceIndex });
}

/* ------------------------------------------------------------------------ *
 * Your own profile
 *
 * Username, bio and icon are all `PATCH /v1/users/<id>` with a different body,
 * so they are one function here rather than three. sidechat.js splits them and
 * sends a different `App-Version` header in each — "0" for the icon, "5.4.22"
 * for the bio, the default for the username. That looks cargo-culted rather
 * than meaningful; we send one consistent set and it works.
 * ------------------------------------------------------------------------ */

export interface ProfileUpdate {
  username?: string;
  bio?: string;
  conversationIcon?: { emoji: string; color: string; secondary_color: string };
}

export async function updateProfile(userId: string, update: ProfileUpdate) {
  const body: Record<string, unknown> = {};
  if (update.username !== undefined) body.username = update.username;
  if (update.bio !== undefined) body.bio = update.bio;
  if (update.conversationIcon) {
    body.conversation_icon = { ...update.conversationIcon, is_migrated: true };
  }
  return request<{ user?: unknown }>(`/v1/users/${encodeURIComponent(userId)}`, 'PATCH', body);
}

/**
 * Is this username free?
 *
 * `GET /v1/users/username?username=` — 200/204 means available. Not
 * `api.checkUsername`, which interpolates the name into the query string
 * **unencoded**: a username containing `&` or `#` would silently check a
 * different string than the one being claimed.
 *
 * Any non-2xx is treated as "taken" rather than thrown, because that is what
 * the caller needs to render; a network failure is reported separately by the
 * caller's own error state.
 */
export async function checkUsername(username: string): Promise<boolean> {
  const res = await api.sendRequest(
    `/v1/users/username?username=${encodeURIComponent(username)}`,
  );
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError('Session expired', 401);
  }
  return res.status === 200 || res.status === 204;
}
