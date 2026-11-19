<script lang="ts">
	// A domain page's "What is counted": the collapsed section that the section's own address
	// (/git/methodology) opens ($lib/methodology, the convention in CLAUDE.md), and the small
	// link icon that copies that address. One component so every domain page gets both the
	// same way; the page binds `open` ($lib/domain-page: the address opens it, never closes it).
	//
	// THE HEAD is the whole <summary>, padding included: the entire closed card, and the band
	// across the top of the open one. So that is what a click toggles and what a hover arms
	// the icon from - the padding sits on the summary rather than on the <details>, or the
	// card's top and bottom 20px would be dead to both.
	//
	// THE LINK ICON. It sits at the right end of the head - the far right of the collapsed
	// card, the top-right corner of the open one - and is drawn only while the pointer is on
	// the head (or on the icon itself), or while it has keyboard focus. Otherwise it is fully
	// transparent AND takes no pointer events: on a phone there is no hover, so it never
	// shows, and a tap at the head's right end must still toggle the section rather than land
	// on an invisible copy target. Hence the `(hover: hover)` gate below; a phone's sticky
	// tap-hover would otherwise arm it. A touchscreen whose PRIMARY pointer hovers (a touch
	// laptop) passes that gate, so a finger can still land on the armed icon; a click made by
	// touch therefore toggles the section, as the head under the finger would have.
	//
	// It is OUTSIDE the <summary>, positioned over it, for two reasons: a closed <details>
	// renders nothing but its summary, so it cannot live in the body; and inside the summary
	// it would be a control nested in a control - the summary is exposed as a button-like
	// disclosure, whose name would then read "What is counted Copy link to What is counted",
	// and whose activation a click on it would have to be talked out of.
	//
	// It is an <a href="/<domain>/methodology"> rather than a <button>: without JavaScript, and
	// on a right-click ("Copy link"), a middle-click or a modified click, it is simply the
	// link, and the same address a click copies. A plain click is the copy, and it does NOT
	// follow the link, so the copy leaves the address bar, the section's open state and the
	// scroll as they were.
	import { onDestroy, tick } from 'svelte';
	import { METHODOLOGY_ID, METHODOLOGY_TITLE } from '$lib/methodology';

	/** Whether the section is expanded. The page binds it. */
	export let open = false;
	/** The section's own address, which the link names and a click copies:
	 * addressOf(<the domain's slug table>, METHODOLOGY), e.g. /git/methodology. */
	export let href: string;
	/** The heading, the same on every domain page: not a prop, so a page cannot drift from it. */
	const title = METHODOLOGY_TITLE;

	type CopyState = 'idle' | 'copied' | 'failed';
	let copyState: CopyState = 'idle';
	/** What the live region says; apart from copyState so a repeat can be heard (settle). */
	let status = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	const STATUS: Record<CopyState, string> = {
		idle: '',
		copied: 'Link copied',
		failed: 'Could not copy the link'
	};
	const TOOLTIP: Record<CopyState, string> = {
		idle: 'Copy link to this section',
		copied: 'Link copied',
		failed: 'Could not copy the link'
	};

	function settle(next: CopyState) {
		copyState = next;
		// Emptied, then refilled once that has rendered: a live region speaks only when its
		// text changes, so a second copy inside the two seconds would otherwise be silent.
		status = '';
		void tick().then(() => (status = STATUS[next]));
		clearTimeout(timer);
		timer = setTimeout(() => {
			copyState = 'idle';
			status = '';
		}, 2000);
	}

	/** The pointer that pressed the link, for a click that does not say itself. A click is a
	 * PointerEvent carrying `pointerType` in current Chrome, not in every engine yet. */
	let pressedWith = '';
	function viaTouch(e: MouseEvent): boolean {
		if (e.detail === 0) return false; // the keyboard: Enter on the focused link
		return ((e as Partial<PointerEvent>).pointerType || pressedWith) === 'touch';
	}

	function copy(e: MouseEvent) {
		// Anything but a plain primary click is the browser's to handle as a link: a new
		// tab, a new window, a download. Enter on the focused link arrives here as a plain
		// click, so the keyboard copies too.
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		// Chrome leaves a clicked link focused, and the next key press (Shift, an arrow, Page
		// Down) turns that into :focus-visible - the icon would come back and stay while the
		// page scrolls. A pointer click lets go of it; Enter's focus is the keyboard's own.
		if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
		if (viaTouch(e)) {
			open = !open;
			return;
		}
		// Made absolute at click time, not at render: the server knows no window.
		const url = new URL(href, window.location.href).href;
		// Called synchronously inside the click, which Safari requires of writeText. With no
		// clipboard API at all (an insecure context) the call itself throws.
		let write: Promise<void>;
		try {
			write = navigator.clipboard.writeText(url);
		} catch (err) {
			write = Promise.reject(err);
		}
		write.then(
			() => settle('copied'),
			() => settle('failed')
		);
	}

	onDestroy(() => clearTimeout(timer));
