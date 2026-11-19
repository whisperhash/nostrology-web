<script lang="ts">
	// A Zapstore app icon: the app's `icon`, or a square letter-tile placeholder
	// (first letter of the app name) when it has none — matching the upstream
	// zapstore/webapp client. `name` is already d-tag-coalesced by the data layer,
	// so no separate fallback is needed. Thin wrapper over IconTile.
	import IconTile, { type IconTileSize } from './IconTile.svelte';

	export let iconUrl: string | null = null;
	export let name: string | null = null;
	export let size: IconTileSize = 'md';
</script>

<IconTile imageUrl={iconUrl} label={name} {size} />
