// @vitest-environment node
//
// landingBoard(): the board from the cache's last good copies - built once per change of
// data, on the clock, never awaited, and a shaping problem logged at most once an hour. The
// sources are replaced by the real 2026-10-15 inputs (board.test.ts's fixture) behind switches.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(
	gunzipSync(readFileSync(resolve(HERE, '../../landing/fixtures/board-inputs-2026-10-15.json.gz'))).toString('utf8')
);

const control = vi.hoisted(() => ({
	inputs: {} as Record<string, unknown>,
	down: false,
	/** How long each read takes, in fake time. */
	delayMs: 0
}));

vi.mock('./sources', () => {
	const read = (name: string) => async () => {
		if (control.delayMs > 0) await new Promise((r) => setTimeout(r, control.delayMs));
		if (control.down) throw new Error('connect ECONNREFUSED');
		return control.inputs[name];
	};
	return {
		LANDING_SOURCES: Object.fromEntries(
			['marketplaces', 'git', 'zapstore', 'nutzapsDaily', 'nutzapMints', 'lightningProviders', 'lightningShare'].map(
				(name) => [name, read(name)]
			)
		)
	};
});

type Index = typeof import('./index');
let mod: Index;
let logged: Record<string, unknown>[];

beforeEach(async () => {
	vi.useFakeTimers({ now: Date.parse('2026-10-15T08:00:00Z') });
	control.inputs = structuredClone(REAL);
	control.down = false;
	control.delayMs = 0;
	logged = [];
	vi.spyOn(console, 'log').mockImplementation((line: string) => {
		logged.push(JSON.parse(line));
	});
	// A fresh module, so each test has its own cache and its own built board.
	vi.resetModules();
	mod = await import('./index');
});

