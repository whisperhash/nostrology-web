import type { PageServerLoad } from './$types';
import { answerAddress } from '$lib/server/slug-address';
import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import { seesUnreleased, visibleTable } from '$lib/unreleased';

// The address: /marketplaces and /marketplaces/<slug> render this page (src/hooks.ts), and
// `target` says what the slug means ($lib/slug-table), or the load redirects. Answered here,
// on the server, and nowhere else. The snapshot is the layout's (+layout.server.ts).
//
// `visibleTable` is what keeps a section still in development out of the answer: for anyone
// but the operator, its address is not a slug this domain has, so it gets the 302 (found) and
// the generic note that any unknown word gets - no page title of its own and no link preview
// naming it ($lib/unreleased).
export const load: PageServerLoad = ({ url, setHeaders, locals }) => ({
	target: answerAddress(
		visibleTable(MARKETPLACES_SLUGS, seesUnreleased(locals.session)),
		url,
		setHeaders
	)
});
