import { error } from '@sveltejs/kit';
import { getRelayDetail } from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// `[...relay]` captures everything after /relays/ — including paths
	// (e.g. 'relay.example.com/inbox'). Stored URLs use wss://, so prepend
	// the protocol back here. ws:// relays exist in the wild but are
	// effectively never used in practice; if any show up, they'll 404 (a
	// follow-up could add ws:// fallback).
	const relayUrl = `wss://${params.relay}`;
	const detail = await getRelayDetail(relayUrl);
	if (!detail) {
		throw error(404, `No NIP-65 declarations for relay ${relayUrl}`);
	}
	return { detail };
};
