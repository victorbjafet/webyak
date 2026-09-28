import type { Group } from '@/api/types';

/**
 * A login, sealed with a passphrase, for moving an account to another webyak —
 * localhost to the live site, say — without the SMS step.
 *
 * The token in it is the whole account: anyone holding it can post, read DMs
 * and change the profile as you. So it never leaves the browser in the clear.
 * PBKDF2 (SHA-256, 600,000 rounds, per OWASP's current guidance) stretches the
 * passphrase into an AES-GCM key, and only ciphertext is written. A file left in
 * Downloads on a shared computer is useless without the passphrase, and GCM's
 * tag makes a wrong passphrase or an edited file fail outright rather than
 * decrypt to garbage.
 *
 * Web Crypto only. `crypto.subtle` exists on https origins and on localhost,
 * which covers everywhere webyak runs (docs/ARCHITECTURE.md#accounts-and-login-files).
 */

export interface LoginPayload {
  userId: string;
  token: string;
  primaryGroup: Group | null;
  /** How the account switcher names it: "@name", or "Phone ending 1234". */
  label: string;
  /** Its emoji and colour, for the switcher. */
  icon?: { emoji?: string; color?: string } | null;
  exportedAt: string;
  /** The webyak it came from, shown when importing. */
  origin: string;
}

interface SealedLogin {
  format: typeof FORMAT;
  version: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

const FORMAT = 'webyak-login';
const VERSION = 1;
const ITERATIONS = 600_000;
/** A file asking for more than this is refused rather than left to hang the tab. */
const MAX_ITERATIONS = 5_000_000;

export const MIN_PASSPHRASE = 8;
export const LOGIN_FILE_ACCEPT = '.json,application/json';

/** A problem worth showing as-is: the message says what to do. */
export class LoginFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginFileError';
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new LoginFileError(
      "This browser can't encrypt here. Login files need an https page, or localhost.",
    );
  }
  return s;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await subtle().importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealLogin(payload: LoginPayload, passphrase: string): Promise<Blob> {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new LoginFileError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload))),
  );
  const sealed: SealedLogin = {
    format: FORMAT,
    version: VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(data),
  };
  return new Blob([JSON.stringify(sealed, null, 2)], { type: 'application/json' });
}

function isSealedLogin(value: unknown): value is SealedLogin {
  const v = value as SealedLogin | null;
  return Boolean(
    v &&
      v.format === FORMAT &&
      typeof v.version === 'number' &&
      v.kdf?.name === 'PBKDF2' &&
      v.kdf.hash === 'SHA-256' &&
      Number.isInteger(v.kdf.iterations) &&
      typeof v.kdf.salt === 'string' &&
      v.cipher?.name === 'AES-GCM' &&
      typeof v.cipher.iv === 'string' &&
      typeof v.data === 'string',
  );
}

export async function openLogin(file: Blob, passphrase: string): Promise<LoginPayload> {
  let sealed: unknown;
  try {
    sealed = JSON.parse(await file.text());
  } catch {
    throw new LoginFileError("That isn't a webyak login file.");
  }
  if ((sealed as SealedLogin | null)?.format === FORMAT && (sealed as SealedLogin).version > VERSION) {
    throw new LoginFileError('This login file is from a newer webyak. Update this one, then try again.');
  }
  if (!isSealedLogin(sealed)) throw new LoginFileError("That isn't a webyak login file.");
  if (sealed.kdf.iterations < 1 || sealed.kdf.iterations > MAX_ITERATIONS) {
    throw new LoginFileError("That login file's settings aren't ones webyak writes.");
  }

  let plain: ArrayBuffer;
  try {
    const key = await keyFor(passphrase, fromBase64(sealed.kdf.salt), sealed.kdf.iterations);
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.cipher.iv) },
      key,
      fromBase64(sealed.data),
    );
  } catch (error) {
    if (error instanceof LoginFileError) throw error;
    throw new LoginFileError("Wrong passphrase, or the file was changed after it was saved.");
  }

  let payload: LoginPayload;
  try {
    payload = JSON.parse(decoder.decode(plain)) as LoginPayload;
  } catch {
    throw new LoginFileError('The file opened, but what was inside is damaged.');
  }
  if (typeof payload?.token !== 'string' || !payload.token || typeof payload.userId !== 'string') {
    throw new LoginFileError('The file opened, but holds no login.');
  }
  return payload;
}

/** `webyak-login-2026-09-27.json`, in local time. Matched by .gitignore. */
export function loginFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `webyak-login-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
