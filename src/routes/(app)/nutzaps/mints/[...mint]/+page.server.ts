import { error } from '@sveltejs/kit';
import { getNutzapMintDetail } from '$lib/db/postgres';
import { mintUrlFromRoute } from '$lib/utils/mintUrl';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	// `[...mint]` captures everything after /nutzaps/mints/, including any path
	// segments and a port (e.g. 'mint.minibits.cash/Bitcoin', '8333.space:3338').
	// https is implied; an http mint's link carries ?scheme=http (mintHref).
	const mintUrl = mintUrlFromRoute(params.mint, url.searchParams.get('scheme'));
	const detail = await getNutzapMintDetail(mintUrl);
	if (!detail) {
		// Not on the 'All' leaderboard: unknown, or a test or private mint, which
		// is not counted anywhere on /nutzaps (nostrology-data#9).
		throw error(404, `No listed nutzap mint at ${mintUrl}`);
	}
	return { detail };
};
