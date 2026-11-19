// The basemap under the /marketplaces bubble maps (Geography and Shipping): OpenFreeMap's
// "Dark" vector style, drawn by MapLibre GL inside the Leaflet map through the
// maplibre-gl-leaflet bridge (both loaded by map-libs.ts).
//
// It replaced CARTO's dark_all raster tiles on 2026-10-13. CARTO now requires an API key
// for its basemaps (terms of 2026-09-29) and answers a keyless request with a placeholder
// tile reading "API KEY REQUIRED" - with HTTP 200, so nothing on our side errored and the
// maps simply showed the watermark. OpenFreeMap needs no key, sets no request limit, allows
// commercial use and asks only for attribution, which its style's source carries: the
// bridge copies it into Leaflet's attribution control once the style has loaded.
//
// Leaflet and MapLibre reach this module only as arguments, so its logic is testable without
// either (basemap.test.ts) and the libraries stay in the chunk that only a map tab loads.
import type { Map as LeafletMap, MaplibreGL } from 'leaflet';
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/**
 * What a bubble map's basemap is doing, mirrored onto the map box as `data-basemap` (for
 * scripts/verify-markets-map.mjs, and for anyone reading the DOM):
 *   loading      the style is being fetched or MapLibre is drawing its first frame
 *   ready        MapLibre went idle: style, tiles and labels are all drawn
 *   unavailable  the browser has no WebGL2, which MapLibre 6 requires; no basemap is tried
 *   failed       MapLibre threw while starting (the layer was taken off again), or reported
 *                an error before its style loaded (the style could not be fetched or was
 *                invalid); BubbleMap also sets it when the map chunk itself did not load,
 *                in which case there are no bubbles either
 * In the last two the bubbles still draw, on the box's own dark background. `ready` means
 * MapLibre finished, not that every tile arrived: a tile or sprite that fails leaves a hole
 * and an error in the console, as it always has. A style request that hangs without failing
 * leaves the status at `loading`: MapLibre sets it no deadline once it fetches the style
 * itself (after loadBasemapStyle's own fetch fell back to the URL).
 */
export type BasemapStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

// The style labels a place whose local name is not in Latin script with a transliteration
// over the local script ("name:latin" then "name:nonlatin"), and any other place with
// name_en or else its local name. This site is in English, so every name label prefers the
// English name, then the transliteration, then the local name. Not name_en: in OpenFreeMap's
// tiles it is name:en where that exists and the LOCAL name otherwise, so placed second it
// would hide every transliteration: a Greek island with no name:en showed in Greek script
// alone instead of as "Skyros" (review of 2026-10-13, measured on the live tiles).
export const ENGLISH_NAME: ExpressionSpecification = [
	'coalesce',
	['get', 'name:en'],
	['get', 'name:latin'],
	['get', 'name']
];

/**
 * The style with every name label rewritten to ENGLISH_NAME. A name label is a symbol layer
 * whose text-field reads `name:nonlatin` (in the Dark style: the place, water and road-name
 * layers); every other layer, including the motorway shields that print `ref`, is returned
 * as it was. The input is not modified.
 */
export function preferEnglishLabels(style: StyleSpecification): StyleSpecification {
	return {
		...style,
		layers: style.layers.map((layer) => {
			if (layer.type !== 'symbol') return layer;
			const field = layer.layout?.['text-field'];
			if (field === undefined || !JSON.stringify(field).includes('name:nonlatin')) return layer;
			return { ...layer, layout: { ...layer.layout, 'text-field': ENGLISH_NAME } };
		})
	};
}

/**
 * The basemap style, with English labels. On any failure (the network, a non-2xx answer, a
 * body that is not a version-8 style, no answer within `timeoutMs`) this returns the style
 * URL instead: MapLibre then fetches the style itself and draws it with its stock labels,
 * which beats no basemap. Never throws.
 */
