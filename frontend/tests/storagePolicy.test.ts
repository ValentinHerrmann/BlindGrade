import { describe, it, expect, beforeEach } from 'vitest';
import { storagePolicyStore, DEFAULT_POLICY } from '../src/lib/stores/storagePolicy';
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

describe('storagePolicyStore', () => {
  beforeEach(() => {
    localStorage.clear();
    storagePolicyStore.setPolicy(DEFAULT_POLICY);
  });

  it('initializes with default policy when localStorage is empty', () => {
    expect(get(storagePolicyStore)).toEqual(DEFAULT_POLICY);
  });

  it('persists storageMode changes to localStorage', () => {
    storagePolicyStore.updateSetting('storageMode', 'all-server');
    expect(get(storagePolicyStore).storageMode).toBe('all-server');
    expect(JSON.parse(localStorage.getItem('bg_storage_policy') || '{}').storageMode).toBe('all-server');
  });

  it('persists latexCompilation changes to localStorage', () => {
    storagePolicyStore.updateSetting('latexCompilation', 'server');
    expect(get(storagePolicyStore).latexCompilation).toBe('server');
    expect(JSON.parse(localStorage.getItem('bg_storage_policy') || '{}').latexCompilation).toBe('server');
  });
});
