<script lang="ts">
	// A one-line note laid over the page just under the sticky nav, which goes away by itself.
	// Used when a link names a section that is no longer on the page ($lib/slug-table).
	//
	// The operator's call, 2026-10-19: shown on arrival, held long enough to read but short
	// enough that nobody looks for a way to dismiss it - 6 s, and no close button. The clock
	// runs only while the tab is visible (a link opened in a background tab would otherwise
	// spend it unseen) and pauses while the pointer rests on the note. Laid OVER the page, not
	// into it: inserting a line and then removing it would push the page down and back up just
	// as the reader gets their bearings. A screen reader hears it once, through the status
	// region, whatever the visual timing: the region is filled a moment after the note
	// appears (an announcement made while the page is still loading is often dropped) and
	// keeps its text after the visible note has gone.
	//
	// The fade is a CSS opacity transition rather than svelte/transition, which drives the Web
	// Animations API that jsdom lacks; reduced motion drops it (src/app.css has no part in it).
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	/** The note. Empty shows nothing. */
	export let text = '';
	/** Visible time before it fades. */
	export let holdMs = 6000;
	/** How long the fade takes. */
	const FADE_MS = 300;
	/** How long after the note appears the status region says it. */
	const ANNOUNCE_MS = 1000;

	let shown = false;
	let leaving = false;
	let left = holdMs;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let fadeTimer: ReturnType<typeof setTimeout> | undefined;
	let hovered = false;
	let top = 0;
	let begun = '';
	/** What the status region says. */
	let announced = '';
	let announceTimer: ReturnType<typeof setTimeout> | undefined;

	function run() {
		if (!shown || leaving || hovered || timer !== undefined || document.visibilityState !== 'visible') return;
		startedAt = Date.now();
		timer = setTimeout(() => {
			timer = undefined;
			leaving = true;
			fadeTimer = setTimeout(() => (shown = false), FADE_MS);
		}, left);
	}
	function pause() {
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
		left = Math.max(0, left - (Date.now() - startedAt));
	}
	function onVisibility() {
		if (document.visibilityState === 'visible') run();
		else pause();
	}
	function begin() {
		top = document.querySelector('nav.nav')?.getBoundingClientRect().bottom ?? 0;
		left = holdMs;
		leaving = false;
		shown = true;
		clearTimeout(announceTimer);
		announced = '';
		announceTimer = setTimeout(() => (announced = text), ANNOUNCE_MS);
		document.addEventListener('visibilitychange', onVisibility);
		run();
	}
	// Once per text: the page may set it after this component has mounted.
	$: if (browser && text && text !== begun) {
		begun = text;
		begin();
	}

	onDestroy(() => {
		clearTimeout(timer);
		clearTimeout(fadeTimer);
		clearTimeout(announceTimer);
		if (browser) document.removeEventListener('visibilitychange', onVisibility);
	});
</script>

<div class="sr-only" role="status">{announced}</div>
{#if shown}
	<div
		class="note rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-100 shadow-lg"
		class:leaving
		style="top: {top + 8}px"
		aria-hidden="true"
		data-transient-note
		on:pointerenter={() => {
			hovered = true;
			pause();
		}}
		on:pointerleave={() => {
			hovered = false;
			run();
		}}
	>
		{text}
	</div>
{/if}

<style>
	/* Centred by margins, not by left: 50% and a transform: that pair caps the box at half
	   the viewport's width, which wrapped the note onto two lines on a phone. */
	.note {
		position: fixed;
		left: 0;
		right: 0;
		margin-inline: auto;
		width: max-content;
		max-width: calc(100vw - 32px);
		z-index: 50;
		opacity: 1;
	}
	.note.leaving {
		opacity: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.note {
			transition: opacity 300ms ease-out;
		}
	}
</style>
