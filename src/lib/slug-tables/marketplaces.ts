import { methodologySection } from '$lib/methodology';
import type { SlugTable } from '$lib/slug-table';

// /marketplaces' slug table (the rules are in $lib/slug-table). The pill bar is drawn from
// `pills`, in this order. The slugs kept the words the pills' old `#` links used (the
// operator's call, 2026-10-19), so "What's for sale" is `catalogue`.
export const MARKETPLACES_SLUGS: SlugTable = {
	path: '/marketplaces',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'growth', label: 'Growth' },
		{ slug: 'catalogue', label: "What's for sale" },
		{ slug: 'geography', label: 'Geography' },
		{ slug: 'shipping', label: 'Shipping' }
	],
	sections: {
		// Categories took an address of its own on 2026-11-04 (the operator's call: "in the same
		// fashion and using the same mechanism as for Recent listings"). It sits first on What's
		// for sale and is for every reader, so it is in the sitemap, and its preview is its own
		// for the same reason as the two sections before it: a reader who is sent this address
		// is being sent the categories, not the page. The copy says the tags sellers use MOST,
		// never every tag: the pipeline floors the tags by sellers and then keeps the top of the
		// list, so the card draws a few of thousands. It states neither number, because the
		// floor is in the snapshot and neither is this copy's to follow.
		categories: {
			pill: 'catalogue',
			elementId: 'markets-categories',
			title: 'Categories',
			preview: {
				title: 'Nostr marketplaces: listings by category',
				description:
					'What is for sale across the Nostr marketplaces, by category: the tags sellers use most on their live listings, and how many listings and sellers carry each.'
			}
		},
		// Recent listings took an address of its own on 2026-10-23 (the operator's call: "I want
		// this section linkable in the identical fashion as the Zaps in /git"), the second
		// section on the site to have one. It sits on What's for sale, and its preview is its
		// own: a reader who is sent this address is being sent the listings, not the page.
		'recent-listings': {
			pill: 'catalogue',
			elementId: 'markets-recent-listings',
			title: 'Recent listings',
			preview: {
				title: 'Nostr marketplaces: the newest listings',
				description:
					'The newest listings across the Nostr marketplaces - what each one is, where it ships from and what it costs - each opening on a marketplace that can show it.'
			}
		},
		methodology: methodologySection('overview')
	},
	former: {},
	retired: {},
	ownRoutes: []
};
