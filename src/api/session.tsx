import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { AuthResult } from './auth';
import { clearAuthToken, setAuthToken, setUnauthorizedHandler } from './client';
import type { AuthToken, Group } from './types';

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
  signIn(result: AuthResult): Promise<void>;
  signOut(): Promise<void>;
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

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [token, setToken] = useState<AuthToken | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [primaryGroup, setPrimaryGroup] = useState<Group | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [storedToken, storedUserId, storedGroup, storedDeviceId] = await Promise.all([
        secureStorage.getItem(TOKEN_KEY),
        cacheStorage.getItem(USER_ID_KEY),
        cacheStorage.getItem(PRIMARY_GROUP_KEY),
        cacheStorage.getItem(DEVICE_ID_KEY),
      ]);
      if (cancelled) return;

      let id = storedDeviceId;
      if (!id) {
        id = createDeviceId();
        await cacheStorage.setItem(DEVICE_ID_KEY, id);
      }
      setDeviceId(id);
      setUserId(storedUserId);
      setPrimaryGroup(parseGroup(storedGroup));

      if (storedToken) {
        setAuthToken(storedToken);
        setToken(storedToken);
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (result: AuthResult) => {
    setAuthToken(result.token);
    await Promise.all([
      secureStorage.setItem(TOKEN_KEY, result.token),
      result.userId ? cacheStorage.setItem(USER_ID_KEY, result.userId) : Promise.resolve(),
      result.group
        ? cacheStorage.setItem(PRIMARY_GROUP_KEY, JSON.stringify(result.group))
        : Promise.resolve(),
    ]);
    setToken(result.token);
    if (result.userId) setUserId(result.userId);
    if (result.group) setPrimaryGroup(result.group);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    clearAuthToken();
    await Promise.all([
      secureStorage.removeItem(TOKEN_KEY),
      cacheStorage.removeItem(USER_ID_KEY),
      cacheStorage.removeItem(PRIMARY_GROUP_KEY),
    ]);
    setToken(null);
    setUserId(null);
    setPrimaryGroup(null);
    setStatus('anonymous');
  }, []);

  // Any 401 from anywhere drops the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<Session>(
    () => ({ status, token, userId, primaryGroup, deviceId, signIn, signOut }),
    [status, token, userId, primaryGroup, deviceId, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
