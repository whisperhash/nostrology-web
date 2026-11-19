// @vitest-environment node
//
// The Zapstore pages link to URLs that publishers wrote into their events: each app's website
// and repository, on /zapstore/apps and on the app's own page, and each release's page there.
// Anyone can publish those events, so every one of these URLs leaves the function that reads it
// through sanitizeExternalUrl: an http(s) address in the form the URL parser gives it, or null,
// which the page renders as no link at all. Until nostrology-web#22 (/zapstore/apps renders
// publisher-supplied URLs into href unsanitized) was fixed, only the app page's Website and Repo
// links went through it.
//
// The sanitizer's own cases are in $lib/utils/externalUrl.test.ts; this pins its call sites,
// with the driver mocked, so it runs everywhere. What the two pages render from such rows is
// src/routes/(app)/zapstore/apps/external-links.ssr.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every statement, so the spy is hoisted with them.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('pg', () => ({
	default: {
		Pool: class {
			query = query;
			on() {}
		}
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { getZapstoreAllApps, getZapstoreAppDetail, getZapstoreAppReleases } from './postgres';

const PK = 'a'.repeat(64);
const D_TAG = 'com.example.app';

// What a publisher can put in these tags, none of which may reach an href: script schemes in
// the spellings a browser still runs, a protocol-relative URL, a host spoofed with credentials,
// and the two kinds of junk observed in the catalog's repository column.
const HOSTILE = [
	'javascript:alert(document.domain)',
	'JavaScript:alert(1)',
	'  javascript:alert(1)',
	'java\nscript:alert(1)',
	'data:text/html,<script>alert(1)</script>',
	'vbscript:msgbox(1)',
	'//evil.example/x',
	'https://github.com@evil.example/',
	'nostr:naddr1qqxnzd3cxqmrzv3exgmr2wfeqgs',
	'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgs'
];

// A block body: vitest calls a function that beforeEach returns as the test's cleanup, and
// mockReset() returns the mock, which would then run once more, with no arguments.
beforeEach(() => {
	query.mockReset();
});

function listRow(app_url: string | null, repo_url: string | null) {
	return {
		app_pubkey: PK,
		app_d_tag: D_TAG,
		app_name: 'Example',
		publisher_pubkey: PK,
		publisher_name: null,
		summary: null,
		icon_url: null,
		app_url,
		repo_url,
		first_release_at: '1767225600',
		first_release_is_release_event: true,
		is_zapstore_republished: false
	};
}

function releaseRow(url: string | null, repo_url: string | null) {
	return {
		event_id: 'e'.repeat(64),
		created_at: '1767225600',
		version: '1.0.0',
		d_tag: `${D_TAG}@1.0.0`,
		channel: 'main',
		url,
		repo_url,
		commit_sha: null,
		content: ''
	};
}

describe('getZapstoreAllApps (/zapstore/apps): the URL and Repo links', () => {
	it.each(HOSTILE)('drops %j from both', async (bad) => {
		query.mockResolvedValueOnce({ rows: [listRow(bad, bad)] });
		const [row] = await getZapstoreAllApps();
		expect(row.app_url).toBeNull();
		expect(row.repo_url).toBeNull();
	});

	it('keeps an http(s) link as the parsed URL, and gives a bare host its https://', async () => {
		query.mockResolvedValueOnce({
			rows: [
				listRow('btcmap.org', 'https://github.com/teambtcmap/btcmap-android'),
				listRow('http://example.org/app', null)
			]
		});
		const rows = await getZapstoreAllApps();
		expect(rows.map((r) => [r.app_url, r.repo_url])).toEqual([
			['https://btcmap.org/', 'https://github.com/teambtcmap/btcmap-android'],
			['http://example.org/app', null]
		]);
	});
});

describe("getZapstoreAppReleases (the app page): each release's link", () => {
	it.each(HOSTILE)('drops %j from both of its fields', async (bad) => {
		query.mockResolvedValueOnce({ rows: [releaseRow(bad, bad)] });
		const [release] = await getZapstoreAppReleases(PK, D_TAG);
		expect(release.url).toBeNull();
		expect(release.repo_url).toBeNull();
	});

	// The page links `repo_url ?? url`, so with no repo_url the url is what reaches the href.
	it('drops a hostile url when there is no repo_url to link instead', async () => {
		query.mockResolvedValueOnce({ rows: [releaseRow('javascript:alert(1)', null)] });
		const [release] = await getZapstoreAppReleases(PK, D_TAG);
		expect(release.repo_url ?? release.url).toBeNull();
	});

	it('falls back to a good url when the repo_url is dropped', async () => {
		query.mockResolvedValueOnce({ rows: [releaseRow('https://example.org/releases/1.0.0', 'vbscript:msgbox(1)')] });
		const [release] = await getZapstoreAppReleases(PK, D_TAG);
		expect(release.repo_url).toBeNull();
		expect(release.repo_url ?? release.url).toBe('https://example.org/releases/1.0.0');
	});

	it('keeps a good repo_url, as the parsed URL', async () => {
		query.mockResolvedValueOnce({
			rows: [releaseRow(null, 'HTTPS://GitHub.com/example/app/releases/tag/v1.0.0')]
		});
		const [release] = await getZapstoreAppReleases(PK, D_TAG);
		expect(release.repo_url).toBe('https://github.com/example/app/releases/tag/v1.0.0');
		expect(release.url).toBeNull();
	});
});

describe('getZapstoreAppDetail (the app page): the Website and Repo links', () => {
	// Three queries: the catalog row carries the two links, and the zaps series and the
	// profile answer empty, which the page renders as an app with no zaps.
	function catalogWith(url: string | null, repository: string | null) {
		query.mockImplementation(async (sql: string) =>
			sql.includes('events_kind_32267_app_catalog')
				? { rows: [{ name: 'Example', icon: null, summary: null, content: null, url, repository }] }
				: { rows: [] }
		);
	}

	it.each(HOSTILE)('drops %j from both', async (bad) => {
		catalogWith(bad, bad);
		const app = await getZapstoreAppDetail(PK, D_TAG);
		expect(app).not.toBeNull();
		expect(app!.website_url).toBeNull();
		expect(app!.repository_url).toBeNull();
	});

	it('keeps an http(s) link as the parsed URL, and gives a bare host its https://', async () => {
		catalogWith('www.cgeo.org', 'https://github.com/cgeo/cgeo');
		const app = await getZapstoreAppDetail(PK, D_TAG);
		expect([app!.website_url, app!.repository_url]).toEqual(['https://www.cgeo.org/', 'https://github.com/cgeo/cgeo']);
	});
});
