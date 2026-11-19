// The board component in jsdom: what it renders from a board (the real 2026-10-15 one, then
// a board with nothing loaded), and the tabs. jsdom has no layout, so the end labels'
// placement and the hover's geometry are left to the browser checks
// (scripts/verify-landing-board.mjs); here, the markup and its contract.

import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildBoard } from '$lib/landing/board';
import LandingBoard from './LandingBoard.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = buildBoard(
	JSON.parse(
		gunzipSync(readFileSync(resolve(HERE, '../../landing/fixtures/board-inputs-2026-10-15.json.gz'))).toString('utf8')
	)
).board;
const EMPTY = buildBoard({}).board;

const panels = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
const tabs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'));
const visible = (c: HTMLElement) => panels(c).filter((p) => !p.hidden).map((p) => p.dataset.key);

describe('the board, from data', () => {
	it('renders every surface, with only the one open on load showing', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		expect(panels(container).map((p) => p.dataset.key)).toEqual(['zapstore', 'marketplaces', 'git', 'lightning', 'nutzaps']);
		// all five charts are in the markup, for readers and crawlers that never click
		expect(container.querySelectorAll('.hc[role="img"]')).toHaveLength(5);
		expect(visible(container)).toEqual(['marketplaces']);
	});

	it('names every tab by its surface, its figure and what that counts', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		// textContent stands in for the accessible name: the spaces between the parts are in
		// the markup, so a screen reader does not read "Zapstore4,773apps".
		expect(tabs(container).map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
			'Zapstore 4,773 apps',
			'Marketplaces 7,848 live listings',
			'Git-on-Nostr New 4,873 repositories',
			'Lightning 2,250 providers',
			'Nutzaps 33 mints'
		]);
	});

	it('keeps one tab in the Tab order, the open one, so Tab leaves the tab list', async () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const order = () => tabs(container).map((t) => t.getAttribute('tabindex'));
		expect(order()).toEqual(['-1', '0', '-1', '-1', '-1']);
		await fireEvent.click(container.querySelector<HTMLElement>('#bt-git')!);
		expect(order()).toEqual(['-1', '-1', '0', '-1', '-1']);
	});

	it('ties every tab to its panel, both ways', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		for (const t of tabs(container)) {
			const panel = container.querySelector(`#${t.getAttribute('aria-controls')}`)!;
			expect(panel.getAttribute('role')).toBe('tabpanel');
			expect(panel.getAttribute('aria-labelledby')).toBe(t.id);
		}
	});

	it('switches the chart when a tab is chosen, by click or by arrow key', async () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const git = container.querySelector<HTMLElement>('#bt-git')!;
		await fireEvent.click(git);
		expect(visible(container)).toEqual(['git']);
		expect(git.getAttribute('aria-selected')).toBe('true');
		expect(tabs(container).filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
		await fireEvent.keyDown(git, { key: 'ArrowRight' });
		expect(visible(container)).toEqual(['lightning']);
		await fireEvent.keyDown(container.querySelector('#bt-lightning')!, { key: 'End' });
		expect(visible(container)).toEqual(['nutzaps']);
		await fireEvent.keyDown(container.querySelector('#bt-nutzaps')!, { key: 'ArrowRight' });
		expect(visible(container)).toEqual(['zapstore']);
	});

	it('moves along the tabs as the tabs pattern does: wrapping, Home and End, focus following', async () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const tab = (key: string) => container.querySelector<HTMLElement>(`#bt-${key}`)!;
		tab('zapstore').focus();
		// fireEvent answers false when the handler prevented the key's default (scrolling the page)
		expect(await fireEvent.keyDown(tab('zapstore'), { key: 'ArrowLeft' })).toBe(false);
		expect(visible(container)).toEqual(['nutzaps']);
		expect(document.activeElement).toBe(tab('nutzaps'));
		await fireEvent.keyDown(tab('nutzaps'), { key: 'Home' });
		expect(visible(container)).toEqual(['zapstore']);
		expect(document.activeElement).toBe(tab('zapstore'));
		await fireEvent.keyDown(tab('zapstore'), { key: 'ArrowLeft' });
		await fireEvent.keyDown(tab('nutzaps'), { key: 'ArrowLeft' });
		expect(visible(container)).toEqual(['lightning']);
		expect(document.activeElement).toBe(tab('lightning'));
		// any other key is left to the browser
		expect(await fireEvent.keyDown(tab('lightning'), { key: 'a' })).toBe(true);
		expect(visible(container)).toEqual(['lightning']);
	});

	it('puts the figure, the change and the way in on each panel', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const band = (key: string) => container.querySelector(`[data-key="${key}"] .band`)!.textContent!.replace(/\s+/g, ' ').trim();
		expect(band('zapstore')).toBe('Zapstore 4,773 apps listed on Zapstore 123% in 12 months Explore Zapstore\u2192');
		expect(band('git')).toBe('Git-on-Nostr 4,873 git repositories on Nostr 13% in 30 days Explore Git-on-Nostr\u2192');
		expect(band('lightning')).toBe('Lightning 2,250 lightning-address providers Explore Lightning\u2192');
		expect(Array.from(container.querySelectorAll('.cta')).map((a) => a.getAttribute('href'))).toEqual([
			'/zapstore',
			'/marketplaces',
			'/git',
			'/lightning',
			'/nutzaps'
		]);
	});

	it('counts up only the figure on the tab open on load', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const nums = Array.from(container.querySelectorAll<HTMLElement>('.num'));
		expect(nums).toHaveLength(1);
		expect([nums[0].textContent, nums[0].dataset.to]).toEqual(['7,848', '7848']);
	});

	it("names the lines' last values where a chart has several, and only there", () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const names = (key: string) => Array.from(container.querySelectorAll(`[data-key="${key}"] .hend em`)).map((e) => e.textContent);
		expect(names('zapstore')).toEqual(['All apps', 'Republished', 'Nostr-native']);
		expect(names('marketplaces')).toEqual([]);
		expect(container.querySelector('[data-key="marketplaces"] .hend')!.textContent).toBe('7,848');
	});

	it('says what each chart counts, and keys the lines where there are several', () => {
		const { container } = render(LandingBoard, { props: { board: REAL } });
		const cap = (key: string) => container.querySelector(`[data-key="${key}"] .board-cap`)!.textContent!.replace(/\s+/g, ' ').trim();
		expect(cap('marketplaces')).toBe('Live listings, by the day each was listed');
		expect(cap('zapstore')).toBe("Apps listed, counted from each app's first release All apps Republished from GitHub / F-Droid Nostr-native");
		// a key per line where there are several; a one-line chart has its colour by the caption
		const keys = (key: string) => container.querySelectorAll(`[data-key="${key}"] .board-cap .ck`).length;
		const chip = (key: string) => container.querySelector<HTMLElement>(`[data-key="${key}"] .board-cap .ck1`);
		expect([keys('zapstore'), keys('marketplaces'), keys('lightning')]).toEqual([3, 0, 5]);
		expect(chip('zapstore')).toBeNull();
		// (jsdom writes the colour back as rgb(), so compare through an element of its own)
		const one = document.createElement('i');
		one.style.background = REAL.panels.find((p) => p.key === 'marketplaces')!.chart!.series[0].color;
		expect(chip('marketplaces')!.style.background).toBe(one.style.background);
		expect(container.querySelector('[data-key="git"] .hc')!.getAttribute('aria-label')).toBe(
			'Git-on-Nostr: Repositories, by the day each was first seen, last 12 months'
		);
	});
});

describe('the board without data', () => {
	it('shows the typed figures, and a note of the chart\'s height where each chart would be', () => {
		const { container } = render(LandingBoard, { props: { board: EMPTY } });
		expect(container.querySelectorAll('.hc[role="img"]')).toHaveLength(0);
		expect(container.querySelectorAll('.hc-none')).toHaveLength(5);
		expect(container.querySelector('[data-key="marketplaces"] .hc-none')!.textContent).toContain('Chart unavailable right now');
		expect(container.querySelector('[data-key="marketplaces"] .bo-n')!.textContent).toBe('7,832');
		// no change without a chart to take it from
		expect(container.querySelectorAll('.pill')).toHaveLength(0);
	});
});
