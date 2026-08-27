import type { PostOrComment } from '@/api/types';

/**
 * The URL we hand to other people.
 *
 * Deliberately a **yikyak.com** link, not a webyak one: `/p/<code>` can't be
 * opened cold yet (docs/API.md#blocker-1), so a webyak link would be broken for
 * whoever receives it. The public web client resolves the code from any group
 * and title segment, and only the leading `cy` matters — but we fill in the real
 * ones when we have them so the link reads sensibly.
 *
 * Flip this to a webyak URL once the Worker lands (docs/WORKER.md).
 */
export function shareUrlForPost(post: PostOrComment): string | null {
  if (!post.index_code) return null;
  const group = post.group?.index_name || post.group?.analytics_name || 'yikyak';
  const slug = slugify(post.text) || 'post';
  return `https://web.yikyak.com/cy/${encodeURIComponent(group)}/comments/${post.index_code}/${slug}`;
}

function slugify(text: string | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join('-')
    .slice(0, 60);
}
