// The cut Recent listings is drawn from, in one place: the server reads these rows
// (+layout.server.ts -> SQL_MARKETPLACES_RECENT), applies this cut, and the section's
// caption states it (RecentListings.svelte), so they must not drift apart.
import { listingTarget } from '$lib/markets/links';
import { labelText } from '$lib/ngit/format';
import type { MarketsRecentListing } from '$lib/shared/data-types';

/** How many rows the table shows. */
export const RECENT_LIMIT = 60;

/**
 * At most this many rows per seller, or null for every listing in date order.
 *
 * WHY A CAP AT ALL. One shop can hold the whole window: on 2026-10-23 a single seller had
 * 252 of the 400 newest live listings, and 397 of one day's 418 came from another.
 * Uncapped, the table is an honest record of what arrived and reads as one shop's stock
 * list - the thing a reader cannot tell from a chart is exactly WHO is listing, and
 * uncapped it answers "that one". At two rows a seller, the same 60 rows carry about
 * thirty sellers. The caption says which it is, either way: a cap that is not stated is a
 * lie about the order.
 *
 * THE CAP IS APPLIED BEFORE THE LIMIT, in SQL (a row_number() per seller), never after -
 * capping the 60 newest rows left 10 of them, because the newest 60 were 7 sellers.
 *
 * SETTLED AT TWO (the operator, 2026-10-23), and it is a knob of the PAGE by design: the
 * pipeline writes every live listing to marketplaces_listings, and the cap is a parameter of
 * the read (SQL_MARKETPLACES_RECENT's $2), so another number here changes the table with no
 * pipeline, database or refresh change - which is the operator's requirement, so the UI can
 * vary this without touching the data.
 */
export const RECENT_PER_SELLER: number | null = 2;

/**
 * How many rows the server READS to fill those RECENT_LIMIT. More than the table shows,
 * because a row no marketplace can open is dropped, and so is a repeated title (both below), and
 * the table should still be full. Four times is well clear of the measured loss:
 *
 * - Openability, 3 of 400 on 2026-10-23, measured with the five pipeline facts supplied from the
 *   archive before the table carried them (it has since 2026-10-24). Those 3 were all
 *   NIP-40-expired, and expiry is now cut in the query instead, where the LIMIT can see it
 *   (SQL_MARKETPLACES_RECENT), so what is left for this cut to drop is the per-marketplace
 *   conditions alone.
 * - Repeated titles, at most 62 of the 240 on any of the 31 days to 2026-11-04, replayed as of each
 *   day. That left at least 178 rows for a table of 60, with the table full on all 31 days.
 *
 * The read scans the WHOLE live pool and sorts it: the per-seller window partitions every
 * live row and no date predicate bounds it, so there is no "newest rows" index scan to be had.
 * Measured on the live cluster 2026-11-04 with this statement: a sequential scan into a sort
 * that SPILLS TO DISK (`external merge`, about 3.9 MB), cost 2,797.35, 23.0 ms at best. The
 * scan node itself is a coin flip - the bitmap alternative is 0.19% away, inside the planner's
 * fuzz window - so do not read a change there as meaningful.
 *
 * A partial index shaped for THAT SORT - (pubkey, effective_ts DESC, coalesce(d_tag,'')) over
 * the live pool - exists in nostrology-data's schema/init.sql as idx_mkl_live_seller_eff. It is
 * RETAINED, UNUSED AND DEFERRED on purpose (2026-11-04). It is not a bad index: lower
 * random_page_cost (4 here, the stock default) to 1.0 and the planner takes it unprompted with
 * no sort node at all, 9.97 ms against 23.0, the steadiest plan of the four measured. The
 * estate deliberately sets no planner cost parameter, so it stays unreachable rather than
 * useless. An index on the date alone is never used either.
 *
 * WHAT TO REACH FOR FIRST if this page gets slow is not the index but work_mem, and NOT from
 * here: the fix is one line in nostrology-data's schema/roles.sql, which already carries three
 * such settings for the role this pool connects as - ALTER ROLE nostrology_web SET work_mem =
 * '8MB'. The sort spills past work_mem, and the same arithmetic flips the plan to a slower,
 * much less predictable parallel one once the row ESTIMATE passes it, so one setting fixes
 * both. init.sql has the numbers and the order to do it in; nostrology-web#30 (Recent listings: the read sorts the whole live pool, and its index
 * is unreachable at the default random_page_cost) tracks it.
 *
 * The window still has to see every live row either way; it is the sort that grows with the
 * table.
 * nostrology-web#28 (Recent listings can come up short: the openability cut runs after the
 * database's limit) carries the shortening, and the layout load now says so in the log when it
 * happens.
 */
export const RECENT_READ = RECENT_LIMIT * 4;

