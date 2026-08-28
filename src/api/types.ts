/**
 * Types for the Sidechat/Yik Yak API.
 *
 * Ported from sidechat.js's JSDoc typedefs, then corrected against live payloads
 * captured on 2026-08-26. Fields marked "(observed)" are present in real
 * responses but missing from the library's own typedefs.
 */

export type VoteStatus = 'upvote' | 'downvote' | 'none';
export type FeedCategory = 'hot' | 'recent' | 'top';

/**
 * What the *UI* offers, which is not what the API accepts.
 *
 * `unread` is ours: the API rejects it with `400 Invalid post type: unread`, so
 * it is a client-side filter over a real category rather than a request
 * parameter (docs/API.md#unread-is-ours-not-theirs).
 */
export type FeedFilter = FeedCategory | 'unread';

/**
 * Time window for the `top` feed, sent as `period`. Verified 2026-08-27: only
 * these three values are recognized — everything else silently falls back to
 * `day`, which is also the default when the param is omitted.
 */
export type TopPeriod = 'day' | 'week' | 'all_time';
export type FollowStatus = 'following' | 'not_following';
export type ContentType = 'post' | 'comment';

/** Opaque pagination cursor, e.g. "persisted~756c2fb0-...". */
export type Cursor = string;

/** Bearer token. Treat as a credential. */
export type AuthToken = string;

/**
 * Some asset URLs are pre-signed (usable in a plain <img>), others require the
 * bearer token in an Authorization header. See Q2 in PLAN.md.
 */
export type AssetURL = string;

export interface ConversationIcon {
  emoji: string;
  color: string;
  secondary_color: string;
}

export interface Identity {
  name: string;
  posted_with_username: boolean;
  /** (observed) present when the author posts under a username. */
  conversation_icon?: ConversationIcon;
  /** (observed) */
  is_following?: boolean;
}

export interface Asset {
  id: string;
  /** (observed) videos exist and are served as HLS — see docs/API.md#video. */
  type: 'image' | 'video';
  content_type: 'jpeg' | 'png' | 'gif' | string;
  width: number;
  height: number;
  url?: AssetURL;
  /** (observed) pre-signed variant returned by the public web API. */
  signed_url?: AssetURL;
  /** (observed, video only) poster frame. */
  thumbnail_asset?: { url?: AssetURL; width?: number; height?: number };
}

/**
 * What an upload turns into when attached to a new post or comment. Narrower
 * than `Asset` — the server fills in the rest — and `width`/`height` have to be
 * measured client-side before upload, because the API never returns them for a
 * freshly uploaded asset.
 */
export interface NewPostAsset {
  id: string;
  type: 'image';
  content_type: 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
  url?: AssetURL;
}

/**
 * (observed) Link previews. Distinct from `assets` — these are unfurled URLs,
 * not uploads. offsides also mentions a `youtube` type.
 */
export interface Attachment {
  id: string;
  type: 'link' | 'youtube' | string;
  created_at?: string;
  link_url?: string;
  display_url?: string;
  title?: string;
}

export interface Group {
  id: string;
  name: string;
  analytics_name: string;
  index_name?: string;
  membership_type: 'non_member' | 'member';
  /** Group accent color as hex, e.g. "#9796F0". */
  color: string;
  group_join_type: 'open' | 'closed' | 'email_domain' | 'open_to_all' | 'account';
  group_visibility: 'private' | 'public_to_all' | 'public_to_schools';
  asset_library_visibility: 'show' | 'hide';
  description?: string;
  icon_url?: AssetURL;
  member_count?: number;
  should_show_leaderboard?: boolean;
  disable_ads?: boolean;
  can_join?: boolean;
  roles?: unknown[];
}

export interface PollChoice {
  count: number;
  text: string;
  selected: boolean;
}

export interface Poll {
  id: string;
  post_id: string;
  choices: PollChoice[];
  allows_view_results: boolean;
  view_results_count: number;
  participated: boolean;
}

export interface PostOrComment {
  type: ContentType;
  id: string;
  authored_by_user: boolean;
  alias: string;
  group_id: string;
  group: Group;
  text: string;
  created_at: string;
  vote_total: number;
  vote_status: VoteStatus;
  assets: Asset[];
  attachments: Attachment[];
  dms_disabled: boolean;
  tags: string[];
  identity: Identity;
  pinned: boolean;
  is_saved: boolean;
  follow_status: FollowStatus;
  destination?: 'group';
  /** (observed) short public share code used in web URLs, e.g. "0ESz5N3t". */
  index_code?: string;
  /** (observed) always present, contents undocumented. */
  awards?: unknown[];

  // post only
  /**
   * Quote-repost. We send `quote_post_id` when creating one; the response
   * carries `quote_post`, which is a **wrapper** — the original is at
   * `quote_post.post`, not `quote_post` itself. Confirmed from offsides, which
   * renders `post.quote_post.post` (docs/OFFSIDES.md).
   *
   * `quote_post_id` is kept as a fallback for the case where only the id comes
   * back; see `QuotedPostInline`.
   */
  quote_post_id?: string;
  quote_post?: { post?: PostOrComment };
  comment_count?: number;
  comments_disabled?: boolean;
  poll?: Poll;

