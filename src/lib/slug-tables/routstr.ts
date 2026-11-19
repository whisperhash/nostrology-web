import { methodologySection } from '$lib/methodology';
import type { SlugTable } from '$lib/slug-table';

// /routstr's slug table (the rules are in $lib/slug-table). The pill bar is drawn from
// `pills`, in this order. The domain is still hidden from the nav, from search engines and
// from the sitemap ($lib/seo/sitemap), and so are its addresses.
export const ROUTSTR_SLUGS: SlugTable = {
	path: '/routstr',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'providers', label: 'Providers' },
		{ slug: 'models', label: 'Models' },
		{ slug: 'network', label: 'Network' }
	],
	sections: {
		methodology: methodologySection('overview')
	},
	former: {},
	retired: {},
	ownRoutes: []
};
