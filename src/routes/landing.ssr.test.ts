// @vitest-environment node
//
// The landing page as the SERVER renders it (svelte/server, the "ssr" project in
// vitest.workspace.ts): what every crawler, link-preview fetcher and reader without script
// receives. The jsdom tests (landing.test.ts) render the client build; this is the other half,
// with the real board of 2026-10-15 (the fixture board.test.ts reads).
//
// It pins what must be in the served HTML before any script runs: all five panels and their
// drawn charts (four of them hidden, Marketplaces open), the figures, the end labels the static
// rule shows, the tabs' state, the headline, and nothing broken in the markup (no
// "undefined", no "NaN"). It also checks the render logs no error.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { render } from 'svelte/server';
import { readable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoard } from '$lib/landing/board';
import { chartGeometry } from '$lib/landing/heroChart';

vi.mock('$app/stores', () => ({ page: readable({ url: new URL('https://site.test/') }) }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_MCP_ENDPOINT: '' } }));

import Page from './+page.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = buildBoard(
	JSON.parse(gunzipSync(readFileSync(resolve(HERE, '../lib/landing/fixtures/board-inputs-2026-10-15.json.gz'))).toString('utf8'))
).board;

const errors = vi.spyOn(console, 'error');
afterEach(() => errors.mockClear());

function serverRender() {
	const { body, head } = render(Page, {
		props: { data: { session: null, analyticsOff: false, endpoint: 'https://site.test/mcp', origin: 'https://site.test', board: BOARD } }
	});
	return { body, head };
}

/** The opening tag of the element with this id. */
const tagOf = (body: string, id: string) => body.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

const KEYS = ['zapstore', 'marketplaces', 'git', 'lightning', 'nutzaps'];
/** One panel's markup: from its opening tag to the next panel's, the last to the roster. */
function panelOf(body: string, key: string): string {
	const from = body.indexOf(`id="bp-${key}"`);
	const ends = [...KEYS.map((k) => body.indexOf(`id="bp-${k}"`)), body.indexOf('class="roster-more')].filter((i) => i > from);
	return body.slice(from, Math.min(...ends));
}
/** The points of each line (class "hl") in a panel's markup, in the chart's 1000 x 1000 box. */
const linePoints = (html: string) =>
	[...html.matchAll(/<path class="hl[^"]*" d="([^"]*)"/g)].map((m) => [...m[1].matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((p) => [+p[1], +p[2]]));

describe('the landing, rendered on the server', () => {
	it('carries all five panels, Marketplaces open and the others hidden', () => {
		const { body } = serverRender();
		for (const key of ['zapstore', 'marketplaces', 'git', 'lightning', 'nutzaps']) {
			const tag = tagOf(body, `bp-${key}`);
			expect(tag).toContain('role="tabpanel"');
			expect(tag).toContain('data-live="true"');
			expect(/\bhidden\b/.test(tag)).toBe(key !== 'marketplaces');
			expect(tagOf(body, `bt-${key}`)).toContain(`aria-selected="${key === 'marketplaces'}"`);
		}
	});

	it('draws every chart in the HTML: lines, fills, the months and the end values', () => {
		const { body } = serverRender();
		expect(body.match(/<svg viewBox="0 0 1000 1000"/g)).toHaveLength(5);
		// one line per series: Zapstore 3, Marketplaces 1, Git-on-Nostr 2 (faded before the wall
		// and after), Lightning 5, Nutzaps 1
		expect(body.match(/class="hl[ "]/g)).toHaveLength(12);
		expect(body).toContain('observation began');
		// (the server render marks each block with a comment, so a tick reads >Oct<!--[!--><!--]-->)
		expect(body).toMatch(/>Oct</);
		// the static rule's end labels: Marketplaces' last value, unhidden (its name's block, empty
		// for a single line, leaves the same markers before the value)
		expect(body).toMatch(/<span class="hend[^"]*"[^>]*>(<!--[^>]*-->)*7,848<\/span>/);
		// the quarters carry their class (a phone keeps only them), and the first month its year
		expect(body).toMatch(/<span [^>]*class="[^"]*\bq\b[^"]*"[^>]*>Oct</);
		expect(body).toMatch(/<span [^>]*>Nov</);
		expect(body).not.toMatch(/<span [^>]*class="[^"]*\bq\b[^"]*"[^>]*>Nov</);
		expect(body).toMatch(/<small[^>]*>2025<\/small>/);
		// Git-on-Nostr's line before observation began is drawn faded
		expect(panelOf(body, 'git')).toMatch(/<path class="hl[^"]*\bfaded\b/);
	});

	it('hides, before any script, exactly the end labels the static rule hides', () => {
		const { body } = serverRender();
		let hidden = 0;
		for (const p of BOARD.panels) {
			const html = panelOf(body, p.key);
			const want = chartGeometry(p.chart!, { h: 250, clear: { x: 0.67, y: 0.45 } }).ends.map((e) => !e.shown);
			const got = [...html.matchAll(/<span class="hend[^>]*>/g)].map((m) => /\shidden(=""|\s|>)/.test(m[0]));
			expect(got, p.key).toEqual(want);
			hidden += want.filter(Boolean).length;
		}
		// the real board crowds some labels (Lightning's five shares), so the rule is exercised
		expect(hidden).toBeGreaterThan(0);
	});

	it('fills each line from a gradient the page defines, once', () => {
		const { body } = serverRender();
		const used = [...body.matchAll(/fill="url\(#([^)]+)\)"/g)].map((m) => m[1]);
		const defined = [...body.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
		expect(used.length).toBeGreaterThan(0);
		expect(new Set(defined).size).toBe(defined.length);
		for (const id of used) expect(defined).toContain(id);
	});

	it('keeps every line under the figure band across its reach, on every panel', () => {
		// the band covers the first 67% of the chart's width and the top 45% of its height
		// (LandingBoard's CLEAR); in the 1000 x 1000 box, no point left of 670 is above 450
		const { body } = serverRender();
		for (const key of KEYS) {
			const lines = linePoints(panelOf(body, key));
			expect(lines.length, key).toBeGreaterThan(0);
			const over = lines.flat().filter(([x, y]) => x <= 670 && y < 449.99);
			expect(over, key).toEqual([]);
		}
	});

	it('prints the figures and the changes', () => {
		const { body } = serverRender();
		expect(body).toContain('>4,773</span>');
		expect(body).toContain('>7,848</span>');
		expect(body).toContain('>4,873</span>');
		expect(body).toMatch(/123%<\/span>\s*in 12 months/);
		expect(body).toMatch(/13%<\/span>\s*in 30 days/);
	});

	it('leaves nothing unfilled in the markup', () => {
		const { body, head } = serverRender();
		expect(body).not.toMatch(/undefined|NaN|\[object Object\]/);
		expect(head).toContain('<title>Nostrology - Nostr growth, in numbers</title>');
		expect(body).toContain('Nostr growth, <em');
		expect(errors).not.toHaveBeenCalled();
	});
});
