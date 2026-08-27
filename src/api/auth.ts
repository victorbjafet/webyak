/**
 * The Sidechat login flow.
 *
 * Modelled on offsides' `LoginScreen.jsx` state machine — see
 * docs/API.md#auth-flow for the branch table this implements.
 *
 * These call the endpoints directly rather than through sidechat.js, because
 * several of the library's auth methods throw from inside their own `try`, which
 * replaces the API's real message ("that code is incorrect") with a generic one
 * ("Failed to request email verification"). The library's `setAge` also throws a
 * hardcoded string naming a different app.
 */

import { api, ApiError, publicRequest, request, setAuthToken } from './client';
import type { Group } from './types';

export type LoginStep = 'phone' | 'code' | 'age' | 'email' | 'emailPending';

/** Minimum age the API accepts. */
export const MIN_AGE = 13;

export interface AuthResult {
  token: string;
  userId?: string;
  /** The user's primary (school) group, when the account has one. */
  group?: Group | null;
}

export type VerifyOutcome =
  | ({ kind: 'authenticated' } & AuthResult)
  | { kind: 'needsAge'; registrationId: string }
  | { kind: 'needsEmail'; token: string; userId?: string };

interface LoggedInUser {
  token: string;
  user?: { id?: string };
  group?: Group | null;
}

/** Digits only, exactly 10. The API wants a US number and adds +1 itself. */
export function normalizePhone(input: string) {
  return input.replace(/\D/g, '').slice(0, 10);
}

export function isValidPhone(input: string) {
  return normalizePhone(input).length === 10;
}

/** Formats as (555) 555-5555 while typing. */
export function formatPhone(input: string) {
  const d = normalizePhone(input);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Step 1 — send the SMS. */
export async function requestSmsCode(phone: string) {
  await publicRequest('/v1/login_register', 'POST', {
    phone_number: `+1${normalizePhone(phone)}`,
    version: 3,
  });
}

/** Step 2 — exchange the SMS code. Three-way branch, see docs/API.md. */
export async function verifySmsCode(phone: string, code: string): Promise<VerifyOutcome> {
  const json = await publicRequest<{
    logged_in_user?: LoggedInUser;
    registration_id?: string;
  }>('/v1/verify_phone_number', 'POST', {
    phone_number: `+1${normalizePhone(phone)}`,
    code: code.trim().toUpperCase(),
  });

  const loggedIn = json.logged_in_user;

  if (loggedIn?.token) {
    if (loggedIn.group) {
      return {
        kind: 'authenticated',
        token: loggedIn.token,
        userId: loggedIn.user?.id,
        group: loggedIn.group,
      };
    }
    // Token is real but registration isn't finished. Keep it either way — the
    // remaining steps need it for their Authorization header.
    if (json.registration_id) {
      setAuthToken(loggedIn.token);
      return { kind: 'needsAge', registrationId: json.registration_id };
    }
    return { kind: 'needsEmail', token: loggedIn.token, userId: loggedIn.user?.id };
  }

  if (json.registration_id) {
    return { kind: 'needsAge', registrationId: json.registration_id };
  }

  throw new ApiError('Verification did not return a token or a registration id.');
}

/** Step 3 — age gate. Returns a usable token. */
export async function completeRegistration(
  age: number,
  registrationId: string,
): Promise<AuthResult> {
  if (!Number.isFinite(age) || age < MIN_AGE) {
    throw new ApiError(`You must be at least ${MIN_AGE} to sign up.`);
  }
  const json = await publicRequest<{ token?: string; user?: { id?: string }; group?: Group }>(
    '/v1/complete_registration',
    'POST',
    { age: Number(age), registration_id: registrationId },
  );
  if (!json.token) {
    throw new ApiError('Registration did not return a token.');
  }
  return { token: json.token, userId: json.user?.id, group: json.group ?? null };
}

/**
 * Step 3b — register the device token. offsides does this immediately after the
 * age gate. We send a random persisted UUID where they send a hashed hardware
 * ID; see docs/API.md for why, and Phase 6 for verifying the API accepts it.
 */
export async function registerDeviceToken(deviceId: string) {
  await request('/v1/register_device_token', 'POST', {
    build_type: 'release',
    bundle_id: 'com.flowerave.sidechat',
    device_token: deviceId,
  });
}

/** Step 4 — school email. Note this one is on /v2. */
export async function registerEmail(email: string) {
  await request('/v2/users/register_email', 'POST', { email: email.trim() });
}

/**
 * Step 5 — poll until the emailed link is clicked.
 * Resolves `null` while still pending, an AuthResult once verified.
 */
export async function checkEmailVerified(): Promise<AuthResult | null> {
  let json: {
    verified_email_updates_response?: { token?: string; user?: { id?: string }; group?: Group };
    changing_phone_number_verified_email_user?: {
      token?: string;
      user?: { id?: string };
      group?: Group;
    };
  };
  try {
    json = await request('/v1/users/check_email_verified', 'GET');
  } catch (error) {
    // A pending verification is reported as an error body, not a distinct
    // status, so treat anything that isn't an auth failure as "not yet".
    if (error instanceof ApiError && error.status === 401) throw error;
    return null;
  }

  const result = json.verified_email_updates_response ?? json.changing_phone_number_verified_email_user;
  if (!result?.token) return null;
  return { token: result.token, userId: result.user?.id, group: result.group ?? null };
}

/** True once the client has a token attached. */
export function isClientAuthenticated() {
  return Boolean(api.userToken);
}
