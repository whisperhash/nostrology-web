import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountBubbleMap } from '$lib/markets/bubble-map';
import BubbleMap from './BubbleMap.svelte';

/**
 * BubbleMap's wiring: on mount it hands mountBubbleMap its box, its points and its options,
 * a loader that imports the map chunk, and its own liveness; it mirrors the basemap status
 * onto the box and removes the map when it is destroyed. What mountBubbleMap does with all
 * that is bubble-map.test.ts. The page test drives both together for the two real maps.
 */
vi.mock('$lib/markets/bubble-map', () => ({ mountBubbleMap: vi.fn(async () => {}) }));
vi.mock('$lib/markets/map-libs', () => ({ chunk: 'the map chunk' }));

const POINTS = [{ lat: 39.5, lon: -98.35, name: 'United States', prec: 'country', listings: 400, sellers: 136 }];
const lastCall = () => vi.mocked(mountBubbleMap).mock.calls.at(-1)!;
const box = (container: HTMLElement) => container.querySelector<HTMLElement>('.markets-map')!;

describe('BubbleMap', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(mountBubbleMap).mockClear();
	});

	it('mounts the map once, in its own box, with its points and the Geography defaults', () => {
		const { container } = render(BubbleMap, { props: { points: POINTS } });
		expect(mountBubbleMap).toHaveBeenCalledTimes(1);
		const [el, points, spec] = lastCall();
		expect(el).toBe(box(container));
		expect(points).toBe(POINTS);
		expect(spec).toEqual({ weight: 'listings', weightLabel: 'listings', secondary: 'sellers', secondaryLabel: 'sellers', color: '#a78bfa' });
	});

	it('passes the Shipping map its own weight, labels and colour', () => {
		render(BubbleMap, {
			props: { points: POINTS, weight: 'sellers', weightLabel: 'sellers ship here', secondary: 'options', secondaryLabel: 'shipping options', color: '#34d399' }
		});
		expect(lastCall()[2]).toEqual({ weight: 'sellers', weightLabel: 'sellers ship here', secondary: 'options', secondaryLabel: 'shipping options', color: '#34d399' });
	});

	it('hands over a loader that imports the map chunk', async () => {
		render(BubbleMap, { props: { points: POINTS } });
		const { loadLibs } = lastCall()[3];
		expect(await loadLibs()).toMatchObject({ chunk: 'the map chunk' });
	});

	it('is alive until it is unmounted', () => {
		const { unmount } = render(BubbleMap, { props: { points: POINTS } });
		const { isAlive } = lastCall()[3];
		expect(isAlive()).toBe(true);
		unmount();
		expect(isAlive()).toBe(false);
	});

	it('mirrors each basemap status onto its box as data-basemap', async () => {
		const { container } = render(BubbleMap, { props: { points: POINTS } });
		const { onStatus } = lastCall()[3];
		expect(box(container).hasAttribute('data-basemap')).toBe(false);
		for (const status of ['loading', 'ready', 'unavailable', 'failed'] as const) {
			onStatus(status);
			await tick();
			expect(box(container).dataset.basemap).toBe(status);
		}
	});

	it('removes the map it was handed when unmounted, and survives a removal that throws', () => {
		const { unmount } = render(BubbleMap, { props: { points: POINTS } });
		const remove = vi.fn(() => {
			throw new Error('a layer could not tidy up');
		});
		lastCall()[3].onMap({ remove } as never);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(() => unmount()).not.toThrow();
		expect(remove).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('unmounts cleanly before any map exists', () => {
		const { unmount } = render(BubbleMap, { props: { points: POINTS } });
		expect(() => unmount()).not.toThrow();
	});
});
