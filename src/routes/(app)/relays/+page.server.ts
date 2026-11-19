import {
	getRelayStats,
	getRelayPerUserDistribution,
	getRelayTierUserCounts
} from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	// All three queries now read from materialized views (see postgres.ts +
	// nostrology-data's schema/init.sql) so each is sub-50 ms. We still stream the
	// promises rather than awaiting because the streaming machinery
	// downstream — chart placeholders, the table's "Loading…" hint, the
	// table-mounted-from-page-load layout — was built around it and works
	// fine even when each promise resolves immediately.
	return {
		relays: getRelayStats(),
		perUserDistribution: getRelayPerUserDistribution(),
		tierUserCounts: getRelayTierUserCounts()
	};
};
