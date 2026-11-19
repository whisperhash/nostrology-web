// Copy GSAP's two browser files from the installed npm package to static/vendor/gsap-<version>/,
// where the landing page loads them with two blocking <script src> tags (src/routes/+page.svelte).
//
//   node scripts/vendor-gsap.mjs
//
// `pnpm dev` and `pnpm build` run it first, so the files are there wherever the site is served
// from source or built: the image gets them from its builder stage's `pnpm build`. They are not
// in the repository. GSAP is under GreenSock's own license (https://gsap.com/standard-license),
// not an open-source one, so the repository pins a version instead: package.json names it
// exactly, and the lockfile holds its integrity hash. The files are copied unchanged, license
// banners included. static/vendor/ is gitignored, and everything in it comes from here.
//
// The path carries the version, so an upgrade is served under a new URL rather than from a cache
// holding the old file under the old one. To upgrade, `pnpm add -D gsap@<x.y.z>` and change the
// two paths in src/routes/+page.svelte; scripts/vendor-gsap.test.mjs fails until both are done.

import { copyFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files the landing page loads, in the order it must load them: ScrollTrigger needs gsap. */
export const GSAP_FILES = ['gsap.min.js', 'ScrollTrigger.min.js'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Copies the files from the gsap package installed under `root` to
 * `<root>/static/vendor/gsap-<version>/`, after checking that the installed version is the one
 * `<root>/package.json` pins. Throws, writing nothing, when it is not.
 * @param {string} root a checkout of this repository, or a test's stand-in for one
 * @returns {{ version: string, dir: string }}
 */
export function vendorGsap(root) {
	const pinned = readJson(join(root, 'package.json')).devDependencies?.gsap;
	// The version becomes part of a path and a URL, and .npmrc makes every specifier exact.
	if (!/^\d+\.\d+\.\d+$/.test(pinned ?? '')) {
		throw new Error(`package.json's devDependencies.gsap is ${JSON.stringify(pinned)}, not an exact x.y.z version`);
	}
	let manifest;
	try {
		manifest = createRequire(join(root, 'package.json')).resolve('gsap/package.json');
	} catch (err) {
		// Only a missing package is a missing install: a gsap whose `exports` left out its
		// package.json would fail here too, and `pnpm install` would not fix that.
		if (err?.code !== 'MODULE_NOT_FOUND') throw err;
		throw new Error('the gsap package is not installed: run `pnpm install`');
	}
	const installed = readJson(manifest).version;
	if (installed !== pinned) {
		throw new Error(`gsap ${installed} is installed, but package.json pins ${pinned}: run \`pnpm install\``);
	}
	const dir = join(root, 'static', 'vendor', `gsap-${pinned}`);
	mkdirSync(dir, { recursive: true });
	for (const file of GSAP_FILES) copyFileSync(join(dirname(manifest), 'dist', file), join(dir, file));
	return { version: pinned, dir };
}

// Whether this file was run as a script rather than imported (by its test). Real paths on both
// sides: run by a path through a symlink, a plain comparison would do nothing and exit 0, and the
// build would go on without GSAP.
function ranAsScript() {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false; // no argv[1], or not a file: imported by something else
	}
}

if (ranAsScript()) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	try {
		const { version, dir } = vendorGsap(root);
		console.log(`vendor-gsap: GSAP ${version} copied to ${relative(root, dir)}/`);
	} catch (err) {
		console.error(`vendor-gsap: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
}
