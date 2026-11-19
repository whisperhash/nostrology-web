// @vitest-environment node
//
// DailyBarChart as the server renders it, before any chart exists: every key on, in aria-pressed
// and in the strike-through alike, in each shape its callers draw. Bars alone are /routstr's
// provider and model stacks, bars with a rolling line each its revenue chart, and the lines with
// a Total /zapstore's App Releases (whose page has its own test, in
// src/routes/(app)/zapstore/app-releases-chart.ssr.test.ts). Until 2026-11-11 the server struck
// every key through, and the browser put them right once the chart had mounted.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import DailyBarChart from './DailyBarChart.svelte';

const series = [
	{ timestamp: 0, value: 1 },
	{ timestamp: 86_400, value: 2 }
];
const datasets = [
	{ label: 'a', color: '#111111', series },
	{ label: 'b', color: '#222222', series }
];

describe('DailyBarChart on the server', () => {
	it.each([
		['bars alone', {}, ['a', 'b']],
		['bars with a rolling line each', { rollingAverageWindow: 14 }, ['a', 'b', 'a - 14d avg', 'b - 14d avg']],
		[
			'bars, their lines and a Total',
			{ rollingAverageWindow: 30, totalLineColor: '#1abc9c' },
			['a', 'b', 'Total - 30d avg', 'a - 30d avg', 'b - 30d avg']
		]
	])('draws every key on: %s', (_, props, labels) => {
		const { body } = render(DailyBarChart, { props: { title: 't', yAxisLabel: 'y', datasets, ...props } });
		const keys = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({
			label: inner.replace(/<[^>]*>/g, '').trim(),
			pressed: /\saria-pressed="([^"]*)"/.exec(attributes)?.[1],
			struck: attributes.includes('line-through')
		}));
		expect(keys).toEqual(labels.map((label) => ({ label, pressed: 'true', struck: false })));
	});
});
