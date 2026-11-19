import { render } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import { addressOf, isPill, own, slugAddresses, slugIn, type SlugTable } from '$lib/slug-table';
import { NUTZAPS_SLUGS } from '$lib/slug-tables/nutzaps';
import { ZAPSTORE_SLUGS } from '$lib/slug-tables/zapstore';
import NutzapsShell from './nutzaps/(shell)/+layout.svelte';
import NutzapsOverview from './nutzaps/(shell)/+page.svelte';
import ZapstoreShell from './zapstore/(shell)/+layout.svelte';
import ZapstoreOverview from './zapstore/(shell)/+page.svelte';

// /zapstore and /nutzaps, whose pills are pages of their own, each its own route
// ($lib/slug-tables/zapstore, nutzaps): their pill bars are drawn by PillBar from their slug
// tables, the open pill is the address's, a click starts the new page at its top, and an
// unknown slug - which the server sends to the domain with a 302 (found) and `#gone`
// (domain-loads.test.ts) - shows the note there, then the hash goes.

const url = vi.hoisted(() => ({ current: new URL('https://site.test/zapstore') }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: { subscribe: (fn: (v: unknown) => void) => readable({ url: url.current }).subscribe(fn) } };
});
const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((to: string) => window.history.replaceState(window.history.state, '', to)),
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve())
}));

beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(kitReplaceState).mockClear();
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
	window.history.replaceState(null, '', '/');
	vi.restoreAllMocks();
});

const at = (path: string) => {
	url.current = new URL('https://site.test' + path);
	window.history.replaceState(null, '', path);
};
const pills = (c: HTMLElement, label: string) =>
	[...c.querySelectorAll(`nav[aria-label="${label}"] > a`)].map((a) => ({
		href: a.getAttribute('href'),
		current: a.getAttribute('aria-current'),
		noscroll: a.getAttribute('data-sveltekit-noscroll'),
		preload: a.getAttribute('data-sveltekit-preload-data')
	}));

describe.each([
	{ shell: ZapstoreShell, table: ZAPSTORE_SLUGS, label: 'Zapstore', domain: '/zapstore', other: '/zapstore/leaderboards' },
	{ shell: NutzapsShell, table: NUTZAPS_SLUGS, label: 'Nutzaps', domain: '/nutzaps', other: '/nutzaps/mints' }
])('$domain pill bar', ({ shell, table, label, domain, other }) => {
	it('draws its pills from its slug table, the open one the address names', () => {
		for (const [path, open] of [
			[domain, domain],
			[other, other]
		]) {
			at(path);
			const { container, unmount } = render(shell);
			expect(pills(container, label).map((p) => [p.href, p.current])).toEqual([
				[domain, open === domain ? 'page' : null],
				[other, open === other ? 'page' : null]
			]);
			unmount();
		}
	});

	// every address of the table, sections among them the day it has any: the open pill is the
	// one the slug names, or the one its section sits on, never none
	it('marks exactly one pill open at every address of its slug table', () => {
		const t: SlugTable = table;
		for (const path of [t.path, ...slugAddresses(t)]) {
			const slug = slugIn(path, t.path) ?? t.pills[0].slug;
			const open = isPill(t, slug) ? slug : own(t.sections, slug)!.pill;
			at(path);
			const { container, unmount } = render(shell);
			const marked = pills(container, label).filter((p) => p.current !== null);
			expect(marked, path).toEqual([
				expect.objectContaining({ href: addressOf(t, open), current: path === addressOf(t, open) ? 'page' : 'true' })
			]);
			unmount();
		}
	});

	it('starts a new page at its top, and never preloads: only a click asks the server', () => {
		at(domain);
		const { container } = render(shell);
		for (const p of pills(container, label)) {
			expect(p.noscroll, p.href!).toBe('false');
			expect(p.preload, p.href!).toBe('off');
		}
	});
});

describe.each([
	{
		// Any page: each takes its own `data` shape.
		page: ZapstoreOverview as Component<any>,
		domain: '/zapstore',
		data: {
			total: [],
			native: [],
			github: [],
			nativeShare: { daily: [] },
			releasesDaily: { native: [], newNative: [], github: [] },
			aggZaps: { daily: [], cumulative: [] }
		}
	},
	{ page: NutzapsOverview as Component<any>, domain: '/nutzaps', data: { dailySeries: [], nutzapsMAU: [] } }
])('$domain overview', ({ page, domain, data }) => {
	const target = { kind: 'page', pill: 'overview' };
	it('says why after a 302 (found) for an unknown slug, then drops the #gone', async () => {
		at(`${domain}#gone`);
		const { container } = render(page, { props: { data: { ...data, target } } });
		await tick();
		expect(container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe('That section is no longer on this page.');
		navigated.callbacks.at(-1)!({ type: 'enter', to: { url: new URL(`https://site.test${domain}#gone`) } });
		await new Promise((r) => setTimeout(r, 0));
		// the router's own move, replacing the entry
		expect(vi.mocked(goto)).toHaveBeenCalledWith(domain, { replaceState: true, noScroll: true, keepFocus: true });
		expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
	});

	it('shows no note anywhere else', async () => {
		at(domain);
		const { container } = render(page, { props: { data: { ...data, target } } });
		await tick();
		expect(container.querySelector('[data-transient-note]')).toBeNull();
	});
});
