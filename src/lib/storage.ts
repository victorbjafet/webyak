import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Credentials (the Sidechat bearer token). Backed by the OS keychain/keystore.
 * SecureStore has no web implementation, so `storage.web.ts` overrides this file
 * on web entirely — see the note there about the security tradeoff.
 *
 * Keep values small: SecureStore warns above ~2KB on Android. Never put the
 * query cache here.
 */
export const secureStorage: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

/**
 * Non-sensitive, and **small**: preferences, the selected community, seen-post
 * ids, drafts. On web this is `localStorage` — a few MB, synchronous, silently
 * lossy at quota — so anything that grows without bound belongs in the archive
 * instead (`src/lib/archive`, IndexedDB). The query cache used to be persisted
 * here and outgrew it; see docs/ARCHITECTURE.md#the-archive--two-storage-layers-not-one.
 */
export const cacheStorage: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
