<script lang="ts">
	// The link icon on a section card that has an address of its own (/git/zaps,
	// $lib/slug-table): the way a reader passes the section on. The operator's design,
	// 2026-10-18/19:
	//
	// ON A DESKTOP it sits at the right end of the card's heading line and is drawn only while
	// the pointer is on that line (or on the icon), or while it has keyboard focus, as What is
	// counted's icon is (MethodologySection). A click copies the section's address and shows a
	// tick, or an amber cross if the clipboard refuses; a live region says which.
	//
	// ON A PHONE there is no hover, so the page decides where it is drawn: on one card at a
	// time, the section with an address whose heading is on screen nearest the top (P1, the
	// operator's choice; the page passes `phoneShown`). Drawing it on every card would pepper
	// the page. A tap opens the phone's own share menu with the address - called
	// synchronously inside the tap, which iOS requires, and with the URL alone, since some
	// apps join a `text` and a `url` into one line. Closing the menu (an AbortError) is the
	// reader's choice and does nothing. A browser with no share menu (Android's WebView)
	// copies instead, and so does a share that fails - which Chrome allows; WebKit and Gecko
	// may refuse the copy once the share has used up the tap, and the amber cross says so. A
	// second tap within a second of a share is ignored, by the clock rather than by the
	// share's promise, which some browsers never settle (headless Chrome's does not).
	//
	// It is an <a href> rather than a <button>: without JavaScript, and on a right-click, a
	// middle-click or a modified click, it is simply the link to the section. It never
	// PRELOADS: the site preloads a link's data on hover and on touchstart
	// (data-sveltekit-preload-data in app.html), and this link is not followed - each preload
	// would run the page's server load and land in the request log as a visit to the
	// section that never happened, the very log these addresses exist to be read from. It
	// sits OUTSIDE the card's <h2> (panel-checks.ts pins each heading's text and name),
	// positioned over the heading line's right end; the card must be `position: relative`.
	import { onDestroy, tick } from 'svelte';

	/** The section's own address, e.g. '/git/zaps'. */
	export let href: string;
	/** The section's heading, for the link's name. */
	export let title: string;
	/** On a phone, whether this card is the one the icon is drawn on (P1). */
	export let phoneShown = false;

	type CopyState = 'idle' | 'copied' | 'failed';
	let copyState: CopyState = 'idle';
	/** What the live region says; apart from copyState so a repeat can be heard (settle). */
	let status = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** When the last share began; a tap within SHARE_GUARD_MS of it is ignored. */
	let sharedAt = -Infinity;
	const SHARE_GUARD_MS = 1000;
	const STATUS: Record<CopyState, string> = { idle: '', copied: 'Link copied', failed: 'Could not copy the link' };
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

	function copy(url: string) {
		// Synchronous inside the click where it can be, as Safari requires of writeText. With
		// no clipboard API at all (an insecure context) the call itself throws.
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

	/** The pointer that pressed the link. Asked FIRST: in every Pointer Events engine a finger's
	 * pointerdown says `touch`, while the click after it is not a PointerEvent everywhere, and
	 * WebKit builds a tap's click from synthetic mouse events. Cleared at each click, so a
	 * later click cannot borrow it. */
	let pressedWith = '';
	function viaTouch(e: MouseEvent): boolean {
		const type = pressedWith || (e as Partial<PointerEvent>).pointerType;
		pressedWith = '';
		// detail 0: Enter on the focused link, el.click(), or an assistive technology's
		// activation - all of which copy, as the link's name says
		if (e.detail === 0) return false;
		return type === 'touch';
	}

	function activate(e: MouseEvent) {
		// Anything but a plain primary click is the browser's to handle as a link.
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		// A clicked link keeps focus in Chrome, and the next key press would turn that into
		// :focus-visible and draw the icon for good; Enter's focus is the keyboard's own.
		if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
		const url = new URL(href, window.location.href).href;
		if (viaTouch(e) && typeof navigator.share === 'function') {
			const now = Date.now();
			if (now - sharedAt < SHARE_GUARD_MS) return;
			sharedAt = now;
			let shared: Promise<void>;
			try {
				shared = navigator.share({ url });
			} catch (err) {
				shared = Promise.reject(err);
			}
			shared.catch((err: unknown) => {
				if ((err as { name?: string } | null)?.name !== 'AbortError') copy(url);
			});
			return;
		}
		copy(url);
	}

	onDestroy(() => clearTimeout(timer));
</script>

<a
	{href}
	class="section-link rounded-md text-gray-400"
	data-sveltekit-preload-data="off"
	class:phone-shown={phoneShown}
	class:shown={copyState !== 'idle'}
	class:copied={copyState === 'copied'}
	class:failed={copyState === 'failed'}
	data-section-link
	title={TOOLTIP[copyState]}
	on:pointerdown={(e) => (pressedWith = e.pointerType)}
	on:click={activate}
>
	<!-- Its name as text rather than an aria-label, so the link is never textless to anything
		 that reads the DOM (the /git page tests hold every link to that). -->
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
<!-- Announces the copy to a screen reader; present from the first render, empty at rest, as a
	 live region must be to be heard when it changes. -->
<span class="sr-only" aria-live="polite">{status}</span>

<style>
	.section-link {
		position: absolute;
		/* On the heading's row: the card's padding is p-5 (1.25rem), measured from its padding
		   edge - inside the border, where an absolute child's offsets start - and the link is as
		   tall as the heading's 1.75rem line (a 1rem glyph in 0.375rem padding). The right edge
		   gives back that padding, so the glyph lines up with the card's text edge. */
		top: 1.25rem;
		right: calc(1.25rem - 0.375rem);
		padding: 0.375rem;
		opacity: 0;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.section-link {
			transition:
				opacity 120ms ease-out,
				color 120ms ease-out;
		}
	}
	/* A desktop: drawn while the pointer is on the heading line - the card's <h2>, which comes
	   before it - or on the icon itself, which keeps it as the pointer crosses over (the
	   heading loses :hover). A sibling selector, not :has(), so an engine without :has() still
	   draws it. The hover colour lives here too: a phone's tap would otherwise leave it
	   bright, a sticky hover. */
	@media (hover: hover) {
		:global(h2:hover) ~ .section-link,
		.section-link:hover {
			opacity: 1;
			pointer-events: auto;
		}
		.section-link:hover {
			color: rgb(243 244 246); /* gray-100 */
		}
	}
	/* A phone: on the one card the page chose (P1), with a finger-sized target - 44 px, the
	   glyph where it was. */
	@media (hover: none) {
		.section-link {
			top: calc(1.25rem - 0.5rem);
			right: calc(1.25rem - 0.875rem);
			padding: 0.875rem;
		}
		.section-link.phone-shown {
			opacity: 1;
			pointer-events: auto;
		}
	}
	/* Keyboard focus draws it wherever it is; so does the moment after a copy, so the tick (or
	   the cross) is still seen when the pointer has already moved on. */
	.section-link:focus-visible,
	.section-link.shown {
		opacity: 1;
	}
	.section-link.copied {
		color: rgb(45 212 191); /* teal-400, as CopyButton's tick */
	}
	.section-link.failed {
		color: rgb(252 211 77); /* amber-300 */
	}
</style>
