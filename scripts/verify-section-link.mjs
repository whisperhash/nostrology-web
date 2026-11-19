// Verify, on a deployed site or a local build, the addresses of pills and sections (/git/hosting,
// /git/zaps, /marketplaces/categories; src/lib/slug-table.ts): that each answers as the rules
// say, that a pill's address opens its pill under a page title of its own, that a section's
// address carries its OWN link preview - the card a chat or Nostr app draws for it, from the HTML
// alone - and, in a real browser, that the pill bar's links move between the pills and the page
// opens at the section.
//
//   node scripts/verify-section-link.mjs                       # https://nostrolo.gy
//   node scripts/verify-section-link.mjs --no-browser          # the wire only
//   node scripts/verify-section-link.mjs http://127.0.0.1:3000 # a local `node build`
//
// WIRE (Node's fetch, redirects not followed):
//   - each public section in SECTIONS (/git/zaps, /marketplaces/categories) and its domain: 200
//     (ok), HTML; the section with its own og:title and og:description, an absolute og:image,
//     og:url naming itself, all in the first 8 KB, and sent on its pill with its card;
//   - on /git, /marketplaces, /routstr, /zapstore and /nutzaps: the pill bar in the server's HTML,
//     a plain link per pill, never preloaded, and every pill's address it links answering 200 (ok)
//     with that pill open, naming itself, under its own page title - and where the pills are
//     parts of one page, on that pill alone with the domain's own preview;
//   - the rules, on each domain: a trailing slash, the default pill's own slug and an unknown
//     slug redirect (the last two never cached, the query kept), `constructor` among the
//     unknown; a non-slug and a deeper path are 404 (not found); /zapstore/<pubkey>, the old
//     address of a publisher's page, still a 308 (permanent redirect) to it; and
//     /zapstore/publishers, a collection with no page of its own, an unknown slug like any other;
// BROWSER (headless Chrome, a desktop and a phone with touch, reduced motion off; a narrower phone
// for the landings alone):
//   - the pill bar on /git: a real click (a tap on the phone) on Hosting opens it at once and
//     moves the address to /git/hosting with ONE small data request (the page's document is
//     not sent again), under the pill's page title, keeping the scroll on the desktop;
//     Maintainers the same; Back returns to Hosting and then to /git, Forward to Hosting;
//     hovering a pill asks the server nothing;
//   - on /zapstore and /nutzaps, whose pills are pages of their own: a click on the second pill
//     from a scrolled page opens it at its top, with one data request and the focus kept on the
//     pill, and Back returns to the scroll it left;
//   - an old /git#hosting link, cold: Hosting, the address moved to /git/hosting;
//   - for each section in SECTIONS, cold (/git/zaps: Collaboration): its card under the sticky
//     nav (measured; exactly, or with the page scrolled as far as it goes and the card clear of
//     the nav - at least one landing exact, per section), the glow seen, focus on the card, the
//     section's tab title, the address unchanged, the card inside its parent and no sideways scroll;
//   - the nav's link to its domain from there (through the phone's menu): the domain on Overview,
//     the plain title - the page stays mounted, so this is the move that kept stale state once;
//   - an unknown slug: /git on Overview with the note under the nav, one line wide enough to
//     read on a phone, and the address tidied to /git;
//   - the link icon on each section in SECTIONS (SectionLink), on a page loaded with a query: on
//     the desktop not drawn at rest, drawn by hovering the heading at the card's right end, and a
//     real click puts exactly <origin>/<section's address> on the real clipboard without following
//     the link, the tick staying after the pointer leaves and going two seconds on; on the phone
//     drawn while its heading is on screen (P1), a 44 px target, a real tap opening the share
//     menu - stood in for, recording what it is given and whether the tap's activation was
//     live - with that address alone, a closed menu doing nothing and the next tap sharing again,
//     a refused share copying instead, and gone and untouchable once the heading has scrolled away; and
//     no data request (a preload) while it is hovered, clicked or tapped;
//   - no page exception, no console error, no request that reached a Google analytics host.
//
// FIRST-PARTY MARKING. Every request carries the User-Agent mark `nozzl-verify-section-link`
// (the whole User-Agent on the wire, a suffix to Chrome's own), so its lines can be told apart
// in the access log. The browser blocks Google's analytics hosts, so a run on the live site is
// never counted there (scripts/lib/google.mjs). GET only; nothing is posted.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error. The browser part
// needs Google Chrome (CHROME=/path/to/chrome overrides).
import { STATUS_CODES } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';
import { blockGoogle, googleLeaks } from './lib/google.mjs';

const args = process.argv.slice(2);
const NO_BROWSER = args.includes('--no-browser');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--no-browser');
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://nostrolo.gy').replace(/\/+$/, '');
if (unknown.length || !/^https?:\/\//.test(base)) {
	console.error('usage: node scripts/verify-section-link.mjs [--no-browser] [<base-url>]');
	process.exit(2);
}
const MARK = 'nozzl-verify-section-link';
/** Preview fetchers read only the start of a page: the tags must be in its first 8 KB, as
 * scripts/verify-link-previews.mjs holds every page to. */
