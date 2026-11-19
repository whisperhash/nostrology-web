// The landing page's reveal gate. Must run in <head>, AFTER the two GSAP files and
// BEFORE first paint. Kept as a file rather than an inline <script> in <svelte:head>
// for a mundane reason: Svelte's vite preprocessor hands the contents of a script
// tag inside svelte:head to PostCSS, which then fails to parse JavaScript as CSS.
//
// WHAT IT DOES, and why it is inverted:
//
// The page's CSS hides every scroll-reveal target with
//
//     :global(.has-gsap) .rv { opacity: 0 }
//
// Note the class prefix. Elements are VISIBLE by default and are hidden only once
// GSAP is confirmed loaded, so a failed library load leaves a plain readable page
// instead of an invisible one. That only works if the check happens before the
// browser paints, which is why this is a blocking script in the head and not an
// onMount import.
//
// THE WATCHDOG covers the case the inversion alone does not: GSAP loading fine while
// the APP bundle does not. They are separate assets, on separate paths, with separate
// cache lifetimes and separate failure modes - a hashed chunk 404 against a tab left
// open across a redeploy, a proxy or extension that allows /vendor/* but not /_app/*,
// or any uncaught error in the hydration path. In every one of those the class is
// stamped and nothing ever clears the opacity, so the page is blank with all its
// content sitting in the DOM.
//
// So the class carries a deadline. The page's onMount clears this timer; if onMount
// never runs, the page un-hides itself and the visitor gets the static rendering a
// few seconds late. A device slow enough to hydrate after the deadline loses the
// entrance animation, which is the right way for this to fail.
//
// A FULL LOAD ONLY. On a client-side navigation to `/`, Svelte re-creates the head's scripts
// after the page has mounted, so this would stamp the class with nothing left to clear it or
// animate, and the board would sit hidden until the watchdog (the review of 2026-10-15). The
// document has finished loading by then, which a first load's head never has.
(function () {
	if (document.readyState !== 'loading') return;
	if (!window.gsap || !window.ScrollTrigger) return;
	document.documentElement.classList.add('has-gsap');
	window.__landingRevealWatchdog = setTimeout(function () {
		document.documentElement.classList.remove('has-gsap');
	}, 3000);
})();
