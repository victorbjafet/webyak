import type { ArchiveStats, ArchivedContent, CrawlState } from './types';

import type { PostOrComment } from '@/api/types';

/**
 * The archive, native side — **not implemented.**
 *
 * The web implementation is IndexedDB, which React Native does not have. A
 * native archive would want `expo-sqlite`, and that is a different schema, a
 * different query language and a dependency that cannot be exercised here —
 * this is a web-first build on GitHub Pages with no native build in the loop.
 * Same decision as image attachments, for the same reason.
 *
 * Everything below no-ops so the native bundle compiles and the settings screen
 * degrades to "not available here" rather than crashing.
 */

export const archiveAvailable = false;

export async function archiveContent(
  _items: (PostOrComment | null | undefined)[],
): Promise<{ added: number; updated: number }> {
  return { added: 0, updated: 0 };
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  return {
    posts: 0,
    comments: 0,
    deleted: 0,
    needsComments: 0,
    withMedia: 0,
    mediaPending: 0,
    mediaCached: 0,
  };
}

export async function getCrawlState(_groupId: string): Promise<CrawlState | undefined> {
  return undefined;
}

export async function setCrawlState(_state: CrawlState): Promise<void> {}

export async function listCrawlStates(): Promise<CrawlState[]> {
  return [];
}

export async function exportArchive(_onProgress?: (rows: number) => void): Promise<Blob> {
  return new Blob([], { type: 'application/x-ndjson' });
}

export async function clearArchive(): Promise<void> {}

export async function findArchivedByCode(_code: string): Promise<ArchivedContent | undefined> {
  return undefined;
}

export async function findArchivedById(_id: string): Promise<ArchivedContent | undefined> {
  return undefined;
}

export async function getOldestArchived(_groupId: string): Promise<string | undefined> {
  return undefined;
}

export async function listPostsNeedingComments(
  _limit?: number,
): Promise<{ id: string; comment_count: number }[]> {
  return [];
}

export async function markCommentsFetched(_postId: string, _count: number): Promise<void> {}

export interface SearchOptions {
  groupId?: string;
  type?: 'post' | 'comment';
  author?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export async function searchArchive(
  _query: string,
  _options?: SearchOptions,
): Promise<ArchivedContent[]> {
  return [];
}
