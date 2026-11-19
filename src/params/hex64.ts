import type { ParamMatcher } from '@sveltejs/kit';

// Matches a 64-character lowercase-hex string - the canonical form for a
// Nostr pubkey or event_id. Used by /zapstore/publishers/[pubkey=hex64] and
// /zapstore/apps/[pubkey=hex64]/[d_tag], and by /zapstore/[pubkey=hex64], the
// old address of a publisher's page, kept as a redirect.
//
// Under a collection (publishers/, apps/) it is VALIDATION: a malformed pubkey
// misses the route and answers 404 (not found) without reaching a DB lookup
// that would bill Aurora only to return nothing. (Written when the cluster
// scaled to zero, so such a lookup also paid a ~15 s resume; it has held a
// 0.5-ACU warm floor since 2026-08-03.)
//
// Directly under /zapstore it is DISAMBIGUATION again, as it was before the
// collections went in: /zapstore's slug table names this matcher in
// `ownShapes` ($lib/slug-tables/zapstore), so src/hooks.ts leaves a word of
// this shape to the old-address redirect instead of rerouting it to the
// domain's page, and no slug may have the shape. Drop the redirect folder and
// the `ownShapes` entry together: src/lib/slug-table.test.ts holds the two to
// each other.
export const match: ParamMatcher = (param) => /^[0-9a-f]{64}$/.test(param);
