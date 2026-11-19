// Cross-surface gating guard.
//
// WHY THIS FILE EXISTS: a destination gated in the nav alone is still PUBLISHED IN THE
// FOOTER, on every page, to every anonymous visitor, and the SiteNav suite cannot see it,
// because that suite asserts the nav and only the nav.
//
// The site renders the destination list on FOUR surfaces: the nav bar, its mobile panel, the
// footer, and the error page. Any surface that iterates the list needs the same gate, and
// "remember to update the other three" is exactly the failure mode $lib/nav.ts's own header
// warns about. No real nav item is unreleased today, so a FIXTURE entry stands in for the next
// domain built in place: the gate is proved before it is needed.

import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { FIXTURE } = vi.hoisted(() => ({
	FIXTURE: { href: '/in-development', label: 'In development', unreleased: true }
}));

// The real list with the fixture among the data domains, and the real filter run over it.
vi.mock('$lib/nav', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/nav')>();
	const items = [...real.NAV_ITEMS.filter((i) => !i.accent), FIXTURE, ...real.NAV_ITEMS.filter((i) => i.accent)];
	return {
		...real,
		NAV_ITEMS: items,
		visibleNavItems: (sees: boolean) => real.visibleNavItems(sees, items)
	};
});

vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/zapstore'), status: 404, error: null })
}));

import SiteNav from '$lib/components/SiteNav.svelte';
import SiteFooter from '$lib/components/SiteFooter.svelte';
import ErrorPage from '../routes/+error.svelte';
import { session } from '$lib/auth/session';
import { NAV_ITEMS } from '$lib/nav';
import { OPERATOR_PUBKEY } from '$lib/unreleased';
import { DOMAINS } from '$lib/landing/board';

const STRANGER = 'b'.repeat(64);

const ANONYMOUS = {
	hydrated: false,
	pubkey: null,
	profile: null,
	status: 'anonymous' as const,
	error: null,
	connectUri: null
};

function hydratedAs(pubkey: string | null) {
	return {
		...ANONYMOUS,
		hydrated: true,
		pubkey,
		status: pubkey === null ? ('anonymous' as const) : ('authenticated' as const)
	};
}

afterEach(() => session.set(ANONYMOUS));

function hrefsOf(container: HTMLElement): string[] {
	return [...container.querySelectorAll('a')]
		.map((a) => a.getAttribute('href'))
		.filter((h): h is string => h !== null);
}

/** Every component that renders the destination list, with its gate wired as in prod. */
const SURFACES = [
	{ name: 'SiteNav', component: SiteNav, ssr: true },
	{ name: 'SiteFooter', component: SiteFooter, ssr: true },
	// The error page has no `data`, so it reads the store alone - see its comment.
	{ name: '+error', component: ErrorPage, ssr: false }
] as const;

describe('no surface leaks an unreleased destination to an anonymous visitor', () => {
	it.each(SURFACES)('$name hides it', ({ component }) => {
		session.set(ANONYMOUS);
		const { container } = render(component as never, { props: {} as never });
		expect(hrefsOf(container)).not.toContain(FIXTURE.href);
		// ...while still rendering the ungated destinations, so a passing test cannot simply
		// mean "this surface rendered nothing".
		expect(hrefsOf(container)).toContain('/data');
	});
});

describe('every surface reveals it to the operator', () => {
	it.each(SURFACES)('$name shows it once hydrated as the operator', ({ component }) => {
		session.set(hydratedAs(OPERATOR_PUBKEY));
		const { container } = render(component as never, { props: {} as never });
		expect(hrefsOf(container)).toContain(FIXTURE.href);
	});

	it.each(SURFACES.filter((s) => s.ssr))(
		'$name shows it in the server-rendered state, from the session prop',
		({ component }) => {
			// The operator must not watch the item pop in after hydration.
			session.set(ANONYMOUS);
			const { container } = render(component as never, {
				props: { ssrSession: { pubkey: OPERATOR_PUBKEY } } as never
			});
			expect(hrefsOf(container)).toContain(FIXTURE.href);
		}
	);
});

