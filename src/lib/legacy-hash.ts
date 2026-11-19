// Old links of the form /<domain>#<pill> and /<domain>#methodology. Until 2026-10-19 a pill
// click wrote /git#hosting into the address bar and What is counted's icon copied
// /git#methodology, so links of that form sit in chats and notes. The part after `#` never
// reaches the server, so the page reads it in the browser and moves to the address it meant.
//
// A COURTESY, NOT A COMMITMENT (the operator, 2026-10-19: "it's a nice to have. I don't want
// to be maintaining compatibility with these old-form links forever, ideally"). To drop it,
// delete this file and its test, its uses in $lib/domain-page (`legacy`, and the `hashchange`
// listener), the old-link tests in each domain page's tests (git-page, marketplaces-page,
// routstr-page), and the old-link steps of scripts/verify-section-link.mjs (3c) and
// scripts/verify-methodology-link.mjs (3 and 4); src/routes/(app)/markets/+server.ts keeps
// `/markets#geography` working only through it. An old link then opens the domain's default
// pill, as any unknown hash does.

import { addressOf, isPill, own, type SlugTable } from '$lib/slug-table';

/** The address an old `#slug` link meant, or null when the hash names nothing on this domain.
 * Current pills and sections only: the old hashes were the pills' and What is counted's, and
 * the slugs kept their words (the operator's call, 2026-10-19), so each still names its own. */
export function legacyAddress(t: SlugTable, hash: string): string | null {
	const slug = hash.replace(/^#/, '');
	return slug && (isPill(t, slug) || own(t.sections, slug)) ? addressOf(t, slug) : null;
}

/** How an old link followed while the page is open moves to the address it meant: a full load of
 * that address, replacing the entry. The browser pushed that `#` entry itself, behind the router's
 * back, and a move of the router's own replacing it left Back stuck on the page with the address
 * bar showing another address (fresh-context review, 2026-10-19). Replacing, never `assign`:
 * the old `#` entry must not stay behind for Back to land on. Rare enough that a full load costs
 * nothing worth saving. An object, so a page's test can stand in for it, and the location a
 * parameter, so this one's test can stand in for the browser's. */
export const reload = {
	at: (address: string, location: Pick<Location, 'replace'> = window.location): void => location.replace(address)
};

