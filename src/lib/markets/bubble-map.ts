// What BubbleMap.svelte does once it is mounted, as a plain function: load the map chunk,
// build the Leaflet map in its box, draw and frame the bubbles, then put the basemap under
// them. The component hands in the dynamic import and its own liveness, so every step here is
// testable without Svelte and without the real chunk (bubble-map.test.ts).
import type { Map as LeafletMap } from 'leaflet';
import { attachBasemap, type BasemapStatus } from './basemap';
import { bubbles, type BubbleSpec, type MapPoint } from './bubbles';
import type * as MapLibs from './map-libs';

export interface MountHooks {
	/** The map chunk: `() => import('$lib/markets/map-libs')` in the app. */
	loadLibs(): Promise<typeof MapLibs>;
	/** False once the component is gone; nothing is built for it after that. */
	isAlive(): boolean;
	/** The map, the moment it exists, for the component to remove when it is destroyed. */
	onMap(map: LeafletMap): void;
	onStatus(status: BasemapStatus): void;
}

export async function mountBubbleMap(
	el: HTMLElement,
	points: MapPoint[],
	spec: BubbleSpec,
	{ loadLibs, isAlive, onMap, onStatus }: MountHooks
): Promise<void> {
	let libs: typeof MapLibs;
	try {
		libs = await loadLibs();
	} catch (err) {
		// No Leaflet, so no bubbles either; the status says why the box is empty.
		console.error('map: could not load the map libraries', err);
		if (isAlive()) onStatus('failed');
		return;
	}
	// The tab may have been switched while the chunk loaded: building the map then would
	// leak it on a detached node.
	if (!isAlive()) return;
	const { L, maplibreGL } = libs;

	const map = L.map(el, {
		center: [24, 4],
		zoom: 2,
		minZoom: 0, // 1 clamps the zoom fitBounds needs on a phone-width container
		maxZoom: 10,
		worldCopyJump: true,
		scrollWheelZoom: false
	});
	onMap(map);

	const drawn = bubbles(points, spec);
	for (const b of drawn) L.circleMarker(b.latlng, b.options).addTo(map).bindPopup(b.popup);

	// Frame what is actually plotted rather than trusting the initial view: at phone width
	// the fixed zoom framed Europe and Africa only, leaving the single biggest bubble
	// off-screen until the user panned.
	if (drawn.length) {
		map.fitBounds(L.latLngBounds(drawn.map((b) => b.latlng)), { padding: [24, 24], maxZoom: 5 });
	}

	// The basemap goes in after the bubbles, so nothing it does (a slow style, a browser
	// without WebGL2, a MapLibre that will not start) can delay or remove them.
	await attachBasemap(map, (style) => maplibreGL({ style }), { onStatus, isAlive });
}
