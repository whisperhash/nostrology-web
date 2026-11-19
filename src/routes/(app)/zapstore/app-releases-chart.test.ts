// /zapstore's App Releases chart as a reader first sees it: every bar and every 30-day line on,
// New Nostr-native - 30d avg among them, which started hidden until the operator asked for it on
// 2026-11-11. A fake Chart records what DailyBarChart hands Chart.js and answers visibility as
// Chart.js does: the dataset's own `hidden` until its key is clicked. A key's state is read both
// ways the page gives it, aria-pressed and the strike-through. What the server renders, before
// any of this runs, is in app-releases-chart.ssr.test.ts.
import { fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { stubCanvasContext } from '$lib/charts/real-chart.test-helper';
import { APP_RELEASES_KEY, OVERVIEW } from './fixture';

type Dataset = { label: string; hidden?: boolean };
type Fake = { data: { datasets: Dataset[] }; isDatasetVisible: (i: number) => boolean };
const charts: Fake[] = [];

vi.mock('chart.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('chart.js')>();
	class FakeChart {
		static register() {}
		data: { datasets: Dataset[] };
		shown = new Map<number, boolean>();
		constructor(_ctx: unknown, cfg: { data: { datasets: Dataset[] } }) {
			this.data = cfg.data;
			charts.push(this);
		}
		isDatasetVisible(i: number) {
			return this.shown.get(i) ?? !this.data.datasets[i].hidden;
		}
		hide(i: number) {
			this.shown.set(i, false);
		}
		show(i: number) {
			this.shown.set(i, true);
		}
		destroy() {}
	}
	return { ...real, Chart: FakeChart };
});
// SocialMeta reads $page, and the page's domainPage() registers with the router: a page rendered
// on its own has neither, so both are stood in for, as in the other page tests.
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('https://site.test/zapstore') }) };
});
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn(),
	afterNavigate: vi.fn(),
	goto: vi.fn(() => Promise.resolve())
}));

import ZapstoreOverview from './(shell)/+page.svelte';

beforeAll(stubCanvasContext);
afterEach(() => {
	charts.length = 0;
});

const LINE = 'New Nostr-native - 30d avg';
const renderPage = () => render(ZapstoreOverview as Component<any>, { props: { data: OVERVIEW } });
/** The App Releases chart: the only one with a New Nostr-native line. */
function appReleases() {
	const found = charts.filter((c) => c.data.datasets.some((d) => d.label === LINE));
	expect(found).toHaveLength(1);
	return found[0];
}
/** Its key, the HTML legend under the chart's own title: each entry and its state. */
function key(container: HTMLElement) {
	const title = [...container.querySelectorAll('h3')].find((h) => h.textContent?.trim() === 'App Releases');
	return [...(title?.parentElement?.querySelectorAll('button') ?? [])].map((b) => ({
		button: b,
		label: b.textContent?.trim(),
		pressed: b.getAttribute('aria-pressed'),
		struck: b.className.includes('line-through')
	}));
}
/** The entries not shown on, each with its state. */
const off = (container: HTMLElement) =>
	key(container)
		.filter((k) => k.pressed !== 'true' || k.struck)
		.map(({ label, pressed, struck }) => ({ label, pressed, struck }));

describe('/zapstore App Releases', () => {
	it('starts with every bar and every 30-day line on, New Nostr-native - 30d avg among them', () => {
		const { container } = renderPage();
		const chart = appReleases();
		expect(chart.data.datasets.map((d) => d.label).sort()).toEqual([...APP_RELEASES_KEY].sort());
		expect(chart.data.datasets.filter((_, i) => !chart.isDatasetVisible(i)).map((d) => d.label)).toEqual([]);
		expect(key(container).map((k) => k.label)).toEqual(APP_RELEASES_KEY);
		expect(off(container)).toEqual([]);
	});

	it('turns the New Nostr-native line off from its key, and on again', async () => {
		const { container } = renderPage();
		const chart = appReleases();
		const line = chart.data.datasets.findIndex((d) => d.label === LINE);
		const button = key(container).find((k) => k.label === LINE)!.button;
		await fireEvent.click(button);
		expect(chart.isDatasetVisible(line)).toBe(false);
		expect(off(container)).toEqual([{ label: LINE, pressed: 'false', struck: true }]);
		await fireEvent.click(button);
		expect(chart.isDatasetVisible(line)).toBe(true);
		expect(off(container)).toEqual([]);
	});
});