const HEAD_BYTES = 8192;
/** The domains with a slug table: their own address, their page title and their pill bar's name.
 * `pages`: each pill is a page of its own (its own route, its own preview), not a part of one. */
const DOMAINS = [
	{ path: '/git', title: 'Nostrology - Git on Nostr', label: 'Git on Nostr' },
	{ path: '/marketplaces', title: 'Nostrology - Nostr Marketplaces', label: 'Nostr Marketplaces' },
	{ path: '/routstr', title: 'Nostrology - Routstr', label: 'Routstr' },
	{ path: '/zapstore', title: 'Nostrology - Zapstore', label: 'Zapstore', pages: true },
	{ path: '/nutzaps', title: 'Nostrology - Nutzaps', label: 'Nutzaps', pages: true }
];
/** The sections with an address and an icon that any reader gets: each answers, lands and copies
 * as the rules say. Hand-kept like DOMAINS, because this script does not import the app's
 * TypeScript; src/lib/unreleased.test.ts fails if it drifts from the slug tables. A section still
 * in development is not here, since a stranger gets a 302 (found) at its address, and that is what
 * scripts/verify-unreleased.mjs checks. What is counted is not here either: it has an icon of its
 * own, and scripts/verify-methodology-link.mjs has it.
 * `word`: what its own preview must be about. */
const SECTIONS = [
	{ path: '/git/zaps', domain: '/git', pill: 'collaboration', pillName: 'Collaboration', id: 'ngit-zaps', name: 'Zaps', word: /zap/i },
	{ path: '/marketplaces/categories', domain: '/marketplaces', pill: 'catalogue', pillName: "What's for sale", id: 'markets-categories', name: 'Categories', word: /categor/i }
];
const domainOf = (sec) => DOMAINS.find((d) => d.path === sec.domain);

let failures = 0;
const ok = (m) => console.log(`ok   ${m}`);
const bad = (m) => {
	failures++;
	console.log(`FAIL ${m}`);
};
const check = (cond, m) => (cond ? ok(m) : bad(m));
/** A status code with its reason phrase: `308 (permanent redirect)`. */
const named = (status) => `${status} (${(STATUS_CODES[status] ?? 'no reason phrase').toLowerCase()})`;

const get = (path) =>
	fetch(base + path, {
		redirect: 'manual',
		headers: { 'User-Agent': MARK },
		signal: AbortSignal.timeout(30000)
	});
/** A <meta> value from the first HEAD_BYTES of the HTML, entities decoded. */
const metaOf = (html, attr, key) => {
	const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html.slice(0, HEAD_BYTES));
	return m?.[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};
const locationOf = (res) => {
	const loc = res.headers.get('location');
	return loc ? new URL(loc, base).href.replace(base, '') : null;
};

async function expectRedirect(path, status, to, { uncached = false } = {}) {
	const res = await get(path);
	const loc = locationOf(res);
	check(res.status === status && loc === to, `${path} -> ${named(res.status)} ${loc ?? '(no Location)'} (want ${named(status)} ${to})`);
	if (uncached) check(res.headers.get('cache-control') === 'no-store', `${path}: never cached (Cache-Control: ${res.headers.get('cache-control')})`);
}

async function expectStatus(path, status) {
	const res = await get(path);
	check(res.status === status, `${path} -> ${named(res.status)} (want ${named(status)})`);
}

async function wire() {
	console.log(`wire: ${base}`);
	for (const sec of SECTIONS) await sectionAddress(sec);

	// Every pill's address, on each domain with a slug table, as its own pill bar links it.
	for (const domain of DOMAINS) await pillAddresses(domain);

	// The rules for every other kind of address.
	for (const { path } of SECTIONS) await expectRedirect(`${path}/`, 308, path);
	await expectRedirect('/git/overview?verify=1', 308, '/git?verify=1');
	for (const { path } of DOMAINS) {
		await expectRedirect(`${path}/overview`, 308, path, { uncached: true });
		await expectRedirect(`${path}/no-such-section-verify`, 302, `${path}#gone`, { uncached: true });
		// slug-shaped, and inherited by every object: a 500 (internal server error) until 2026-10-19
		await expectRedirect(`${path}/constructor`, 302, `${path}#gone`, { uncached: true });
		await expectStatus(`${path}/a/b`, 404);
		await expectStatus(`${path}/Overview`, 404);
	}
	// /zapstore/<pubkey>, the old address of a publisher's page, is a redirect of its own: never a slug
	const PUBKEY = '7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19';
	await expectRedirect(`/zapstore/${PUBKEY}`, 308, `/zapstore/publishers/${PUBKEY}`);
	// a collection with no page at its own address is a slug like any other ($lib/slug-tables/zapstore)
	await expectRedirect('/zapstore/publishers', 302, '/zapstore#gone', { uncached: true });
}

/** A live section, and the domain page it is part of: the domain with its own preview and address,
 * and the section on its pill, with its card and a preview of its own. */
