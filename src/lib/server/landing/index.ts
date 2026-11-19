// The landing's one way to its data: the cache (./cache.ts) over the surface pages' own data
// functions (./sources.ts), and the board shaped from what the cache holds ($lib/landing/board).
//
// src/hooks.server.ts starts the cache's clock at boot (`init`) and waits for its first pass, so
// the first visitor after a deploy finds the data loaded; `values()` starts it too, in case
// anything ever skips that hook. The board is rebuilt when the cache's data changes - on the
// clock, after every successful refresh, whether or not anyone visits - and served as built, never
// shaped per request. A shaping problem (a document whose shape changed) is logged at most once an
// hour while it lasts: each of the seven sources' refreshes rebuilds the board, and a line per
// rebuild would repeat it up to seven times an hour.

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { buildBoard, type Board } from '$lib/landing/board';
import {
	createLandingCache,
	ERROR_MESSAGE_MAX,
	errorMessage,
	HOUR_MS,
	type LandingCache,
	type LogLine
} from './cache';
import { fixtureSources } from './fixture';
import { LANDING_SOURCES, type LandingSources } from './sources';

let built: { version: number; board: Board } | null = null;
const problemLoggedAt = new Map<string, number>();

function warn(line: Omit<LogLine, 'ts' | 'level'>): void {
	try {
		console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', ...line }));
	} catch {
		// Never let logging fail a page load.
	}
}

/**
 * Which of this build's problems to log now: each at most once an hour while it lasts, capped
 * like an error message. Problems that are gone are forgotten, so `loggedAt` stays as small as
 * the board, and one that comes back is logged at once. Updates `loggedAt`.
 */
export function dueProblems(problems: string[], loggedAt: Map<string, number>, now: number): string[] {
	const current = new Set(problems.map((p) => (p.length > ERROR_MESSAGE_MAX ? `${p.slice(0, ERROR_MESSAGE_MAX)}...` : p)));
	for (const p of loggedAt.keys()) if (!current.has(p)) loggedAt.delete(p);
	const due: string[] = [];
	for (const problem of current) {
		const last = loggedAt.get(problem);
		if (last !== undefined && now - last < HOUR_MS) continue;
		loggedAt.set(problem, now);
		due.push(problem);
	}
	return due;
}

function reportProblems(problems: string[], now: number): void {
	for (const problem of dueProblems(problems, problemLoggedAt, now)) warn({ msg: 'landing board shaping failed', problem });
}

// One cache per process. `vite dev` re-runs this module on every edit to it; without the
// handover each run would start another clock, and every source would be read once per copy.
// In a build the module runs once and there is nothing to hand over.
const KEY = Symbol.for('nostrology.landingCache');
const registry = globalThis as unknown as Record<symbol, LandingCache<LandingSources> | undefined>;
registry[KEY]?.stop();

// `vite dev` with LANDING_FIXTURE set reads the board's inputs from that file (./fixture.ts);
// `dev` is false in every build, so a deployed server always reads the database.
export const landingCache = createLandingCache({
	sources: dev && env.LANDING_FIXTURE ? fixtureSources(env.LANDING_FIXTURE) : LANDING_SOURCES,
	onRefresh: () => {
		landingBoard();
	}
});
registry[KEY] = landingCache;

/**
 * The board, from the cache's last good copies. Never waits and never touches the database: a
 * source that has not loaded since the server started shows its typed fallback.
 */
export function landingBoard(): Board {
	const version = landingCache.version();
	if (built === null || built.version !== version) {
		let board: Board;
		const now = Date.now();
		try {
			const result = buildBoard(landingCache.values());
			board = result.board;
			reportProblems(result.problems, now);
		} catch (err) {
			// buildBoard catches per panel; this is the backstop, and the empty inputs cannot throw.
			reportProblems([`board: ${errorMessage(err)}`], now);
			board = buildBoard({}).board;
		}
		built = { version, board };
	}
	return built.board;
}
