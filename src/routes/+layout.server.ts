// Hands the server-verified Nostr identity to every page.
//
// This is what lets the nav render correctly in the SERVER-RENDERED HTML - a logged-in
// user never sees a "Log in" button flash before hydration. The value is derived from
// the session cookie's HMAC in hooks.server.ts, so it cannot be forged by the client.
//
// Only the pubkey crosses the boundary from the session. The profile (avatar, name, NIP-05 (DNS
// identifier) handle) is fetched client-side instead: it is public Nostr data, and making the SSR
// path depend on a relay round trip would put a third-party network hop in front of
// every page load.

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	session: locals.session,
	// The operator's signed-in session (hooks.server.ts). The root layout skips GA
	// entirely when true. Server-rendered on every document request, so it needs no
	// storage in the browser and cannot be expired by it.
	analyticsOff: locals.analyticsOff
});
