import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import LeaderboardTable from './LeaderboardTable.svelte';

/**
 * jsdom does not run the CSS table-layout algorithm, so these assert the class
 * contract rather than measured widths. The widths were verified separately in
 * headless Chrome at a 390x844 viewport against dev.
 *
 * The load-bearing invariant: the first data column carries BOTH a width cap
 * (`max-w-0`, which is what makes the ellipsis work inside an auto-layout table
 * by setting the column's preferred width to zero) AND a floor (`min-w-`). With
 * only the cap, a phone — where no leftover width exists to absorb — collapsed
 * the column to 89 px, narrower than the `#` column next to it.
 */
const HEADERS = ['Relay', 'Users', 'Read & Write'];
const ROWS = [
	[{ label: 'relay.momostr.pink', href: '/relays/relay.momostr.pink', barFraction: 1 }, '297,737', '297,475'],
	[{ label: 'nos.lol', href: '/relays/nos.lol', barFraction: 0.5 }, '148,000', '147,900']
];

function firstDataCell(container: HTMLElement): HTMLElement {
	// children[0] is the auto-generated "#" index column.
	return container.querySelector('tbody tr')!.children[1] as HTMLElement;
}

describe('LeaderboardTable first column sizing', () => {
	it('caps AND floors the first data column', () => {
		const { container } = render(LeaderboardTable, { headers: HEADERS, rows: ROWS });
		const cell = firstDataCell(container);
		expect(cell.className).toContain('max-w-0');
		expect(cell.className).toContain('truncate');
		expect(cell.className).toMatch(/min-w-\[\d+rem\]/);
	});

	it('floors the first header cell to match its column', () => {
		const { container } = render(LeaderboardTable, { headers: HEADERS, rows: ROWS });
		const th = container.querySelectorAll('thead th')[1] as HTMLElement;
		expect(th.className).toMatch(/min-w-\[\d+rem\]/);
	});

	it('keeps numeric columns shrink-to-content and right-aligned', () => {
		const { container } = render(LeaderboardTable, { headers: HEADERS, rows: ROWS });
		const cells = [...container.querySelector('tbody tr')!.children] as HTMLElement[];
		for (const cell of cells.slice(2)) {
			expect(cell.className).toContain('w-px');
			expect(cell.className).toContain('whitespace-nowrap');
			expect(cell.className).toContain('text-right');
		}
	});
});

describe('LeaderboardTable responsive padding', () => {
	// px-6 costs ~48 px of padding per cell; across /relays' 8 columns that
	// exceeds an entire phone viewport, which is what starved the first column.
	it('halves horizontal cell padding below the lg breakpoint', () => {
		const { container } = render(LeaderboardTable, { headers: HEADERS, rows: ROWS });
		const cells = [...container.querySelector('tbody tr')!.children] as HTMLElement[];
		for (const cell of cells) {
			const cls = cell.className;
			const hasResponsiveX = /(^|\s)px-3(\s|$)/.test(cls) && cls.includes('lg:px-6');
			const hasResponsiveR = /(^|\s)pr-3(\s|$)/.test(cls) && cls.includes('lg:pr-6');
			expect(hasResponsiveX || hasResponsiveR, `cell classes: ${cls}`).toBe(true);
		}
	});

	// Every horizontal padding a cell declares must exist on BOTH sides of the
	// breakpoint, so no cell can keep a desktop-sized gutter on a phone. Stated
	// per-side rather than per-value: `pl-6 lg:pl-12` is a legitimate pair (6 is
	// the mobile half of 12), whereas a lone `pl-6` is the regression.
	it('pairs every horizontal padding utility with an lg: variant', () => {
		const { container } = render(LeaderboardTable, {
			headers: HEADERS,
			rows: ROWS,
			groupBoundary: 1
		});
		const cells = [
			...container.querySelectorAll('thead th'),
			...container.querySelectorAll('tbody td')
		] as HTMLElement[];
		for (const cell of cells) {
			const base = new Set<string>();
			const responsive = new Set<string>();
			for (const cls of cell.className.split(/\s+/)) {
				const baseMatch = /^p([xlr])-\S+$/.exec(cls);
				if (baseMatch) base.add(baseMatch[1]);
				const lgMatch = /^lg:p([xlr])-\S+$/.exec(cls);
				if (lgMatch) responsive.add(lgMatch[1]);
			}
			expect(base.size, `no horizontal padding at all on: ${cell.className}`).toBeGreaterThan(0);
			for (const side of base) {
				expect(
					responsive.has(side),
					`p${side}- has no lg: counterpart on: ${cell.className}`
				).toBe(true);
			}
		}
	});

	it('scales the group-boundary indent across the breakpoint', () => {
		const { container } = render(LeaderboardTable, {
			headers: HEADERS,
			rows: ROWS,
			groupBoundary: 1
		});
		const cell = container.querySelector('tbody tr')!.children[2] as HTMLElement;
		expect(cell.className).toContain('pl-6');
		expect(cell.className).toContain('lg:pl-12');
	});
});
