import { error } from '@sveltejs/kit';
import { getZapstorePublisherDetail } from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { pubkey } = params;

	// The hex64 matcher already validates this server-side, but the explicit
	// check belt-and-braces against any future loosening of the matcher.
	if (!/^[0-9a-f]{64}$/.test(pubkey)) {
		throw error(400, 'Invalid pubkey');
	}

	const publisher = await getZapstorePublisherDetail(pubkey);
	if (!publisher) {
		throw error(404, `No Zapstore apps published by pubkey: ${pubkey}`);
	}

	return { publisher };
};
