import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { n } from '$lib/ngit/format';
import HBar from './HBar.svelte';

/**
 * How HBar writes its counts. By default in the viewer's locale, as /marketplaces and
 * /routstr always have; a page whose other numbers are all en-US passes its own formatter,
 * or a German reader sees "2.837" in the bars beside "4,304" on the cards of the same page
 * (/git, web review 4). The viewer's locale is simulated as de-DE.
 */
describe('HBar number format', () => {
	beforeEach(() => {
		const original = Number.prototype.toLocaleString;
		vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
			this: number,
			locales?: Intl.LocalesArgument,
			options?: Intl.NumberFormatOptions
		) {
			return original.call(this, locales ?? 'de-DE', options);
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const ROWS = [{ label: 'relay.ngit.dev', value: 2837, sub: 1200 }];

	it('writes counts, sub-counts and the hover title with the formatter the page passes', () => {
		const { container } = render(HBar, {
			props: { rows: ROWS, subLabel: 'users', valueLabel: 'repositories', format: n }
		});
		expect(container.textContent).toContain('2,837');
		expect(container.textContent).toContain('1,200');
		expect(container.textContent).not.toContain('2.837');
		expect(container.querySelector('[title$=" repositories"]')?.getAttribute('title')).toBe('2,837 repositories');
	});

	it("keeps the viewer's locale when no formatter is passed", () => {
		const { container } = render(HBar, { props: { rows: ROWS, subLabel: 'users', valueLabel: 'repositories' } });
		expect(container.textContent).toContain('2.837');
		expect(container.querySelector('[title$=" repositories"]')?.getAttribute('title')).toBe('2.837 repositories');
	});
});

/**
 * The share column. Only rows that split one whole carry it (the /git Servers per list
 * buckets, whose counts sum to every list publisher); a top-N cut must not, because its
 * shares of anything it can see would mislead. Default: no share at all.
 */
describe('HBar share of a total', () => {
	const BUCKETS = [
		{ label: '1', value: 4 },
		{ label: '2', value: 35 },
		{ label: '3', value: 24 },
		{ label: '4+', value: 18 }
	];
	const shares = (c: Element) => [...c.querySelectorAll('[data-share]')].map((e) => e.textContent?.trim());

	it('shows each row as a share of the total, in the hover title too', () => {
		const { container } = render(HBar, {
			props: { rows: BUCKETS, subLabel: '', valueLabel: 'users', format: n, total: 81 }
		});
		expect(shares(container)).toEqual(['5%', '43%', '30%', '22%']);
		expect(container.querySelector('[title^="35 "]')?.getAttribute('title')).toBe('35 users (43%)');
	});

	it('writes the share with the formatter the page passes', () => {
		const { container } = render(HBar, {
			props: { rows: BUCKETS, subLabel: '', valueLabel: 'users', total: 81, formatShare: (s: number) => `${(s * 100).toFixed(1)} pc` }
		});
		expect(shares(container)).toEqual(['4.9 pc', '43.2 pc', '29.6 pc', '22.2 pc']);
	});

	it('shows no share without a total, or with a total of 0', () => {
		for (const total of [undefined, 0]) {
			const { container, unmount } = render(HBar, { props: { rows: BUCKETS, subLabel: '', valueLabel: 'users', total } });
			expect(container.querySelector('[data-share]')).toBeNull();
			expect(container.querySelector('[title^="35 "]')?.getAttribute('title')).toBe('35 users');
			unmount();
		}
	});
});

/**
 * fill: the rows spread over the height the parent gives them, so a list in a card that a
 * grid row stretches beside a taller card ends on the same line (/git Clone hosts beside the
 * GRASP servers table). Off by default, so /marketplaces and /routstr keep their spacing.
 */
describe('HBar fill', () => {
	const ROWS = [
		{ label: 'a', value: 2 },
		{ label: 'b', value: 1 }
	];
	const root = (c: Element) => c.firstElementChild as HTMLElement;

	it('stacks the rows with fixed spacing by default', () => {
		const { container } = render(HBar, { props: { rows: ROWS, subLabel: '' } });
		expect(root(container).hasAttribute('data-fill')).toBe(false);
		expect(root(container).className).toContain('space-y-2');
		expect(root(container).className).not.toContain('justify-between');
	});

	it('spreads the rows, first at the top and last at the bottom, as a growing flex column', () => {
		const { container } = render(HBar, { props: { rows: ROWS, subLabel: '', fill: true } });
		expect(root(container).hasAttribute('data-fill')).toBe(true);
		for (const c of ['flex', 'flex-1', 'flex-col', 'justify-between', 'gap-2']) {
			expect(root(container).classList.contains(c), c).toBe(true);
		}
		// spacing comes from the gap alone: margins from space-y would add to it
		expect(root(container).className).not.toContain('space-y');
		expect(root(container).children.length).toBe(2);
	});
});

/**
 * Per-row colour and category: a list whose rows fall in categories (/git Clone hosts, by kind
 * of host) paints each bar its category's colour, and names the category in words for whoever
 * cannot see the colour: a screen reader reads it after the label, and the hover title on the
 * bar's whole track ends with it (a short bar is a few pixels wide). Rows without them keep the
 * list's one colour and say nothing more, so /marketplaces and /routstr are unchanged.
 */
describe('HBar per-row colour and category', () => {
	const ROWS = [
		{ label: 'relay.ngit.dev', value: 30, color: '#a78bfa', category: 'GRASP server' },
		{ label: 'github.com', value: 20, color: '#60a5fa', category: 'Forge' },
		{ label: 'plain.example', value: 10 }
	];
	const fills = (c: Element) => [...c.querySelectorAll('[data-bar]')] as HTMLElement[];

	it('paints each bar its own colour, and the list colour where a row has none', () => {
		const { container } = render(HBar, {
			props: { rows: ROWS, subLabel: '', valueLabel: 'repositories', color: '#d1d5db', format: n }
		});
		expect(fills(container).map((b) => b.style.backgroundColor)).toEqual([
			'rgb(167, 139, 250)',
			'rgb(96, 165, 250)',
			'rgb(209, 213, 219)'
		]);
	});

	it('puts the hover title on the whole track, ending with the category, so a short bar is no small target', () => {
		const { container } = render(HBar, {
			props: { rows: ROWS, subLabel: '', valueLabel: 'repositories', format: n }
		});
		const tracks = fills(container).map((f) => f.parentElement!);
		expect(tracks.map((t) => t.getAttribute('title'))).toEqual([
			'30 repositories - GRASP server',
			'20 repositories - Forge',
			'10 repositories'
		]);
		// the fill itself carries no title of its own, which would shadow the track's over the bar
		expect(fills(container).every((f) => !f.hasAttribute('title'))).toBe(true);
		// one titled element per row besides the label
		expect(container.querySelectorAll('div[title]').length).toBe(3);
	});

	it('names the category for a screen reader, after the label, and leaves the label itself alone', () => {
		const { container } = render(HBar, {
			props: { rows: ROWS, subLabel: '', valueLabel: 'repositories' }
		});
		const rows = [...(container.firstElementChild as HTMLElement).children];
		const hidden = rows.map((r) => r.querySelector('[data-category]'));
		expect(hidden.map((h) => h?.textContent ?? null)).toEqual(['GRASP server', 'Forge', null]);
		expect(hidden[0]?.classList.contains('sr-only')).toBe(true);
		// read between the name and the count
		expect(hidden[0]?.previousElementSibling?.getAttribute('title')).toBe('relay.ngit.dev');
		expect(hidden[0]?.nextElementSibling?.textContent).toContain('30');
		// the visible label and its hover title are the name alone
		expect([...container.querySelectorAll('span[title]')].map((s) => [s.getAttribute('title'), s.textContent?.trim()])).toEqual([
			['relay.ngit.dev', 'relay.ngit.dev'],
			['github.com', 'github.com'],
			['plain.example', 'plain.example']
		]);
	});

	it("shows a row's labelTitle as its label's hover title, where the label is a short form", () => {
		// /git's Clone hosts: a hashtree host reads htree:// and a short npub, the whole npub on hover
		const rows = [
			{ label: 'htree://npub1hwam...04hu', labelTitle: 'htree://npub1hwamhwam', value: 30, category: 'hashtree' },
			{ label: 'relay.ngit.dev', value: 20, category: 'GRASP' }
		];
		const { container } = render(HBar, { props: { rows, subLabel: '', valueLabel: 'repositories', format: n } });
		expect([...container.querySelectorAll('span[title]')].map((s) => [s.getAttribute('title'), s.textContent?.trim()])).toEqual([
			['htree://npub1hwamhwam', 'htree://npub1hwam...04hu'],
			['relay.ngit.dev', 'relay.ngit.dev']
		]);
		// the track's hover title is unchanged by it
		expect(container.querySelector('div[title]')?.getAttribute('title')).toBe('30 repositories - hashtree');
	});
});