afterEach(async () => {
	mod.landingCache.stop();
	// Let any read still in flight finish here, under this test's spy, not in the next test's.
	for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const shapingLines = () => logged.filter((l) => l.msg === 'landing board shaping failed');

describe('dueProblems', () => {
	it('logs a problem once an hour while it lasts, and at once when it comes back', () => {
		const loggedAt = new Map<string, number>();
		const MIN = 60_000;
		expect(mod.dueProblems(['p'], loggedAt, 0)).toEqual(['p']);
		expect(mod.dueProblems(['p'], loggedAt, 59 * MIN)).toEqual([]);
		expect(mod.dueProblems(['p'], loggedAt, 60 * MIN)).toEqual(['p']);
		// gone, then back within the hour of its last line: reported at once
		expect(mod.dueProblems([], loggedAt, 61 * MIN)).toEqual([]);
		expect(loggedAt.size).toBe(0);
		expect(mod.dueProblems(['p'], loggedAt, 62 * MIN)).toEqual(['p']);
	});
});

describe('the dev-only fixture', () => {
	// The fixture holds the real 2026-10-15 data (Marketplaces 7,848); the mocked sources, a
	// recognisable stand-in (1), so the board says which the cache read.
	async function boardWith(dev: boolean, fixture: string | undefined) {
		(control.inputs.marketplaces as { summary: { active_listings: number } }).summary.active_listings = 1;
		vi.doMock('$app/environment', () => ({ dev, building: false, browser: false, version: 'test' }));
		vi.doMock('$env/dynamic/private', () => ({ env: fixture ? { LANDING_FIXTURE: fixture } : {} }));
		vi.resetModules();
		mod.landingCache.stop();
		mod = await import('./index');
		mod.landingBoard();
		await vi.advanceTimersByTimeAsync(0);
		vi.doUnmock('$app/environment');
		vi.doUnmock('$env/dynamic/private');
		return mod.landingBoard().panels.find((p) => p.key === 'marketplaces')!.value;
	}
	const FIXTURE = resolve(HERE, '../../landing/fixtures/board-inputs-2026-10-15.json.gz');

	it('is read under vite dev when LANDING_FIXTURE names it', async () => {
		expect(await boardWith(true, FIXTURE)).toBe(7848);
	});

	it('is ignored by every build, whatever the environment says', async () => {
		expect(await boardWith(false, FIXTURE)).toBe(1);
	});

	it('is not read under vite dev without LANDING_FIXTURE', async () => {
		expect(await boardWith(true, undefined)).toBe(1);
	});
});

describe('landingBoard', () => {
	it('answers at once, with the typed fallbacks, before anything has loaded', () => {
		const board = mod.landingBoard();
		expect(board).not.toBeInstanceOf(Promise);
		expect(board.panels.every((p) => !p.live && p.chart === null)).toBe(true);
	});

	it('shows the data once the cache has read it', async () => {
		mod.landingBoard();
		await vi.advanceTimersByTimeAsync(0);
		const board = mod.landingBoard();
		expect(board.panels.map((p) => p.value)).toEqual([4773, 7848, 4873, 2250, 33]);
		expect(board.panels.every((p) => p.live)).toBe(true);
	});

	it('builds the board once per change of data, not per request', async () => {
		mod.landingBoard();
		await vi.advanceTimersByTimeAsync(0);
		const first = mod.landingBoard();
		expect(mod.landingBoard()).toBe(first);
		expect(mod.landingBoard()).toBe(first);
		await vi.advanceTimersByTimeAsync(60 * 60_000); // the hourly reads bump the version
		expect(mod.landingBoard()).not.toBe(first);
	});

	it('keeps serving the board it has while the database is down', async () => {
		mod.landingBoard();
		await vi.advanceTimersByTimeAsync(0);
		control.down = true;
		await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
		const board = mod.landingBoard();
		expect(board.panels.every((p) => p.live)).toBe(true);
		expect(board.panels.map((p) => p.value)).toEqual([4773, 7848, 4873, 2250, 33]);
	});

	it('logs a shaping problem on the clock, with no visitor at all', async () => {
		// The board is rebuilt after every refresh, so a changed document is reported even on a
		// night nobody opens the page (the review of 2026-10-15).
		(control.inputs.git as { summary: { repos: unknown } }).summary.repos = 'many';
		mod.landingCache.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(shapingLines()).toEqual([
			expect.objectContaining({ level: 'warn', problem: 'git figure: repos is not a count: "many"' })
		]);
	});

	it('caps a problem at 300 characters', async () => {
		(control.inputs.git as { summary: { repos: unknown } }).summary.repos = 'x'.repeat(400);
		mod.landingCache.start();
		await vi.advanceTimersByTimeAsync(0);
		const problem = shapingLines()[0].problem as string;
		expect(problem).toHaveLength(303);
		expect(problem.endsWith('...')).toBe(true);
	});

	it('reports a problem again at once when it comes back after going away', async () => {
		const git = control.inputs.git as { summary: { repos: unknown } };
		const good = git.summary.repos;
		git.summary.repos = 'many';
		mod.landingCache.start();
		await vi.advanceTimersByTimeAsync(0);
		git.summary.repos = good; // fixed: the next pass forgets it
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		git.summary.repos = 'many'; // back within the hour: reported again, not held back
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(shapingLines()).toHaveLength(2);
	});

	it('keeps one clock when the module runs again (vite dev, on an edit)', async () => {
		mod.landingCache.start();
		await vi.advanceTimersByTimeAsync(0);
		const first = mod.landingCache;
		vi.resetModules();
		mod = await import('./index');
		mod.landingCache.start();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		// the first copy's clock was stopped: one hourly pass, read once, not twice
		const reads = logged.filter((l) => l.msg === 'landing source refreshed' && l.source === 'git');
		expect(reads).toHaveLength(3); // the first copy's start, the second's start, one hourly pass
		expect(first).not.toBe(mod.landingCache);
	});

	it('logs a shaping problem at most once an hour, however often the board is rebuilt', async () => {
		(control.inputs.git as { summary: { repos: unknown } }).summary.repos = 'many';
		// Each read takes a second, and a visitor asks every half second: the board is rebuilt
		// after each of the seven reads of a pass, as it is in production when visits arrive
		// during the hourly pass.
		control.delayMs = 1000;
		const visit = async (ms: number) => {
			for (let t = 0; t < ms; t += 500) {
				mod.landingBoard();
				await vi.advanceTimersByTimeAsync(500);
			}
		};
		await visit(10_000);
		expect(mod.landingBoard().panels.filter((p) => p.live)).toHaveLength(4); // git is the one that fails
		expect(shapingLines()).toEqual([
			expect.objectContaining({ level: 'warn', problem: 'git figure: repos is not a count: "many"' })
		]);
		// The next pass, at the 60th minute's tick, rebuilds it seven times again: one more line,
		// not seven.
		await vi.advanceTimersByTimeAsync(60 * 60_000 - 20_000);
		await visit(20_000);
		expect(mod.landingBoard().panels.filter((p) => p.live)).toHaveLength(4);
		expect(shapingLines()).toHaveLength(2);
	});
});
