// The ROOT layout's analytics wiring - the layer where the operator's exclusion actually
// takes effect. The pieces are unit-tested elsewhere (ga.test.ts, hooks.server.test.ts);
// this pins that they are CONNECTED: the server load forwards the flag, and the mounted
// layout honours it by injecting no Google script at all - and that nothing else does.

import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStorage } from '$lib/testing/mem-storage';

// Real iPhone browsers' User-Agents, from the site's access log (see badge.test.ts).
const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 26_7_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.24 Mobile/15E148 Safari/604.1';

const GA_ID = 'G-LAYOUTTEST1';
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_GA_MEASUREMENT_ID: 'G-LAYOUTTEST1' } }));
// Session hydration is irrelevant here and would reach for fetch.
vi.mock('$lib/auth/session', () => ({ hydrate: vi.fn() }));

import Layout from './+layout.svelte';
import { load } from './+layout.server';

function gaScripts(): Element[] {
	return Array.from(document.head.querySelectorAll('script[src*="googletagmanager.com"]'));
}

beforeEach(() => {
	installStorage();
	delete (window as unknown as { gtag?: unknown }).gtag;
	delete (window as unknown as { dataLayer?: unknown }).dataLayer;
	for (const s of gaScripts()) s.remove();
	window.history.replaceState({}, '', '/');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('root layout server load', () => {
	it("forwards the operator's exclusion to the page", async () => {
		const data = await load({ locals: { session: null, analyticsOff: true } } as never);
		expect(data).toMatchObject({ analyticsOff: true, session: null });
	});

	it('forwards false for a measured visitor', async () => {
		const data = await load({ locals: { session: null, analyticsOff: false } } as never);
		expect(data).toMatchObject({ analyticsOff: false });
	});
});

describe('root layout analytics', () => {
	it('SECURITY: an operator page loads no Google script and shows the badge', async () => {
		const { findByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: true } } });
		const badge = await findByTestId('analytics-off-badge');
		// Exact: the operator chose this wording (2026-09-24), and scripts/verify-ga.mjs checks
		// that it includes "Operator browser".
		expect(badge.getAttribute('title')).toBe('Operator browser - excluded from analytics');
		expect(gaScripts()).toHaveLength(0);
		expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
	});

	it('adds the portrait nudge class for iPhone Safari only', async () => {
		vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI);
		const { findByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: true } } });
		const badge = await findByTestId('analytics-off-badge');
		// bottom-3 stays for landscape; the portrait variant overrides it (see badge.ts).
		// jsdom has no orientation, so whether the rule WINS is pinned in
		// layout.badge-css.test.ts, against the CSS Tailwind actually generates.
		expect(badge.getAttribute('class')).toContain('bottom-3');
		expect(badge.getAttribute('class')).toContain('portrait:bottom-0');
	});

	it.each([
		['iPhone Chrome', IPHONE_CHROME],
		['the test runner', null]
	])('does not nudge the badge in %s', async (_name, ua) => {
		if (ua) vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
		const { findByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: true } } });
		const badge = await findByTestId('analytics-off-badge');
		expect(badge.getAttribute('class')).toContain('bottom-3');
		expect(badge.getAttribute('class')).not.toContain('portrait:');
	});

	it('the badge shows only a yellow dot; its words are for screen readers', async () => {
		const { findByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: true } } });
		const badge = await findByTestId('analytics-off-badge');
		const dot = badge.querySelector('[data-testid="analytics-off-dot"]');
		expect(dot).not.toBeNull();
		expect(dot?.getAttribute('class')).toContain('bg-yellow-');
		expect(dot?.getAttribute('aria-hidden')).toBe('true');
		// The words survive for screen readers, but only inside sr-only: strip those and
		// nothing is left to render as visible text. jsdom computes no CSS, so the class is
		// the only thing a unit test can see; scripts/verify-ga.mjs --operator measures the
		// rendered dot in a real browser.
		expect(badge.querySelector('.sr-only')?.textContent).toContain('Analytics off');
		const visible = badge.cloneNode(true) as HTMLElement;
		visible.querySelectorAll('.sr-only').forEach((el) => el.remove());
		expect(visible.textContent?.trim()).toBe('');
	});

	it('a normal visitor is measured and sees no badge', async () => {
		const { queryByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: false } } });
		await vi.waitFor(() => expect(gaScripts()).toHaveLength(1));
		expect(gaScripts()[0].getAttribute('src')).toContain(GA_ID);
		expect(queryByTestId('analytics-off-badge')).toBeNull();
	});

	it('SECURITY: no query parameter and no stored flag switches analytics off', async () => {
		// The retired ?ga_optout fallback let any visitor do it. Only the operator's session
		// may now (hooks.server.ts), so a visitor carrying either old switch is measured.
		window.localStorage.setItem('ga-opt-out', '1');
		window.history.replaceState({}, '', '/?ga_optout=1');
		const { queryByTestId } = render(Layout, { props: { data: { session: null, analyticsOff: false } } });
		await vi.waitFor(() => expect(gaScripts()).toHaveLength(1));
		expect(queryByTestId('analytics-off-badge')).toBeNull();
		expect(window.localStorage.getItem('ga-opt-out')).toBe('1');
	});
});
