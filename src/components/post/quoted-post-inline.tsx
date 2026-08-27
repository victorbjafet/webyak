import { useRouter } from 'expo-router';

import { QuotedPost } from './quoted-post';

import { usePost } from '@/api/queries';
import type { PostOrComment } from '@/api/types';

/**
 * The original post inside a quote-repost — the retweet block.
 *
 * Resolved two ways because the API's response shape for a quote is not
 * documented anywhere and sidechat.js's typedefs don't mention it at all. It
 * sends `quote_post_id` when creating one, so:
 *
 *  - if the response **inlines** the quoted post, render it directly — no
 *    request, no loading state;
 *  - if it returns only the **id**, fetch it. `usePost` is cached, so a quoted
 *    post already on screen costs nothing.
 *
 * Handling both means this works whichever shape the API actually uses, which
 * is why the repost was rendering as a bare caption: we were reading neither.
 *
 * Renders nothing when the post isn't a quote, so it is safe to drop into any
 * card unconditionally.
 */
export function QuotedPostInline({ post }: { post: PostOrComment }) {
  const router = useRouter();

  // Called unconditionally — `usePost` is disabled without an id, and hooks
  // cannot be skipped. Never fires when the quote is already inlined.
  const fetched = usePost(post.quote_post ? undefined : post.quote_post_id);
  const quoted = post.quote_post ?? fetched.data;

  if (!post.quote_post && !post.quote_post_id) return null;
  if (!quoted) return null;

  return (
    <QuotedPost
      post={quoted}
      onPress={
        quoted.index_code
          ? () => router.push({ pathname: '/p/[code]', params: { code: quoted.index_code! } })
          : undefined
      }
    />
  );
}
