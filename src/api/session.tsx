import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { accountLabel, loadAccounts, withAccount, writeAccounts, type SavedAccount } from './accounts';
import type { AuthResult } from './auth';
import { checkToken, clearAuthToken, getUpdates, setAuthToken, setUnauthorizedHandler } from './client';
import type { AuthToken, Group, MyIdentity } from './types';

import { LoginFileError, type LoginPayload } from '@/lib/login-file';
import { cacheStorage, secureStorage } from '@/lib/storage';

const TOKEN_KEY = 'webyak.token';
const USER_ID_KEY = 'webyak.userId';
const PRIMARY_GROUP_KEY = 'webyak.primaryGroup';
const DEVICE_ID_KEY = 'webyak.deviceId';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface Session {
  status: SessionStatus;
  token: AuthToken | null;
  userId: string | null;
  /** The account's primary group, stored at login so the home feed has a target. */
  primaryGroup: Group | null;
  /** Stable per-install ID, required by the DM endpoints (Phase 6). */
  deviceId: string | null;
  /** Every account saved in this browser, the active one included. */
  accounts: SavedAccount[];
  signIn(result: AuthResult): Promise<void>;
  /** Signs out, and removes this account from the browser. Others stay saved. */
  signOut(): Promise<void>;
  /** Makes a saved account the active one. */
  switchAccount(userId: string): Promise<void>;
  /** Keeps the active account saved, and goes to sign-in to add another. */
  addAccount(): Promise<void>;
  /** Saves an account opened from a login file, after checking its token, and switches to it. */
  importAccount(payload: LoginPayload): Promise<void>;
  /** Removes a saved account. The active one is signed out. */
  forgetAccount(userId: string): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** RFC4122-ish v4. `crypto.randomUUID` isn't guaranteed on every RN runtime. */
function createDeviceId() {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseGroup(raw: string | null): Group | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Group;
  } catch {
    return null;
  }
}

/** Writes `account` into the keys the active session is read from. */
async function activate(account: SavedAccount) {
  await Promise.all([
    secureStorage.setItem(TOKEN_KEY, account.token),
    cacheStorage.setItem(USER_ID_KEY, account.userId),
    account.primaryGroup
      ? cacheStorage.setItem(PRIMARY_GROUP_KEY, JSON.stringify(account.primaryGroup))
      : cacheStorage.removeItem(PRIMARY_GROUP_KEY),
  ]);
}

