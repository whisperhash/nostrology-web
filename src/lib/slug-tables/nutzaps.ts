import type { SlugTable } from '$lib/slug-table';

// /nutzaps' slug table (the rules are in $lib/slug-table). Its pills are pages of their own,
// each its own route: /nutzaps, and /nutzaps/mints, which is also the collection the mint
// pages sit under (/nutzaps/mints/<mint>). The table gives the domain the rules every domain
// page follows - an unknown slug is a 302 (found) back to /nutzaps with a note rather than a
// 404 (not found) - and draws the pill bar.
export const NUTZAPS_SLUGS: SlugTable = {
	path: '/nutzaps',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'mints', label: 'Mints', ownRoute: true }
	],
	sections: {},
	former: {},
	retired: {},
	ownRoutes: []
};
