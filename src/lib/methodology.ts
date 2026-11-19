// What is counted, on every domain page that has it: a section with an address of its own,
// /<domain>/methodology (/git/methodology), which opens the page on the pill holding the
// section, expanded, just under the nav.
//
// WHY. "How did you arrive at that number?" is the question the operator fields most often
// about any figure on the site, and the answer is always the same section. It is collapsed by
// default on purpose - the figures come first, the method is there for whoever wants it - so
// a bare link to the page leaves the asker to find the pill, find the section and open it.
// One address that lands them on the open section is the whole point.
//
// SHAPE OF THE CONVENTION (nostrology-web CLAUDE.md -> "Every domain page's What is counted
// has an address" - the expectation for every new domain):
//   - the section is $lib/components/MethodologySection.svelte: a <details>, COLLAPSED by
//     default, carrying id="methodology", plus the link icon that copies the address;
//   - its slug is `methodology` in the domain's slug table, as methodologySection() below
//     builds it, so the server answers /<domain>/methodology like any other section's
//     address ($lib/slug-table) and sends the section already expanded;
//   - opening or closing it by hand leaves the address bar alone, and the address only ever
//     OPENS it ($lib/domain-page): a reader who opened it keeps it open across the pills.
// Until 2026-10-19 the address was `<page>#methodology`; an old link of that form still lands
// ($lib/legacy-hash), for as long as that courtesy is kept.

import type { SectionEntry } from '$lib/slug-table';

/** What is counted's slug in every slug table that has the section. */
export const METHODOLOGY = 'methodology';
/** The id the section's element carries. */
export const METHODOLOGY_ID = 'methodology';
/** The heading, the same on every domain page (the operator's call, 2026-10-18, when
 * /routstr's "What is counted - and who is not" was renamed to it). */
export const METHODOLOGY_TITLE = 'What is counted';

/** What is counted as a section of a domain's slug table, on the pill that holds it. It
 * carries no preview of its own: its address draws the domain's. */
export function methodologySection(pill: string): SectionEntry {
	return { pill, elementId: METHODOLOGY_ID, title: METHODOLOGY_TITLE };
}
