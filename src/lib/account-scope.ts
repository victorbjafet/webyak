import { cacheStorage } from './storage';

/**
 * The storage key for one account's copy of a per-account setting:
 * `webyak.seenPosts:<userId>`.
 *
 * Which community is selected, which posts have been seen, which chats have
 * been read: all of it belongs to an account, not to the browser, once a
 * browser can hold more than one (the account switcher). These keys were
 * unscoped before that. The first account to load afterwards adopts the old
 * value — it is the one that was signed in, so the value is its own — and the
 * unscoped key is removed, so it can't be adopted twice.
 */
export async function accountKey(base: string, userId: string): Promise<string> {
  const key = `${base}:${userId}`;
  const legacy = await cacheStorage.getItem(base);
  if (legacy !== null) {
    if ((await cacheStorage.getItem(key)) === null) await cacheStorage.setItem(key, legacy);
    await cacheStorage.removeItem(base);
  }
  return key;
}
