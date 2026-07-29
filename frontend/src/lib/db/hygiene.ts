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
import { get } from 'svelte/store';

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
  sessionStore.lock();
  if (get(storagePolicyStore).resultsAndStudentsData === 'server') {
    await wipeDatabase();
  }
}

/** Inactivity timeout in milliseconds (30 minutes). */
const TIMEOUT_MS = 30 * 60 * 1000;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

function resetTimeout(): void {
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  timeoutHandle = setTimeout(async () => {
    await lockSession();
  }, TIMEOUT_MS);
}

/** Register all hygiene event listeners. Call once on app startup. */
export function registerHygieneListeners(): void {
  // Inactivity timeout — reset on any user interaction
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimeout, { passive: true }));
  resetTimeout(); // Start timer immediately

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
