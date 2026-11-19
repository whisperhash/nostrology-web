import { methodologySection } from '$lib/methodology';
import type { SlugTable } from '$lib/slug-table';

// /git's slug table (the rules are in $lib/slug-table). The pill bar is drawn from `pills`,
// in this order. Zaps was the first section with an address of its own, taken the whole way
// first (the operator's call, 2026-10-19); What is counted joined it the same day. More
// sections waited for a way to grab a link to any section (the operator, 2026-10-19): that is
// the link icon, SectionLink, and a section takes an address now at the operator's call.
export const GIT_SLUGS: SlugTable = {
	path: '/git',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'repositories', label: 'Repositories' },
		{ slug: 'hosting', label: 'Hosting' },
		{ slug: 'maintainers', label: 'Maintainers' },
		{ slug: 'collaboration', label: 'Collaboration' }
	],
	sections: {
		zaps: {
			pill: 'collaboration',
			elementId: 'ngit-zaps',
			title: 'Zaps',
			preview: {
				title: 'Git on Nostr: the most-zapped repositories',
				description:
					"The git repositories on Nostr that draw the most zaps, counted from zap receipts that pay one of the repository's maintainers."
			}
		},
		methodology: methodologySection('overview')
	},
	former: {},
	retired: {},
	ownRoutes: []
};
