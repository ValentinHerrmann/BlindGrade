import { writable, derived, get } from 'svelte/store';

const BACKEND_URL_KEY = 'bg_backend_url';

function createBackendStore() {
    let initialUrl = '';
    if (typeof localStorage !== 'undefined') {
        initialUrl = localStorage.getItem(BACKEND_URL_KEY) || '';
    }

    const { subscribe, set } = writable<string>(initialUrl);

    return {
        subscribe,
        setTransient: (url: string) => {
            set(url);
        },
        saveSuccessfulBackendUrl: (url: string) => {
            if (typeof localStorage !== 'undefined') {
                if (url) {
                    localStorage.setItem(BACKEND_URL_KEY, url);
                } else {
                    localStorage.removeItem(BACKEND_URL_KEY);
                }
            }
            set(url);
        },
        set: (url: string) => {
            if (typeof localStorage !== 'undefined') {
                if (url) {
                    localStorage.setItem(BACKEND_URL_KEY, url);
                } else {
                    localStorage.removeItem(BACKEND_URL_KEY);
                }
            }
            set(url);
        },
        restoreSavedUrl: () => {
            let saved = '';
            if (typeof localStorage !== 'undefined') {
                saved = localStorage.getItem(BACKEND_URL_KEY) || '';
            }
            set(saved);
        },
        clear: () => {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(BACKEND_URL_KEY);
            }
            set('');
        }
    };
}

export const backendStore = createBackendStore();

export const effectiveBackendStore = derived(backendStore, ($url) => {
    return $url || '';
});

