import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import SiteFooter from './SiteFooter.svelte';

// The footer's line, on every page: "Nostrology is open source software.", its last three words,
// and only those, a link to nostrology-data's repository. The link leads off the site, so it opens
// in a new tab. Its underline is CSS, which jsdom does not apply. SiteFooter.ssr.test.ts holds the
// same line in the server's HTML.

const REPOSITORY = 'https://github.com/whisperhash/nostrology-data';
/** A path of this site. `//host` and `/\host` lead to another host. */
const ON_SITE = /^\/(?![/\\])/;

/** The footer's line: the element that holds the link to the repository. */
const line = (container: HTMLElement) =>
	[...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === REPOSITORY)?.parentElement;

describe('SiteFooter', () => {
	it('says "Nostrology is open source software.", with no space before the full stop', () => {
		expect(line(render(SiteFooter).container)?.textContent).toBe('Nostrology is open source software.');
	});

	it('links only "open source software" in the line, to the repository in a new tab', () => {
		const { container } = render(SiteFooter);
		// Found by role and name, as assistive technology finds it: a link hidden from it, or named
		// anything else, is not found.
		expect(within(container).getByRole('link', { name: 'open source software' }).getAttribute('href')).toBe(
			REPOSITORY
		);
		const links = [...(line(container)?.querySelectorAll('a') ?? [])].map((a) => ({
			text: a.textContent,
			href: a.getAttribute('href'),
			target: a.getAttribute('target'),
			rel: a.getAttribute('rel')
		}));
		expect(links).toEqual([
			{ text: 'open source software', href: REPOSITORY, target: '_blank', rel: 'noopener' }
		]);
	});

	it('links nothing else off the site', () => {
		const { container } = render(SiteFooter);
		const offSite = [...container.querySelectorAll('a')]
			.map((a) => a.getAttribute('href') ?? '')
			.filter((href) => !ON_SITE.test(href));
		expect(offSite).toEqual([REPOSITORY]);
	});
});
