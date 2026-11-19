import {
	getZapstoreAppReleasesDaily,
	getZapstoreAppsCumulativeDaily,
	getZapstoreNativeShareDaily,
	getZapstoreZapsAggregateDaily
} from '$lib/db/postgres';
import { answerAddress } from '$lib/server/slug-address';
import { ZAPSTORE_SLUGS } from '$lib/slug-tables/zapstore';
import type { PageServerLoad } from './$types';

// /zapstore/<slug> renders this page too (src/hooks.ts, $lib/slug-table), and its address is
// answered first: the default pill's own slug and a slug the table does not know are
// redirected before the database is asked anything. Its other pill is a route of its own.
export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const target = answerAddress(ZAPSTORE_SLUGS, url, setHeaders);
	const [cumulative, nativeShare, aggZaps, releasesDaily] = await Promise.all([
		getZapstoreAppsCumulativeDaily(),
		getZapstoreNativeShareDaily(),
		getZapstoreZapsAggregateDaily(),
		getZapstoreAppReleasesDaily()
	]);
	return { ...cumulative, nativeShare, aggZaps, releasesDaily, target };
};