async function deactivate() {
  await Promise.all([
    secureStorage.removeItem(TOKEN_KEY),
    cacheStorage.removeItem(USER_ID_KEY),
    cacheStorage.removeItem(PRIMARY_GROUP_KEY),
  ]);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [token, setToken] = useState<AuthToken | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [primaryGroup, setPrimaryGroup] = useState<Group | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);

  // The callbacks below run long after the render that made them (the 401
  // handler especially), so they read the latest list and account from here.
  const accountsRef = useRef<SavedAccount[]>([]);
  const userIdRef = useRef<string | null>(null);

  const saveAccounts = useCallback(async (next: SavedAccount[]) => {
    accountsRef.current = next;
    setAccounts(next);
    await writeAccounts(next);
  }, []);

  /**
   * Names an account from its identity: "@name", or the last four digits of
   * its number. One `getUpdates()` after a sign-in, and once for a session
   * saved before the switcher existed.
   */
  const labelActive = useCallback(
    async (id: string) => {
      try {
        const user = ((await getUpdates())?.user ?? {}) as MyIdentity;
        const current = accountsRef.current.find((a) => a.userId === id);
        if (!current) return;
        const label = accountLabel(user, id);
        const icon = user.conversation_icon
          ? { emoji: user.conversation_icon.emoji, color: user.conversation_icon.color }
          : null;
        if (
          label === current.label &&
          current.icon !== undefined &&
          icon?.emoji === current.icon?.emoji &&
          icon?.color === current.icon?.color
        ) {
          return;
        }
        await saveAccounts(withAccount(accountsRef.current, { ...current, label, icon }));
      } catch {
        /* the stand-in label stays until next time */
      }
    },
    [saveAccounts],
  );

  /**
   * Moves the app to another account, or to none. On the web that's a fresh
   * page load: the only reset sure to be complete — the query cache, the
   * module-level stores, open video players, requests still in flight — so
   * nothing one account loaded can show under another.
   */
  const enter = useCallback(
    (account: SavedAccount | null) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.replace('/');
        return;
      }
      queryClient.clear();
      userIdRef.current = account?.userId ?? null;
      if (account) {
        setAuthToken(account.token);
        setToken(account.token);
        setUserId(account.userId);
        setPrimaryGroup(account.primaryGroup);
        setStatus('authenticated');
      } else {
        clearAuthToken();
        setToken(null);
        setUserId(null);
        setPrimaryGroup(null);
        setStatus('anonymous');
      }
    },
    [queryClient],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [storedToken, storedUserId, storedGroup, storedDeviceId, saved] = await Promise.all([
        secureStorage.getItem(TOKEN_KEY),
        cacheStorage.getItem(USER_ID_KEY),
        cacheStorage.getItem(PRIMARY_GROUP_KEY),
        cacheStorage.getItem(DEVICE_ID_KEY),
        loadAccounts(),
      ]);
      if (cancelled) return;

      let id = storedDeviceId;
      if (!id) {
        id = createDeviceId();
        await cacheStorage.setItem(DEVICE_ID_KEY, id);
      }
      setDeviceId(id);
      setUserId(storedUserId);
      userIdRef.current = storedUserId;
      setPrimaryGroup(parseGroup(storedGroup));
      accountsRef.current = saved;
      setAccounts(saved);

      if (storedToken) {
        setAuthToken(storedToken);
        setToken(storedToken);
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
        return;
      }

      // A session from before the account switcher: save it, so it's one tap
      // away once another account is added, and give it a real name.
      let known = storedUserId;
      if (!known) {
        known = (await checkToken(storedToken).catch(() => null))?.userId ?? null;
        if (!known || cancelled) return;
        await cacheStorage.setItem(USER_ID_KEY, known);
        setUserId(known);
        userIdRef.current = known;
      }
      if (!saved.some((a) => a.userId === known)) {
        await saveAccounts(
          withAccount(saved, {
            userId: known,
            token: storedToken,
            primaryGroup: parseGroup(storedGroup),
            label: accountLabel(null, known),
            savedAt: new Date().toISOString(),
          }),
        );
      }
      // Named from the identity when it only has a stand-in name, or its icon
      // was never looked up (an import from before files carried it).
      const entry = accountsRef.current.find((a) => a.userId === known);
      if (entry && (entry.label === accountLabel(null, known) || entry.icon === undefined)) {
        void labelActive(known);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [saveAccounts, labelActive]);

  const signIn = useCallback(
    async (result: AuthResult) => {
      setAuthToken(result.token);
      const id = result.userId ?? (await checkToken(result.token).catch(() => null))?.userId;
      await Promise.all([
        secureStorage.setItem(TOKEN_KEY, result.token),
        id ? cacheStorage.setItem(USER_ID_KEY, id) : Promise.resolve(),
        result.group
          ? cacheStorage.setItem(PRIMARY_GROUP_KEY, JSON.stringify(result.group))
          : Promise.resolve(),
      ]);
      if (id) {
        const existing = accountsRef.current.find((a) => a.userId === id);
        await saveAccounts(
          withAccount(accountsRef.current, {
            userId: id,
            token: result.token,
            primaryGroup: result.group ?? existing?.primaryGroup ?? null,
            label: existing?.label ?? accountLabel(null, id),
            savedAt: new Date().toISOString(),
          }),
        );
      }
      setToken(result.token);
      if (id) {
        setUserId(id);
        userIdRef.current = id;
      }
      if (result.group) setPrimaryGroup(result.group);
      setStatus('authenticated');
      if (id) void labelActive(id);
    },
    [saveAccounts, labelActive],
  );

  const signOut = useCallback(async () => {
    clearAuthToken();
    const gone = userIdRef.current;
    await Promise.all([
      deactivate(),
      gone ? saveAccounts(accountsRef.current.filter((a) => a.userId !== gone)) : Promise.resolve(),
    ]);
    enter(null);
  }, [saveAccounts, enter]);

  const switchAccount = useCallback(
    async (id: string) => {
      const account = accountsRef.current.find((a) => a.userId === id);
      if (!account) return;
      await activate(account);
      enter(account);
    },
    [enter],
  );

  const addAccount = useCallback(async () => {
    clearAuthToken();
    await deactivate();
    enter(null);
  }, [enter]);

  const importAccount = useCallback(
    async (payload: LoginPayload) => {
      let owner: { userId: string } | null;
      try {
        owner = await checkToken(payload.token);
      } catch {
        throw new LoginFileError("Couldn't reach Yik Yak to check the login. Try again in a moment.");
      }
      if (!owner) {
        throw new LoginFileError(
          'That login no longer works — it was signed out or has expired. Sign in with the phone number instead.',
        );
      }
      // The token's own answer wins over whatever the file says it is.
      const account: SavedAccount = {
        userId: owner.userId,
        token: payload.token,
        primaryGroup: payload.primaryGroup ?? null,
        label: payload.label || accountLabel(null, owner.userId),
        icon: payload.icon,
        savedAt: new Date().toISOString(),
      };
      await saveAccounts(withAccount(accountsRef.current, account));
      await activate(account);
      enter(account);
    },
    [saveAccounts, enter],
  );

  const forgetAccount = useCallback(
    async (id: string) => {
      if (id === userIdRef.current) {
        await signOut();
        return;
      }
      await saveAccounts(accountsRef.current.filter((a) => a.userId !== id));
    },
    [saveAccounts, signOut],
  );

  // Any 401 from anywhere drops the session — and the account with it, since
  // its token is what stopped working.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<Session>(
    () => ({
      status,
      token,
      userId,
      primaryGroup,
      deviceId,
      accounts,
      signIn,
      signOut,
      switchAccount,
      addAccount,
      importAccount,
      forgetAccount,
    }),
    [
      status,
      token,
      userId,
      primaryGroup,
      deviceId,
      accounts,
      signIn,
      signOut,
      switchAccount,
      addAccount,
      importAccount,
      forgetAccount,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
