import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import StackedBars from './StackedBars.svelte';

/**
 * StackedBars under jsdom: there is no 2D canvas context here, so Chart.js never draws
 * (onMount returns early, the pattern every chart test on this site relies on). What is
 * pinned is everything that is DOM and therefore reaches every reader: the canvas and its
 * accessible name, the legend (present from two series or with a line, absent for one bar
 * series alone), and the caption that names the capture wall and partial buckets.
 */
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TWO = [
	{ label: 'GRASP-hosted today', color: '#a78bfa', values: [1, 2, 3, 4, 5] },
	{ label: 'Other hosting', color: '#64748b', values: [10, 20, 30, 40, 50] }
];
const ONE = [{ label: 'Pushes', color: '#2dd4bf', values: [5, 6, 7, 8, 9] }];

describe('StackedBars', () => {
	it('renders a canvas inside a named plot', () => {
		const { container } = render(StackedBars, {
			props: { series: ONE, labels: MONTHS, yAxisLabel: 'pushes', ariaLabel: 'Pushes per month' }
		});
		expect(container.querySelector('canvas')).not.toBeNull();
		expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Pushes per month');
	});

	it('draws a legend for two or more series, in input order', () => {
		const { container } = render(StackedBars, { props: { series: TWO, labels: MONTHS, yAxisLabel: 'repositories' } });
		const items = [...container.querySelectorAll('[data-testid="chart-legend"] button')];
		expect(items.map((b) => b.textContent?.trim())).toEqual(['GRASP-hosted today', 'Other hosting']);
		expect(items.every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);
	});

	it('draws no legend for a single series (the title names it)', () => {
		const { container } = render(StackedBars, { props: { series: ONE, labels: MONTHS, yAxisLabel: 'pushes' } });
		expect(container.querySelector('[data-testid="chart-legend"]')).toBeNull();
	});

	it('toggles a series from its legend entry', async () => {
		const { container } = render(StackedBars, { props: { series: TWO, labels: MONTHS, yAxisLabel: 'repositories' } });
		const first = container.querySelector('[data-testid="chart-legend"] button')!;
		await fireEvent.click(first);
		expect(first.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(first);
		expect(first.getAttribute('aria-pressed')).toBe('true');
	});

	it('captions the capture wall and the partial bucket only when the series has them', () => {
		const { container } = render(StackedBars, {
			props: {
				series: TWO,
				labels: MONTHS,
				yAxisLabel: 'repositories',
				dimBefore: '2026-05',
				partialLabel: '2026-07',
				partialNote: 'partial month: data to Jul 24, 2026'
			}
		});
		const notes = [...container.querySelectorAll('[data-note]')].map((li) => [
			li.getAttribute('data-note'),
			li.textContent?.trim()
		]);
		expect(notes).toEqual([
			['wall', 'before observation began: only what relays still served'],
			['partial_last', 'partial month: data to Jul 24, 2026']
		]);

		// a series entirely after the wall with no partial bucket gets no caption at all
		const clean = render(StackedBars, {
			props: { series: TWO, labels: ['2026-05', '2026-06'], yAxisLabel: 'x', dimBefore: '2026-05' }
		});
		expect(clean.container.querySelector('[data-testid="bucket-notes"]')).toBeNull();
	});

	it('names a leading partial bucket with its own note (weekly series)', () => {
		const { container } = render(StackedBars, {
			props: {
				series: ONE,
				labels: ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'],
				bucket: 'week',
				yAxisLabel: 'pushes',
				partialFirstLabel: '2026-06-08',
				partialFirstNote: 'partial week: observation began Jun 14, 2026'
			}
		});
		expect(container.querySelector('[data-note="partial_first"]')?.textContent?.trim()).toBe(
			'partial week: observation began Jun 14, 2026'
		);
		expect(container.querySelector('[data-note="wall"]')).toBeNull();
	});

	it('keys both partial buckets once under one legend note', () => {
		const WEEKS = ['2026-06-08', '2026-06-15', '2026-06-22'];
		const props = {
			series: ONE.map((s) => ({ ...s, values: [90, 1300, 1400] })),
			labels: WEEKS,
			bucket: 'week' as const,
			yAxisLabel: 'pushes',
			partialFirstLabel: '2026-06-08',
			partialLabel: '2026-06-22',
			partialFirstNote: 'partial week: observation began Jun 14, 2026',
			partialNote: 'partial week: data to Jun 24, 2026',
			partialLegend: 'partial week'
		};
		const { container } = render(StackedBars, { props });
		const notes = [...container.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => [
			li.getAttribute('data-note'),
			li.textContent?.trim()
		]);
		expect(notes).toEqual([['partial', 'partial week']]);

		// one partial bucket only - the last, or the first, as on every Monday run, when the
		// trailing week is complete - is still the one key; none: no caption at all
		const keys = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => li.textContent?.trim());
		expect(keys(render(StackedBars, { props: { ...props, partialFirstLabel: null } }).container)).toEqual(['partial week']);
		expect(keys(render(StackedBars, { props: { ...props, partialLabel: null } }).container)).toEqual(['partial week']);
		const none = render(StackedBars, { props: { ...props, partialFirstLabel: null, partialLabel: null } });
		expect(none.container.querySelector('[data-testid="bucket-notes"]')).toBeNull();
	});

	it('keeps the wall key beside the merged partial key', () => {
		const { container } = render(StackedBars, {
			props: {
				series: ONE,
				labels: MONTHS,
				yAxisLabel: 'pushes',
				dimBefore: '2026-04',
				partialFirstLabel: '2026-04',
				partialLabel: '2026-07',
				partialLegend: 'partial month'
			}
		});
		const items = [...container.querySelectorAll('[data-testid="bucket-notes"] li')];
		expect(items.map((li) => [li.getAttribute('data-note'), li.textContent?.trim()])).toEqual([
			['wall', 'before observation began: only what relays still served'],
			['partial', 'partial month']
		]);
	});

	it('renders no table twin ("Show as a table" was removed on 2026-10-01)', () => {
		const { container } = render(StackedBars, {
			props: { series: TWO, labels: MONTHS, yAxisLabel: 'repositories', dimBefore: '2026-05' }
		});
		expect(container.querySelector('details')).toBeNull();
		expect(container.querySelector('table')).toBeNull();
		expect(container.textContent).not.toContain('Show as a table');
	});

	it('draws a line with a legend key of its own, toggled like a series', async () => {
		const { container } = render(StackedBars, {
			props: {
				series: [{ label: 'New users', color: '#a78bfa', values: [null, 1, 3, 2, 4] }],
				line: { label: 'Total', color: '#fbbf24', values: [null, 1, 4, 6, 10], axisLabel: 'total' },
				labels: MONTHS,
				yAxisLabel: 'new users'
			}
		});
		const keys = [...container.querySelectorAll('[data-testid="chart-legend"] button')];
		expect(keys.map((b) => b.textContent?.trim())).toEqual(['New users', 'Total']);
		expect(keys.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
		await fireEvent.click(keys[1]);
		expect(keys[1].getAttribute('aria-pressed')).toBe('false');
		expect(keys[0].getAttribute('aria-pressed')).toBe('true');
		// one bar series and no line: no legend at all
		const bare = render(StackedBars, { props: { series: ONE, labels: MONTHS, yAxisLabel: 'pushes' } });
		expect(bare.container.querySelector('[data-testid="chart-legend"]')).toBeNull();
	});

	it('keys each mark by its shape: a square for every bar series, a stroke for the line', () => {
		const { container } = render(StackedBars, {
			props: {
				series: TWO,
				line: { label: 'First-time maintainers', color: '#f7931a', values: [1, 1, 2, 0, 3], axisLabel: 'first-time maintainers' },
				labels: MONTHS,
				yAxisLabel: 'repositories'
			}
		});
		const keys = [...container.querySelectorAll('[data-testid="chart-legend"] button')].map((b) => [
			b.textContent?.trim(),
			b.querySelector('[data-swatch]')?.getAttribute('data-swatch')
		]);
		expect(keys).toEqual([
			['GRASP-hosted today', 'bar'],
			['Other hosting', 'bar'],
			['First-time maintainers', 'line']
		]);
		// the attribute names the branch; the classes are the shape - a 12px square, a 3px stroke
		const shape = (el: Element) => ['h-3', 'w-3', 'h-[3px]', 'w-5'].filter((c) => el.classList.contains(c));
		for (const bar of container.querySelectorAll('[data-swatch="bar"]')) expect(shape(bar)).toEqual(['h-3', 'w-3']);
		expect(shape(container.querySelector('[data-swatch="line"]')!)).toEqual(['h-[3px]', 'w-5']);
	});
});