/**
 * What a row is called in the table: the title as published, else the pipeline's lowercased copy
 * for a row with no `title` tag, and a stated placeholder when nothing visible is left. In one
 * place because the one-row-per-title cut below has to compare exactly what the table draws: a
 * key built from anything else would let two rows read the same on the page.
 *
 * `title_tag`, not `title`: the stored `title` is folded by a different rule in the pipeline, and
 * it keeps a trailing space that this drops, so comparing it misses twins a reader sees as one.
 */
export function listingTitle(r: Pick<MarketsRecentListing, 'title' | 'title_tag'>): string {
	return labelText(r.title_tag ?? r.title);
}

/**
 * The ways two titles come to read the same in the table, folded so that they compare equal.
 * labelText has already removed control and format characters and the outer whitespace; a browser
 * collapses a run of spaces, NFC makes a composed and a decomposed accent one string, and the case
 * is folded because "Fresas" and "FRESAS" are the same name to a reader. Not chased further: a
 * lookalike letter from another alphabet, or an invisible character labelText leaves inside a title
 * (U+FE0F, U+2800). Those are 0 pairs in the live pool, and a seller set on a second row could
 * always use the lookalike, so the cut is for repeats and not for evasion.
 */
function titleKey(title: string): string {
	return title.normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
}

/** The rows the table draws, and what was left out to get them. */
export type RecentSelection = {
	/** At most RECENT_LIMIT rows, newest first, every one openable, no two with the same title. */
	rows: MarketsRecentListing[];
	/** How many rows were read before the cut. */
	read: number;
	/** How many of those no marketplace this page links to can show. */
	unopenable: number;
	/** How many of the openable ones repeat the title of a newer openable one. */
	repeated: number;
};

/**
 * Drop every listing that no marketplace we link to can show, keep the newest of each title, then
 * cut to RECENT_LIMIT.
 *
 * WHY DROP IT RATHER THAN DRAW IT UNLINKED (the operator's instruction, 2026-10-23). The
 * section exists so that a reader can click a row and see the listing for themselves; a
 * row they cannot open is a row that does not do that job, and before this it offered a
 * name that led to "Listing not available", to "Product not found", or to a spinner that
 * never resolves. Each marketplace's own conditions are read from its deployed source in
 * $lib/markets/links, so the question "can anybody show this?" has one answer here.
 *
 * It costs the table its last claim to being a plain record of arrivals: these rows are
 * the newest live listings THAT OPEN SOMEWHERE, and the caption has to say so, which is
 * why this returns the counts rather than just the rows. Every figure elsewhere on the
 * page still counts the whole live pool - this cut is the table's alone.
 *
 * ONE ROW PER TITLE (the operator's call, 2026-11-04, after reading identical titles in this
 * table as a defect). Every repeat was a real, separately signed listing: identity on Nostr is
 * the key plus the `d` tag, so a new `d` or a new key is a second listing however identical the
 * rest, and on any day since the table landed 1 to 4 titles appeared twice and our own placeholder
 * for an untitled listing filled up to 10 rows.
 *
 * It keeps the NEWEST, which is the first in the read's order (effective_ts DESC, then pubkey and
 * d_tag, so a same-second tie resolves the same way every time). It runs after the openable filter
 * so that a row nobody can open cannot claim a title from one somebody can. What it costs: a
 * second real seller of a common title drops out, and untitled listings shrink to one row, which
 * nearly removes from the table the sellers who publish only those. That is why the caption says
 * so, and why this is the table's cut alone: every other figure on the page still counts every
 * one of those listings, and an MCP record of the pool must not inherit it.
 *
 * Here and not in the SQL: the key is the title as drawn (listingTitle), which SQL cannot compute,
 * and this file's tests run in CI where the database's are skipped. The per-seller cap still runs
 * first, in SQL, so a seller whose two newest share a title shows one row, not their third.
 *
 * THESE RUN AFTER THE DATABASE'S LIMIT, so a sharp change in what the marketplaces will render, or
 * a burst of one repeated title across sellers, leaves the table SHORT rather than wrong - the
 * caption counts the rows it is given. Measured headroom is at RECENT_READ above; the read is 4x
 * the table, and the capped pool it comes from was 2,540 rows from 1,798 live sellers on
 * 2026-10-23. Options and the recommendation are nostrology-web#28 (Recent listings can come up
 * short: the openability cut runs after the database's limit); recent.test.ts pins the short case
 * rather than leaving it to be found.
 */
export function selectShowable(
	rows: MarketsRecentListing[],
	now: number = Date.now()
): RecentSelection {
	const openable = rows.filter((r) => listingTarget(r, now) !== null);
	const seen = new Set<string>();
	const distinct = openable.filter((r) => {
		const key = titleKey(listingTitle(r));
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return {
		rows: distinct.slice(0, RECENT_LIMIT),
		read: rows.length,
		unopenable: rows.length - openable.length,
		repeated: openable.length - distinct.length
	};
}
