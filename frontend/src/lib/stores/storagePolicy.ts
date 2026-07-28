import { writable, derived } from 'svelte/store';

export interface StoragePolicy {
    latexCompilation: 'server' | 'local';
    examAndExerciseStorage: 'server' | 'local';
    resultsAndStudentsData: 'server' | 'local';
}

const STORAGE_KEY = 'bg_storage_policy';

export const DEFAULT_POLICY: StoragePolicy = {
    latexCompilation: 'local',
    examAndExerciseStorage: 'server',
    resultsAndStudentsData: 'local',
};

export function getStoragePolicyLabel(policy: StoragePolicy): string {
    const parts = [];
    parts.push(policy.latexCompilation === 'server' ? 'LaTeX Server' : 'LaTeX Local');
    parts.push(policy.examAndExerciseStorage === 'server' ? 'Exams Server' : 'Exams Local');
    parts.push(policy.resultsAndStudentsData === 'server' ? 'Student Data Server' : 'Student Data Local');
    return parts.join(' | ');
}

export function getStoragePolicyBadge(policy: StoragePolicy): { icon: string; text: string; title: string } {
    const isAllLocal = policy.latexCompilation === 'local' && policy.examAndExerciseStorage === 'local' && policy.resultsAndStudentsData === 'local';
    const isAllServer = policy.latexCompilation === 'server' && policy.examAndExerciseStorage === 'server' && policy.resultsAndStudentsData === 'server';
    
    if (isAllLocal) {
        return {
            icon: '🛡️',
            text: 'Fully Local',
            title: 'Everything stored & processed locally',
        };
    } else if (isAllServer) {
        return {
            icon: '☁️',
            text: 'Fully Server',
            title: 'Everything processed & stored on server',
        };
    }
    return {
        icon: '🔀',
        text: 'Custom Storage',
        title: getStoragePolicyLabel(policy),
    };
}

function getInitialPolicy(): StoragePolicy {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                if (saved === 'server-synced') {
                    return { latexCompilation: 'server', examAndExerciseStorage: 'server', resultsAndStudentsData: 'server' };
                } else if (saved === 'local-only') {
                    return DEFAULT_POLICY;
                }
                const parsed = JSON.parse(saved);
                return { ...DEFAULT_POLICY, ...parsed };
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
