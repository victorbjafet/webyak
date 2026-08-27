import type { KeyValueStore } from './storage';

export type { KeyValueStore };

/**
 * `expo-secure-store` has no web implementation, and the browser has no keychain.
 * We fall back to localStorage, which means the bearer token is readable by any
 * script running on this origin. Mitigation is to ship zero third-party scripts.
 * See "Risks" in PLAN.md.
 *
 * Guarded because `web.output: "static"` prerenders these routes in Node, where
 * `window` does not exist, and because Safari private mode can throw on access.
 */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const webStore: KeyValueStore = {
  async getItem(key) {
    try {
      return safeLocalStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      safeLocalStorage()?.setItem(key, value);
    } catch {
      // quota exceeded or storage blocked — non-fatal
    }
  },
  async removeItem(key) {
    try {
      safeLocalStorage()?.removeItem(key);
    } catch {
      // non-fatal
    }
  },
};

export const secureStorage = webStore;
export const cacheStorage = webStore;
