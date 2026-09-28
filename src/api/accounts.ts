import type { AuthToken, Group } from './types';

import { secureStorage } from '@/lib/storage';

/**
 * Accounts saved in this browser, for the account switcher.
 *
 * Each holds a live token, so the list is kept where the active token is
 * (`secureStorage`; on web that is localStorage, see storage.web.ts). The
 * active session is still the keys `SessionProvider` always used. This list
 * sits beside them, so a browser that never adds a second account behaves
 * exactly as before (docs/ARCHITECTURE.md#accounts-and-login-files).
 */
export interface SavedAccount {
  userId: string;
  token: AuthToken;
  primaryGroup: Group | null;
  /** "@name", "Phone ending 1234", or a stand-in until the identity loads. */
  label: string;
  /** `null` once looked up and found missing; absent until then. */
  icon?: { emoji?: string; color?: string } | null;
  savedAt: string;
}

const ACCOUNTS_KEY = 'webyak.accounts';

function isSavedAccount(value: unknown): value is SavedAccount {
  const v = value as SavedAccount | null;
  return Boolean(v && typeof v.userId === 'string' && v.userId && typeof v.token === 'string' && v.token);
}

export async function loadAccounts(): Promise<SavedAccount[]> {
  try {
    const raw = await secureStorage.getItem(ACCOUNTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isSavedAccount) : [];
  } catch {
    // A corrupt list loses the switcher, never the active session.
    return [];
  }
}

export async function writeAccounts(accounts: SavedAccount[]): Promise<void> {
  await secureStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** The list with `account` in it, replacing any older copy of the same user. */
export function withAccount(accounts: SavedAccount[], account: SavedAccount): SavedAccount[] {
  const at = accounts.findIndex((a) => a.userId === account.userId);
  if (at === -1) return [...accounts, account];
  const next = [...accounts];
  next[at] = { ...accounts[at], ...account };
  return next;
}

/**
 * What the switcher calls an account.
 *
 * Yik Yak accounts are phone numbers, so where there's no username, the last
 * four digits are what a person recognises; only those four are kept. The id
 * is the last resort, and is replaced once `getUpdates()` has answered.
 */
export function accountLabel(
  user: { username?: unknown; phone_number?: unknown } | null | undefined,
  userId: string,
): string {
  if (typeof user?.username === 'string' && user.username) return `@${user.username}`;
  const digits = typeof user?.phone_number === 'string' ? user.phone_number.replace(/\D/g, '') : '';
  if (digits.length >= 4) return `Phone ending ${digits.slice(-4)}`;
  return `Account ${userId.slice(0, 4)}`;
}
