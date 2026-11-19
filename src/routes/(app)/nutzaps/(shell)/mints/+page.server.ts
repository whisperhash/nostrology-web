import {
	getNutzapMintStats,
	getNutzapsTopMintsCumulativeSeries,
	parseNutzapMintStatsPeriod
} from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period = parseNutzapMintStatsPeriod(url);
	// Fetch the max the selector exposes (Top 20). The page slices to 5 / 10
	// / 20 client-side, so switching the selector is instant — no refetch.
	const [mintStats, topMintsCumulative] = await Promise.all([
		getNutzapMintStats(period),
		getNutzapsTopMintsCumulativeSeries(20)
	]);

	return {
		mintStats,
		topMintsCumulative,
		period
	};
};