async function sectionAddress({ path, domain, pill, pillName, id, name, word }) {
	// The domain page itself, unchanged: its own preview and address.
	const domainRes = await get(domain);
	const domainHtml = await domainRes.text();
	check(domainRes.status === 200, `${domain} -> ${named(domainRes.status)}`);
	const domainTitle = metaOf(domainHtml, 'property', 'og:title');
	check(metaOf(domainHtml, 'property', 'og:url') === `${base}${domain}`, `${domain} names itself (og:url ${metaOf(domainHtml, 'property', 'og:url')})`);

	// The section: the page, on the section's pill, with the section's own preview.
	const res = await get(path);
	const html = await res.text();
	check(res.status === 200, `${path} -> ${named(res.status)}`);
	check((res.headers.get('content-type') ?? '').startsWith('text/html'), `${path} is HTML (${res.headers.get('content-type')})`);
	const title = metaOf(html, 'property', 'og:title');
	const description = metaOf(html, 'property', 'og:description');
	const image = metaOf(html, 'property', 'og:image');
	check(!!title && title !== domainTitle && word.test(title), `${path} has its own preview title: "${title}"`);
	check(!!description && word.test(description), `${path} has its own preview description: "${description}"`);
	// https on the live site; a local build's own origin is http
	const scheme = new URL(base).protocol;
	check(!!image && image.startsWith(`${scheme}//`), `${path} has an absolute ${scheme.slice(0, -1)} preview image: ${image}`);
	check(metaOf(html, 'property', 'og:url') === `${base}${path}`, `${path} names itself (og:url ${metaOf(html, 'property', 'og:url')})`);
	check(html.includes(`id="panel-${pill}"`) && !html.includes('id="panel-overview"'), `${path} is sent on the ${pillName} pill, not Overview`);
	check(html.includes(`id="${id}"`), `${path} carries the ${name} section`);
}

/** A domain's pill bar, as its own server sends it: each pill's link, never preloaded, the open one
 * marked; then each pill's address, fetched: 200 (ok), its pill marked open, naming itself, under a
 * page title of its own - and where the pills are parts of one page, on that pill's panel alone,
 * with the domain's preview. */
async function pillAddresses({ path, title, label, pages = false }) {
	const res = await get(path);
	const html = await res.text();
	const preview = metaOf(html, 'property', 'og:title');
	const bar = new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`).exec(html)?.[1] ?? '';
	const links = [...bar.matchAll(/<a href="([^"]*)" id="tab-([a-z-]+)"([^>]*)>/g)].map((m) => ({ href: m[1], slug: m[2], attrs: m[3] }));
	check(links.length >= 2 && links[0].href === path, `${path}: the pill bar is in the server's HTML, a link per pill (${links.map((l) => l.href).join(' ')})`);
	check(links.every((l) => l.attrs.includes('data-sveltekit-preload-data="off"')), `${path}: no pill link preloads`);
	check(links.filter((l) => l.attrs.includes('aria-current="page"')).map((l) => l.slug).join() === links[0]?.slug, `${path}: the default pill is the open one`);
	const titles = new Set([/<title>([^<]*)<\/title>/.exec(html)?.[1]]);
	for (const { href, slug } of links.slice(1)) {
		const r = await get(href);
		const h = await r.text();
		const t = /<title>([^<]*)<\/title>/.exec(h)?.[1];
		titles.add(t);
		const marked = new RegExp(`<a href="${href}" id="tab-${slug}" aria-current="page"`).test(h);
		const onPill = pages || (h.includes(`id="panel-${slug}"`) && (h.match(/id="panel-[a-z-]+"/g) ?? []).length === 1);
		const self = metaOf(h, 'property', 'og:url') === `${base}${href}` && h.includes(`<link rel="canonical" href="${base}${href}"`);
		const titled = pages ? !!t && t !== title : !!t?.startsWith(`${title} - `);
		const previewed = pages || metaOf(h, 'property', 'og:title') === preview;
		check(r.status === 200 && marked && onPill && self && titled && previewed,
			`${href} -> ${named(r.status)}, its pill open, naming itself, titled "${t}"${pages ? '' : ", the domain's preview"}`);
	}
	check(titles.size === links.length, `${path}: every pill's address has a page title of its own`);
}

