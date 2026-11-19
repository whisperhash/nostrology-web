import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import RelayRoleMixScatter from './RelayRoleMixScatter.svelte';

/**
 * jsdom has no canvas backend, so `getContext('2d')` returns null and the
 * component's onMount bails before touching Chart.js — which is exactly what
 * lets us assert the wrapper's sizing contract here. The rendered heights were
 * verified separately in headless Chrome against dev (mobile 324x150 -> 324x406,
 * desktop unchanged at 578x426).
 */
const RELAYS = [
	{ relay_url: 'wss://relay.momostr.pink', user_count: 297737, both_count: 297475, read_count: 297668, write_count: 297544 },
	{ relay_url: 'wss://nos.lol', user_count: 148000, both_count: 147900, read_count: 147950, write_count: 147920 }
];

function wrapper(container: HTMLElement): HTMLElement {
	return container.querySelector('div.flex.flex-col') as HTMLElement;
}

describe('RelayRoleMixScatter sizing', () => {
	// heightPx={null} means "fill the grid row". Below `lg` /relays' grid is a
	// single column, so there is no taller sibling to inherit a row height from
	// and h-full resolves against an auto-height parent — the canvas then fell
	// back to its 150 px intrinsic default.
	it('supplies a definite fallback height when told to fill its parent', () => {
		const { container } = render(RelayRoleMixScatter, { relays: RELAYS, heightPx: null });
		const cls = wrapper(container).className;
		expect(cls).toContain('h-full');
		expect(cls).toMatch(/min-h-\[\d+px\]/);
	});

	it('releases the fallback at lg, where the row-sharing resumes', () => {
		const { container } = render(RelayRoleMixScatter, { relays: RELAYS, heightPx: null });
		expect(wrapper(container).className).toContain('lg:min-h-0');
	});

	it('sets no inline height when filling its parent', () => {
		const { container } = render(RelayRoleMixScatter, { relays: RELAYS, heightPx: null });
		expect(wrapper(container).style.height).toBe('');
	});

	it('uses an explicit pixel height when given one, with no fallback floor', () => {
		const { container } = render(RelayRoleMixScatter, { relays: RELAYS, heightPx: 315 });
		const el = wrapper(container);
		expect(el.style.height).toBe('315px');
		expect(el.className).not.toContain('h-full');
		expect(el.className).not.toMatch(/min-h-\[/);
	});
});
