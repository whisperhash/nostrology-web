import { render, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { session } from '$lib/auth/session';

// SiteNav reads $page to mark the current section.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/marketplaces') })
}));

import SiteNav from './SiteNav.svelte';
import { NAV_ITEMS, visibleNavItems } from '$lib/nav';

/**
 * Succeeds src/routes/layout.mobile-nav.test.ts, which tested this contract when the
 * nav was written out inside the root layout. The nav is now one shared component,
 * rendered by both the landing page and (app)/+layout.svelte, so the test moved to
 * the component - and the contract tightened in two ways:
 *
 *   - the collapsed mobile panel stays IN the DOM (merely `hidden`) rather than
 *     being removed, so every destination is in the served HTML for crawlers even
 *     when nothing runs scripts;
 *   - the order leads with Zapstore. Before the chrome was unified the layout led
 *     with Relays while the landing led with Zapstore, so crossing between them
 *     silently reordered the menu.
 *
 * jsdom does not evaluate the media queries that hide the row below 768px, but it
 * can assert the interactive contract that makes the toggle work.
 *
 * The href list is pinned deliberately. Adding or burying a domain is a decision,
 * not a refactor, and it has to be made in two places (this list and $lib/nav.ts)
 * so it cannot happen by accident. Marketplaces joined and Relays was buried on
 * 2026-08-22; /relays still exists and is linked from /wip. Git-on-Nostr joined on
 * 2026-10-15, after Marketplaces, and Lightning and Nutzaps swapped places.
 *
 * Gating an unreleased item, on the two surfaces this component draws (the bar and
 * its mobile panel) and on every other surface that renders the list, is
 * nav.gating.test.ts's job, with a fixture item.
 */
