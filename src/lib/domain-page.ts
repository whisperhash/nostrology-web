// A domain page with a slug table ($lib/slug-table), in the browser: which pill is open,
// whether What is counted is expanded, the note for a section that has gone, and what each
// navigation does. One module, so every domain page behaves the same; the page calls
// domainPage() once, while it initialises, and draws its pill bar with PillBar.svelte.
//
// PILLS ARE LINKS (since 2026-10-19). A pill is an address - /git/hosting - and a click on it
// is a SvelteKit navigation like any link's: it adds a history entry, so Back returns to the
// previous pill (the operator's call, 2026-10-19), and the address bar shows the pill's own
// address. That navigation runs only the page's server load, which answers the address in a
// few bytes; the page's document comes from the layout's load, which does not run again
// ($lib/server/slug-address). The click opens the pill at once (`pick`), ahead of that answer.
//
// THE ADDRESS DECIDES. After every navigation the open pill is the one the server's answer
// for the address names (`target`, read through the getter the page passes, since the page's
// `data` changes under it). The address also OPENS What is counted - /git/methodology - but
// never closes it: a reader who opened it by hand keeps it open across the pills.
//
// OPENING AT A SECTION (a section's own address, /git/zaps): its top just under the sticky
// nav, glowing once, and focus on it, so the next Tab and a screen reader carry on from
// there. On a cold load only when the document was opened fresh - a reload, or Back from
// another site, keeps the reader's own scroll - and after an in-site link, never after Back
// or Forward, whose restored scroll is the reader's. After a navigation it waits for a timer:
// the router scrolls and then re-applies that position from a timer of its own
// (@sveltejs/kit 2.51 client.js, _navigate -> scrollIntoView, reset_focus), and a timer
// queued here runs after both.
//
// THE PAGE MOVES ITSELF in three cases, each once the router has started (SvelteKit fires
// `enter` just before it marks itself started, and refuses to move until then - hence the
// timers), each keeping the query and REPLACING the history entry, so Back never returns to the
// address that was left: a `#gone` note has been read, so the hash is dropped (a move the router
// makes without asking the server, as only the hash differs); a retired slug's address becomes
// its pill's, so what the reader passes on is the page's own address and shows no note again;
// and an old /git#hosting link moves to /git/hosting ($lib/legacy-hash). Never the router's
// shallow replaceState: it keeps its own record of the page's address on the entry, and Back to
// that entry loads that address again, whatever the address bar said.
// An old link followed while the page is open is a jump within the page that only a
// `hashchange` reports, on an entry the browser pushed behind the router's back: that one is a
// full load of the address it meant ($lib/legacy-hash `reload`).

import { browser } from '$app/environment';
import { afterNavigate, goto } from '$app/navigation';
import { onMount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import { legacyAddress, reload } from '$lib/legacy-hash';
import { METHODOLOGY } from '$lib/methodology';
import { focusSection, glowSection, openedFresh, revealElement } from '$lib/section-link';
import { addressOf, defaultPill, GONE_HASH, own, resolveSlug, slugIn, type SlugTable, type Target } from '$lib/slug-table';

/** The note for a slug the server did not know, which it sent here with `#gone`. */
export const GONE_NOTE = 'That section is no longer on this page.';
/** The note for a recorded retired section, by its own title. */
export const retiredNote = (title: string) => `${title} is no longer on this page.`;

/** How the page moves itself: replacing the entry, and leaving the scroll and focus alone. */
const MOVE = { replaceState: true, noScroll: true, keepFocus: true } as const;

export interface DomainPage {
	/** The open pill's slug. */
	tab: Writable<string>;
	/** Whether What is counted is expanded: MethodologySection binds it. */
	methodologyOpen: Writable<boolean>;
	/** The note for a section that has gone (TransientNote); empty for none. */
	note: Writable<string>;
	/** A plain click on a pill: open it now. The router's navigation follows. */
	pick(slug: string): void;
}

/** The section a target opens at, if any. */
export function sectionOf(target: Target | undefined): string | undefined {
	return target?.kind === 'page' ? target.section : undefined;
}

/** Call once, while the page initialises: `target` reads the server's answer for the current
 * address (`() => data.target`). Absent - a test rendering the page with a document alone -
 * it is the domain's own address. */
export function domainPage(t: SlugTable, target: () => Target | undefined): DomainPage {
	const first = target();
	const tab = writable(first?.pill ?? defaultPill(t));
	const methodologyOpen = writable(sectionOf(first) === METHODOLOGY);
	const note = writable(browser && first?.kind === 'retired' ? retiredNote(first.title) : '');

	// An old /git#hosting link: the pill it meant opens before the first paint, so the server's
	// default pill never flashes, and the address follows on `enter`.
	const legacy = browser ? legacyAddress(t, window.location.hash) : null;
	if (legacy) {
		const meant = resolveSlug(t, slugIn(legacy, t.path));
		if (meant.kind === 'page') {
			tab.set(meant.pill);
			if (meant.section === METHODOLOGY) methodologyOpen.set(true);
		}
	}

	function arrive(slug: string) {
		const section = own(t.sections, slug);
		const el = section && document.getElementById(section.elementId);
		if (!el) return;
		revealElement(el);
		focusSection(el);
		glowSection(el);
	}
	const gone = () => window.location.hash === '#' + GONE_HASH;
	/** Move to `address`, keeping the query: the server keeps it on its redirects too. */
	const move = (address: string) => setTimeout(() => goto(address + window.location.search, MOVE), 0);

	onMount(() => {
		if (gone()) note.set(GONE_NOTE);
		// An old link followed while the page is open: a full load of the address it meant.
		const onHash = () => {
			const to = legacyAddress(t, window.location.hash);
			if (to) reload.at(to + window.location.search);
		};
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	});

	afterNavigate(({ type }) => {
		const now = target();
		if (type === 'enter') {
			if (legacy && legacy !== window.location.pathname) {
				move(legacy);
				return;
			}
			const section = sectionOf(now);
			if (section && openedFresh()) arrive(section);
			// The hash to drop: `#gone` once its note is read, or an old link that named the
			// address it is already at (/git#overview).
			if (gone() || legacy) move(window.location.pathname);
			else if (now?.kind === 'retired') move(addressOf(t, now.pill));
			return;
		}
		tab.set(now?.pill ?? defaultPill(t));
		const section = sectionOf(now);
		if (section === METHODOLOGY) methodologyOpen.set(true);
		if (gone()) {
			note.set(GONE_NOTE);
			move(window.location.pathname);
		} else if (now?.kind === 'retired') {
			note.set(retiredNote(now.title));
			move(addressOf(t, now.pill));
		}
		if (section && type !== 'popstate') setTimeout(() => arrive(section), 0);
	});

	return {
		tab,
		methodologyOpen,
		note,
		pick: (slug) => tab.set(slug)
	};
}
