import type { LayoutServerLoad } from './$types';
import { getMarketplacesRecentListings, getMarketplacesSnapshot } from '$lib/db/postgres';
import { RECENT_LIMIT, RECENT_PER_SELLER, RECENT_READ, selectShowable } from '$lib/markets/recent';
import { redirectsAway } from '$lib/server/slug-address';
import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import { seesSection, seesUnreleased, visibleTable } from '$lib/unreleased';

/** The section whose rows this load fetches; its entry in the slug table says whether it is
 *  still in development, and RecentListings.svelte draws it under the same name. */
const RECENT_SECTION = 'recent-listings';

// The whole page is one precomputed snapshot document (see SQL_MARKETPLACES_SNAPSHOT):
// a single-row read per visit, no per-request aggregation. Produced daily by
// nostrology-data's marketplaces_refresh job; append-only, so this always serves the
// newest complete refresh even while a new one is being written.
//
// A LAYOUT load, apart from the address (+page.server.ts), so that a pill click - a move
// between this page's own addresses - runs only the page load and sends only its small
// answer, never this document again ($lib/server/slug-address). It reads the address only
// untracked, to fetch nothing for an address the page load is about to redirect.
// Recent listings (What's for sale) is the one part of the page that is not in the
// snapshot: it is the newest rows of marketplaces_listings, the same refresh's other
// table. It is fetched HERE, beside the snapshot, for the same reason - a pill click must
// not re-fetch it - and in parallel with it, so the page costs one round trip, not two.
// A failure of this one read is not a failed page: the table is one section of one pill,
// and the rest of /marketplaces does not depend on it, so it resolves to no rows and the
// section is left out. The snapshot read still fails loud.
//
// THE SECTION'S SLUG-TABLE ENTRY DECIDES WHO IS SENT THESE ROWS ($lib/unreleased). Released
// (the operator's call of 2026-11-24), every reader is. Marked in development, this load does
// not read them at all for anyone but the operator: no query, no rows in the SSR payload and
// none in this route's __data.json, and the page draws no card because it is given nothing.
// That absence IS the gate - the page renders the section only when the server sent rows - and
// `recent` being absent rather than empty is what tells the two cases apart in a test.
//
// `seesSection` is asked rather than `seesUnreleased`, so the SLUG TABLE'S FLAG is the only
// switch: deleting `unreleased: true` releases the address, the title, the preview, the sitemap
// entry AND these rows together. Asking about the session alone would have left the rows hidden
// from everyone the day the flag came off - two edits in two files with nothing coupling them.
//
// The cut (how many rows, how many per seller, which rows a marketplace can actually show, and
// one row per title) is $lib/markets/recent's. The per-seller cap, the read window and the expiry
// test are applied in SQL; the per-marketplace showable test and the title test run here, because
// the first reads each marketplace's own conditions and the second compares titles as the page
// draws them, neither of which the database has. The document then carries exactly the rows the
// table draws - the counts selectShowable also returns are not sent, because nothing on the page
// states them.
export const load: LayoutServerLoad = async ({ url, untrack, locals }) => {
	const sees = seesSection(MARKETPLACES_SLUGS, RECENT_SECTION, locals.session);
	if (
		untrack(() =>
			redirectsAway(
				visibleTable(MARKETPLACES_SLUGS, seesUnreleased(locals.session)),
				url.pathname
			)
		)
	)
		return {};
	// ONE clock read for the request, passed on to the page. The cut and the table both ask
	// "has this listing expired?", and reading Date.now() in each - on the server and then
	// again while the browser hydrates - lets a listing expiring in that gap render as a link
	// on the server and as plain text in the browser, which is a hydration mismatch inside a
	// keyed each.
	const now = Date.now();
	const [snapshot, read] = await Promise.all([
		getMarketplacesSnapshot(),
		sees
			? getMarketplacesRecentListings(RECENT_READ, RECENT_PER_SELLER, now).catch((err) => {
					console.error('/marketplaces: recent listings unavailable', err);
					return [];
				})
			: Promise.resolve(null)
	]);
	if (read === null) return { snapshot };
	const cut = selectShowable(read, now);
	warnIfShort(cut);
	return { snapshot, recent: cut.rows, recentAt: now };
};

/**
 * One line in the log when the cuts left the table short of RECENT_LIMIT, and
 * nothing when it did not (nostrology-web#28 (Recent listings can come up short: the
 * openability cut runs after the database's limit), the operator's call of 2026-10-24: "output
 * a warn into the logs. Log how short it shows up vs expected").
 *
 * WHY A LOG RATHER THAN ANYTHING A READER SEES: a short table cannot be WRONG - the caption
 * counts the rows it was handed, so it says "The 43 most recent live listings" rather than
 * claiming 60 - so this is a signal for us, not a notice for them. The cuts run AFTER the
 * database's LIMIT, so the only things that can shorten the table are a change in what the
 * marketplaces will render and a burst of one repeated title, and those are exactly the events
 * this says out loud - `unopenable` and `repeated` say which.
 *
 * `expected` is the smaller of the table's size and what the read returned: a live pool too
 * small to fill the table is not the cut's doing, and a warning that fires on a fresh or tiny
 * database is a warning nobody will read twice.
 *
 * ONE LINE PER READ, so one per visit that fetches the document: the operator's alone while the
 * section is in development, every reader's once it is released. That is worth revisiting if it
 * is ever public AND short at the same time, which is the state this exists to announce.
 *
 * The JSON shape is the nozzl logging convention (hooks.server.ts writes its page-view line the
 * same way), so Loki's `| json` gives `shown` and `expected` as fields rather than text to
 * parse out of a sentence.
 */
function warnIfShort(cut: {
	rows: unknown[];
	read: number;
	unopenable: number;
	repeated: number;
}): void {
	const expected = Math.min(RECENT_LIMIT, cut.read);
	if (cut.rows.length >= expected) return;
	console.log(
		JSON.stringify({
			ts: new Date().toISOString(),
			level: 'warn',
			msg: '/marketplaces: recent listings came up short',
			shown: cut.rows.length,
			expected,
			short_by: expected - cut.rows.length,
			read: cut.read,
			unopenable: cut.unopenable,
			repeated: cut.repeated
		})
	);
}
