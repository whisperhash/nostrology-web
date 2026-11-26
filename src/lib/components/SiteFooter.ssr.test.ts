// @vitest-environment node
//
// The footer's line as the server sends it, which is what a reader has before any script runs:
// "Nostrology is open-source software.", with no space before the full stop, and its last three
// words, and only those, a link opening the repository in a new tab. SiteFooter.test.ts holds the
// same in the client's render.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import SiteFooter from './SiteFooter.svelte';

const REPOSITORY = 'https://github.com/whisperhash/nostrology-data';
/** A path of this site. `//host` and `/\host` lead to another host. */
const ON_SITE = /^\/(?![/\\])/;

/** The rendered HTML without Svelte's hydration markers. */
const html = () => render(SiteFooter, { props: { ssrSession: null } }).body.replace(/<!--[\s\S]*?-->/g, '');

/** Each link in some markup: its words without tags, and the attributes the browser acts on. */
const links = (markup: string) =>
	[...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
		text: inner.replace(/<[^>]*>/g, ''),
		href: /\shref="([^"]*)"/.exec(attributes)?.[1],
		target: /\starget="([^"]*)"/.exec(attributes)?.[1],
		rel: /\srel="([^"]*)"/.exec(attributes)?.[1]
	}));

/** The footer's line: the inside of the element whose text begins "Nostrology is". */
const line = () => /<span[^>]*>(Nostrology is [\s\S]*?)<\/span>/.exec(html())?.[1] ?? '';

describe('SiteFooter on the server', () => {
	it('sends "Nostrology is open-source software.", with no space before the full stop', () => {
		expect(line().replace(/<[^>]*>/g, '')).toBe('Nostrology is open-source software.');
	});

	it('sends only "open-source software" in the line as a link, to the repository in a new tab', () => {
		expect(links(line())).toEqual([
			{ text: 'open-source software', href: REPOSITORY, target: '_blank', rel: 'noopener' }
		]);
	});

	it('sends no other link off the site', () => {
		expect(links(html()).map((l) => l.href ?? '').filter((href) => !ON_SITE.test(href))).toEqual([REPOSITORY]);
	});
});
