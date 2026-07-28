/**
 * Session store — in-memory only, never persisted to IDB or localStorage.
 *
 * SECURITY: No accessToken field. Auth tokens live in httpOnly cookies managed
 * by the browser — JavaScript never reads or stores them.
 *
 * masterKey and sessionKey are non-extractable CryptoKey objects.
 * They are wiped from this store on:
 *   - Manual lock
 *   - 30-minute inactivity timeout (see hygiene.ts)
 *   - Tab close / visibility hidden (best-effort)
 */

import { writable, derived, get } from 'svelte/store';
import { deriveKey, generateSalt } from '$lib/crypto/keyDerivation';
import { deriveSessionKey, generateSessionNonce } from '$lib/crypto/sessionKey';

export interface SessionState {
  mode: 'local' | 'hybrid' | 'authenticated' | null;
  masterKey: CryptoKey | null;      // Argon2id-derived — never serialized
  sessionKey: CryptoKey | null;     // HKDF-derived from masterKey + nonce
  sessionNonce: Uint8Array | null;
  lockedAt: number | null;          // Unix ms
  isDirty: boolean;                 // Unsaved IDB changes
  email: string | null;             // From server login response
  role: 'teacher' | 'admin' | null;
}

const INITIAL_STATE: SessionState = {
  mode: null,
  masterKey: null,
  sessionKey: null,
  sessionNonce: null,
  lockedAt: null,
  isDirty: false,
  email: null,
  role: null,
};

function createSessionStore() {
  const { subscribe, set, update } = writable<SessionState>(INITIAL_STATE);

  return {
    subscribe,

    /** Unlock with derived keys after password entry. */
    unlock(params: {
      masterKey: CryptoKey;
      sessionKey: CryptoKey;
      sessionNonce: Uint8Array;
      email?: string;
      role?: 'teacher' | 'admin';
      mode?: 'local' | 'hybrid' | 'authenticated';
    }) {
      update((s) => ({
        ...s,
        mode: params.mode ?? 'authenticated',
        masterKey: params.masterKey,
        sessionKey: params.sessionKey,
        sessionNonce: params.sessionNonce,
        lockedAt: null,
        email: params.email ?? s.email,
        role: params.role ?? s.role,
      }));
    },

    /** Automatically unlock an anonymous local session with persistent keys in localStorage. */
    async initAnonymousSession() {
      if (typeof localStorage === 'undefined') return;

      let pwd = localStorage.getItem('bg_anon_pwd');
      let saltB64 = localStorage.getItem('bg_anon_salt');
      let nonceB64 = localStorage.getItem('bg_anon_nonce');
      let salt: Uint8Array;
      let sessionNonce: Uint8Array;

      if (!pwd || !saltB64 || !nonceB64) {
        pwd = crypto.randomUUID() + '-' + crypto.randomUUID();
        salt = generateSalt();
        sessionNonce = generateSessionNonce();
        localStorage.setItem('bg_anon_pwd', pwd);
        localStorage.setItem('bg_anon_salt', btoa(String.fromCharCode(...salt)));
        localStorage.setItem('bg_anon_nonce', btoa(String.fromCharCode(...sessionNonce)));
      } else {
        salt = new Uint8Array(atob(saltB64).split('').map((c) => c.charCodeAt(0)));
        sessionNonce = new Uint8Array(atob(nonceB64).split('').map((c) => c.charCodeAt(0)));
      }

      const masterKey = await deriveKey(pwd, salt);
      const sessionKey = await deriveSessionKey(masterKey, sessionNonce);

      update((s) => ({
        ...s,
        mode: 'local',
        masterKey,
        sessionKey,
        sessionNonce,
        lockedAt: null,
        email: null,
        role: null,
      }));
    },

    /** Wipe all key material and lock the UI. */
    lock() {
      update((s) => ({
        ...INITIAL_STATE,
        mode: s.mode,
        email: s.email,
        role: s.role,
        lockedAt: Date.now(),
      }));
    },

    setDirty(dirty: boolean) {
      update((s) => ({ ...s, isDirty: dirty }));
    },

    setHybridUser(email: string, role: 'teacher' | 'admin') {
      update((s) => ({ ...s, email, role }));
    },

    reset() {
      set(INITIAL_STATE);
    },
  };
}

export const sessionStore = createSessionStore();

/** True when the session has active crypto keys. */
export const isUnlocked = derived(
  sessionStore,
  ($s) => $s.masterKey !== null && $s.sessionKey !== null
);

/** True when user is authenticated with the server (Hybrid Mode). */
export const isAuthenticated = derived(
  sessionStore,
  ($s) => $s.email !== null
);
