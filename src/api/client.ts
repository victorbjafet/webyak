import { SidechatAPIClient } from 'sidechat.js';

import type {
  AuthToken,
  Cursor,
  TopPeriod,
  CurrentUser,
  FeedCategory,
  Group,
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
  const put = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': mimeType },
  });
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

export async function setVote(postId: string, action: VoteStatus) {
  return api.setVote(postId, action);
}

export async function getAvailableGroups(onePage = true) {
  return (await api.getAvailableGroups(onePage)) as unknown as Group[];
}

export async function searchAvailableGroups(query: string) {
  return (await api.searchAvailableGroups(query)) as unknown as Group[];
}

export async function getGroupMetadata(groupId: string) {
  return (await api.getGroupMetadata(groupId)) as unknown as Group;
}

export async function getUserProfile(username: string) {
  return (await api.getUserProfile(username)) as unknown as Profile;
}