export async function loadBasemapStyle(
	fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000
): Promise<StyleSpecification | string> {
	try {
		const res = await fetchFn(BASEMAP_STYLE_URL, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return BASEMAP_STYLE_URL;
		const style = await res.json();
		if (style?.version !== 8 || !Array.isArray(style.layers)) return BASEMAP_STYLE_URL;
		return preferEnglishLabels(style as StyleSpecification);
	} catch {
		return BASEMAP_STYLE_URL;
	}
}

/**
 * Whether this browser can give MapLibre 6 the WebGL2 context it requires. The probe's
 * context is released at once: browsers cap live WebGL contexts (about 16) and drop the
 * oldest when a page opens more.
 */
export function supportsWebGL2(doc: Document = document): boolean {
	try {
		const gl = doc.createElement('canvas').getContext('webgl2');
		if (!gl) return false;
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	} catch {
		return false;
	}
}

export interface AttachOptions {
	/** Called with every status change, in order. */
	onStatus(status: BasemapStatus): void;
	/** False once the map's component is gone; nothing is added to a map after that. */
	isAlive(): boolean;
	webgl2?: () => boolean;
	loadStyle?: () => Promise<StyleSpecification | string>;
}

/**
 * Put the basemap under `map`. `makeLayer` builds the bridge's layer for a style (in the app:
 * `(style) => maplibreGL({ style })`). Never throws: whatever goes wrong, the map keeps its
 * bubbles and `onStatus` says what happened.
 *
 * `map` must already have a view (a center and zoom, or a fitBounds): then Leaflet runs the
 * layer's onAdd synchronously inside addTo, which is what lets the try below catch a MapLibre
 * that fails to start. On a map without one, onAdd would run later, outside it.
 */
export async function attachBasemap(
	map: LeafletMap,
	makeLayer: (style: StyleSpecification | string) => MaplibreGL,
	{ onStatus, isAlive, webgl2 = supportsWebGL2, loadStyle = loadBasemapStyle }: AttachOptions
): Promise<void> {
	if (!webgl2()) {
		onStatus('unavailable');
		return;
	}
	onStatus('loading');
	const style = await loadStyle();
	if (!isAlive()) return;

	const layer = makeLayer(style);
	try {
		layer.addTo(map);
	} catch (err) {
		// The bridge's onAdd appends its container and only then constructs the MapLibre map,
		// after Leaflet has already registered the layer's move/zoom handlers on the map; its
		// onRemove assumes the MapLibre map exists. So a constructor that throws leaves a
		// half-added layer whose handlers fail on every pan, and whose removal throws (from
		// the component's map.remove() too). Take it off with a no-op onRemove - removeLayer
		// still unregisters it and fires the 'remove' that detaches those handlers - and drop
		// the empty container by hand.
		console.warn('basemap: MapLibre GL failed to start; showing the bubbles without it', err);
		// If the bridge failed AFTER constructing the MapLibre map, that map is live (a WebGL
		// context, listeners, fetches) and the no-op onRemove below would orphan it.
		try {
			layer.getMaplibreMap()?.remove();
		} catch {
			/* it was never whole */
		}
		layer.onRemove = () => layer;
		try {
			map.removeLayer(layer);
		} catch {
			/* nothing more to undo */
		}
		layer.getContainer()?.remove(); // absent if onAdd failed before creating it
		onStatus('failed');
		return;
	}
	const gl = layer.getMaplibreMap();
	if (!gl) return;
	// MapLibre's isStyleLoaded() is NOT "the style has loaded": it also waits for the sprite
	// and every visible tile, and a sprite request that fails reports its error while it is
	// still false - a map that then draws fine would read as failed (post-deploy review of
	// 2026-10-13, reproduced in Chrome). 'style.load' is the style itself; it fires
	// asynchronously, so registering here, straight after addTo, is in time.
	let styleLoaded = false;
	gl.once('style.load', () => (styleLoaded = true));
	let settled = false;
	const settle = (status: BasemapStatus) => {
		if (settled || !isAlive()) return;
		settled = true;
		onStatus(status);
	};
	gl.on('error', (e) => {
		// A listener stops MapLibre logging errors itself, so log them as it would have.
		console.error('basemap: MapLibre error', e.error ?? e);
		// A style that fails leaves no basemap and never goes idle; say so rather than staying
		// `loading`. Anything after the style (a sprite, a tile, a glyph) is not a failure.
		if (!styleLoaded) settle('failed');
	});
	gl.once('idle', () => settle('ready'));
}
