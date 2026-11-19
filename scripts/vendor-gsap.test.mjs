// scripts/vendor-gsap.mjs, what runs it, and the landing page's two GSAP tags that load what it copies.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { GSAP_FILES, vendorGsap } from './vendor-gsap.mjs';

const repo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const packageJson = JSON.parse(readFileSync(repo('package.json'), 'utf8'));
const pinned = packageJson.devDependencies.gsap;

describe("the landing page's GSAP tags", () => {
	// The page's <svelte:head> without its comments: a tag commented out loads nothing.
	const page = readFileSync(repo('src/routes/+page.svelte'), 'utf8');
	const head = (page.match(/<svelte:head>([\s\S]*?)<\/svelte:head>/)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '');
	// Every script tag that names GSAP, whatever its form, so a CDN URL or an `async` is caught
	// rather than skipped.
	const tags = head.match(/<script\b[^>]*\bgsap\b[^>]*>/gi) ?? [];

	// An upgrade that changes package.json and forgets the page, or the reverse, would serve a
	// path the build never wrote: the page would load no GSAP and show no animation. The exact
	// form also holds the tags blocking (no async, defer or type=module) and on our own origin.
	it('load the version package.json pins, both files, in order', () => {
		expect(tags).toEqual(GSAP_FILES.map((file) => `<script src="/vendor/gsap-${pinned}/${file}">`));
	});

	// The gate stamps has-gsap before first paint only if GSAP has already loaded: the order the
	// comment above the tags explains.
	it('come before the gate script that reads them', () => {
		const gate = head.indexOf('<script src="/scripts/landing-gate.js">');
		expect(gate).toBeGreaterThan(-1);
		for (const tag of tags) expect(head.indexOf(tag)).toBeLessThan(gate);
	});
});

// The test gate never builds, and the page reads as it should without GSAP, so a build that
// skipped the copy would pass every other check and serve 404 (not found) for both files.
describe('what puts the files there', () => {
	it('`pnpm dev` and `pnpm build` copy them first, and stop if the copy fails', () => {
		for (const script of ['dev', 'build']) {
			expect(packageJson.scripts[script]).toMatch(new RegExp(`^node scripts/vendor-gsap\\.mjs && vite ${script}\\b`));
		}
	});

	// So an upgrade whose package moved or renamed a file fails here, not in the image build.
	it('the installed gsap is the pinned version, with both files', () => {
		const manifest = createRequire(repo('package.json')).resolve('gsap/package.json');
		expect(JSON.parse(readFileSync(manifest, 'utf8')).version).toBe(pinned);
		for (const file of GSAP_FILES) expect(existsSync(join(dirname(manifest), 'dist', file)), file).toBe(true);
	});

	// GSAP's license is not an open-source one, so the repository holds none of its files: the
	// copies on disk are the build's. .gitignore does not untrack a file already tracked, and a
	// commit that names a deleted file takes it back from disk once a build has copied it there.
	it('the repository tracks nothing under static/vendor/', (ctx) => {
		const ls = spawnSync('git', ['ls-files', '--', 'static/vendor'], { cwd: repo(''), encoding: 'utf8' });
		if (ls.status !== 0) ctx.skip(); // not a git checkout: an archive or an export
		expect(ls.stdout).toBe('');
	});
});

describe('vendor-gsap.mjs', () => {
	const dirs = [];
	afterEach(() => {
		for (const dir of dirs.splice(0).reverse()) rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * A stand-in checkout: a package.json pinning `pinned`, gsap `installed` under node_modules
	 * (none for null), and a copy of the script under scripts/, so that it can run as that
	 * checkout's own.
	 */
	function checkout({ pinned = '1.2.3', installed = pinned } = {}) {
		const root = mkdtempSync(join(tmpdir(), 'vendor-gsap-'));
		dirs.push(root);
		writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { gsap: pinned } }));
		mkdirSync(join(root, 'scripts'));
		copyFileSync(fileURLToPath(new URL('vendor-gsap.mjs', import.meta.url)), join(root, 'scripts', 'vendor-gsap.mjs'));
		if (installed !== null) {
			const pkg = join(root, 'node_modules', 'gsap');
			mkdirSync(join(pkg, 'dist'), { recursive: true });
			writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'gsap', version: installed }));
			for (const file of GSAP_FILES) writeFileSync(join(pkg, 'dist', file), `/* ${file} ${installed} */\n`);
		}
		return root;
	}

	/** Runs the checkout's copy of the script as `pnpm build` does, by a path through a symlink. */
	function run(root) {
		const link = `${root}-link`;
		symlinkSync(root, link);
		dirs.push(link);
		return spawnSync(process.execPath, [join(link, 'scripts', 'vendor-gsap.mjs')], { encoding: 'utf8' });
	}

	it('copies both files unchanged to static/vendor/gsap-<version>/', () => {
		const root = checkout();
		const { version, dir } = vendorGsap(root);
		expect(version).toBe('1.2.3');
		expect(dir).toBe(join(root, 'static', 'vendor', 'gsap-1.2.3'));
		for (const file of GSAP_FILES) {
			expect(readFileSync(join(dir, file))).toEqual(readFileSync(join(root, 'node_modules', 'gsap', 'dist', file)));
		}
		// Every `pnpm dev` and `pnpm build` runs it again over its own output.
		expect(() => vendorGsap(root)).not.toThrow();
	});

	it('refuses an installed gsap other than the pinned one, and writes nothing', () => {
		const root = checkout({ pinned: '1.2.4', installed: '1.2.3' });
		expect(() => vendorGsap(root)).toThrow('gsap 1.2.3 is installed, but package.json pins 1.2.4');
		expect(existsSync(join(root, 'static'))).toBe(false);
	});

	it('refuses when gsap is not installed', () => {
		expect(() => vendorGsap(checkout({ installed: null }))).toThrow('the gsap package is not installed');
	});

	it('refuses a specifier that is not an exact version', () => {
		expect(() => vendorGsap(checkout({ pinned: '^1.2.3', installed: '1.2.3' }))).toThrow('not an exact x.y.z version');
	});

	// A script that exits 0 without copying lets the build go on, and the site serves no GSAP.
	it('copies them when run as a script, by a path through a symlink', () => {
		const root = checkout();
		const ran = run(root);
		expect(ran.status, ran.stderr).toBe(0);
		expect(ran.stdout).toBe('vendor-gsap: GSAP 1.2.3 copied to static/vendor/gsap-1.2.3/\n');
		for (const file of GSAP_FILES) expect(existsSync(join(root, 'static', 'vendor', 'gsap-1.2.3', file)), file).toBe(true);
	});

	it('exits 1 when it refuses, which stops the build', () => {
		const ran = run(checkout({ pinned: '1.2.4', installed: '1.2.3' }));
		expect(ran.status).toBe(1);
		expect(ran.stderr).toBe('vendor-gsap: gsap 1.2.3 is installed, but package.json pins 1.2.4: run `pnpm install`\n');
	});
});
