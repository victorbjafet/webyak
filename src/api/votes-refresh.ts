import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { votesThreshold } from './activity';
import { patchPostEverywhere } from './mutations';
import { activityItems, isPostId, queryKeys, useActivity } from './queries';
import { useSession } from './session';

/**
 * Scores kept current by `votes` alerts instead of by polling every score (B1).
 *
 * A `votes` alert says a post, or one of your comments, just reached a karma
 * threshold: `votes~<uuid>~<n>`. The alerts poll already runs app-wide, so a
 * new one is a free signal that a score moved. When one arrives:
 *
 * - every cached copy of that post or comment is raised to at least `n`, which
 *   costs no request and is never wrong about the moment the alert was made;
 * - the post, and its thread when a comment is named, are invalidated, so they
 *   refetch **only if on screen**. Anything else just reads fresh next time.
 *
 * Only alerts that arrive while the app is open count. The first load is a
 * baseline: acting on all ~30 alerts already there would raise scores to
 * thresholds that may be weeks old.
 */
export function useScoresFromVotesAlerts() {
  const client = useQueryClient();
  const { userId } = useSession();
  const { data } = useActivity();
  const known = useRef<{ userId: string | null; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (!data) return;
    const votes = activityItems(data).filter((item) => item.type === 'votes');
    if (known.current?.userId !== userId) {
      known.current = { userId, ids: new Set(votes.map((item) => item.id)) };
      return;
    }
    const { ids } = known.current;
    for (const item of votes) {
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      const reached = votesThreshold(item);
      const postId = item.post_id && isPostId(item.post_id) ? item.post_id : null;
      if (reached === null || !postId) continue;
      const commentId = item.comment_id && isPostId(item.comment_id) ? item.comment_id : null;
      patchPostEverywhere(client, commentId ?? postId, (post) =>
        post.vote_total < reached ? { ...post, vote_total: reached } : post,
      );
      void client.invalidateQueries({ queryKey: queryKeys.post(postId) });
      if (commentId) void client.invalidateQueries({ queryKey: queryKeys.comments(postId) });
    }
  }, [client, data, userId]);
}
