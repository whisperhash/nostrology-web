import { error } from '@sveltejs/kit';
import {
	getZapstoreAppDetail,
	getZapstoreAppReleases,
	getZapstoreAppStackAppearances
} from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { pubkey, d_tag } = params;

	// Pubkey must be a 64-char lowercase hex string — anything else is a
	// malformed URL, not a real lookup.
	if (!/^[0-9a-f]{64}$/.test(pubkey)) {
		throw error(400, 'Invalid pubkey');
	}

	const [app, releases, stackAppearances] = await Promise.all([
		getZapstoreAppDetail(pubkey, d_tag),
		getZapstoreAppReleases(pubkey, d_tag),
		getZapstoreAppStackAppearances(pubkey, d_tag)
	]);
	if (!app) {
		throw error(404, `Zapstore app not found: ${d_tag}`);
	}

	return { app, releases, stackAppearances };
};
