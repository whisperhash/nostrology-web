// @vitest-environment node
//
// The boot hook: it starts the landing cache's clock and waits for its first pass, so the first
// visitor after a deploy finds the board's data loaded - adapter-node listens only once it
// resolves - and it does neither while building, which renders nothing from the cache and has no
// database.

import { afterEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({ start: vi.fn(), settled: vi.fn(async (_ms: number) => undefined) }));
vi.mock('$lib/server/landing', () => ({ landingCache: cache }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

afterEach(() => {
	vi.doUnmock('$app/environment');
	vi.resetModules();
	cache.start.mockClear();
	cache.settled.mockClear();
});

async function initWith(building: boolean) {
	vi.doMock('$app/environment', () => ({ building, browser: false, dev: false, version: 'test' }));
	const mod = await import('./hooks.server');
	await mod.init();
	return mod;
}

describe('init', () => {
	it('starts the landing cache at boot and waits for its first pass, bounded', async () => {
		const { BOOT_WAIT_MS } = await initWith(false);
		expect(cache.start).toHaveBeenCalledTimes(1);
		expect(cache.settled).toHaveBeenCalledWith(BOOT_WAIT_MS);
		// well inside the compose healthcheck's 20 s start period
		expect(BOOT_WAIT_MS).toBeLessThanOrEqual(10_000);
	});

	it('leaves it alone while building', async () => {
		await initWith(true);
		expect(cache.start).not.toHaveBeenCalled();
		expect(cache.settled).not.toHaveBeenCalled();
	});
});
