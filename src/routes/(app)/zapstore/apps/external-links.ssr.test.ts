// @vitest-environment node
//
// /zapstore/apps and an app's own page as the server renders them, from rows that hold what any
// publisher can write: every string column but the two pubkeys, which hold a valid key, carries a
// script URL naming its column, and the link columns carry the other vectors too. No href in the page may be anything but a path of this
// site or an absolute web address. The rows go through the pages' own loads and the real readers
// in $lib/db/postgres (the driver mocked), so this fails when a reader stops sanitizing a field,
// when a load stops going through the readers, and when a template links a field that no reader
// sanitizes. Good links ride in the same rows, so a page that rendered no link at all fails too.
// The readers' own cases are in src/lib/db/zapstore-links.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
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
// SocialMeta reads $page; a page rendered on its own has no router, so the store is supplied
// here, as in the other page tests.
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('https://site.test/zapstore/apps') }) };
});

import { load as loadApps } from './+page.server';
import AppsPage from './+page.svelte';
import { load as loadApp } from './[pubkey=hex64]/[d_tag]/+page.server';
import AppPage from './[pubkey=hex64]/[d_tag]/+page.svelte';

const PK = 'a'.repeat(64);
const D_TAG = 'com.example.app';

/** A script URL that names the column it was put in, so a failure says which one leaked. */
const hostile = (column: string) => `javascript:alert(1)//${column}`;

/** Every href in the markup, as the browser reads the attribute. */
function hrefs(html: string): string[] {
	const entities: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
	return [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1].replace(/&(amp|quot|#39|lt|gt);/g, (e) => entities[e]));
}

// A path of this site, a fragment, or an absolute web address with a host. Anything else is a
// script scheme, a link to another host by `//` or `/\`, or junk the browser would resolve as a
// path of ours.
const SAFE = /^(\/(?![/\\])|#|https?:\/\/[^/\\\s])/i;
// Any of the hostile values, anywhere in an href. A path of ours carries one only encoded.
const HOSTILE_IN_HREF = /javascript:|vbscript:|data:|evil\.example|naddr1|nostr:/i;

function render_(page: unknown, data: unknown) {
	const { head, body } = render(page as Component<any>, { props: { data } });
	return { body, links: hrefs(head + body) };
}

// A block body: vitest calls a function that beforeEach returns as the test's cleanup, and
// mockReset() returns the mock, which would then run once more, with no arguments.
beforeEach(() => {
	query.mockReset();
});

describe('/zapstore/apps on the server', () => {
	function listRow(n: number, app_url: string, repo_url: string) {
		return {
			app_pubkey: PK,
			app_d_tag: `${hostile('app_d_tag')}-${n}`,
			app_name: hostile('app_name'),
			publisher_pubkey: PK,
			publisher_name: hostile('publisher_name'),
			summary: hostile('summary'),
			icon_url: hostile('icon_url'),
			app_url,
			repo_url,
			first_release_at: '1767225600',
			first_release_is_release_event: true,
			is_zapstore_republished: false
		};
	}

	it('links no hostile URL from any column, and still links the good ones', async () => {
		query.mockResolvedValueOnce({
			rows: [
				listRow(1, hostile('app_url'), 'data:text/html,<script>alert(1)</script>'),
				listRow(2, '//evil.example/x', 'nostr:naddr1qqxnzd3cxqmrzv3exgmr2wfeqgs'),
				listRow(3, 'btcmap.org', 'https://github.com/teambtcmap/btcmap-android')
			]
		});
		const data = await loadApps({} as never);
		expect(query).toHaveBeenCalledTimes(1);
		const { links } = render_(AppsPage, data);

		expect(links.filter((href) => !SAFE.test(href))).toEqual([]);
		expect(links.filter((href) => HOSTILE_IN_HREF.test(href))).toEqual([]);
		// The good row keeps both links, the bare host with the https:// it was missing.
		expect(links).toContain('https://btcmap.org/');
		expect(links).toContain('https://github.com/teambtcmap/btcmap-android');
		// All three rows are listed, each linking its own app page with its d_tag encoded.
		expect(links.filter((href) => href.startsWith(`/zapstore/apps/${PK}/javascript%3Aalert`))).toHaveLength(3);
	});
});

describe("an app's page on the server", () => {
	function releaseRow(n: number, created_at: number, url: string | null, repo_url: string | null) {
		return {
			event_id: `${hostile('event_id')}-${n}`,
			created_at: String(created_at),
			version: hostile('version'),
			d_tag: hostile('d_tag'),
			channel: hostile('channel'),
			url,
			repo_url,
			commit_sha: hostile('commit_sha'),
			content: hostile('content')
		};
	}

	it('links no hostile URL from any column, and still links the good ones', async () => {
		query.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM events_kind_32267_app_catalog')) {
				return {
					rows: [
						{
							name: hostile('name'),
							icon: hostile('icon'),
							summary: hostile('summary'),
							content: hostile('content'),
							url: hostile('url'),
							repository: 'https://github.com/example/app'
						}
					]
				};
			}
			if (sql.includes('FROM events_kind_30063_app_releases')) {
				return {
					rows: [
						releaseRow(3, 1767225600, null, 'https://github.com/example/app/releases/tag/v3.0.0'),
						releaseRow(2, 1764547200, 'https://example.org/releases/2.0.0', 'vbscript:msgbox(1)'),
						// The page links `repo_url ?? url`: with no repo_url, this url is what it would link.
						releaseRow(1, 1761955200, hostile('release url'), null)
					]
				};
			}
			if (sql.includes('FROM events_kind_0_profiles')) {
				return {
					rows: [
						{
							name: hostile('profile name'),
							display_name: hostile('display_name'),
							picture: hostile('picture'),
							nip05: hostile('nip05')
						}
					]
				};
			}
			if (sql.includes('FROM events_kind_30267_app_stacks')) return { rows: [{ stack_count: '2' }] };
			if (sql.includes('FROM events_kind_9735_zaps_zapstore')) return { rows: [] };
			// A query this test does not know about is a new reader: give it hostile rows here.
			throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
		});
		const data = await loadApp({ params: { pubkey: PK, d_tag: D_TAG } } as never);
		const { body, links } = render_(AppPage, data);

		expect(links.filter((href) => !SAFE.test(href))).toEqual([]);
		expect(links.filter((href) => HOSTILE_IN_HREF.test(href))).toEqual([]);
		// The Repo link stays and the Website link goes; every release is listed, and the two
		// with a good URL link it.
		expect(links).toContain('https://github.com/example/app');
		expect(body).not.toContain('Website');
		expect(links).toContain('https://github.com/example/app/releases/tag/v3.0.0');
		expect(links).toContain('https://example.org/releases/2.0.0');
		expect(body.match(/Release page/g)).toHaveLength(2);
		const releases = body.slice(body.indexOf('>Releases</h2>'));
		expect(releases.slice(0, releases.indexOf('</ul>')).match(/<li\b/g)).toHaveLength(3);
	});
});
