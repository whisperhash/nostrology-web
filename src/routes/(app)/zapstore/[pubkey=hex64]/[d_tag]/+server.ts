import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy app URL: /zapstore/<pubkey>/<d_tag> -> /zapstore/apps/<pubkey>/<d_tag>.
//
// An app's identity is the (pubkey, d_tag) pair - the NIP-01 addressable
// coordinate 32267:<pubkey>:<d-tag> - so both segments stay in the path. What
// changed is the parent: apps now live under /zapstore/apps, the collection
// that already listed them, instead of hanging off /zapstore directly.
//
// See the sibling shim at ../+server.ts for why this is a 308, and why
// url.search is carried across.
//
// params.d_tag arrives already percent-decoded, so re-encode it: d-tags are
// reverse-DNS app ids today, but nothing in NIP-01 stops one carrying a
// character that must not appear raw in a Location header. Pinned by a test -
// do not "simplify" this to a bare interpolation.
export const GET: RequestHandler = ({ params, url }) => {
	redirect(
		308,
		`/zapstore/apps/${params.pubkey}/${encodeURIComponent(params.d_tag)}${url.search}`
	);
};
