import { accountKey } from './account-scope';
import { cacheStorage } from './storage';

/**
 * Your karma as it stood the last time Alerts was open, so the next visit can
 * say what changed (B4). Per account and per device: there is no server-side
 * record of when you last looked, and the official app shows no such number.
 */
const STORAGE_KEY = 'webyak.karmaSeen';

export interface KarmaMark {
  post: number;
  comment: number;
  /** When it was recorded, ISO. */
  at: string;
}

export async function readKarmaMark(userId: string): Promise<KarmaMark | null> {
  try {
    const raw = await cacheStorage.getItem(await accountKey(STORAGE_KEY, userId));
    const mark = raw ? (JSON.parse(raw) as Partial<KarmaMark>) : null;
    return mark &&
      typeof mark.post === 'number' &&
      typeof mark.comment === 'number' &&
      typeof mark.at === 'string'
      ? (mark as KarmaMark)
      : null;
  } catch {
    return null;
  }
}

export async function writeKarmaMark(userId: string, mark: KarmaMark): Promise<void> {
  await cacheStorage.setItem(await accountKey(STORAGE_KEY, userId), JSON.stringify(mark));
}
