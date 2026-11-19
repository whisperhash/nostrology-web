// @vitest-environment node
//
// Unit tests for the /nutzaps/mints labels and per-mint links (nostrology-data#9).
// The property that matters: for every stored mint URL, the link's route resolves
// back to exactly that URL, so a listed mint's page never 404s on its own link.

import { describe, expect, it } from 'vitest';
import { mintHref, mintLabel, mintUrlFromRoute } from './mintUrl';

// Stored spellings seen on the live leaderboard (2026-09-18), plus an onion mint.
const STORED = [
	'https://mint.minibits.cash/Bitcoin',
	'https://mint.coinos.io',
	'https://8333.space:3338',
	'https://stpaulinternet.net/cashu/api/v1/TTcmiEDSWmkefef3XqERKv',
	'http://127.0.0.1:3338',
	'http://172.17.0.1:32769',
	'http://[::1]:3338',
	'http://lbutlh5lfggq5r7xpiwhrajdl7sxpupgagazxl65w4c5cg72wtofasad.onion:3338',
	// Shapes the loader keeps as written, which a naive link would cut or mangle.
	'https://mint.example.com/p?x=1',
	'http://mint.example.com/p?x=1',
	'https://mint.example.com#frag',
	'https://mint.example.com/a%2Fb',
	'https://mint.example.com/100%',
	'https://mint.example.com/a b'
];

// What SvelteKit hands the page: the rest param (the path after /nutzaps/mints/) and
// the query string. The browser resolves the href against the page; SvelteKit then percent-decodes the
// rest param (decodeURIComponent over the matched path).
function route(href: string): { path: string; scheme: string | null } {
	const u = new URL(href, 'https://nostrolo.gy/nutzaps/mints');
	// Still on the per-mint route: nothing in the stored URL escaped it.
	expect(u.origin + u.pathname.slice(0, 15)).toBe('https://nostrolo.gy/nutzaps/mints/');
	return {
		path: decodeURIComponent(u.pathname.replace(/^\/nutzaps\/mints\//, '')),
		scheme: u.searchParams.get('scheme')
	};
}

describe('mintHref / mintUrlFromRoute', () => {
	it.each(STORED)('the link for %s resolves back to it', (url) => {
		const { path, scheme } = route(mintHref(url));
		expect(mintUrlFromRoute(path, scheme)).toBe(url);
	});

	it('keeps https links clean and marks only http ones', () => {
		expect(mintHref('https://mint.minibits.cash/Bitcoin')).toBe('/nutzaps/mints/mint.minibits.cash/Bitcoin');
		expect(mintHref('http://mint.example.onion:3338')).toBe('/nutzaps/mints/mint.example.onion:3338?scheme=http');
	});

	it('treats anything but scheme=http as https, so old links keep working', () => {
		expect(mintUrlFromRoute('mint.coinos.io', null)).toBe('https://mint.coinos.io');
		expect(mintUrlFromRoute('mint.coinos.io', 'https')).toBe('https://mint.coinos.io');
		expect(mintUrlFromRoute('mint.coinos.io', 'javascript')).toBe('https://mint.coinos.io');
	});
});

describe('mintLabel', () => {
	it('keeps the port and the path, drops the scheme', () => {
		expect(mintLabel('https://8333.space:3338')).toBe('8333.space:3338');
		expect(mintLabel('http://127.0.0.1:3338')).toBe('127.0.0.1:3338');
		expect(mintLabel('https://mint.minibits.cash/Bitcoin')).toBe('mint.minibits.cash/Bitcoin');
		expect(mintLabel('https://mint.coinos.io')).toBe('mint.coinos.io');
	});

	it('tells apart mints that differ only by port', () => {
		const labels = new Set(['http://127.0.0.1:32787', 'http://127.0.0.1:32788', 'http://127.0.0.1:3338'].map(mintLabel));
		expect(labels.size).toBe(3);
	});

	it('falls back to the raw text for an unparseable URL', () => {
		expect(mintLabel('not a url')).toBe('not a url');
	});
});
