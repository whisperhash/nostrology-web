import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BasemapStatus } from './basemap';
import { mountBubbleMap, type MountHooks } from './bubble-map';
import type { BubbleSpec, MapPoint } from './bubbles';
import type * as MapLibs from './map-libs';

/**
 * mountBubbleMap, with a stand-in for the map chunk that records what it is asked to draw
 * (jsdom can draw neither Leaflet's canvas nor WebGL). basemap.ts runs for real, with the
 * browser's WebGL2 and the style fetch stubbed where a test needs them. What the bubbles
 * look like is bubbles.test.ts; the real libraries' failure path is basemap.leaflet.test.ts;
 * the component's wiring is BubbleMap.test.ts.
 */
function fakeChunk() {
	const state = {
		maps: [] as Array<{ el: unknown; options: unknown; fitBounds: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>,
		markers: [] as Array<{ latlng: unknown; options: unknown; popup?: string }>,
		layers: [] as Array<{ style: unknown; markersBefore: number; fireIdle: () => void }>
	};
	const L = {
		map: vi.fn((el: unknown, options: unknown) => {
			const m = { el, options, fitBounds: vi.fn(), remove: vi.fn(), removeLayer: vi.fn() };
			state.maps.push(m);
			return m;
		}),
		circleMarker: vi.fn((latlng: unknown, options: unknown) => {
			const rec: { latlng: unknown; options: unknown; popup?: string } = { latlng, options };
			state.markers.push(rec);
			const marker = { addTo: () => marker, bindPopup: (html: string) => ((rec.popup = html), marker) };
			return marker;
		}),
		latLngBounds: vi.fn((points: unknown) => ({ bounds: points }))
	};
	const maplibreGL = vi.fn(({ style }: { style: unknown }) => {
		const once: Record<string, () => void> = {};
		const layer = {
			addTo: () => layer,
			onRemove: () => layer,
			getContainer: () => undefined,
			getMaplibreMap: () => ({ once: (type: string, fn: () => void) => (once[type] = fn), on: () => {} })
		};
		state.layers.push({ style, markersBefore: state.markers.length, fireIdle: () => once.idle?.() });
		return layer;
	});
	return { state, L, maplibreGL, libs: { L, maplibreGL } as unknown as typeof MapLibs };
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
	return { promise, resolve, reject };
}

function hooks(libs: typeof MapLibs, over: Partial<MountHooks> = {}) {
	let alive = true;
	const statuses: BasemapStatus[] = [];
	const maps: unknown[] = [];
	const h: MountHooks = {
		loadLibs: async () => libs,
		isAlive: () => alive,
		onMap: (m) => maps.push(m),
		onStatus: (s) => statuses.push(s),
		...over
	};
	return { h, statuses, maps, kill: () => (alive = false) };
}

const GEOGRAPHY: BubbleSpec = { weight: 'listings', weightLabel: 'listings', secondary: 'sellers', secondaryLabel: 'sellers', color: '#a78bfa' };
const SHIPPING: BubbleSpec = { weight: 'sellers', weightLabel: 'sellers ship here', secondary: 'options', secondaryLabel: 'shipping options', color: '#34d399' };
const POINTS: MapPoint[] = [
	{ lat: 39.5, lon: -98.35, name: 'United States', prec: 'country', listings: 400, sellers: 136 },
	{ lat: 38.72, lon: -9.14, name: 'Lisbon', prec: 'city', listings: 4, sellers: 1 },
	{ lat: 0, lon: 0, name: 'Nowhere', prec: 'country', listings: 0, sellers: 0 }
];
const STYLE = { version: 8, sources: {}, layers: [] };

// A browser that can give MapLibre WebGL2, and an OpenFreeMap that answers with `answer`.
function withWebGL2(answer: () => Promise<Response> = async () => new Response(JSON.stringify(STYLE))) {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		getExtension: () => ({ loseContext: () => {} })
	} as unknown as RenderingContext);
	vi.stubGlobal('fetch', vi.fn(answer));
}