describe('SiteNav', () => {
	const HREFS = ['/zapstore', '/marketplaces', '/git', '/lightning', '/nutzaps', '/data'];

	it('renders the destinations in one order, leading with Zapstore', () => {
		const { container } = render(SiteNav);
		const row = container.querySelector('.nav-links')!;
		// The link row holds the non-accent items; /data is pinned right.
		expect([...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(
			HREFS.slice(0, -1)
		);
		expect(NAV_ITEMS.map((i) => i.href)).toEqual(HREFS);
	});

	it('pins the accent item, MCP, right as an accent pill', () => {
		const { container } = render(SiteNav);
		const accent = [...container.querySelectorAll('.nav-right a.mcp')].map((a) =>
			a.getAttribute('href')
		);
		expect(accent).toEqual(['/data']);
	});

	it('puts the identity control between the link row and the accent items', () => {
		const { container } = render(SiteNav);
		const right = container.querySelector('.nav-right')!;
		const order = [...right.children].map((el) =>
			el.classList.contains('nav-links')
				? 'links'
				: el.classList.contains('nav-auth')
					? 'auth'
					: el.classList.contains('mcp')
						? el.getAttribute('href')
						: 'other'
		);
		expect(order.slice(0, 3)).toEqual(['links', 'auth', '/data']);
	});

	it('keeps the collapsed mobile panel in the DOM, with every destination', () => {
		const { container, getByLabelText } = render(SiteNav);
		const panel = container.querySelector('#navMobile') as HTMLElement;

		expect(panel).not.toBeNull();
		expect(panel.hidden).toBe(true);
		expect(getByLabelText('Toggle navigation menu').getAttribute('aria-expanded')).toBe('false');
		// Present while hidden - that is the point.
		expect([...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(HREFS);
	});

	it('offers a way to log in from the mobile panel', () => {
		// Below 768px the desktop identity control is display:none, so without its own
		// copy a phone user could never log in at all.
		const { container } = render(SiteNav);
		expect(container.querySelector('#navMobile .nav-auth-mobile')).not.toBeNull();
	});

	it('draws one divider before the accent block and one before the identity control', () => {
		const { container } = render(SiteNav);
		const panel = container.querySelector('#navMobile') as HTMLElement;
		// One rule before the accent block, plus the one separating the identity control.
		expect(panel.querySelectorAll('hr')).toHaveLength(2);
	});

	it('opens and closes on the hamburger', async () => {
		const { container, getByLabelText } = render(SiteNav);
		const panel = container.querySelector('#navMobile') as HTMLElement;
		const toggle = getByLabelText('Toggle navigation menu');

		await fireEvent.click(toggle);
		expect(panel.hidden).toBe(false);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');

		await fireEvent.click(toggle);
		expect(panel.hidden).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes after a nav link, and after the logo', async () => {
		const { container, getByLabelText } = render(SiteNav);
		const panel = container.querySelector('#navMobile') as HTMLElement;
		const toggle = getByLabelText('Toggle navigation menu');

		await fireEvent.click(toggle);
		await fireEvent.click(panel.querySelector('a[href="/marketplaces"]')!);
		expect(panel.hidden).toBe(true);

		await fireEvent.click(toggle);
		await fireEvent.click(container.querySelector('a[href="/"]')!);
		expect(panel.hidden).toBe(true);
	});

	it('marks the section you are on, including a sub-route', () => {
		// The mocked page is /marketplaces.
		const { container } = render(SiteNav);
		const current = [...container.querySelectorAll('a[aria-current="page"]')].map((a) =>
			a.getAttribute('href')
		);
		// Once in the desktop row, once in the mobile panel.
		expect(new Set(current)).toEqual(new Set(['/marketplaces']));
	});

	it('never preloads the link to the domain you are on, and leaves every other link alone', () => {
		// On one of a domain's own addresses (/marketplaces/geography) a hover over its nav link
		// fetched the domain's data: a request the log reads as a visit nobody made (fresh-context
		// review, 2026-10-19). The other links keep the site's own setting (app.html).
		const { container } = render(SiteNav);
		const links = [...container.querySelectorAll('a[href^="/"]:not([href="/"])')];
		expect(links.length).toBeGreaterThan(2);
		for (const a of links)
			expect(a.getAttribute('data-sveltekit-preload-data'), a.getAttribute('href')!).toBe(
				a.getAttribute('href') === '/marketplaces' ? 'off' : null
			);
	});
});

describe('visibleNavItems', () => {
	const ITEMS = [
		{ href: '/a', label: 'A' },
		{ href: '/b', label: 'B', unreleased: true },
		{ href: '/c', label: 'C', accent: true }
	];

	it('drops an unreleased item for everyone but the operator, and keeps the rest', () => {
		expect(visibleNavItems(false, ITEMS).map((i) => i.href)).toEqual(['/a', '/c']);
		expect(visibleNavItems(true, ITEMS).map((i) => i.href)).toEqual(['/a', '/b', '/c']);
	});

	it('is the only place the gate is decided', () => {
		// If a second filter appears elsewhere, this stops matching NAV_ITEMS and the two
		// copies can drift - which is exactly how the nav broke before it was unified.
		expect(visibleNavItems(true)).toEqual(NAV_ITEMS);
	});

	it('has no unreleased item today, so everyone sees the same list', () => {
		expect(visibleNavItems(false)).toEqual(NAV_ITEMS);
	});
});

describe('SiteNav: store vs server-rendered prop', () => {
	// The `hydrated` flag decides who is authoritative. Every test above runs with the
	// store at hydrated:false, i.e. only the SSR path - which is how a review found that
	// nothing covered the post-login and post-logout states at all.
	const HYDRATED = {
		hydrated: true,
		profile: null,
		status: 'authenticated' as const,
		error: null,
		connectUri: null
	};

	afterEach(() => {
		session.set({
			hydrated: false,
			pubkey: null,
			profile: null,
			status: 'anonymous',
			error: null,
			connectUri: null
		});
	});

	it('renders the identity chip from the store after a client-side login, with no SSR prop', () => {
		// login() updates the store; `data.session` from the last full page load is still
		// anonymous. The store must win.
		session.set({ ...HYDRATED, pubkey: 'a'.repeat(64) });
		const { queryAllByText } = render(SiteNav);
		expect(queryAllByText('Log in')).toHaveLength(0);
	});

	it('shows Log in after logout even though the SSR session still names someone', () => {
		// The regression the `hydrated` flag exists for: without it the nav falls back to a
		// stale server-rendered session until a hard reload.
		session.set({ ...HYDRATED, pubkey: null, status: 'anonymous' });
		const { queryAllByText } = render(SiteNav, { props: { ssrSession: { pubkey: 'c'.repeat(64) } } });
		expect(queryAllByText('Log in')).toHaveLength(2);
	});

	it('renders the identity chip from the SSR session before hydration', () => {
		// Otherwise a logged-in user gets a "Log in" button in the server-rendered HTML
		// that flips to their avatar after hydration, on every page load.
		const { container, queryAllByText } = render(SiteNav, {
			props: { ssrSession: { pubkey: 'c'.repeat(64) } }
		});
		expect(queryAllByText('Log in')).toHaveLength(0);
		// Two chips: the desktop bar's and the mobile panel's. They share the store, so
		// they can differ in panel state but never in identity.
		expect(container.querySelectorAll('.auth-chip')).toHaveLength(2);
	});

	it('shows Log in when there is no session at all', () => {
		// One control in the desktop bar, one in the mobile panel - below 768px the
		// desktop copy is display:none, so without the second a phone could never log in.
		const { queryAllByText } = render(SiteNav);
		expect(queryAllByText('Log in')).toHaveLength(2);
	});
});
