import { json } from '@sveltejs/kit';
import { getNutzapMintStats, parseNutzapMintStatsPeriod } from '$lib/db/postgres';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const period = parseNutzapMintStatsPeriod(url);
	const items = await getNutzapMintStats(period);
	return json({ items, period });
};
