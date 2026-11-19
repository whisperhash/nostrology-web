// Unit tests for the GA4 integration. The security-critical property under test
// is the exclusion: a page rendered for the operator's session must load NO Google
// script and emit NO event - verified below by asserting the DOM never gains a
// googletagmanager <script> and window.gtag stays undefined - and nothing a visitor
// controls may switch analytics off. The rest pins the gtag queue plumbing.
//
// Runs in the default jsdom environment (vite.config.ts test.environment), which
// supplies window / document / localStorage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStorage } from '$lib/testing/mem-storage';
import { initAnalytics } from './ga';

const GA_ID = 'G-TEST123456';

function gaScripts(): Element[] {
	return Array.from(document.head.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]'));
}

beforeEach(() => {
	// Fresh browser state for every test: real (empty) storage, no gtag bootstrap, no
	// injected scripts. initAnalytics keys idempotency off window.gtag, so it must be
	// cleared or a later test would see it "already initialized".
	// (This test env stubs window.localStorage as an inert empty object, hence the
	// installed in-memory Storage - see $lib/testing/mem-storage.)
	installStorage();
	delete (window as unknown as { gtag?: unknown }).gtag;
	delete (window as unknown as { dataLayer?: unknown }).dataLayer;
	for (const s of gaScripts()) s.remove();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('initAnalytics', () => {
	it('injects gtag.js and configures GA when enabled and not excluded', () => {
		initAnalytics(GA_ID);

		const scripts = gaScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0].getAttribute('src')).toBe(
			`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
		);
		expect((scripts[0] as HTMLScriptElement).async).toBe(true);

		expect(typeof (window as unknown as { gtag?: unknown }).gtag).toBe('function');
		const dl = (window as unknown as { dataLayer: unknown[][] }).dataLayer;
		expect(dl.some((args) => args[0] === 'js')).toBe(true);
		expect(dl.some((args) => args[0] === 'config' && args[1] === GA_ID)).toBe(true);
	});

	// REGRESSION GUARD. The two assertions above were green for the entire time GA4 was
	// completely dead on the live site, because indexing works identically on an array and
	// on an arguments object - so they pinned the queue's CONTENTS while the bug was in its
	// TYPE. gtag.js dispatches a dataLayer entry as a command only when the entry passes
	// its own arguments-like predicate; a plain array is routed to a legacy dotted-path
	// branch where resolving the empty path yields undefined and the command is dropped, so
	// `config` never runs and not one hit is sent. This test asserts
	// that predicate verbatim. Do not relax it into a contents check.
	it('CONTRACT: every queued command is an arguments object, not an array', () => {
		initAnalytics(GA_ID);
		const dl = (window as unknown as { dataLayer: unknown[] }).dataLayer;
		expect(dl.length).toBeGreaterThanOrEqual(2);

		// gtag.js's predicate, transcribed from the shipped bundle.
		const isArgumentsLike = (x: unknown): boolean =>
			!!x &&
			(Object.prototype.toString.call(x) === '[object Arguments]' ||
				Object.prototype.hasOwnProperty.call(x, 'callee'));

		for (const entry of dl) {
			expect(isArgumentsLike(entry)).toBe(true);
			expect(Array.isArray(entry)).toBe(false);
		}
	});

	it('is a no-op with an empty measurement id (e.g. local dev)', () => {
		initAnalytics('');
		expect(gaScripts()).toHaveLength(0);
		expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
	});

	it('SECURITY: the retired ?ga_optout flag no longer excludes anyone', () => {
		// Only the operator may switch analytics off (the operator, 2026-11-14: "if anybody
		// other than the operator can do this, then no"). A browser still holding the old
		// localStorage flag is measured like any other.
		window.localStorage.setItem('ga-opt-out', '1');
		initAnalytics(GA_ID);
		expect(gaScripts()).toHaveLength(1);
	});

	it('SECURITY: a page rendered for the operator loads no Google script and gets no gtag', () => {
		initAnalytics(GA_ID, { excluded: true });
		expect(gaScripts()).toHaveLength(0);
		expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
		expect((window as unknown as { dataLayer?: unknown }).dataLayer).toBeUndefined();
	});

	it('excluded: false behaves exactly like no option', () => {
		initAnalytics(GA_ID, { excluded: false });
		expect(gaScripts()).toHaveLength(1);
	});

	it('is idempotent - a second call injects no second script', () => {
		initAnalytics(GA_ID);
		initAnalytics(GA_ID);
		expect(gaScripts()).toHaveLength(1);
	});
});
