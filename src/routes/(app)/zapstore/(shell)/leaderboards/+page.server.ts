import {
	getZapstoreAppLeaderboards,
	getZapstoreAppStackLeaderboards,
	getZapstorePublisherAppCounts,
	getZapstorePublisherZapLeaderboards
} from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [appLeaderboards, appStackLeaderboards, publisherAppCounts, publisherZapLeaderboards] =
		await Promise.all([
			getZapstoreAppLeaderboards(),
			getZapstoreAppStackLeaderboards(),
			getZapstorePublisherAppCounts(),
			getZapstorePublisherZapLeaderboards()
		]);
	return {
		appLeaderboards,
		appStackLeaderboards,
		publisherAppCounts,
		publisherZapLeaderboards
	};
};