describe('mountBubbleMap', () => {
	const el = document.createElement('div');
	// jsdom has no canvas contexts, i.e. no WebGL2; tests that need it say so.
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('builds the map in the box it is given and hands it over before drawing anything', async () => {
		const chunk = fakeChunk();
		let markersWhenHandedOver = -1;
		const { h, maps } = hooks(chunk.libs, { onMap: (m) => (maps.push(m), (markersWhenHandedOver = chunk.state.markers.length)) });
		await mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		expect(chunk.state.maps).toHaveLength(1);
		expect(chunk.state.maps[0].el).toBe(el);
		expect(chunk.state.maps[0].options).toEqual({ center: [24, 4], zoom: 2, minZoom: 0, maxZoom: 10, worldCopyJump: true, scrollWheelZoom: false });
		expect(maps).toEqual([chunk.state.maps[0]]);
		expect(markersWhenHandedOver).toBe(0);
	});

	it('draws one bubble per point that has a weight, with its popup', async () => {
		const chunk = fakeChunk();
		await mountBubbleMap(el, POINTS, GEOGRAPHY, hooks(chunk.libs).h);
		expect(chunk.state.markers.map((m) => m.latlng)).toEqual([[39.5, -98.35], [38.72, -9.14]]);
		expect(chunk.state.markers[1].options).toMatchObject({ color: '#fbbf24', fillColor: '#a78bfa' });
		expect(chunk.state.markers[0].popup).toBe('<b>United States</b><br>400 listings<br>136 sellers');
	});

	it('draws the shipping map from its own weight, labels and colour', async () => {
		const chunk = fakeChunk();
		await mountBubbleMap(el, [{ lat: 53.2, lon: -7.4, name: 'Ireland', sellers: 38, options: 234 }], SHIPPING, hooks(chunk.libs).h);
		expect(chunk.state.markers[0].options).toMatchObject({ color: '#34d399', fillColor: '#34d399' });
		expect(chunk.state.markers[0].popup).toBe('<b>Ireland</b><br>38 sellers ship here<br>234 shipping options');
	});

	it('frames the bubbles it drew, and only those; frames nothing when nothing was drawn', async () => {
		const chunk = fakeChunk();
		await mountBubbleMap(el, POINTS, GEOGRAPHY, hooks(chunk.libs).h);
		expect(chunk.state.maps[0].fitBounds).toHaveBeenCalledWith({ bounds: [[39.5, -98.35], [38.72, -9.14]] }, { padding: [24, 24], maxZoom: 5 });
		const empty = fakeChunk();
		await mountBubbleMap(el, [POINTS[2]], GEOGRAPHY, hooks(empty.libs).h);
		expect(empty.state.maps[0].fitBounds).not.toHaveBeenCalled();
	});

	it('puts the OpenFreeMap basemap under the bubbles, after them, and reports ready once it is drawn', async () => {
		withWebGL2();
		const chunk = fakeChunk();
		const { h, statuses } = hooks(chunk.libs);
		await mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		expect(fetch).toHaveBeenCalledWith('https://tiles.openfreemap.org/styles/dark', expect.anything());
		expect(chunk.state.layers.map((l) => l.style)).toEqual([STYLE]);
		expect(chunk.state.layers[0].markersBefore).toBe(2); // the bubbles were already there
		expect(statuses).toEqual(['loading']);
		chunk.state.layers[0].fireIdle();
		expect(statuses).toEqual(['loading', 'ready']);
	});

	it('without WebGL2: reports unavailable, tries no basemap, and still draws the bubbles', async () => {
		const chunk = fakeChunk();
		const { h, statuses } = hooks(chunk.libs);
		await mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		expect(statuses).toEqual(['unavailable']);
		expect(chunk.maplibreGL).not.toHaveBeenCalled();
		expect(chunk.state.markers).toHaveLength(2);
	});

	it('builds nothing when the component is gone by the time the chunk arrives', async () => {
		const chunk = fakeChunk();
		const arrival = deferred<typeof MapLibs>();
		const { h, statuses, maps, kill } = hooks(chunk.libs, { loadLibs: () => arrival.promise });
		const mounting = mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		kill();
		arrival.resolve(chunk.libs);
		await mounting;
		expect(chunk.L.map).not.toHaveBeenCalled();
		expect(maps).toEqual([]);
		expect(statuses).toEqual([]);
	});

	it('adds no basemap when the component is gone by the time the style arrives', async () => {
		const style = deferred<Response>();
		withWebGL2(() => style.promise);
		const chunk = fakeChunk();
		const { h, statuses, kill } = hooks(chunk.libs);
		const mounting = mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		kill();
		style.resolve(new Response(JSON.stringify(STYLE)));
		await mounting;
		expect(chunk.maplibreGL).not.toHaveBeenCalled();
		expect(statuses).toEqual(['loading']);
	});

	it('when the chunk does not load: logs it and reports failed, with no map at all', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { h, statuses, maps } = hooks(fakeChunk().libs, {
			loadLibs: async () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
		});
		await expect(mountBubbleMap(el, POINTS, GEOGRAPHY, h)).resolves.toBeUndefined();
		expect(statuses).toEqual(['failed']);
		expect(maps).toEqual([]);
		expect(logged).toHaveBeenCalledWith('map: could not load the map libraries', expect.any(TypeError));
	});

	it('reports nothing to a component that is gone when the chunk fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const arrival = deferred<typeof MapLibs>();
		const { h, statuses, kill } = hooks(fakeChunk().libs, { loadLibs: () => arrival.promise });
		const mounting = mountBubbleMap(el, POINTS, GEOGRAPHY, h);
		kill();
		arrival.reject(new TypeError('Failed to fetch dynamically imported module'));
		await mounting;
		expect(statuses).toEqual([]);
	});
});
