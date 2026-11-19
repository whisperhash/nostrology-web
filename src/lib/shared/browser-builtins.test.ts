import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Code that runs in the page calls no built-in that Safari before 15.4 lacks. Vite builds for
// its default target, which reaches back to Safari 14, but it only rewrites syntax: a missing
// built-in is a TypeError when it is called, and in the page's start-up code that stops the
// page from hydrating at all. `own` in $lib/slug-table used Object.hasOwn until a
// fresh-context review caught it (2026-10-19); no test runtime here lacks it, so only this
// scan of the source can hold the line. A tripwire for the usual spellings, not a proof: an
// `.at(i)` with a variable index slips through.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Safari 15.4's additions, as they are usually written. */
const NEWER_THAN_SAFARI_14 = [
	{ name: 'Object.hasOwn', pattern: /\bObject\.hasOwn\(/ },
	{ name: 'structuredClone', pattern: /\bstructuredClone\(/ },
	{ name: 'Array.prototype.findLast / findLastIndex', pattern: /\.findLast(?:Index)?\(/ },
	{ name: 'Array.prototype.at / String.prototype.at', pattern: /\.at\(\s*-?\d/ }
];

/** Source that never reaches the page: tests, and the server's own modules. */
const serverOrTest = (path: string) =>
	/\.test(?:-helper)?\.ts$/.test(path) ||
	/(^|\/)(server|db)\//.test(path) ||
	/\.server\.ts$|(^|\/)\+server\.ts$/.test(path);

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return sources(path);
		return ['.ts', '.js', '.svelte'].includes(extname(e.name)) ? [path] : [];
	});
}

describe('built-ins in browser code', () => {
	it('calls none that Safari before 15.4 lacks', () => {
		const files = sources(SRC).filter((f) => !serverOrTest(relative(SRC, f)));
		// the scan sees the page's code: its own start-up module among it
		expect(files.map((f) => relative(SRC, f))).toContain('lib/slug-table.ts');
		const found = files.flatMap((f) => {
			const lines = readFileSync(f, 'utf8').split('\n');
			return lines.flatMap((line, i) =>
				NEWER_THAN_SAFARI_14.filter(({ pattern }) => pattern.test(line)).map(({ name }) => `${relative(SRC, f)}:${i + 1} ${name}`)
			);
		});
		expect(found).toEqual([]);
	});

	it('finds each one where it is written', () => {
		const lines = ['Object.hasOwn(a, b)', 'structuredClone(x)', 'xs.findLast((x) => x)', 'xs.findLastIndex(f)', 'xs.at(-1)', 's.at(0)'];
		for (const line of lines) expect(NEWER_THAN_SAFARI_14.some(({ pattern }) => pattern.test(line)), line).toBe(true);
		// our own methods named `at` are not the built-in
		for (const line of ['reload.at(to + window.location.search)', 'Object.prototype.hasOwnProperty.call(r, k)'])
			expect(NEWER_THAN_SAFARI_14.some(({ pattern }) => pattern.test(line)), line).toBe(false);
	});
});