  // comment only
  parent_post_id?: string;
  reply_post_id?: string;
  context?: string;
  /** Added client-side by sidechat.js when it nests the comment tree. */
  replies?: PostOrComment[];
}

export interface PostsAndCursor {
  posts: PostOrComment[];
  cursor: Cursor;
}

export interface Membership {
  groupId: string;
  type: string;
}

export interface CurrentUser {
  id: string;
  hashedVerifiedEmail: string;
  isGlobalModerator: boolean;
  isGlobalAdmin: boolean;
  memberships: Membership[];
  roles: unknown[];
  emailDomain: string;
  wildcardEmailDomain: string;
}

/**
 * Your own identity, read from `getUpdates().user`.
 *
 * `/v1/users/me` does **not** carry a username or bio — it returns ids,
 * memberships and email domains — so the editable fields come from the updates
 * payload instead. Fields are optional because that payload is undocumented and
 * has not been schema-checked; the edit screen degrades rather than assuming.
 */
export interface MyIdentity {
  id?: string;
  username?: string;
  bio?: string;
  conversation_icon?: ConversationIcon;
}

/**
 * Yakarma, from `getUpdates().karma`.
 *
 * Confirmed from offsides, which reads `{post, comment, groups}` off the same
 * call (docs/OFFSIDES.md). Everything is optional because the payload is
 * undocumented — the You tab renders what it gets rather than assuming a shape.
 */
export interface KarmaGroup {
  /**
   * Which key carries the id is unconfirmed — the payload is undocumented and
   * the entries observed so far carry **no name at all**, which is why the You
   * tab resolves the label against the user's own group list rather than
   * reading it from here. Both plausible keys are accepted.
   */
  group_id?: string;
  id?: string;
  name?: string;
  post?: number;
  comment?: number;
  color?: string;
}

export interface Karma {
  post?: number;
  comment?: number;
  groups?: KarmaGroup[];
}

export interface Profile {
  id: string;
  name: string;
  conversation_icon?: ConversationIcon;
  description?: string;
  /** Unverified — sidechat.js's typedef says icons are emoji + color only, but
   *  the same typedef has been wrong before. Probed by the profile diagnostic. */
  icon_url?: AssetURL;
  image_url?: AssetURL;
  index_name: string;
  analytics_name: string;
  color: string;
  share_color_start: string;
  share_color_end: string;
  group_join_type: 'account';
  group_visibility: 'public_to_all';
}

export interface DirectMessage {
  id: string;
  chat_id: string;
  created_at: string;
  client_id: string;
  obfuscatedUserId: string;
  text: string;
  authored_by_user: boolean;
  type: 'message';
}

export interface DirectThread {
  id: string;
  group_id: string;
  updated_at: string;
  /**
   * The post the conversation started from. DMs are always *about* something —
   * there is no way to open one out of nowhere, which is why the entry point is
   * an action on a post.
   */
  post_id: string;
  post_context: string;
  /**
   * Message requests. A thread you haven't accepted is a stranger writing to
   * you about your post, and the official app gates those behind an accept
   * step. (observed values: `accepted`; others unconfirmed.)
   */
  accept_status: 'accepted' | string;
  type: ContentType;
  messages: DirectMessage[];
  /** (observed in list responses) preview text and unread state. */
  last_message?: DirectMessage;
  unread_count?: number;
}

/**
 * A group chat. From `/v1/chats/explore` (joinable) or `getUpdates().chats.chats`
 * (already joined) — both wrap each entry in a `{chat}` envelope.
 *
 * Fields observed live 2026-08-28: `id` (with a `-v2` suffix), `name`,
 * `joinability`, `joinable_group_ids`, `notification_state`. The rest are
 * plausible but unconfirmed, so they stay optional.
 */
export interface GroupChat {
  id: string;
  name?: string;
  description?: string;
  member_count?: number;
  emoji?: string;
  color?: string;
  is_member?: boolean;
  /** e.g. `"some_groups"` — who is allowed in. */
  joinability?: string;
  /** Communities whose members may join. */
  joinable_group_ids?: string[];
  /** e.g. `"on"`. Present on chats you're already in, so it doubles as a
   *  membership signal until a clearer one is found. */
  notification_state?: string;
  [key: string]: unknown;
}

/** The per-chat identity a group chat is joined under. */
export interface JoinChatIdentity {
  displayName: string;
  emoji: string;
  color: string;
  secondaryColor: string;
}

/** Response shape of POST /v1/verify_phone_number. */
export interface VerifyResponse {
  logged_in_user?: { token: AuthToken };
  registration_id?: string;
  [key: string]: unknown;
}
