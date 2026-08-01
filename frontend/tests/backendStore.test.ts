import { describe, it, expect, beforeEach } from 'vitest';
import { backendStore, effectiveBackendStore } from '../src/lib/stores/backendStore';
import { get } from 'svelte/store';

// Mock localStorage for Vitest environment
const mockStorage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => {
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
  },
  length: 0,
  key: () => null,
};

describe('backendStore', () => {
  beforeEach(() => {
    localStorage.clear();
    backendStore.clear();
  });

  it('defaults to empty string without falling back to origin', () => {
    expect(get(backendStore)).toBe('');
    expect(get(effectiveBackendStore)).toBe('');
  });

  it('supports transient URL without saving to localStorage', () => {
    backendStore.setTransient('http://temp-server:8000');
    expect(get(backendStore)).toBe('http://temp-server:8000');
    expect(localStorage.getItem('bg_backend_url')).toBeNull();
  });

  it('saves successful URL to localStorage', () => {
    backendStore.saveSuccessfulBackendUrl('http://active-server:8000');
    expect(get(backendStore)).toBe('http://active-server:8000');
    expect(localStorage.getItem('bg_backend_url')).toBe('http://active-server:8000');
  });

  it('restores saved URL from localStorage on demand', () => {
    localStorage.setItem('bg_backend_url', 'http://saved-server:8000');
    backendStore.setTransient('http://failed-server:8000');
    expect(get(backendStore)).toBe('http://failed-server:8000');

    backendStore.restoreSavedUrl();
    expect(get(backendStore)).toBe('http://saved-server:8000');
  });
});

