import { match as hex64 } from '../../params/hex64';
import type { SlugTable } from '$lib/slug-table';

// /zapstore's slug table (the rules are in $lib/slug-table). Its pills are pages of their own,
// each its own route: /zapstore, and /zapstore/leaderboards. The table gives the domain the
// rules every domain page follows - an unknown slug is a 302 (found) back to /zapstore with a
// note rather than a 404 (not found) - and draws the pill bar. The detail pages sit under the
// collections `apps` and `publishers`. Only `apps` has a page at its own address, so only it is
// a route of its own: /zapstore/publishers, which has none, is an unknown slug like any other.
// /zapstore/<pubkey> is the old address of a publisher's page, kept as a redirect, so a word of
// that shape is never a slug.
export const ZAPSTORE_SLUGS: SlugTable = {
	path: '/zapstore',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'leaderboards', label: 'Leaderboards', ownRoute: true }
	],
	sections: {},
	former: {},
	retired: {},
	ownRoutes: ['apps'],
	ownShapes: { hex64 }
};