describe('a logged-in visitor who is not the operator sees no entrance anywhere', () => {
	it.each(SURFACES)('$name hides it once hydrated as someone else', ({ component }) => {
		session.set(hydratedAs(STRANGER));
		const { container } = render(component as never, { props: {} as never });
		expect(hrefsOf(container)).not.toContain(FIXTURE.href);
	});

	it.each(SURFACES.filter((s) => s.ssr))(
		'$name hides it in the server-rendered state too',
		({ component }) => {
			session.set(ANONYMOUS);
			const { container } = render(component as never, {
				props: { ssrSession: { pubkey: STRANGER } } as never
			});
			expect(hrefsOf(container)).not.toContain(FIXTURE.href);
		}
	);
});

describe('SiteNav gates its desktop row and its mobile panel each on its own', () => {
	// hrefsOf() above merges every link in a render, so it cannot see one of the two halves of
	// SiteNav dropping the item while the other keeps it.
	const rowAndPanel = (container: HTMLElement) => ({
		row: [...container.querySelectorAll('.nav-links a')].map((a) => a.getAttribute('href')),
		panel: [...container.querySelectorAll('#navMobile a')].map((a) => a.getAttribute('href'))
	});

	it('shows it in both to the operator', () => {
		session.set(hydratedAs(OPERATOR_PUBKEY));
		const { row, panel } = rowAndPanel(render(SiteNav).container);
		expect(row).toContain(FIXTURE.href);
		expect(panel).toContain(FIXTURE.href);
	});

	it('shows it in neither to anyone else', () => {
		session.set(hydratedAs(STRANGER));
		const { row, panel } = rowAndPanel(render(SiteNav).container);
		expect(row).not.toContain(FIXTURE.href);
		expect(panel).not.toContain(FIXTURE.href);
		expect(row).toContain('/zapstore');
		expect(panel).toContain('/zapstore');
	});
});

describe('after logout the store wins over a stale server-rendered session', () => {
	it.each(SURFACES.filter((s) => s.ssr))('$name hides it again', ({ component }) => {
		session.set(hydratedAs(null));
		const { container } = render(component as never, {
			props: { ssrSession: { pubkey: OPERATOR_PUBKEY } } as never
		});
		expect(hrefsOf(container)).not.toContain(FIXTURE.href);
	});
});

/**
 * INCUBATING DOMAINS stay off every destination surface. /routstr is linked from /wip only
 * (noindex, out of the sitemap, the nav and the landing's board). Graduation is one
 * deliberate change - into NAV_ITEMS and the landing board's DOMAINS, out of /wip - and these
 * assertions move with it; until then a stray entry in either list, or a surface that grows
 * its own copy, fails here. /git graduated on 2026-10-15, with the redesigned landing.
 */
describe('incubating domains appear on no destination surface', () => {
	const INCUBATING = ['/routstr'];

	it.each(INCUBATING)('NAV_ITEMS has no %s entry', (href) => {
		expect(NAV_ITEMS.map((i) => i.href)).not.toContain(href);
	});

	it.each(INCUBATING)("the landing's board (DOMAINS) has no %s panel", (href) => {
		expect(DOMAINS.map((d) => d.href)).not.toContain(href);
	});

	it.each(SURFACES)('$name links none of them, even for the operator', ({ component }) => {
		session.set(hydratedAs(OPERATOR_PUBKEY));
		const { container } = render(component as never, { props: {} as never });
		const hrefs = hrefsOf(container);
		for (const href of INCUBATING) {
			expect(hrefs.some((h) => h === href || h.startsWith(`${href}/`) || h.startsWith(`${href}#`))).toBe(false);
		}
	});
});

/**
 * GRADUATED DOMAINS are on both destination surfaces, in one order: the nav's data domains
 * (the items that are not accent items) and the landing board's panels are the same list,
 * so crossing from the landing to any page never reorders the domains.
 */
describe('the nav and the landing board list the same domains in the same order', () => {
	it('matches item for item', () => {
		// Unreleased items are left out: a domain still in development is not on the board.
		expect(NAV_ITEMS.filter((i) => !i.accent && !i.unreleased).map((i) => [i.href, i.label])).toEqual(
			DOMAINS.map((d) => [d.href, d.label])
		);
	});
});
