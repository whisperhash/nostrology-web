<script lang="ts">
	// A Nostr profile avatar (e.g. a Zapstore publisher): the profile picture, or a
	// circular letter-tile placeholder (first letter of the display name) when there
	// is none. Thin wrapper over IconTile (the same fallback as AppIcon, but round).
	import IconTile, { type IconTileSize } from './IconTile.svelte';

	export let pictureUrl: string | null = null;
	export let name: string | null = null;
	export let size: IconTileSize = 'sm';
</script>

<IconTile imageUrl={pictureUrl} label={name} {size} circle />
