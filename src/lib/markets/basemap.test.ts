import type { Map as LeafletMap, MaplibreGL } from 'leaflet';
import type { StyleSpecification } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	attachBasemap,
	BASEMAP_STYLE_URL,
	type BasemapStatus,
	ENGLISH_NAME,
	loadBasemapStyle,
	preferEnglishLabels,
	supportsWebGL2
} from './basemap';

// The label layers of OpenFreeMap's Dark style as served on 2026-10-13, one of each kind,
// plus a layer of every other shape the rewrite must leave alone.
const PLACE_LABEL = [
	'case',
	['has', 'name:nonlatin'],
	['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
	['coalesce', ['get', 'name_en'], ['get', 'name']]
];
const ROAD_LABEL = [
	'case',
	['has', 'name:nonlatin'],
	['concat', ['get', 'name:latin'], ' ', ['get', 'name:nonlatin']],
	['coalesce', ['get', 'name_en'], ['get', 'name']]
];
const STYLE = {
	version: 8,
	sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
	glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
		{ id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(27,27,29)' } },
		{ id: 'place_country_major', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': PLACE_LABEL, 'text-size': 14 } },
		{ id: 'highway_name_other', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': ROAD_LABEL } },
		{ id: 'highway_name_motorway', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
		{ id: 'poi_icon', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'icon-image': 'dot' } }
	]
} as unknown as StyleSpecification;

const layout = (style: StyleSpecification, id: string) =>
	(style.layers.find((l) => l.id === id) as { layout?: Record<string, unknown> }).layout;

describe('preferEnglishLabels', () => {
	it('rewrites the place and road name labels to the English name', () => {
		const out = preferEnglishLabels(STYLE);
		expect(layout(out, 'place_country_major')?.['text-field']).toEqual(ENGLISH_NAME);
		expect(layout(out, 'highway_name_other')?.['text-field']).toEqual(ENGLISH_NAME);
		// the rest of the layer's layout is kept
		expect(layout(out, 'place_country_major')?.['text-size']).toBe(14);
	});

	it('leaves every other layer as it was: shields, icons, fills, the background', () => {
		const out = preferEnglishLabels(STYLE);
		for (const id of ['background', 'water', 'highway_name_motorway', 'poi_icon']) {
			expect(out.layers.find((l) => l.id === id)).toBe(STYLE.layers.find((l) => l.id === id));
		}
	});

	it('prefers name:en, then the transliteration, then the local name', () => {
		// Not name_en: in OpenFreeMap's tiles it is the local name wherever name:en is absent,
		// so it would stand in front of the transliteration (see ENGLISH_NAME).
		expect(ENGLISH_NAME).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]);
	});

	it('keeps the rest of the style and does not modify its input', () => {
		const before = structuredClone(STYLE);
		const out = preferEnglishLabels(STYLE);
		expect(STYLE).toEqual(before);
		expect(out.sources).toBe(STYLE.sources);
		expect(out.glyphs).toBe(STYLE.glyphs);
		expect(out.layers.map((l) => l.id)).toEqual(STYLE.layers.map((l) => l.id));
	});
});

describe('loadBasemapStyle', () => {
	const answer = (body: unknown, init: ResponseInit = {}) =>
		vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init));

	it('fetches the OpenFreeMap Dark style, with a deadline, and returns it with English labels', async () => {
		const fetchFn = answer(STYLE);
		const style = (await loadBasemapStyle(fetchFn as unknown as typeof fetch)) as StyleSpecification;
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://tiles.openfreemap.org/styles/dark');
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(layout(style, 'place_country_major')?.['text-field']).toEqual(ENGLISH_NAME);
	});

	it.each([
		['a non-2xx answer', () => answer(STYLE, { status: 503 })],
		['a body that is not JSON', () => answer('<html>busy</html>')],
		['JSON that is not a version-8 style', () => answer({ version: 7, layers: [] })],
		['a style without a layers array', () => answer({ version: 8, sources: {} })],
		['a JSON null', () => answer('null')],
		['a network failure', () => vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))]
	])('falls back to the style URL on %s, so MapLibre loads the stock style itself', async (_, make) => {
		expect(await loadBasemapStyle(make() as unknown as typeof fetch)).toBe(BASEMAP_STYLE_URL);
	});

	it('gives up after the deadline and falls back to the style URL', async () => {
		// Answers only by failing when the deadline aborts it, as a real hung request would.
		// Given no signal it never settles, and the test times out: nothing else ends it.
		const hang = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
		);
		expect(await loadBasemapStyle(hang as unknown as typeof fetch, 20)).toBe(BASEMAP_STYLE_URL);
	});
});

