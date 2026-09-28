/**
 * Where a post opens: `/p/<share code>` when it has one, since that's short
 * and the form yikyak.com uses, else `/p/<id>`, which the post screen resolves
 * cold. Every post the API has sent so far carries a code; this keeps one that
 * doesn't openable instead of silently unlinked.
 */
export function postHref(post: { index_code?: string; id?: string } | null | undefined) {
  const code = post?.index_code || post?.id;
  return code ? { pathname: '/p/[code]' as const, params: { code } } : null;
}
