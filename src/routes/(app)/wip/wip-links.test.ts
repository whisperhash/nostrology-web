import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, it, expect, vi } from 'vitest';

import WipPage from './+page.svelte';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to
// be supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

/**
 * /wip is the index of pages that are deliberately unlinked from the public nav, and it moves in
 * BOTH directions. A page that graduates INTO the top-level nav must leave this list, or the same
 * destination is offered twice with contradictory "experimental" framing (Nutzaps graduated on
 * 2026-07-25). A page dropped FROM the nav must arrive here, or burying it makes it unreachable.
 * Relays was buried on 2026-08-22 - its data pipeline is untouched, only the nav entry went.
 */
describe('/wip index', () => {
	it('no longer lists Nutzaps (it is a top-level nav item now)', () => {
		const { container } = render(WipPage);
		expect(container.querySelector('a[href="/nutzaps"]')).toBeNull();
	});

	it('lists Relays, which left the top-level nav', () => {
		const { container } = render(WipPage);
		expect(container.querySelector('a[href="/relays"]')).not.toBeNull();
	});

	it('lists Routstr, incubating before any nav graduation', () => {
		const { container } = render(WipPage);
		expect(container.querySelector('a[href="/routstr"]')).not.toBeNull();
	});

	it('no longer lists the git page (it is a top-level nav item since 2026-10-15)', () => {
		const { container } = render(WipPage);
		expect(container.querySelector('a[href="/git"]')).toBeNull();
	});

	it('still lists the remaining WIP pages', () => {
		const { container } = render(WipPage);
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(['/zapstore/apps', '/relays', '/routstr']);
	});
});