describe('supportsWebGL2', () => {
	const docWith = (getContext: () => unknown) =>
		({ createElement: () => ({ getContext }) }) as unknown as Document;

	it('is true when a WebGL2 context is available, and releases the probe context at once', () => {
		const loseContext = vi.fn();
		const getExtension = vi.fn(() => ({ loseContext }));
		const getContext = vi.fn(() => ({ getExtension }));
		expect(supportsWebGL2(docWith(getContext))).toBe(true);
		expect(getContext).toHaveBeenCalledWith('webgl2');
		expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
		expect(loseContext).toHaveBeenCalledTimes(1);
	});

	it('is still true when the context cannot be released explicitly', () => {
		expect(supportsWebGL2(docWith(() => ({ getExtension: () => null })))).toBe(true);
	});

	it('is false when the browser gives no WebGL2 context, or throws for one', () => {
		expect(supportsWebGL2(docWith(() => null))).toBe(false);
		expect(
			supportsWebGL2(
				docWith(() => {
					throw new Error('blocked');
				})
			)
		).toBe(false);
	});
});

describe('attachBasemap', () => {
	afterEach(() => vi.restoreAllMocks());

	// A stand-in for the bridge's layer: records what is done to it, and hands out a MapLibre
	// map whose 'style.load', 'idle' and 'error' the test fires, in the order MapLibre would.
	// A bridge whose MapLibre constructor threw has no MapLibre map (`glConstructed: false`);
	// one that failed later in onAdd has one.
	function fakeLayer({
		addToThrows = false,
		glConstructed = !addToThrows,
		glRemoveThrows = false
	}: { addToThrows?: boolean; glConstructed?: boolean; glRemoveThrows?: boolean } = {}) {
		const container = document.createElement('div');
		document.body.append(container);
		const once: Record<string, (() => void) | undefined> = {};
		let error: ((e: { error: Error }) => void) | undefined;
		const gl = {
			once: (type: 'style.load' | 'idle', fn: () => void) => (once[type] = fn),
			on: (_: 'error', fn: (e: { error: Error }) => void) => (error = fn),
			remove: vi.fn(() => {
				if (glRemoveThrows) throw new Error('half-built');
			})
		};
		const originalOnRemove = vi.fn();
		const layer = {
			addTo: vi.fn(() => {
				if (addToThrows) throw new Error('Failed to initialize WebGL');
				return layer;
			}),
			onRemove: originalOnRemove as (map: unknown) => unknown,
			getContainer: () => container,
			getMaplibreMap: () => (glConstructed ? gl : undefined)
		};
		return {
			layer,
			gl,
			container,
			originalOnRemove,
			fireIdle: () => once.idle?.(),
			fireError: (message: string) => error?.({ error: new Error(message) }),
			styleLoads: () => once['style.load']?.()
		};
	}
	const fakeMap = (removeLayer = vi.fn()) => ({ removeLayer }) as unknown as LeafletMap & { removeLayer: typeof removeLayer };
	const asBridge = (layer: object) => layer as unknown as MaplibreGL;

	function run(
		map: LeafletMap,
		layer: object,
		{
			webgl2 = true,
			alive = () => true,
			style = STYLE
		}: { webgl2?: boolean; alive?: () => boolean; style?: StyleSpecification | string } = {}
	) {
		const statuses: BasemapStatus[] = [];
		const makeLayer = vi.fn(() => asBridge(layer));
		const loadStyle = vi.fn(async () => style);
		const done = attachBasemap(map, makeLayer, {
			onStatus: (s) => statuses.push(s),
			isAlive: alive,
			webgl2: () => webgl2,
			loadStyle
		});
		return { done, statuses, makeLayer, loadStyle };
	}

	it('without WebGL2 says so and tries nothing: no style fetched, no layer built', async () => {
		const { layer } = fakeLayer();
		const { done, statuses, makeLayer, loadStyle } = run(fakeMap(), layer, { webgl2: false });
		await done;
		expect(statuses).toEqual(['unavailable']);
		expect(loadStyle).not.toHaveBeenCalled();
		expect(makeLayer).not.toHaveBeenCalled();
	});

	it('adds a layer built from the loaded style, and reports ready once MapLibre goes idle', async () => {
		const { layer, fireIdle } = fakeLayer();
		const map = fakeMap();
		const { done, statuses, makeLayer } = run(map, layer, { style: 'https://example.test/style.json' });
		await done;
		expect(makeLayer).toHaveBeenCalledWith('https://example.test/style.json');
		expect(layer.addTo).toHaveBeenCalledWith(map);
		expect(statuses).toEqual(['loading']);
		fireIdle();
		expect(statuses).toEqual(['loading', 'ready']);
	});

	it('adds nothing when the map is gone by the time the style arrives', async () => {
		const { layer } = fakeLayer();
		const { done, statuses, makeLayer } = run(fakeMap(), layer, { alive: () => false });
		await done;
		expect(makeLayer).not.toHaveBeenCalled();
		expect(statuses).toEqual(['loading']);
	});

	it('does not report ready to a map that is gone by the time MapLibre goes idle', async () => {
		const { layer, fireIdle } = fakeLayer();
		let alive = true;
		const { done, statuses } = run(fakeMap(), layer, { alive: () => alive });
		await done;
		alive = false;
		fireIdle();
		expect(statuses).toEqual(['loading']);
	});

	it('when MapLibre will not start: warns, takes the layer off without its own onRemove, drops its container', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { layer, container, originalOnRemove } = fakeLayer({ addToThrows: true });
		const removeLayer = vi.fn((l: typeof layer) => l.onRemove(undefined));
		const map = fakeMap(removeLayer);
		const { done, statuses } = run(map, layer);
		await expect(done).resolves.toBeUndefined();
		expect(statuses).toEqual(['loading', 'failed']);
		expect(removeLayer).toHaveBeenCalledWith(layer);
		// The bridge's onRemove assumes a MapLibre map; the one Leaflet calls must not be it.
		expect(originalOnRemove).not.toHaveBeenCalled();
		expect(container.isConnected).toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('when the bridge failed AFTER constructing MapLibre, removes that MapLibre map too', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { layer, gl, container } = fakeLayer({ addToThrows: true, glConstructed: true });
		const { done, statuses } = run(fakeMap(), layer);
		await done;
		expect(gl.remove).toHaveBeenCalledTimes(1);
		expect(statuses).toEqual(['loading', 'failed']);
		expect(container.isConnected).toBe(false);
	});

	it('finishes the clean-up when that MapLibre map cannot even be removed', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const removeLayer = vi.fn();
		const { layer, container } = fakeLayer({ addToThrows: true, glConstructed: true, glRemoveThrows: true });
		const { done, statuses } = run(fakeMap(removeLayer), layer);
		await expect(done).resolves.toBeUndefined();
		expect(removeLayer).toHaveBeenCalledWith(layer);
		expect(container.isConnected).toBe(false);
		expect(statuses).toEqual(['loading', 'failed']);
	});

	it('reports failed, and logs why, when the style never loads; a later idle changes nothing', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { layer, fireError, fireIdle } = fakeLayer();
		const { done, statuses } = run(fakeMap(), layer);
		await done;
		fireError('style 503');
		fireIdle();
		expect(statuses).toEqual(['loading', 'failed']);
		expect(logged).toHaveBeenCalledWith('basemap: MapLibre error', expect.objectContaining({ message: 'style 503' }));
	});

	it('treats an error once the style has loaded (a sprite, a glyph) as no failure: it is logged, and idle still reports ready', async () => {
		// The case the post-deploy review reproduced in Chrome with MapLibre 6.11.2: a sprite
		// that 404s reports its error after 'style.load' but before the map is idle, while
		// MapLibre's own isStyleLoaded() still reads false. The map draws fine.
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { layer, fireError, fireIdle, styleLoads } = fakeLayer();
		const { done, statuses } = run(fakeMap(), layer);
		await done;
		styleLoads();
		fireError('sprite 404');
		fireIdle();
		expect(statuses).toEqual(['loading', 'ready']);
		expect(logged).toHaveBeenCalledTimes(1);
	});

	it('reports nothing about errors to a map that is gone', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { layer, fireError } = fakeLayer();
		let alive = true;
		const { done, statuses } = run(fakeMap(), layer, { alive: () => alive });
		await done;
		alive = false;
		fireError('style 503');
		expect(statuses).toEqual(['loading']);
	});

	it('still reports failed, and never throws, when even removing the layer throws', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { layer, container } = fakeLayer({ addToThrows: true });
		const map = fakeMap(
			vi.fn(() => {
				throw new Error('removeLayer');
			})
		);
		const { done, statuses } = run(map, layer);
		await expect(done).resolves.toBeUndefined();
		expect(statuses).toEqual(['loading', 'failed']);
		expect(container.isConnected).toBe(false);
	});
});
