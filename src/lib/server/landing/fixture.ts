// DEV ONLY: the board's inputs from a fixture file instead of the database, so `vite dev` shows
// the real landing, with real data, on a machine that cannot reach Aurora. The file is a gzipped
// JSON object holding each source's output under its LANDING_SOURCES name - the same shape
// src/lib/landing/fixtures/board-inputs-2026-10-15.json.gz has.
//
// index.ts takes this only when SvelteKit's `dev` is true AND LANDING_FIXTURE is set. `dev` is
// false in every build, the production image included, so no setting can switch a deployed
// server onto a fixture. scripts/verify-landing-board.mjs says how to run it.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { LANDING_SOURCES, type LandingSources } from './sources';

export function fixtureSources(path: string): LandingSources {
	const inputs = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(LANDING_SOURCES).map((name) => [name, async () => inputs[name]])
	) as unknown as LandingSources;
}
