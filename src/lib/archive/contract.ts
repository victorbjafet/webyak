import type { ArchiveQuery } from './query';
import type { ArchiveStats, ArchivedContent, CrawlState } from './types';

/**
 * What every platform implementation of the archive store must provide.
 *
 * ## Why this exists
 *
 * `store.ts` (native) and `store.web.ts` (IndexedDB) are a platform split, and
 * **TypeScript only ever resolves `./store` to the native file.** So a web-only
 * implementation can lose an export entirely and `tsc`, `expo lint` and the
 * production build all stay green — the failure surfaces as
 * `listPostsNeedingComments is not a function` in a browser, at the moment a
 * user presses the button.
 *
 * That is exactly what happened on 2026-09-12: an edit that replaced a section
 * of `store.web.ts` by slicing between two markers removed three functions that
 * had been appended in between, and nothing caught it.
 *
 * Both modules now assert against this interface at the bottom of the file. tsc
 * checks every file in the project, including the `.web` one it never resolves,
 * so a missing or mistyped export is a compile error instead of a runtime one.
 */
export interface ArchiveStore {
  archiveAvailable: boolean;

  archiveContent(
    items: (unknown | null | undefined)[],
  ): Promise<{ added: number; updated: number }>;
  getArchiveStats(): Promise<ArchiveStats>;
  clearArchive(): Promise<void>;
  forEachRecord(
    visit: (record: ArchivedContent) => void,
    onProgress?: (seen: number) => void,
  ): Promise<void>;

  findArchivedByCode(code: string): Promise<ArchivedContent | undefined>;
  findArchivedById(id: string): Promise<ArchivedContent | undefined>;
  getOldestArchived(groupId: string): Promise<string | undefined>;

  searchArchive(query: ArchiveQuery): Promise<{
    records: ArchivedContent[];
    scanned: number;
    strategy: string;
    truncated: boolean;
    ms: number;
  }>;

  getCrawlState(groupId: string): Promise<CrawlState | undefined>;
  setCrawlState(state: CrawlState): Promise<void>;
  listCrawlStates(): Promise<CrawlState[]>;

  listPostsNeedingComments(
    limit?: number,
    groupId?: string,
  ): Promise<{ id: string; comment_count: number }[]>;
  countPostsNeedingComments(groupId?: string): Promise<number>;
  markCommentsFetched(postId: string, count: number): Promise<void>;

  exportArchive(onProgress?: (rows: number) => void): Promise<Blob>;
  importArchive(
    file: Blob,
    onProgress?: (progress: unknown) => void,
    shouldStop?: () => boolean,
  ): Promise<unknown>;
}
