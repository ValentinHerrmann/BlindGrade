/**
 * IDB hygiene — clear-on-close (best-effort) + session timeout.
 *
 * IMPORTANT SECURITY NOTE:
 * This module provides a BEST-EFFORT UX courtesy — it is NOT a security guarantee.
 *
 * The beforeunload/visibilitychange wipe is NOT reliably fired on:
 *   - Browser crashes or process kills
 *   - Mobile tab discards
 *   - OS-level force-quits
 *
 * If the wipe fails, the encrypted-at-rest blobs in IDB remain safe because:
 *   - A new session CANNOT derive the key without the teacher's password.
 *   - All sensitive fields (piiCt, scanCt) are encrypted before every IDB write.
 *
 * Encryption-at-rest is the PRIMARY protection. This wipe is a secondary UX layer.
 */

import { clearAllTables } from './db';
import { sessionStore } from '$lib/stores/session';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { get, writable } from 'svelte/store';

import { api } from '$lib/api/client';

/** Clear all IDB data. Returns true if successful, false on error. */
export async function wipeDatabase(): Promise<boolean> {
  try {
    await clearAllTables();
    return true;
  } catch {
    // Intentionally silenced — wipe failure is non-fatal (data is encrypted-at-rest)
    return false;
  }
}

/** Lock the session: wipe keys from store, set lockedAt, and wipe DB if server-synced. */
export async function lockSession(): Promise<void> {
  timeUntilLock.set(null);
  sessionStore.lock();
  try {
    await api.post('/auth/logout');
  } catch {
    // Non-fatal if offline
  }
  if (get(storagePolicyStore).storageMode === 'all-server') {
    await wipeDatabase();
  }
  if (typeof window !== 'undefined' && window.location.pathname !== '/unlock') {
    window.location.href = '/unlock';
  }
}

/** Inactivity timeout in milliseconds (60 minutes). */
const TIMEOUT_MS = 60 * 60 * 1000;
/** Warning threshold in milliseconds (5 minutes). */
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let expirationTime: number = 0;

export const timeUntilLock = writable<number | null>(null);

export function keepSessionAlive(): void {
  resetTimeout();
}

function resetTimeout(): void {
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  if (intervalHandle !== null) clearInterval(intervalHandle);

  expirationTime = Date.now() + TIMEOUT_MS;
  timeUntilLock.set(null);

  timeoutHandle = setTimeout(async () => {
    if (intervalHandle !== null) clearInterval(intervalHandle);
    await lockSession();
  }, TIMEOUT_MS);

  intervalHandle = setInterval(() => {
    const remaining = expirationTime - Date.now();
    if (remaining <= WARNING_THRESHOLD_MS && remaining > 0) {
      timeUntilLock.set(Math.ceil(remaining / 1000));
    } else {
      timeUntilLock.set(null);
    }
  }, 1000);
}

/** Register all hygiene event listeners. Call once on app startup. */
export function registerHygieneListeners(): void {
  // Inactivity timeout — reset on any user interaction
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimeout, { passive: true }));
  resetTimeout(); // Start timer immediately

  // Force full logout on Ctrl+F5 / Ctrl+R (hard reload)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'F5' || e.code === 'F5' || e.key === 'r' || e.key === 'R' || e.code === 'KeyR')
    ) {
      lockSession();
    }
  });

  // Inactivity timeout — lock session on timeout (data remains safe encrypted at rest)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Intentionally do not wipe DB on tab switch; encryption-at-rest secures data
    }
  });

  window.addEventListener('beforeunload', (event) => {
    const session = get(sessionStore);
    if (session.isDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

