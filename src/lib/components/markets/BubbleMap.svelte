<script lang="ts">
	// A world map of bubbles over the OpenFreeMap basemap, for the Geography and Shipping
	// tabs of /marketplaces. What it does once mounted is $lib/markets/bubble-map.ts; Leaflet
	// and MapLibre arrive in their own chunk the first time a map mounts
	// ($lib/markets/map-libs.ts), never on the server.
	import { onDestroy, onMount } from 'svelte';
	import type { Map as LeafletMap } from 'leaflet';
	import type { BasemapStatus } from '$lib/markets/basemap';
	import { mountBubbleMap } from '$lib/markets/bubble-map';
	import type { MapPoint } from '$lib/markets/bubbles';

	export let points: MapPoint[];
	// which numeric field drives the bubble radius / colour
	export let weight: string = 'listings';
	export let weightLabel: string = 'listings';
	export let secondary: string | null = 'sellers';
	export let secondaryLabel: string = 'sellers';
	export let color: string = '#a78bfa';
	export let heightPx: number = 520;
	// A world map fitted to a phone-width container lands near zoom 0, where the
	// whole world is 256 px tall -- in a 520 px box that leaves half the frame as
	// empty gutter above and below the tiles. Shorten the box on small screens so
	// the fitted world actually fills it.
	export let mobileHeightPx: number = 300;

	let el: HTMLDivElement;
	let map: LeafletMap | null = null;
	let basemap: BasemapStatus | undefined;
	let dead = false;

	onMount(() => {
		void mountBubbleMap(
			el,
			points,
			{ weight, weightLabel, secondary, secondaryLabel, color },
			{
				loadLibs: () => import('$lib/markets/map-libs'),
				isAlive: () => !dead,
				onMap: (m) => (map = m),
				onStatus: (s) => (basemap = s)
			}
		);
	});

	onDestroy(() => {
		dead = true;
		try {
			map?.remove();
		} catch (err) {
			// Leaving a page must never fail because a layer could not tidy up after itself.
			console.warn('map: removing the map threw', err);
		}
	});
</script>

<div
	bind:this={el}
	class="markets-map w-full rounded-xl"
	style="--map-h: {heightPx}px; --map-h-sm: {mobileHeightPx}px"
	data-basemap={basemap}
></div>

<style>
	.markets-map {
		height: var(--map-h);
		/* Leaflet paints its container #ddd. A world map fitted to a narrow box
		   leaves a band above and below the world, and #ddd makes that band read
		   as a broken image rather than as empty ocean. It is also all there is
		   behind the bubbles when the basemap cannot be drawn (no WebGL2). */
		background: #0f1520;
	}
	@media (max-width: 640px) {
		.markets-map {
			height: var(--map-h-sm);
		}
	}
</style>