</script>

<div class="methodology">
	<!-- Before the section in the DOM, so Tab reaches it ahead of the summary it sits over
		 rather than after everything an open section holds. Positioned, so it draws on top. -->
	<!-- data-sveltekit-preload-data="off": the site preloads a link's data on hover (app.html),
		 and this link is never followed - a preload would run the page's server load for nothing
		 and log a visit to /<domain>/methodology that never happened. -->
	<a
		{href}
		class="copy-link rounded-md p-1.5 text-gray-400 hover:text-gray-100"
		data-sveltekit-preload-data="off"
		class:shown={copyState !== 'idle'}
		class:copied={copyState === 'copied'}
		class:failed={copyState === 'failed'}
		data-methodology-link
		title={TOOLTIP[copyState]}
		on:pointerdown={(e) => (pressedWith = e.pointerType)}
		on:click={copy}
	>
		<!-- Its name as text rather than an aria-label, so the link is never textless to
			 anything that reads the DOM (the /git page tests hold every link to that). -->
		<span class="sr-only">Copy link to {title}</span>
		{#if copyState === 'copied'}
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
			</svg>
		{:else if copyState === 'failed'}
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
			</svg>
		{:else}
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
				/>
			</svg>
		{/if}
	</a>
	<!-- Collapsed by default: the method is there for whoever opens it, after the figures.
		 Closed, its content is still in the DOM (and the SSR HTML), only not drawn. Its address
		 (/<domain>/methodology) opens the pill holding it, expanded, just under the nav.
		 pr-12 keeps a long heading clear of the icon; the body's padding is its own wrapper's,
		 since the summary's is the head's. -->
	<details class="rounded-xl border border-gray-700 bg-gray-800" id={METHODOLOGY_ID} bind:open>
		<summary class="cursor-pointer select-none p-5 pr-12 text-white marker:text-gray-400">
			<h2 class="inline text-lg font-semibold">{title}</h2>
		</summary>
		<div class="px-5 pb-5">
			<slot />
		</div>
	</details>
	<!-- Announces the copy to a screen reader; present from the first render, empty at rest,
		 as a live region must be to be heard when it changes. -->
	<span class="sr-only" aria-live="polite">{status}</span>
</div>

<style>
	.methodology {
		position: relative;
	}
	/* Open, the head's bottom padding gives way to the body's own top margin, so the text
	   sits where it did when the padding was the <details>'s. */
	details[open] > summary {
		padding-bottom: 0;
	}
	.copy-link {
		position: absolute;
		/* On the heading's row: the <details> has a 1px border and the summary p-5 (1.25rem),
		   and the link is as tall as the heading's 1.75rem line (a 1rem icon in 0.375rem
		   padding). The right edge gives back that padding, so the glyph lines up with the
		   section's text edge. */
		top: calc(1px + 1.25rem);
		right: calc(1px + 1.25rem - 0.375rem);
		opacity: 0;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.copy-link {
			transition:
				opacity 120ms ease-out,
				color 120ms ease-out;
		}
	}
	/* Only where the primary pointer can hover. The icon's own :hover keeps it while the
	   pointer crosses from the summary onto it - it is a sibling, so the summary loses :hover
	   there. */
	@media (hover: hover) {
		.methodology:has(> details > summary:hover) .copy-link,
		.copy-link:hover {
			opacity: 1;
			pointer-events: auto;
		}
	}
	/* Keyboard focus shows it wherever it is; so does the moment after a copy, so the tick
	   (or the cross) is still seen when the pointer has already moved on. */
	.copy-link:focus-visible,
	.copy-link.shown {
		opacity: 1;
	}
	.copy-link.copied {
		color: rgb(45 212 191); /* teal-400, as CopyButton's tick */
	}
	.copy-link.failed {
		color: rgb(252 211 77); /* amber-300 */
	}
</style>
