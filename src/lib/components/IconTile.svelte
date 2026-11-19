<script lang="ts" context="module">
	// Size variants → paired Tailwind w-/h- + letter font-size. Kept here (a file
	// Tailwind scans) as literal strings so the classes are always emitted, and so
	// callers pick a `size` instead of hand-pairing a box size with a font size.
	export type IconTileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
	const SIZE_CLASSES: Record<IconTileSize, string> = {
		xs: 'w-5 h-5 text-[0.6rem]',
		sm: 'w-6 h-6 text-[0.65rem]',
		md: 'w-10 h-10 text-lg',
		lg: 'w-16 h-16 text-2xl',
		xl: 'w-24 h-24 text-4xl'
	};
</script>

<script lang="ts">
	// Shared base for AppIcon (square) and Avatar (circle): render `imageUrl`, or
	// fall back to a solid-accent tile with the first letter of `label`. Mirrors the
	// upstream zapstore/webapp letter-tile placeholder. The tile also covers a
	// broken/404 image (on:error), which the raw <img> sites previously left blank.
	export let imageUrl: string | null = null;
	export let label: string | null = null; // text whose first letter fills the tile
	export let size: IconTileSize = 'md';
	export let circle = false; // rounded-full (avatar) vs rounded (app icon)

	let errored = false;
	// Reset the error flag if the instance is reused with a new image (keyed {#each}).
	$: {
		imageUrl;
		errored = false;
	}
	$: sizeCls = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
	$: shapeCls = circle ? 'rounded-full' : 'rounded';
	$: letter = ((label || '?').trim().charAt(0) || '?').toUpperCase();
</script>

{#if imageUrl && !errored}
	<img
		src={imageUrl}
		alt=""
		class="{sizeCls} {shapeCls} shrink-0 bg-gray-700 object-cover"
		loading="lazy"
		referrerpolicy="no-referrer"
		on:error={() => (errored = true)}
	/>
{:else}
	<div
		class="{sizeCls} {shapeCls} shrink-0 bg-nostr-purple text-white flex items-center justify-center font-semibold leading-none select-none"
		aria-hidden="true"
	>
		{letter}
	</div>
{/if}
