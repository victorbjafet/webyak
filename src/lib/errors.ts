/**
 * What to tell the user about a failure (PLAN Phase 9, friendly errors).
 *
 * The API's own messages are shown when it sends one (`unwrap` surfaces
 * them). These cover the failures that arrive as a bare status or a browser
 * exception, whose raw text ("Failed to fetch", "GET /v1/posts failed with
 * 502") means nothing to a reader.
 *
 * Duck-typed on `status` rather than importing `ApiError`, so the toast and
 * state components can use it without pulling in the API client.
 */
export function friendlyError(error: unknown): string | undefined {
  if (!error) return undefined;
  const status = (error as { status?: unknown }).status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 429) {
    return 'Yik Yak is asking webyak to slow down. It will wait a minute before trying again.';
  }
  if (typeof status === 'number' && status >= 500) {
    return `Yik Yak's servers had a problem (${status}). Try again in a moment.`;
  }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) {
    return "Couldn't reach Yik Yak. Check your connection and try again.";
  }
  if (/ failed with \d+$/.test(message)) {
    return status === 403 ? 'Yik Yak refused that.' : 'That request failed.';
  }
  return message || undefined;
}
