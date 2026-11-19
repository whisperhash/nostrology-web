// Verify the sitemap on a deployed site or a local build: that it lists what the site serves at
// each address, and that it lists every address a domain page links as its own.
//
//   node scripts/verify-sitemap.mjs                        # https://nostrolo.gy
//   node scripts/verify-sitemap.mjs http://127.0.0.1:3000  # a local `node build`
//   node scripts/verify-sitemap.mjs --sample=60            # detail pages to fetch (default 25)
//
// CORRECTNESS. Every URL the sitemap lists answers 200 (ok) at once, with no redirect, as HTML
// that names that same URL as its canonical address and carries no noindex. Every listed page
// that is not a detail page is fetched; of the detail pages (apps, publishers, mints, /data
// entries: about 5,000), a random sample.
// COMPLETENESS. Every address a listed domain page links as one of its own - each pill of its
// pill bar, What is counted's (/git/methodology), each section's link icon (/git/zaps) - is
// listed too. The sitemap is built from the same slug tables as those links
// ($lib/seo/sitemap, slugTablePaths); this is the check that the deployed site agrees.
// And no hidden page is listed (/wip, /routstr, /relays and the
// /zapstore/apps index), nor any address with a query or a `#`.
//
// FIRST-PARTY MARKING. Every request carries the User-Agent `nozzl-verify-sitemap`, so its lines
// can be told apart in the access log. GET only, a few at a time.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error.
import { STATUS_CODES } from 'node:http';

const args = process.argv.slice(2);
const sampleArg = args.find((a) => a.startsWith('--sample='));
const SAMPLE = sampleArg ? Number(sampleArg.slice('--sample='.length)) : 25;
const unknown = args.filter((a) => a.startsWith('--') && !a.startsWith('--sample='));
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://nostrolo.gy').replace(/\/+$/, '');
if (unknown.length || !/^https?:\/\//.test(base) || !Number.isInteger(SAMPLE) || SAMPLE < 0) {
	console.error('usage: node scripts/verify-sitemap.mjs [--sample=<n>] [<base-url>]');
	process.exit(2);
}
const ORIGIN = new URL(base).origin;
const MARK = 'nozzl-verify-sitemap';
/** Hidden on purpose (src/lib/seo/sitemap.ts, HIDDEN_TREES and HIDDEN_EXACT). */
const HIDDEN_TREES = ['/wip', '/routstr', '/relays'];
const HIDDEN_EXACT = ['/zapstore/apps'];
/** A detail page: a page about one thing, found by its ID (sampled, not all fetched). */
const DETAIL = /^\/(zapstore\/(apps|publishers)\/|nutzaps\/mints\/|data\/[^/]+\/)/;

let failures = 0;
const ok = (m) => console.log(`ok   ${m}`);
const bad = (m) => {
	failures++;
	console.log(`FAIL ${m}`);
};
const check = (cond, m) => (cond ? ok(m) : bad(m));
/** A status code with its reason phrase: `404 (not found)`. */
const named = (status) => `${status} (${(STATUS_CODES[status] ?? 'no reason phrase').toLowerCase()})`;
const get = (url) =>
	fetch(url, {
		redirect: 'manual',
		headers: { 'User-Agent': MARK },
		signal: AbortSignal.timeout(30000)
	});
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const hidden = (path) => HIDDEN_EXACT.includes(path) || HIDDEN_TREES.some((t) => path === t || path.startsWith(`${t}/`));

/** Fetch `urls` a few at a time, calling `each(url, res, html)`. */
async function visit(urls, each, width = 4) {
	const queue = [...urls];
	await Promise.all(
		Array.from({ length: width }, async () => {
			for (let url = queue.shift(); url; url = queue.shift()) {
				try {
					const res = await get(url);
					await each(url, res, await res.text());
				} catch (e) {
					bad(`${url}: ${e.message}`);
				}
			}
		})
	);
}

/** The page answers as a listed page must: 200 (ok) at once, HTML, naming itself, indexable. */
function listedPage(url, res, html) {
	const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
	const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
	const type = res.headers.get('content-type') ?? '';
	const good = res.status === 200 && type.startsWith('text/html') && canonical === url && !noindex;
	if (good) return true;
	bad(`${url.replace(ORIGIN, '')}: ${named(res.status)}${res.headers.get('location') ? ' -> ' + res.headers.get('location') : ''}, ${type}, canonical ${canonical}, noindex ${noindex}`);
	return false;
}

const res = await get(`${base}/sitemap.xml`);
const xml = await res.text();
check(res.status === 200 && (res.headers.get('content-type') ?? '').includes('xml'), `/sitemap.xml -> ${named(res.status)}, ${res.headers.get('content-type')}`);
const urls = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]));
check(urls.length > 0 && new Set(urls).size === urls.length, `the sitemap lists ${urls.length} URLs, each once`);
check(urls.every((u) => u.startsWith(`${ORIGIN}/`) || u === ORIGIN + '/'), `every URL is on ${ORIGIN}`);
const paths = urls.map((u) => new URL(u).pathname);
check(urls.every((u) => !new URL(u).search && !new URL(u).hash), 'no URL carries a query or a #');
const hiddenListed = paths.filter(hidden);
check(hiddenListed.length === 0, `no hidden page is listed${hiddenListed.length ? ': ' + hiddenListed.slice(0, 5).join(' ') : ''}`);

const pages = urls.filter((u) => !DETAIL.test(new URL(u).pathname));
const details = urls.filter((u) => DETAIL.test(new URL(u).pathname));
const sample = details
	.map((u) => [Math.random(), u])
	.sort((a, b) => a[0] - b[0])
	.slice(0, SAMPLE)
	.map(([, u]) => u);
console.log(`fetching the ${pages.length} pages that are not detail pages, and ${sample.length} of the ${details.length} detail pages`);

// Each listed page, and every address it links as one of its own.
const listed = new Set(paths);
const own = new Map(); // address -> the page that links it
let good = 0;
await visit(pages, (url, res, html) => {
	if (listedPage(url, res, html)) good++;
	const path = new URL(url).pathname;
	// a pill bar's links are the ones with an id="tab-<slug>" (PillBar)
	const links = [
		...[...html.matchAll(/<a href="(\/[^"]*)" id="tab-[a-z-]+"/g)].map((m) => m[1]),
		...[...html.matchAll(/<a href="(\/[^"]*)"[^>]*data-(?:methodology|section)-link/g)].map((m) => m[1])
	];
	for (const link of links) if (!own.has(link)) own.set(link, path);
});
check(good === pages.length, `${good} of ${pages.length} pages answer 200 (ok) at once, naming themselves, indexable`);
const missing = [...own].filter(([address]) => !listed.has(address));
check(own.size > 0, `the domain pages link ${own.size} addresses of their own (pills, What is counted, sections)`);
check(missing.length === 0, `every one of them is listed${missing.length ? '; missing: ' + missing.map(([a, from]) => `${a} (linked from ${from})`).join(', ') : ''}`);

let goodDetails = 0;
await visit(sample, (url, res, html) => {
	if (listedPage(url, res, html)) goodDetails++;
});
check(goodDetails === sample.length, `${goodDetails} of ${sample.length} sampled detail pages answer 200 (ok) at once, naming themselves, indexable`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
