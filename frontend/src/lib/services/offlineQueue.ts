import { writable } from 'svelte/store';
import { api } from '$lib/api/client';

export interface QueuedRequest {
  id: string;
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: any;
  timestamp: number;
}

const QUEUE_KEY = 'bg_offline_queue';

function getInitialQueue(): QueuedRequest[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const offlineQueue = writable<QueuedRequest[]>(getInitialQueue());

offlineQueue.subscribe((val) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(val));
  }
});

export function enqueueRequest(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: any): void {
  const req: QueuedRequest = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    url,
    method,
    body,
    timestamp: Date.now(),
  };
  offlineQueue.update((q) => [...q, req]);
}

let isFlushing = false;

export async function flushOfflineQueue(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    let currentQueue: QueuedRequest[] = [];
    offlineQueue.subscribe((q) => (currentQueue = q))();

    if (currentQueue.length === 0) return;

    const remaining: QueuedRequest[] = [];
    for (const req of currentQueue) {
      try {
        if (req.method === 'POST') {
          await api.post(req.url, req.body);
        } else if (req.method === 'PATCH') {
          await api.patch(req.url, req.body);
        } else if (req.method === 'DELETE') {
          await api.delete(req.url);
        }
      } catch (err: any) {
        if (err?.code === 'ERR_NETWORK' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          remaining.push(req);
          break;
        }
      }
    }
    offlineQueue.set(remaining);
  } finally {
    isFlushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushOfflineQueue();
  });
}
