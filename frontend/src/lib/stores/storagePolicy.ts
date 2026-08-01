import { writable, derived } from 'svelte/store';

export type StorageMode = 'all-server' | 'all-local' | 'hybrid';

export interface StoragePolicy {
    storageMode: StorageMode;
    latexCompilation: 'server' | 'local';
}

const STORAGE_KEY = 'bg_storage_policy';

export const DEFAULT_POLICY: StoragePolicy = {
    storageMode: 'all-local',
    latexCompilation: 'local',
};

export function getStoragePolicyLabel(policy: StoragePolicy): string {
    const modeLabel = policy.storageMode === 'all-server' 
        ? 'All Server' 
        : policy.storageMode === 'all-local' 
            ? 'All Local' 
            : 'Hybrid (Exercises Server, Students Local)';
    const latexLabel = policy.latexCompilation === 'server' ? 'LaTeX Server' : 'LaTeX Local';
    return `${modeLabel} | ${latexLabel}`;
}

export function getStoragePolicyBadge(policy: StoragePolicy): { icon: string; text: string; title: string } {
    if (policy.storageMode === 'all-local') {
        return {
            icon: '🛡️',
            text: 'All Local',
            title: 'Everything stored locally in browser IndexedDB',
        };
    } else if (policy.storageMode === 'all-server') {
        return {
            icon: '☁️',
            text: 'All Server',
            title: 'Everything stored and synced with backend server',
        };
    } else {
        return {
            icon: '🔀',
            text: 'Hybrid Mode',
            title: 'Exercises & Exams on server, Student identity & submissions local',
        };
    }
}

function getInitialPolicy(): StoragePolicy {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.storageMode && parsed.latexCompilation) {
                    return parsed;
                }
                // Migration from legacy policy structure
                if (parsed.examAndExerciseStorage === 'server' && parsed.resultsAndStudentsData === 'server') {
                    return { storageMode: 'all-server', latexCompilation: parsed.latexCompilation || 'local' };
                } else if (parsed.examAndExerciseStorage === 'server' && parsed.resultsAndStudentsData === 'local') {
                    return { storageMode: 'hybrid', latexCompilation: parsed.latexCompilation || 'local' };
                }
            } catch {
                return DEFAULT_POLICY;
            }
        }
    }
    return DEFAULT_POLICY;
}

function createStoragePolicyStore() {
    const { subscribe, set, update } = writable<StoragePolicy>(getInitialPolicy());

    return {
        subscribe,
        setPolicy(policy: StoragePolicy) {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
            }
            set(policy);
        },
        updateSetting<K extends keyof StoragePolicy>(key: K, value: StoragePolicy[K]) {
            update((current) => {
                const next = { ...current, [key]: value };
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
                }
                return next;
            });
        }
    };
}

export const storagePolicyStore = createStoragePolicyStore();

export const storagePolicyLabelStore = derived(
    storagePolicyStore,
    ($policy) => getStoragePolicyLabel($policy)
);

export const storagePolicyBadgeStore = derived(
    storagePolicyStore,
    ($policy) => getStoragePolicyBadge($policy)
);

