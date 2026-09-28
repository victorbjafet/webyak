import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { markChatRead } from './chats';
import { queryKeys } from './queries';
import { useSession } from './session';
import type { DirectThread } from './types';

import { chatReadAt, useChatReads } from '@/lib/chat-reads';

/**
 * Tells the server what this device has read, so the official app agrees.
 *
 * Opening a thread and *Mark all read* write a mark on this device first
 * (src/lib/chat-reads.ts), and the UI reads that, so a chat clears the moment
 * it's read. This sends the server each mark it doesn't have yet, as
 * `POST /v1/chats/read` (docs/API.md#marking-a-chat-read):
 *
 * - **Only forward.** A mark goes out only while it's later than the server's
 *   `last_read_timestamp` for that chat. Marks made before the call was known
 *   go out the first time the list loads.
 * - **One request at a time**, each sending the chat's latest mark when its
 *   turn comes. *Mark all read* can mean every chat at once, and two marks for
 *   one chat racing each other could leave the older one on the server.
 * - **Each mark once per page load**, sent or refused, so a chat the server
 *   won't mark isn't retried on every poll. A refused mark still clears the
 *   chat here, and goes out again on the next load.
 *
 * Mounted wherever chats are on screen: the list, and a thread. Both at once
 * send nothing twice.
 */

interface Job {
  id: string;
  userId: string;
  client: QueryClient;
}

const queue: Job[] = [];
/** Chats with a job queued and not yet started. */
const waiting = new Set<string>();
let draining = false;
/** `userId chatId mark`, for every mark sent or refused since the page loaded. */
const tried = new Set<string>();

/**
 * Whether `mark` is later than `serverMark`. A chat with no server mark, or an
 * unreadable one, counts as never read.
 */
function isAhead(mark: string, serverMark: string | undefined) {
  const at = Date.parse(mark);
  if (!Number.isFinite(at)) return false;
  const server = serverMark ? Date.parse(serverMark) : NaN;
  return !Number.isFinite(server) || at > server;
}

/** The later server mark of the chat's two cached copies, the list's and its own. */
function serverMark(client: QueryClient, id: string): string | undefined {
  const listed = client
    .getQueryData<DirectThread[]>(queryKeys.dmThreads())
    ?.find((thread) => thread.id === id)?.last_read_timestamp;
  const opened = client.getQueryData<DirectThread | null>(queryKeys.dmThread(id))?.last_read_timestamp;
  if (!listed || !opened) return listed ?? opened;
  return isAhead(opened, listed) ? opened : listed;
}

/** Writes a mark the server took into both cached copies, so it isn't sent again. */
function recordServerMark(client: QueryClient, id: string, mark: string) {
  const patch = (thread: DirectThread): DirectThread =>
    thread.id === id && isAhead(mark, thread.last_read_timestamp)
      ? { ...thread, last_read_timestamp: mark }
      : thread;
  client.setQueryData<DirectThread[]>(queryKeys.dmThreads(), (threads) => threads?.map(patch));
  client.setQueryData<DirectThread | null>(queryKeys.dmThread(id), (thread) =>
    thread ? patch(thread) : thread,
  );
}

async function send({ id, userId, client }: Job) {
  const mark = chatReadAt(id);
  if (!mark || !isAhead(mark, serverMark(client, id))) return;
  const key = `${userId} ${id} ${mark}`;
  if (tried.has(key)) return;
  tried.add(key);
  try {
    await markChatRead(id, mark);
    recordServerMark(client, id, mark);
  } catch {
    // Still read here, by the local mark. The next page load tries again.
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      waiting.delete(job.id);
      await send(job);
    }
  } finally {
    draining = false;
  }
}

/** Sends the server every mark this device has for `threads` that it's missing. */
export function useChatReadSync(threads: readonly DirectThread[] | undefined) {
  const client = useQueryClient();
  const { userId } = useSession();
  const reads = useChatReads();

  useEffect(() => {
    if (!threads || !userId) return;
    for (const thread of threads) {
      const mark = reads.get(thread.id);
      if (!mark || !isAhead(mark, thread.last_read_timestamp)) continue;
      if (waiting.has(thread.id) || tried.has(`${userId} ${thread.id} ${mark}`)) continue;
      waiting.add(thread.id);
      queue.push({ id: thread.id, userId, client });
    }
    void drain();
  }, [threads, reads, userId, client]);
}
