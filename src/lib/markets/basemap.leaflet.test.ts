import type { Map as LeafletMap } from 'leaflet';
import type { StyleSpecification } from 'maplibre-gl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { attachBasemap, type BasemapStatus } from './basemap';

/**
 * attachBasemap's failure path against the REAL Leaflet, maplibre-gl-leaflet bridge and
 * MapLibre GL, not stand-ins. jsdom has no WebGL at all, so MapLibre's constructor throws
 * (a GPUInitializationError) inside the bridge's onAdd - the half-added state the clean-up
 * exists for. If a bridge or MapLibre upgrade changes what onAdd registers before that
 * constructor, or what onRemove assumes, this notices. It cannot reach a failure AFTER the
 * constructor (jsdom always fails inside it): that path is basemap.test.ts's, with a fake.
 * The first test is the control: the same failure WITHOUT attachBasemap's clean-up, which
 * must break the map, or the second proves nothing.
 *
 * (The success path needs a real GPU; scripts/verify-markets-map.mjs drives it in Chrome.)
 */
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] } as StyleSpecification;

let L: typeof import('leaflet');
let maplibreGL: typeof import('@maplibre/maplibre-gl-leaflet').maplibreGL;

beforeAll(async () => {
	L = (await import('leaflet')).default;
	({ maplibreGL } = await import('@maplibre/maplibre-gl-leaflet'));
});

function newMap(): LeafletMap {
	const el = document.createElement('div');
	document.body.append(el);
	return L.map(el, { center: [24, 4], zoom: 2, zoomAnimation: false });
}

// What a user's pan and zoom, and the page's teardown, put the map through.
function exercise(map: LeafletMap) {
	map.fire('zoomstart');
	map.fire('move');
	map.fire('zoom');
	map.fire('zoomend');
	map.fire('resize');
}

describe('a MapLibre that will not start, with the real bridge', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	});

	it('control: without the clean-up, the half-added layer breaks every pan and the teardown', () => {
		const map = newMap();
		expect(() => maplibreGL({ style: EMPTY_STYLE }).addTo(map)).toThrow(/WebGL2/);
		expect(document.querySelector('.leaflet-gl-layer')).not.toBeNull();
		expect(() => exercise(map)).toThrow();
		expect(() => map.remove()).toThrow();
	});

	it('attachBasemap reports failed and leaves a map that pans and tears down cleanly', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const map = newMap();
		const statuses: BasemapStatus[] = [];
		await attachBasemap(map, (style) => maplibreGL({ style }), {
			onStatus: (s) => statuses.push(s),
			isAlive: () => true,
			webgl2: () => true, // let it try: jsdom's real answer would be "unavailable"
			loadStyle: async () => EMPTY_STYLE
		});
		expect(statuses).toEqual(['loading', 'failed']);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][1])).toMatch(/WebGL2/); // MapLibre's own failure, nothing else
		expect(document.querySelector('.leaflet-gl-layer')).toBeNull();
		expect(() => exercise(map)).not.toThrow();
		expect(() => map.remove()).not.toThrow();
	});

	it('in a browser with no WebGL2 (jsdom is one), tries nothing and adds nothing', async () => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
		const map = newMap();
		const statuses: BasemapStatus[] = [];
		await attachBasemap(map, (style) => maplibreGL({ style }), {
			onStatus: (s) => statuses.push(s),
			isAlive: () => true
		});
		expect(statuses).toEqual(['unavailable']);
		expect(document.querySelector('.leaflet-gl-layer')).toBeNull();
		expect(() => map.remove()).not.toThrow();
	});
});
