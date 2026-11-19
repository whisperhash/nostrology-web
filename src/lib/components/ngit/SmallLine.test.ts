import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import SmallLine from './SmallLine.svelte';

// Same jsdom contract as StackedBars.test.ts: the canvas, the legend rule and the captions.
const WEEKS = ['2026-06-08', '2026-06-15', '2026-06-22'];

describe('SmallLine', () => {
	it('renders a canvas and no legend for one series', () => {
		const { container } = render(SmallLine, {
			props: { series: [{ label: 'Repositories', color: '#a78bfa', values: [1, 2, 3] }], labels: WEEKS, bucket: 'week' }
		});
		expect(container.querySelector('canvas')).not.toBeNull();
		expect(container.querySelector('[data-testid="chart-legend"]')).toBeNull();
	});

	it('draws a legend from two series and captions both partial ends', () => {
		const { container } = render(SmallLine, {
			props: {
				series: [
					{ label: 'Repositories pushed', color: '#60a5fa', values: [1, 2, 3] },
					{ label: 'Maintainers pushing', color: '#fbbf24', values: [1, 1, 2] }
				],
				labels: WEEKS,
				bucket: 'week',
				partialFirstLabel: '2026-06-08',
				partialLabel: '2026-06-22'
			}
		});
		const legend = [...container.querySelectorAll('[data-testid="chart-legend"] li')].map((li) => li.textContent?.trim());
		expect(legend).toEqual(['Repositories pushed', 'Maintainers pushing']);
		expect([...container.querySelectorAll('[data-note]')].map((li) => li.getAttribute('data-note'))).toEqual([
			'partial_first',
			'partial_last'
		]);
	});

	it('keys both partial ends once under one legend note', () => {
		const { container } = render(SmallLine, {
			props: {
				series: [{ label: 'Repositories pushed', color: '#60a5fa', values: [1, 2, 3] }],
				labels: WEEKS,
				bucket: 'week',
				partialFirstLabel: '2026-06-08',
				partialLabel: '2026-06-22',
				partialLegend: 'partial week'
			}
		});
		expect([...container.querySelectorAll('[data-note]')].map((li) => [li.getAttribute('data-note'), li.textContent?.trim()])).toEqual([
			['partial', 'partial week']
		]);
	});

	it('draws a right-axis series beside the left one, with a legend key of its own, toggled like a series', async () => {
		const { container } = render(SmallLine, {
			props: {
				series: [{ label: 'Authors', color: '#fbbf24', values: [5, 6, 7] }],
				rightSeries: { label: 'Threads', color: '#34d399', values: [50, 60, 70], axisLabel: 'threads' },
				labels: WEEKS,
				bucket: 'week',
				yAxisLabel: 'authors',
				partialLabel: '2026-06-22',
				partialNote: 'partial week: data to Jun 24, 2026'
			}
		});
		const buttons = [...container.querySelectorAll('[data-testid="chart-legend"] button')];
		expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Authors', 'Threads']);
		await fireEvent.click(buttons[1]);
		expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
		expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
		// two lines: the caption's faded key is the neutral grey, not either line's colour
		const key = container.querySelector('[data-note="partial_last"] span') as HTMLElement;
		expect(key.style.backgroundColor).toBe('rgba(148, 163, 184, 0.35)');
		// both lines solid since 2026-10-08, the right-axis one too, and so are both swatches
		expect(container.querySelector('[data-dashed], .border-dashed')).toBeNull();
		expect(buttons.map((b) => (b.querySelector('span') as HTMLElement).style.backgroundColor)).toEqual([
			'rgb(251, 191, 36)',
			'rgb(52, 211, 153)'
		]);
	});

	it('fades the stretch before the wall on a daily series and says why', () => {
		const { container } = render(SmallLine, {
			props: {
				series: [{ label: 'Repositories', color: '#a78bfa', values: [1, 2, 3] }],
				labels: ['2026-05-01', '2026-05-02', '2026-05-03'],
				bucket: 'day',
				dimBefore: '2026-05-02'
			}
		});
		expect(container.querySelector('[data-note="wall"]')?.textContent?.trim()).toBe(
			'before observation began: only what relays still served'
		);
	});
});
