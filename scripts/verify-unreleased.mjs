// Verify, on a deployed site, that what is still in development is invisible to everyone but
// the operator - the operator's requirement of 2026-10-24: "To any other visitor, including a
// logged in one, the new section should not ever be visible."
//
//   node scripts/verify-unreleased.mjs                        # https://nostrolo.gy
//   node scripts/verify-unreleased.mjs http://127.0.0.1:3000  # a local `node build`
//
// WHAT IT CHECKS, as a stranger, for every entry in HIDDEN (scripts/lib/unreleased.mjs):
//   - its ADDRESS answers 302 (found) to the domain with the `#gone` note, uncached, exactly as
//     a word nobody has ever used does - not 200 (ok), and not 404 (not found), which the slug
//     rules forbid ($lib/slug-table);
//   - the domain's own page AND the pill the section sits on carry no trace of it: not its
//     element id, not its heading, not its address, not its preview copy;
//   - the SITEMAP does not list the address.
// It cannot check the operator's own view, which needs their key: that is a person's check, one
// page load while logged in.
//
// The sitemap check needs a site with a database behind it, so against a stub server that
// implements one page's reads and no others it reports /sitemap.xml 500 (internal server error)
// and the other checks still mean what they say. Against a deployed site all of them run.
//
// WHY A LIVE CHECK AT ALL, with the gate unit-tested in both server loads: because this is the
// requirement, and because a unit test sees only the components it renders, while a fetch of
// the deployed page sees the whole of what a stranger is sent, whichever component drew it.
//
// HIDDEN IS HAND-KEPT, like verify-section-link.mjs's DOMAINS: these scripts are plain Node and
// do not import the app's TypeScript. It lives in scripts/lib/unreleased.mjs, which
// verify-login.mjs reads too, and src/lib/unreleased.test.ts reads it and fails if the list and
// the slug tables disagree, so the drift is caught in the suite rather than by a check that
// silently examines nothing.
//
// WHEN NOTHING IS IN DEVELOPMENT, HIDDEN is empty, and this says so and exits 0 without a
// request: there is nothing for a stranger to be kept from. It never prints ALL CHECKS PASSED
// having checked nothing.
//
// FIRST-PARTY MARKING. Every request carries the User-Agent `nozzl-verify-unreleased`, so its
// lines can be told apart in the access log. NO operator marker cookie, deliberately: this
// script's whole job is to be a stranger. GET only, one at a time.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error.

import { HIDDEN } from './lib/unreleased.mjs';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://nostrolo.gy').replace(/\/+$/, '');
if (args.some((a) => a.startsWith('--')) || !/^https?:\/\//.test(base)) {
	console.error('usage: node scripts/verify-unreleased.mjs [<base-url>]');
	process.exit(2);
}
const MARK = 'nozzl-verify-unreleased';
let failures = 0;
const fail = (msg) => {
	failures += 1;
	console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const get = async (path, redirect = 'manual') => {
	const res = await fetch(base + path, { redirect, headers: { 'user-agent': MARK } });
	return {
		status: res.status,
		location: res.headers.get('location'),
		cache: res.headers.get('cache-control'),
		body: res.status === 200 ? await res.text() : ''
	};
};

if (HIDDEN.length === 0) {
	console.log(`${base}: nothing is in development (scripts/lib/unreleased.mjs): no address to check`);
	process.exit(0);
}
console.log(`${base}: ${HIDDEN.length} slug(s) still in development`);
const sitemap = await get('/sitemap.xml', 'follow');

for (const { domain, address, pill, needles } of HIDDEN) {
	console.log(`\n${address}`);

	const at = await get(address);
	if (at.status === 302 && at.location === `${domain}#gone`) pass('302 (found) to the domain with the note');
	else fail(`expected 302 (found) to ${domain}#gone, got ${at.status} -> ${at.location}`);
	if ((at.cache ?? '').includes('no-store')) pass('uncached, so a release is seen at once');
	else fail(`expected cache-control: no-store, got ${at.cache}`);

	for (const page of [domain, pill]) {
		const res = await get(page, 'follow');
		if (res.status !== 200) {
			fail(`${page}: expected 200 (ok), got ${res.status}`);
			continue;
		}
		const found = needles.filter((n) => res.body.includes(n));
		if (found.length === 0) pass(`${page}: no trace of it in ${res.body.length} bytes`);
		else fail(`${page}: carries ${found.map((f) => JSON.stringify(f)).join(', ')}`);
	}

	if (sitemap.status !== 200) fail(`/sitemap.xml: expected 200 (ok), got ${sitemap.status}`);
	else if (sitemap.body.includes(address)) fail(`/sitemap.xml lists ${address}`);
	else pass('not in the sitemap');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
