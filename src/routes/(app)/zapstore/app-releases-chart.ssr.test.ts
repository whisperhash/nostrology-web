// @vitest-environment node
//
// /zapstore as the server renders it: what a reader sees until the page's JavaScript runs, and
// all that a reader without it ever sees. App Releases' key shows every entry on, as the chart is
// then drawn (the operator asked for its New Nostr-native line on, 2026-11-11), in aria-pressed
// and in the strike-through alike. Until that day the server struck every entry through, and the
// browser put them right once the chart had mounted. What the chart itself starts with is in
// app-releases-chart.test.ts, and the component's other shapes in DailyBarChart.ssr.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import ZapstoreOverview from './(shell)/+page.svelte';
import { APP_RELEASES_KEY, OVERVIEW } from './fixture';

// SocialMeta reads $page; a page rendered on its own has no router, so the store is supplied
// here, as in the other page tests.
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('https://site.test/zapstore') }) };
});

describe('/zapstore on the server', () => {
	it('draws App Releases with every entry of its key on', () => {
		const { body } = render(ZapstoreOverview as Component<any>, { props: { data: OVERVIEW } });
		const from = body.indexOf('App Releases</h3>');
		expect(from).toBeGreaterThan(-1);
		const legend = body.slice(from, body.indexOf('<canvas', from));
		const keys = [...legend.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({
			label: inner.replace(/<[^>]*>/g, '').trim(),
			pressed: /\saria-pressed="([^"]*)"/.exec(attributes)?.[1],
			struck: attributes.includes('line-through')
		}));
		expect(keys).toEqual(APP_RELEASES_KEY.map((label) => ({ label, pressed: 'true', struck: false })));
	});
});
