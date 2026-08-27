import { useRouter } from 'expo-router';

import { QuotedPost } from './quoted-post';

import { usePost } from '@/api/queries';
import type { PostOrComment } from '@/api/types';

/**
 * The original post inside a quote-repost — the retweet block.
 *
 * sidechat.js's typedefs don't mention quotes at all, so the shape came from
 * offsides: the original lives at **`post.quote_post.post`** — `quote_post` is a
 * wrapper, not the post itself. Reading `quote_post` directly would silently
 * render nothing, which is roughly what was happening before: the repost showed
 * only its own caption.
 *
 * The `quote_post_id` fetch is kept as a fallback for responses that carry the
 * id without inlining the original. `usePost` is cached, so a quoted post
 * already on screen costs nothing.
 *
 * Renders nothing when the post isn't a quote, so it is safe to drop into any
 * card unconditionally.
 */
export function QuotedPostInline({ post }: { post: PostOrComment }) {
  const router = useRouter();
  const inlined = post.quote_post?.post;

  // Called unconditionally — `usePost` is disabled without an id, and hooks
  // cannot be skipped. Never fires when the quote is already inlined.
  const fetched = usePost(inlined ? undefined : post.quote_post_id);
  const quoted = inlined ?? fetched.data;

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
