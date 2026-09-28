/**
 * Where a yikyak.com path goes in webyak, or null. Their URLs are
 * `/cy/<group>/comments/<code>/<slug>` for a post and `/cy/<group>` for a
 * community. Only the code matters for a post: `cy` is a literal and the other
 * segments are decoration (docs/WORKER.md#get-postcode). So a yikyak.com link
 * with its host swapped for webyak's lands on the right screen, and
 * `/p/<code>` then resolves the code as far as it can (cache, archive, Worker).
 */
export function yikYakRedirect(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'cy') return null;
  const commentsAt = parts.indexOf('comments');
  if (commentsAt >= 1 && parts[commentsAt + 1]) {
    return `/p/${encodeURIComponent(parts[commentsAt + 1])}`;
  }
  if (parts.length === 2) return `/g/${encodeURIComponent(parts[1])}`;
  return null;
}
