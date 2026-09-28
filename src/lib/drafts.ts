import { accountKey } from './account-scope';
import { cacheStorage } from './storage';

/**
 * Unsent posts, kept so leaving the composer doesn't lose one (Phase 7).
 *
 * One draft per account and target: `new` for a plain post, or the id of the
 * post being quote-reposted, so a half-written repost doesn't turn up over a
 * fresh post. Only what can be serialized is kept: text, the toggles and
 * poll options. An attached image is a blob and isn't. Per device, like the
 * other per-account state (src/lib/account-scope.ts).
 */
export interface Draft {
  text: string;
  anonymous: boolean;
  disableDMs: boolean;
  disableComments: boolean;
  pollOptions: string[] | null;
  /** When it was last written, ISO. */
  savedAt: string;
}

const STORAGE_KEY = 'webyak.drafts';
/** Only the most recent few targets are kept. */
const MAX_DRAFTS = 5;

type Drafts = Record<string, Draft>;

async function load(userId: string): Promise<{ key: string; drafts: Drafts }> {
  const key = await accountKey(STORAGE_KEY, userId);
  try {
    const raw = await cacheStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return { key, drafts: parsed && typeof parsed === 'object' ? (parsed as Drafts) : {} };
  } catch {
    return { key, drafts: {} };
  }
}

export async function readDraft(userId: string, target: string): Promise<Draft | null> {
  const draft = (await load(userId)).drafts[target];
  return draft && typeof draft.text === 'string' ? draft : null;
}

/** Saves, or removes when there is nothing worth keeping. */
export async function writeDraft(userId: string, target: string, draft: Omit<Draft, 'savedAt'>) {
  const { key, drafts } = await load(userId);
  const empty = !draft.text.trim() && !(draft.pollOptions ?? []).some((o) => o.trim());
  if (empty) {
    if (!(target in drafts)) return;
    delete drafts[target];
  } else {
    drafts[target] = { ...draft, savedAt: new Date().toISOString() };
  }
  const kept = Object.entries(drafts)
    .sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_DRAFTS);
  await cacheStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
}

export async function clearDraft(userId: string, target: string) {
  const { key, drafts } = await load(userId);
  if (!(target in drafts)) return;
  delete drafts[target];
  await cacheStorage.setItem(key, JSON.stringify(drafts));
}