async function browserChecks() {
	console.log(`browser: headless Chrome on ${base}`);
	const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	const PORT = 9300 + (process.pid % 500);
	const PROFILE = await mkdtemp(join(tmpdir(), 'verify-section-link-'));
	const ORIGIN = new URL(base).origin;
	// The narrow phone takes the landings alone: what it is here for is a card wider than the screen.
	const VIEWPORTS = [
		{ name: 'desktop', width: 1440, height: 900, mobile: false },
		{ name: 'phone', width: 390, height: 844, mobile: true },
		{ name: 'narrow phone', width: 360, height: 740, mobile: true, landingsOnly: true }
	];
	const chrome = launchChrome({ path: CHROME, port: PORT, profile: PROFILE });
	let ws;
	try {
		let wsUrl;
		for (let i = 0; i < 80 && !wsUrl; i++) {
			try {
				wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
			} catch {
				await sleep(250);
			}
		}
		if (!wsUrl) throw new Error('Chrome did not start');
		ws = new WebSocket(wsUrl);
		await new Promise((r) => (ws.onopen = r));
		let id = 0;
		const pending = new Map();
		const events = [];
		ws.onmessage = (m) => {
			const msg = JSON.parse(m.data);
			if (msg.id && pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			} else events.push(msg);
		};
		const send = (method, params = {}, sessionId) =>
			new Promise((res, rej) => {
				const i = ++id;
				pending.set(i, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
				ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
			});
		// What the page shows, measured.
		const STATE = `(() => {
			const el = document.getElementById(${JSON.stringify(Object.fromEntries(SECTIONS.map((sec) => [sec.path, sec.id])))}[location.pathname]);
			const nav = document.querySelector('nav.nav');
			const de = document.documentElement;
			const sel = document.querySelector('a[id^="tab-"][aria-current]');
			const note = document.querySelector('[data-transient-note]');
			const nr = note ? note.getBoundingClientRect() : null;
			return {
				top: el ? Math.round(el.getBoundingClientRect().top) : null,
				pastParent: el ? Math.round(el.getBoundingClientRect().right - el.parentElement.getBoundingClientRect().right) : null,
				glow: el ? el.classList.contains('section-arrival') : null,
				focused: !!el && document.activeElement === el,
				navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
				tab: sel ? sel.id : null,
				current: sel ? sel.getAttribute('aria-current') : null,
				scrollY: Math.round(window.scrollY),
				maxScroll: Math.max(0, Math.round(de.scrollHeight - de.clientHeight)),
				over: de.scrollWidth - de.clientWidth,
				path: location.pathname + location.hash,
				title: document.title,
				note: note ? note.textContent.trim() : null,
				noteTop: nr ? Math.round(nr.top) : null,
				noteHeight: nr ? Math.round(nr.height) : null,
				lineHeight: note ? parseFloat(getComputedStyle(note).lineHeight) : null,
				vw: window.innerWidth
			};
		})()`;

		// How many landings were EXACTLY under the nav rather than at the page's scroll end. The
		// scroll end is honest geometry - a document too short to lift the section higher, as a
		// local build's fixture is on a desktop - but it would also pass with the page's own
		// scroll deleted, so a run that never lands a strict one has not checked the landing.
		// Counted per section: one section's exact landing says nothing about another's.
		const strict = new Map(SECTIONS.map((sec) => [sec.path, 0]));
		for (const vp of VIEWPORTS) {
			const tag = vp.name;
			const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
			const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
			const since = events.length;
			await send('Page.enable', {}, s);
			await send('Runtime.enable', {}, s);
			await send('Network.enable', {}, s);
			const { userAgent } = await send('Browser.getVersion');
			await send('Network.setUserAgentOverride', { userAgent: `${userAgent} ${MARK}` }, s);
			await blockGoogle(send, s);
			await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }, s);
			if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
			// A tab opened over CDP can count as hidden, and the glow waits for a visible tab.
			await send('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
			await send('Page.bringToFront', {}, s);
			const ev = async (expression) => {
				const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
				if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
				return r.result.value;
			};
			const go = async (url) => {
				await send('Page.navigate', { url: 'about:blank' }, s);
				await sleep(150);
				const from = events.length;
				await send('Page.navigate', { url }, s);
				for (let i = 0; i < 100; i++) {
					await sleep(100);
					if (events.slice(from).some((e) => e.sessionId === s && e.method === 'Page.loadEventFired')) break;
				}
			};
			/** How many of the page's data requests (`__data.json`) are still on the wire: sent, and
			 * neither finished nor failed. */
			const dataInFlight = () => {
				const open = new Set();
				for (let i = since; i < events.length; i++) {
					const e = events[i];
					if (e.sessionId !== s) continue;
					if (e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('__data.json')) open.add(e.params.requestId);
					else if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') open.delete(e.params.requestId);
				}
				return open.size;
			};
			/** Wait for the page to stop moving with no data request on the wire, noting whether the
			 * glow was ever on; returns the last state either way, so the caller's assertion decides.
			 * On Back the address changes at once, before the move's answer arrives, and the page only
			 * renders, and restores its scroll, once it has: a still page with an answer still coming
			 * has not settled. From a local build the answer takes no time; from here to the live
			 * site about 0.4 s, close enough to three still readings that Back's scroll was once read
			 * before it was restored (2026-10-22). */
			const settle = async (ms = 9000, { glow = false } = {}) => {
				const until = Date.now() + ms;
				let sawGlow = false;
				let last = await ev(STATE);
				let same = 0;
				while (Date.now() < until) {
					await sleep(150);
					const now = await ev(STATE);
					sawGlow ||= !!now.glow;
					const still = now.scrollY === last.scrollY && now.tab === last.tab && now.path === last.path;
					same = still && dataInFlight() === 0 ? same + 1 : 0;
					last = now;
					if (same >= 3 && (!glow || sawGlow)) break;
				}
				return { ...last, sawGlow };
			};

			/** What every viewport ends with: nothing went wrong in the page, and the tab closes. */
			const finish = async () => {
				const mine = events.slice(since).filter((e) => e.sessionId === s);
				const thrown = mine.filter((e) => e.method === 'Runtime.exceptionThrown').length;
				const revoked = mine.filter((e) => e.method === 'Runtime.exceptionRevoked').length;
				const errors = mine.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
				check(thrown - revoked === 0, `${tag}: no page exception (${thrown} thrown, ${revoked} revoked)`);
				check(errors.length === 0, `${tag}: no console error${errors.length ? ': ' + JSON.stringify(errors[0].params.args?.[0]?.value ?? '') : ''}`);
				const ga = googleLeaks(mine).length;
				check(ga === 0, `${tag}: nothing reached Google analytics (${ga})`);
				await send('Target.closeTarget', { targetId });
			};

			let m;
			for (const sec of SECTIONS) {
				const { path, domain, pill, pillName, name } = sec;
				const domainTitle = domainOf(sec).title;
				// 1. A cold section address.
				await go(`${base}${path}`);
				m = await settle(9000, { glow: true });
				// the open item of the pill bar, not its current page: the pill's link is its own address
				check(m.tab === `tab-${pill}` && m.current === 'true', `${tag} ${path}: the ${pillName} pill (${m.tab}, aria-current ${m.current})`);
				const under = m.top !== null && m.navBottom !== null && Math.abs(m.top - (m.navBottom + 8)) <= 2;
				// the page scrolled as far as it goes, with the card still clear of the nav
				const atEnd = m.scrollY >= m.maxScroll - 2 && m.scrollY > 0 && m.top !== null && m.navBottom !== null && m.top >= m.navBottom + 6;
				if (under) strict.set(path, strict.get(path) + 1);
				check(under || atEnd, `${tag} ${path}: the ${name} card under the nav (top ${m.top}, nav bottom ${m.navBottom} + 8; scroll ${m.scrollY} of ${m.maxScroll})${under ? ', exactly' : atEnd ? ', the page scrolled as far as it goes' : ''}`);
				check(m.sawGlow, `${tag} ${path}: the ${name} card glowed`);
				check(m.focused, `${tag} ${path}: focus on the ${name} card`);
				check(m.title === `${domainTitle} - ${name}`, `${tag} ${path}: tab title "${m.title}"`);
				check(m.path === path, `${tag} ${path}: the address stays ${m.path}`);
				check(m.note === null, `${tag} ${path}: no note`);
				check(m.over <= 0, `${tag} ${path}: no horizontal scroll (${m.over})`);
				// A grid track as wide as a child's unbreakable content pushes the card, and the icon
				// at its right end, past its parent long before the page itself scrolls sideways.
				check(m.pastParent !== null && m.pastParent <= 0, `${tag} ${path}: the card inside its parent (right edge ${m.pastParent} px past the parent's)`);

				// 2. The nav's link to the domain from there: a move within the route, the page stays mounted.
				if (vp.mobile) {
					await ev(`document.querySelector('nav.nav .nav-burger').click()`);
					await sleep(300);
				}
				const clicked = await ev(
					`(() => { const a = [...document.querySelectorAll('nav.nav a')].find((a) => new URL(a.href).pathname === ${JSON.stringify(domain)} && a.getClientRects().length > 0); if (!a) return false; a.click(); return true; })()`
				);
				check(clicked, `${tag} the nav's link to ${domain} is there to follow`);
				for (let i = 0; i < 80; i++) {
					const now = await ev(STATE);
					if (now.path !== path) break;
					await sleep(100);
				}
				m = await settle(4000);
				check(m.path === domain && m.tab === 'tab-overview', `${tag} the nav's link to ${domain} from ${path}: ${m.path} on ${m.tab}`);
				check(m.title === domainTitle, `${tag} after it: tab title "${m.title}"`);
			}
			if (vp.landingsOnly) {
				await finish();
				continue;
			}

			// 3. An unknown slug: 302 (found) to /git#gone, the note, the address tidied.
			await go(`${base}/git/no-such-section-verify`);
			m = await settle(3000);
			check(m.note === 'That section is no longer on this page.', `${tag} an unknown slug: the note "${m.note}"`);
			check(m.noteTop !== null && m.navBottom !== null && m.noteTop >= m.navBottom, `${tag} an unknown slug: the note under the nav (${m.noteTop} vs ${m.navBottom})`);
			check(m.noteHeight !== null && m.lineHeight !== null && m.noteHeight < 1.5 * m.lineHeight + 20, `${tag} an unknown slug: the note on one line (${m.noteHeight} px tall, line ${m.lineHeight} px, viewport ${m.vw} px)`);
			check(m.path === '/git' && m.tab === 'tab-overview', `${tag} an unknown slug: the address ${m.path}, on ${m.tab}`);

			// 3b. The pill bar: real clicks (a finger's tap on the phone), each a move of the router's
			// to the pill's own address, with Back and Forward through them.
			await go(`${base}/git`);
			await settle(4000);
			const pillAt = (slug) =>
				ev(`(() => { const a = document.getElementById('tab-${slug}'); a.scrollIntoView({ block: 'center' }); const b = a.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
			/** Scrolls the page so a pill sits just under the sticky nav; where it is, and the scroll. */
			const pillUnderNav = (slug) =>
				ev(`(() => { const a = document.getElementById('tab-${slug}'); const nav = document.querySelector('nav.nav'); window.scrollTo(0, window.scrollY + a.getBoundingClientRect().top - (nav ? nav.getBoundingClientRect().bottom : 0) - 12); const b = a.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), scrollY: Math.round(window.scrollY) }; })()`);
			const pointer = (type, x, y) =>
				send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, s);
			const dataRequests = (from) =>
				events.slice(from).filter((e) => e.sessionId === s && e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('__data.json'));
			if (!vp.mobile) {
				// a hover over a pill asks the server nothing: a preload would log a visit nobody made
				const at = await pillAt('maintainers');
				const hoverFrom = events.length;
				await pointer('mouseMoved', at.x, at.y);
				await sleep(800);
				const hovered = dataRequests(hoverFrom).map((e) => e.params.request.url);
				check(hovered.length === 0, `${tag} pills: hovering one asks the server nothing${hovered.length ? ': ' + hovered.join(' ') : ''}`);
			}
			const press = async (slug, placed) => {
				const at = placed ?? (await pillAt(slug));
				if (vp.mobile) await send('Input.synthesizeTapGesture', { x: at.x, y: at.y, duration: 50, tapCount: 1, gestureSourceType: 'touch' }, s);
				else {
					await pointer('mouseMoved', at.x, at.y);
					await pointer('mousePressed', at.x, at.y);
					await pointer('mouseReleased', at.x, at.y);
				}
			};
			const arrive = async (path) => {
				for (let i = 0; i < 80 && (await ev('location.pathname + location.hash')) !== path; i++) await sleep(100);
				return settle(4000);
			};
			for (const [slug, title] of [
				['hosting', 'Hosting'],
				['maintainers', 'Maintainers']
			]) {
				// on the desktop, from a page scrolled to put the pill bar under the nav (on a phone the
				// page scrolls to a panel that starts off screen, on purpose)
				const placed = vp.mobile ? undefined : await pillUnderNav(slug);
				const from = events.length;
				await press(slug, placed);
				m = await arrive(`/git/${slug}`);
				if (placed)
					check(placed.scrollY > 0 && Math.abs(m.scrollY - placed.scrollY) <= 2, `${tag} pills: the click on ${title} keeps the scroll (${placed.scrollY} -> ${m.scrollY})`);
				check(m.path === `/git/${slug}` && m.tab === `tab-${slug}` && m.current === 'page', `${tag} pills: a click on ${title} opens it at /git/${slug} (${m.path} on ${m.tab}, aria-current ${m.current})`);
				check(m.title === `Nostrology - Git on Nostr - ${title}`, `${tag} pills: titled "${m.title}"`);
				// one small answer for the address: the page's document is the layout's, not sent again.
				// Measured as the answer's own bytes as they arrived, not from the request's end: on the
				// live site Chrome sometimes marks the request canceled a few milliseconds after the whole
				// answer has arrived, as the router moves the address (2 of 30 clicks, 2026-10-22; Caddy
				// logged every one 200 (ok) in full, and the page opened the pill). Only a request that
				// fails before its answer fails here.
				const asked = dataRequests(from);
				const trail = asked.length === 1 ? events.slice(from).filter((e) => e.sessionId === s && e.params?.requestId === asked[0].params.requestId) : [];
				const response = trail.find((e) => e.method === 'Network.responseReceived');
				const failed = trail.find((e) => e.method === 'Network.loadingFailed');
				const ended = !!failed || trail.some((e) => e.method === 'Network.loadingFinished');
				const bytes = response && ended ? trail.filter((e) => e.method === 'Network.dataReceived').reduce((n, e) => n + e.params.dataLength, 0) : null;
				const status = response ? response.params.response.status : null;
				const wire =
					bytes === null
						? failed
							? `failed before its answer (${failed.params.errorText})`
							: 'still on the wire'
						: `${status} (${STATUS_CODES[status]?.toLowerCase()}) with a ${bytes}-byte answer${failed ? ', then marked canceled by Chrome' : ''}`;
				check(asked.length === 1 && asked[0].params.request.url.includes(`/git/${slug}/__data.json`) && status === 200 && bytes > 0 && bytes < 8192,
					`${tag} pills: one data request for /git/${slug}, ${wire} (${asked.map((e) => e.params.request.url.replace(ORIGIN, '')).join(' ')})`);
			}
			await ev('history.back()');
			m = await arrive('/git/hosting');
			check(m.path === '/git/hosting' && m.tab === 'tab-hosting', `${tag} pills: Back returns to Hosting (${m.path} on ${m.tab})`);
			await ev('history.back()');
			m = await arrive('/git');
			check(m.path === '/git' && m.tab === 'tab-overview' && m.title === 'Nostrology - Git on Nostr', `${tag} pills: Back again to /git on Overview (${m.path} on ${m.tab}, "${m.title}")`);
			await ev('history.forward()');
			m = await arrive('/git/hosting');
			check(m.path === '/git/hosting' && m.tab === 'tab-hosting', `${tag} pills: Forward to Hosting (${m.path} on ${m.tab})`);
			if (!vp.mobile) {
				// on one of the domain's own addresses, the nav's link to it never preloads: a preload
				// would log a visit to /git that never happened (SiteNav)
				const navAt = await ev(`(() => { const a = [...document.querySelectorAll('nav.nav a')].find((a) => new URL(a.href).pathname === '/git' && a.getClientRects().length > 0); const b = a.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
				const navFrom = events.length;
				await pointer('mouseMoved', navAt.x, navAt.y);
				await sleep(800);
				const navAsked = dataRequests(navFrom).map((e) => e.params.request.url);
				check(navAsked.length === 0, `${tag} on /git/hosting, hovering the nav's Git link asks the server nothing${navAsked.length ? ': ' + navAsked.join(' ') : ''}`);
				await pointer('mouseMoved', 2, vp.height - 2);
			}

			// 3c. An old /git#hosting link, cold: Hosting, and the address moved to the pill's own.
			await go(`${base}/git#hosting`);
			m = await arrive('/git/hosting');
			check(m.path === '/git/hosting' && m.tab === 'tab-hosting', `${tag} an old /git#hosting link: ${m.path} on ${m.tab}`);

			// 3d. Where each pill is a page of its own (/zapstore, /nutzaps): a click on the second pill,
			// from a scrolled page, opens it at its top with one data request and the focus kept on the
			// pill (its bar is the shared layout's, so the link survives); Back returns to the scroll.
			for (const { path: home } of DOMAINS.filter((d) => d.pages)) {
				await go(`${base}${home}`);
				await settle(4000);
				const second = await ev(`(() => { const a = document.querySelectorAll('a[id^="tab-"]')[1]; return a ? { id: a.id, path: new URL(a.href).pathname } : null; })()`);
				if (!second) {
					check(false, `${tag} ${home}: a second pill to click`);
					continue;
				}
				const slug = second.id.replace(/^tab-/, '');
				const placed = await pillUnderNav(slug);
				const from = events.length;
				await press(slug, placed);
				m = await arrive(second.path);
				const active = await ev('document.activeElement ? document.activeElement.id : null');
				check(m.path === second.path && m.tab === second.id && m.current === 'page', `${tag} ${home}: a click on its second pill opens ${second.path} (${m.path} on ${m.tab}, aria-current ${m.current})`);
				check(placed.scrollY > 0 && m.scrollY === 0, `${tag} ${second.path}: the new page starts at its top (${placed.scrollY} -> ${m.scrollY})`);
				check(active === second.id, `${tag} ${second.path}: the focus stays on the pill (${active})`);
				const asked = dataRequests(from).map((e) => e.params.request.url.replace(ORIGIN, ''));
				check(asked.length === 1 && asked[0].startsWith(`${second.path}/__data.json`), `${tag} ${second.path}: one data request (${asked.join(' ')})`);
				await ev('history.back()');
				m = await arrive(home);
				check(m.path === home && Math.abs(m.scrollY - placed.scrollY) <= 2, `${tag} ${home}: Back returns to the scroll it left (${m.scrollY}, was ${placed.scrollY})`);
			}

			// 4. The link icon on each section (SectionLink), on a page loaded with a query, which the
			// link must not carry.
			await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
			for (const { path, id, name } of SECTIONS) {
				const want = `${ORIGIN}${path}`;
				await go(`${base}${path}?verify=1`);
				await settle(9000, { glow: true });
				const iconFrom = events.length;
				const ICON = `(() => {
					const a = document.querySelector('#${id} > a[data-section-link]');
					const h = document.querySelector('#${id} > h2');
					const c = document.getElementById('${id}');
					const r = (el) => {
						if (!el) return null;
						const b = el.getBoundingClientRect();
						return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2) };
					};
					const cs = a && getComputedStyle(a);
					return { found: !!a, opacity: cs && cs.opacity, pe: cs && cs.pointerEvents, copied: !!a && a.classList.contains('copied'), link: r(a), heading: r(h), card: r(c), href: a && a.href, path: location.pathname + location.search + location.hash, shared: window.__shared || null };
				})()`;
				const icon = () => ev(ICON);
				const SENTINEL = 'verify-section-link-sentinel';
				const seed = () => ev(`navigator.clipboard.writeText('${SENTINEL}')`);
				const clip = () => ev(`navigator.clipboard.readText()`);
				/** At the card's right end, level with the heading. */
				const placed = (i) => i.link && i.card && i.heading && i.card.r - i.link.r <= 24 && i.link.r < i.card.r && Math.abs(i.link.cy - i.heading.cy) <= 3;
				if (!vp.mobile) {
					const mouse = (type, x, y) =>
						send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, s);
					const away = () => mouse('mouseMoved', 2, vp.height - 2);
					await away();
					await sleep(300);
					let i = await icon();
					check(i.found && i.opacity === '0' && i.pe === 'none' && i.href === want, `${tag} ${name} icon: at rest not drawn and untouchable; its href ${i.href}`);
					await mouse('mouseMoved', i.heading.l + 8, i.heading.cy);
					await sleep(300);
					i = await icon();
					check(i.opacity === '1' && i.pe === 'auto' && placed(i), `${tag} ${name} icon: hovering the heading draws it at the card's right end, level with the heading (${JSON.stringify(i.link)})`);
					await seed();
					await mouse('mouseMoved', i.link.cx, i.link.cy);
					await mouse('mousePressed', i.link.cx, i.link.cy);
					await mouse('mouseReleased', i.link.cx, i.link.cy);
					await sleep(300);
					check((await clip()) === want, `${tag} ${name} icon: a click copies ${await clip()}`);
					// off the icon and off the heading, so :hover cannot be what draws it
					await away();
					await sleep(300);
					i = await icon();
					check(i.path === `${path}?verify=1` && i.copied && i.opacity === '1', `${tag} ${name} icon: not followed (${i.path}), and the tick stays drawn after the pointer leaves (opacity ${i.opacity})`);
					await sleep(2300);
					i = await icon();
					check(!i.copied && i.opacity === '0', `${tag} ${name} icon: the tick goes after two seconds (opacity ${i.opacity})`);
				} else {
					// The share menu, stood in for: it records what it is given and whether the tap's user
					// activation was still live, and ends as window.__shareEnds says.
					await ev(`(() => {
						window.__shared = [];
						window.__shareEnds = 'shared';
						Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
							window.__shared.push({ url: d.url, keys: Object.keys(d).join(','), active: navigator.userActivation ? navigator.userActivation.isActive : null });
							if (window.__shareEnds === 'closed') return Promise.reject(new DOMException('closed', 'AbortError'));
							if (window.__shareEnds === 'refused') return Promise.reject(new DOMException('refused', 'NotAllowedError'));
							return Promise.resolve();
						} });
					})()`);
					await sleep(400);
					let i = await icon();
					check(i.found && i.opacity === '1' && i.pe === 'auto' && placed(i), `${tag} ${name} icon: drawn on ${name}, its heading on screen (opacity ${i.opacity})`);
					check(i.link && i.link.w >= 44 && i.link.h >= 44, `${tag} ${name} icon: a finger-sized target (${i.link && i.link.w} x ${i.link && i.link.h} px)`);
					const tap = async () => {
						const at = await icon();
						await send('Input.synthesizeTapGesture', { x: at.link.cx, y: at.link.cy, duration: 50, tapCount: 1, gestureSourceType: 'touch' }, s);
						await sleep(500);
					};
					await seed();
					await tap();
					i = await icon();
					check(
						JSON.stringify(i.shared) === JSON.stringify([{ url: want, keys: 'url', active: true }]),
						`${tag} ${name} icon: a tap opens the share menu with the address alone, inside the tap ${JSON.stringify(i.shared)}`
					);
					check(i.path === `${path}?verify=1` && (await clip()) === SENTINEL, `${tag} ${name} icon: the tap is not followed (${i.path}) and copies nothing`);
					// the reader closes the menu: nothing more - and the next tap shares again
					await ev(`window.__shareEnds = 'closed'`);
					await sleep(1100); // past the second-tap guard
					await tap();
					await sleep(1100);
					await tap();
					i = await icon();
					check(i.shared.length === 3 && (await clip()) === SENTINEL && !i.copied, `${tag} ${name} icon: a closed menu does nothing, and the next tap opens it again (${i.shared.length} shares)`);
					// a share the browser refuses: copied instead
					await ev(`window.__shareEnds = 'refused'`);
					await sleep(1100);
					await tap();
					i = await icon();
					check(i.shared.length === 4 && (await clip()) === want, `${tag} ${name} icon: a refused share copies the address instead (${await clip()})`);
					await sleep(2300); // the copy's tick keeps it drawn for two seconds, wherever the heading is
					await ev(`window.scrollBy(0, 400)`);
					await sleep(500);
					i = await icon();
					check(i.opacity === '0' && i.pe === 'none', `${tag} ${name} icon: gone, and untouchable, once its heading has scrolled away (opacity ${i.opacity}, pointer-events ${i.pe})`);
				}
				// The icon is a link that is never followed, so nothing may preload it: a preload runs
				// the page's server load and logs a visit to the section that never happened.
				const preloads = events
					.slice(iconFrom)
					.filter((e) => e.sessionId === s && e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('__data.json'))
					.map((e) => e.params.request.url);
				check(preloads.length === 0, `${tag} ${name} icon: no data request while it is hovered, clicked or tapped${preloads.length ? ': ' + preloads.join(' ') : ''}`);
			}

			await finish();
		}
		for (const [path, n] of strict) check(n > 0, `${path}: at least one landing exactly under the nav, not at the scroll end (${n} of ${VIEWPORTS.length})`);
	} catch (e) {
		bad(`browser: ${e.message}`);
	} finally {
		try {
			ws?.close();
		} catch {}
		await stopChrome(chrome, PROFILE);
	}
}

try {
	await wire();
	if (NO_BROWSER) console.log('browser: skipped (--no-browser)');
	else await browserChecks();
} catch (err) {
	bad(`run: ${err.message}`);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
exitProcess(failures ? 1 : 0);
