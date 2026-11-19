// Test-only helper: a spec-compliant in-memory `Storage`.
//
// The test environment (the svelteTesting vite plugin) stubs window.localStorage
// as an inert empty object - `getItem`/`setItem`/`clear` are simply absent - so
// any module that actually persists something must be handed a real Storage to
// be exercised at all. This is that Storage, plus the installer that swaps it in.

/** A fresh, empty, spec-compliant in-memory Storage. */
export function memStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
		setItem: (k: string, v: string) => {
			m.set(k, String(v));
		},
		removeItem: (k: string) => {
			m.delete(k);
		},
		key: (i: number) => Array.from(m.keys())[i] ?? null
	} as Storage;
}

/**
 * Install `storage` (default: a fresh empty one) as `window.localStorage`.
 * `configurable: true` so a later call - or a test installing a throwing stub to
 * simulate private mode / a disabled-storage browser - can replace it again.
 */
export function installStorage(storage: Storage = memStorage()): Storage {
	Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
	return storage;
}
