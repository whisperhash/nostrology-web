<script lang="ts">
	// Recent listings: the newest live listings, one row each, re-sortable by any column. It
	// is here so that the growth the charts above draw as a curve can be read as the
	// listings themselves - a reader who wants to know whether a steep week is real can look
	// at what arrived in it, and so can we.
	//
	// EVERY CELL IS A SELLER'S OWN TEXT. A title, a seller's name, a location, a category and
	// a client name all come from a stranger's event, so each goes through visibleText() -
	// which strips the control and format characters that would reorder or hide a line - and
	// sits in a <bdi>, which keeps a right-to-left title from rearranging the row around it.
	// The same treatment /git gives repository names.
	import SectionLink from '$lib/components/SectionLink.svelte';
	import SortTh from '$lib/components/ngit/SortTh.svelte';
	import { personLabel, visibleText } from '$lib/ngit/format';
	import { njumpUrl } from '$lib/ngit/links';
	import { BTC_ORANGE } from '$lib/ngit/palette';
	import { sortRows, type SortDir } from '$lib/ngit/series';
	import { isBitcoinUnit } from '$lib/markets/currency';
	import { liveMarketplaces, listingTarget } from '$lib/markets/links';
	import { listingTitle } from '$lib/markets/recent';
	import { sortInk } from '$lib/sort-ink';
	import { addressOf } from '$lib/slug-table';
	import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
	import type { MarketsRecentListing } from '$lib/shared/data-types';

	// THIS SECTION HAS AN ADDRESS OF ITS OWN - /marketplaces/recent-listings - the way /git's
	// Zaps does (the operator's call, 2026-10-23). Everything about it is the slug table's
	// ($lib/slug-tables/marketplaces): the pill it sits on, the id below, the heading, and the
	// link preview the address draws. So the heading here and the title there must agree, which
	// RecentListings.test.ts pins - a renamed heading with a stale slug-table title would give
	// the link icon a name the reader cannot see.
	const SECTION = 'recent-listings';
	const ENTRY = MARKETPLACES_SLUGS.sections[SECTION];

	/**
	 * The newest live listings that open somewhere, newest first, as the server cut them
	 * ($lib/markets/recent -> selectShowable).
	 *
	 * NO DEFAULT, deliberately, and it is what holds the gate: the server sends `recent` only
	 * to a reader who may see this section while it is in development ($lib/unreleased), so the
	 * page must render the card only when it HAS rows. A default here would make
	 * `rows={data.recent}` type-check with `recent` absent, and the gate would then rest on this
	 * component drawing nothing when empty - one later change away from a visitor seeing a
	 * headed, empty card. Without it, dropping the page's `{#if data.recent}` fails
	 * `npm run check` instead of failing quietly.
	 */
	export let rows: MarketsRecentListing[];
	/** The snapshot's country table, for naming a row's `cc`. */
	export let countries: { cc: string; name: string }[] = [];
	/**
	 * At most this many rows per seller, or null for plain date order - whichever the
	 * server applied ($lib/markets/recent, in SQL). This component does not cut anything:
	 * it STATES the cut, because a cap that is not stated is a lie about the order.
	 */
	export let perSeller: number | null = null;
	/** On a phone, whether the link icon is drawn on THIS card: the page works out which one
	 * section gets it (P1) and only that card draws it (SectionLink). */
	export let phoneShown = false;
	/**
	 * When the server read these rows. Expiry is the one thing here that depends on the
	 * clock, and reading it again while the browser hydrates would let a listing expiring in
	 * that gap render differently in the two passes - a mismatch inside a keyed each. The
	 * page passes the server's instant (+layout.server.ts); a caller with none gets now.
	 */
	export let now: number | undefined = undefined;

	// What the Where cell says, in this order: the country the listing resolved to, else
	// what the seller actually wrote in its `location` tag, else nothing. The seller's own
	// words come BEFORE our bucket names: "Online" and "Europe" are what they typed, while
	// NONGEO and AMBIG are how this site classified them, and a reader checking a row
	// against the listing should see the listing's words. The bucket name is the last
	// resort, for a row that resolved to a bucket from something other than its location.
	const COUNTRYLESS: Record<string, string> = {
		NONGEO: 'Online, worldwide',
		REGION: 'A region',
		AMBIG: 'Unclear place'
	};

	const whereOf = (r: MarketsRecentListing): string => {
		const name = r.cc ? countries.find((c) => c.cc === r.cc)?.name : undefined;
		if (name) return name;
		const said = visibleText(r.location);
		if (said !== '') return said.slice(0, 40);
		return (r.cc && COUNTRYLESS[r.cc]) || '';
	};

	/**
	 * The price as the listing quotes it: the amount grouped, with the seller's OWN decimals
	 * kept (toLocaleString's default drops a trailing zero, which turned a listing's "23.50"
	 * into "23.5" - a price that is not the one on the listing), and the currency as
	 * published. The page does not normalise the unit here: a listing says SAT, sats, USD,
	 * EUR, and a reader comparing a row to the listing should see what it says. The one
	 * exception is upstream: a family's kept row with no price of its own carries its newest
	 * priced child's (the pipeline's fold_product_options).
	 *
	 * `cur` is EMPTY for a `price` tag that carries no currency at all, which happens and is
	 * not our omission - one shop's 190.00 is published as exactly `["price", "190.00"]`.
	 * The cell marks those rather than printing a bare number as though the unit were
	 * obvious. `n` is what the column SORTS on, and is null for a listing with no price.
	 *
	 * `ink` IS WHAT THE UNIT MEANS, where `cur` is how it is spelled: the orange of the Priced
	 * in bitcoin card for a listing that card counts (the operator's call, 2026-11-04), read
	 * from the unit alone, so an amount shown verbatim below still wears it. It is undefined
	 * for anything else, and the cell then keeps the ink of the sort. It does not follow the
	 * sort itself: this is a colour that carries meaning, which $lib/sort-ink exempts.
	 *
	 * WHAT COUNTS AS A NUMBER HERE IS NARROWER THAN `Number()`, for two reasons found in
	 * review on 2026-10-23, both reachable from a `price` tag the pipeline passes through
	 * verbatim:
	 *
	 * - `Number()` accepts `1e9`, `0x10`, `Infinity` and a 30-digit amount, and then this
	 *   function PRINTS A DIFFERENT PRICE from the one published - 1,000,000,000 for `1e9`,
	 *   16 for `0x10`, and 111,111,111,111,111,100,000,000,000,000 for thirty 1s, because a
	 *   double cannot hold it. Quoting a stranger's price wrongly is worse than not quoting
	 *   it, so anything that is not a plain decimal numeral of a length a double represents
	 *   exactly is shown verbatim instead, and does not sort as a number.
	 * - `minimumFractionDigits` throws a RangeError above 100 (above 20 before Node 19), and
	 *   this runs inside a reactive block that SvelteKit materialises during the server
	 *   render - so `["price", "1.<101 zeroes>"]` from any seller would have answered
	 *   500 (internal server error) for the WHOLE of /marketplaces, not just this section.
	 *   The live pool's maximum today is 20 decimals. Hence both the DECIMALS cap and the
	 *   digit cap below.
	 */
	/** Decimals a price may carry and still be formatted: Intl's floor across our runtimes. */
	const MAX_DECIMALS = 20;
	/** Integer digits we will render as a grouped number: a double is exact to 2^53. */
	const MAX_INT_DIGITS = 15;
	/** A plain decimal numeral, with an optional sign: no exponent, no hex, no Infinity. */
	const DECIMAL = /^[+-]?(\d+)(?:\.(\d+))?$/;

	const priceOf = (
		price: string[] | null
	): { amount: string; cur: string; n: number | null; ink: string | undefined } | null => {
		if (!price || price.length < 2) return null;
		const raw = visibleText(price[1]);
		if (raw === '') return null;
		const trimmed = raw.trim();
		const m = DECIMAL.exec(trimmed);
		const decimals = m?.[2]?.length ?? 0;
		const num = m ? Number(trimmed) : NaN;
		const ok =
			m !== null &&
			Number.isFinite(num) &&
			decimals <= MAX_DECIMALS &&
			m[1].replace(/^0+(?=\d)/, '').length <= MAX_INT_DIGITS;
		const amount = ok
			? num.toLocaleString('en-US', {
					minimumFractionDigits: decimals,
					maximumFractionDigits: Math.max(decimals, 2)
				})
			: trimmed.slice(0, 24);
		return {
			amount,
			cur: price.length > 2 ? visibleText(price[2]).slice(0, 12) : '',
			n: ok ? num : null,
			ink: isBitcoinUnit(price[2]) ? BTC_ORANGE : undefined
		};
	};

	/**
	 * A listing's date, in UTC: the day, and the time under it. `effective_ts` is capped at
	 * the run by the pipeline, but nothing in THIS file bounds it, and `toISOString` throws a
	 * RangeError past about 8.64e12 - inside a reactive block the server render materialises,
	 * which is a 500 (internal server error) for the whole page rather than a bad cell. So an
	 * unrepresentable stamp degrades to empty rather than throwing.
	 */
	const stamp = (ts: number): { day: string; time: string } => {
		const at = new Date(ts * 1000);
		if (!Number.isFinite(at.getTime())) return { day: '', time: '' };
		const iso = at.toISOString();
		return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
	};

	// WHAT A `status` WORD MEANS, in three groups, because the colour has to agree with it
	// (the operator, 2026-10-23: "'traded' being in red is wrong choice of color. Needs
	// something more neutral / positive, since it's a positive outcome").
	//
	// A deal that happened is the marketplace WORKING, and this page's green is the colour
	// it gives a good outcome elsewhere (/routstr's reviewColor). A listing the seller
	// pulled, or one nobody can buy any more, is the red the exclusion ledger uses. And a
	// seller's own synonym for "for sale" - `open`, `listed`, `online` - is neither: it is
	// just a different word for `active`, so it stays the dim grey of the line it sits on.
	//
	// The words are the seller's, lowercased by the pipeline; these are the ones the live
	// pool and the excluded rows actually carry (measured 2026-10-23: 19 distinct values
	// across the table, 8 of them in the live pool). Anything else falls to neutral - a
	// word we have not seen is not evidence of a sale OR of a withdrawal.
	const DONE = new Set(['sold', 'sold-hidden', 'traded', 'taken', 'completed']);
	const GONE = new Set(['withdrawn', 'cancelled', 'canceled', 'closed', 'deleted', 'hidden', 'inactive']);
	const statusInk = (status: string): string =>
		DONE.has(status)
			? 'text-emerald-400/90'
			: GONE.has(status)
				? 'text-red-300/80'
				: 'text-gray-400';

	// One flat row per listing: the keys the table sorts on, and everything the cells draw.
	// Built once per document, so a re-sort costs no formatting and no link building.
	$: at = now ?? Date.now();
	$: views = rows.map((r) => {
		const price = priceOf(r.price);
		const when = stamp(r.effective_ts);
		const target = listingTarget(r, at);
		return {
			// --- sort keys ---
			when: r.effective_ts,
			// THE TITLE AS PUBLISHED. `r.title` is the pipeline's lowercased copy - folded for
			// the farm and synthetic classifiers - and drawing it read "arcanine for abra" for
			// every row until the verbatim column landed (nostrology-data#29 (/marketplaces: the
			// listings table drops the title as published and four other per-listing facts the
			// web needs), 2026-10-24). The fold stays as the fallback for a row that carries no
			// `title_tag`, and labelText says so in words for a listing with no visible title at
			// all. listingTitle is the one definition, shared with the one-row-per-title cut, so
			// what that cut compares is what this draws.
			title: listingTitle(r),
			seller: personLabel(r.seller_name, r.pubkey),
			price: price?.n ?? null,
			where: whereOf(r),
			// CAPPED, like `where` above and the unparseable price below: every one of these is
			// a seller-chosen string of any length, and an uncapped one widens its column until
			// the table scrolls sideways. Two categories, 40 characters, is what the column is
			// sized for (longest single category in the live pool: 78).
			cats: r.categories
				.map((c) => visibleText(c).slice(0, 40))
				.filter(Boolean)
				.slice(0, 2)
				.join(', '),
			// --- the rest ---
			day: when.day,
			time: when.time,
			priceText: price,
			client: visibleText(r.client).slice(0, 40),
			status: r.status !== 'active' ? visibleText(r.status).slice(0, 24) : '',
			statusInk: statusInk(r.status),
			// A listing its seller set to expire, past that moment: relays delete those, so
			// nothing can open it. The server drops those rows ($lib/markets/recent), so this
			// marks only a row handed to this component uncut - a preview, or a test.
			isExpired: typeof r.expires_at === 'number' && r.expires_at * 1000 <= at,
			target,
			/**
			 * Where the SELLER's name goes: their page on the same marketplace the listing
			 * opens on, so a reader who wants the rest of that shop's stock lands in the shop
			 * (nostrology-web#26 (Recent listings: open the Seller name on the same marketplace
			 * the listing opens on, not njump), the operator's call of 2026-10-24).
			 *
			 * njump - a raw Nostr event viewer - stays as the fallback for a row with no
			 * marketplace at all. The server drops those ($lib/markets/recent), so it is
			 * reachable only through a caller handing this component uncut rows, and it is kept
			 * because the honest answer for such a row is still "here is what was published".
			 */
			sellerHref: target?.sellerUrl ?? njumpUrl(r.pubkey),
			/** Whether that seller link is a marketplace's or njump's: they differ in `rel`,
			 *  and only one of the two is a page whose goodwill the page is trying to earn. */
			sellerIsMarket: target?.sellerUrl != null
		};
	});

	/** The four columns a phone leaves out, as classes for their headers (the cells carry
	 * the same pair; a `th` cannot be wrapped in another one). */
	const PHONE_OFF = 'hidden sm:table-cell';

	type RecentKey = 'when' | 'title' | 'seller' | 'price' | 'where' | 'cats';
	const NUMERIC: RecentKey[] = ['when', 'price'];
	let sortKey: RecentKey = 'when';
	let sortDir: SortDir = 'desc';
	/** A header click, in /git's grammar: the open column flips, a new numeric column starts
	 * at its largest and a new text column at A. */
	const sort = (clicked: string) => {
		const k = clicked as RecentKey;
		[sortKey, sortDir] =
			k === sortKey
				? [sortKey, sortDir === 'asc' ? 'desc' : 'asc']
				: [k, NUMERIC.includes(k) ? 'desc' : 'asc'];
	};
	// ALWAYS sorted by the marked column, from the first paint: the server reads the rows in
	// this same order (effective_ts DESC), and sortRows is stable, so nothing moves until a
	// reader clicks - but what the arrow says is then true of the rows, not just of the read.
	$: shown = sortRows(views, sortKey, sortDir);
	// Named in the order the rotation holds them, not the order the rows happen to use, so
	// the sentence does not change shape when the data does; and only the clients some row
	// actually opens on, so it never names one it is not using.
	$: used = new Set(views.map((v) => v.target?.marketplace.key));
	$: marketplaces = liveMarketplaces()
		.filter((c) => used.has(c.key))
		.map((c) => c.label);
	/** "A or B", "A, B or C" - the last name joined with "or", not another comma. */
	$: marketplaceList =
		marketplaces.length < 2
			? marketplaces.join('')
			: marketplaces.slice(0, -1).join(', ') + ' or ' + marketplaces[marketplaces.length - 1];
</script>

{#if rows.length > 0}
	<!-- `relative`, and the id the slug table names: the link icon is positioned against this
	     card and sits OUTSIDE the heading, so the heading's text stays the heading's. -->
	<div class="relative rounded-xl border border-gray-700 bg-gray-800 p-5" id={ENTRY.elementId}>
		<h2 class="text-lg font-semibold text-white">{ENTRY.title}</h2>
		<SectionLink href={addressOf(MARKETPLACES_SLUGS, SECTION)} title={ENTRY.title} {phoneShown} />
		<p class="mb-4 mt-1 text-sm leading-relaxed text-gray-400">
			The {rows.length.toLocaleString('en-US')} most recent live {rows.length === 1
				? 'listing'
				: 'listings'}.
			{#if perSeller !== null}
				At most {perSeller} per seller, so the table shows who is listing rather than one shop's
				stock list.
			{:else}
				No cap per seller, so a shop that lists in bulk fills the table, which is what arriving in
				bulk looks like.
			{/if}
			<!-- The other cut this table makes (the operator's call, 2026-11-04). It has to be said:
			     a row left out because another seller used the name is not the "most recent" the
			     sentence above promises, and $lib/markets/recent says what it costs. "Of those",
			     because it runs after the per-seller cap: a newer twin that cap took out is not
			     counted, so this row is the newest of what is left and not always the newest there is
			     (1 row of 60, on 2 of the 31 days to 2026-11-04). -->
			Of those, each title appears once, on its newest listing, so a repeat is left out even when a
			different seller published it.
			<!-- THE CUT, in one line (the operator's call, 2026-10-24: add it to the section,
			     "very concise while conveying the message"). It belongs here and not in What is
			     counted, which is about the whole page: every figure elsewhere counts the entire
			     live pool, and this cut is this table's alone. -->
			A listing no marketplace can show is left out, so these are the newest that open somewhere.
			{#if marketplaces.length > 1}
				A name opens that listing on {marketplaceList}, picked from the listing's own address so the
				traffic this page sends is spread between them and not pointed at one.
			{:else if marketplaces.length === 1}
				A name opens that listing on {marketplaces[0]}, the one marketplace every row here can
				be shown on today.
			{/if}
		</p>
		<!-- A PHONE GETS TWO COLUMNS, not a sideways scroll. At 390 px the full table showed
		     the date and the title and cut the price off at the edge, so seller, price, place
		     and category move under the title there - the same answer RepoTable gives on
		     /git. They are columns, and sortable, from `sm` up. -->
		<div class="overflow-x-auto">
			<table class="w-full min-w-0 text-left text-sm sm:min-w-[760px]" aria-label="Recent listings">
				<thead>
					<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
						<SortTh label="Dated (UTC)" key="when" {sortKey} {sortDir} onSort={sort} />
						<SortTh label="Listing" key="title" {sortKey} {sortDir} onSort={sort} />
						<SortTh label="Seller" key="seller" {sortKey} {sortDir} onSort={sort} cellClass={PHONE_OFF} />
						<SortTh label="Price" key="price" {sortKey} {sortDir} right onSort={sort} cellClass={PHONE_OFF} />
						<SortTh label="Where" key="where" {sortKey} {sortDir} onSort={sort} cellClass={PHONE_OFF} />
						<SortTh label="Category" key="cats" {sortKey} {sortDir} onSort={sort} cellClass={PHONE_OFF} />
					</tr>
				</thead>
				<tbody>
					<!-- KEYED BY INDEX, never by a value from the rows - the rule /git's page states
					     and the reason is third-party data: Svelte 5 throws on a duplicate key even
					     in production, the SERVER render tolerates it, so the page would paint and
					     then die on hydration. marketplaces_listings has no unique index and the
					     read coalesces a null `d` tag to the empty string, so one seller publishing
					     both an absent and an empty identifier collapses two rows to one key. The
					     sort is stable (sortRows), so index keys do not reorder a re-sort wrongly. -->
					{#each shown as v, i (i)}
						<tr class="border-b border-gray-700/50 align-top">
							<td class="py-2 pr-3 tabular-nums {sortInk(sortKey, 'when')}">
								<div class="whitespace-nowrap">{v.day}</div>
								<div class="text-xs text-gray-500">{v.time}</div>
							</td>
							<td class="max-w-[22rem] py-2 pr-3">
								{#if v.target}
									<!-- NO `noreferrer` HERE, deliberately (the operator, 2026-10-23: "let's not
									     block the attribution path"). `noreferrer` strips the Referer header, so
									     every reader we send arrived at these marketplaces as unattributable
									     direct traffic and we were the invisible referrer. Without it the
									     browser's default policy (strict-origin-when-cross-origin; we set no
									     Referrer-Policy) sends the ORIGIN alone - https://nostrolo.gy/, never
									     which page or what the reader was looking at.
									     WHAT THAT DOES AND DOES NOT BUY, corrected in review 2026-10-23: it puts
									     us in their HTTP access logs. It does NOT reach Conduit's checkout
									     attribution (that capture runs only on a document load at /checkout with
									     a fragment, which an in-app navigation from a product page never is) and
									     it does NOT reach their PostHog, which is configured `save_referrer:
									     false`, `save_campaign_params: false`, `capture_pageview: false`. A
									     marker in the query would not help on Conduit either: its product route
									     validates search params down to `event` and `occurrence` and drops the
									     rest. `noopener` and `nofollow` stay: a new tab must not reach back into
									     this one, and a seller's rank is not ours to vouch for.
									     nostrology-web#27 (Recent listings: let the marketplaces see that the
									     traffic is ours) holds what is left. -->
									<a
										href={v.target.url}
										target="_blank"
										rel="noopener nofollow"
										title="Open on {v.target.marketplace.label}"
										class="break-words text-gray-100 underline decoration-gray-600 underline-offset-2 transition-colors hover:text-nostr-gold hover:decoration-nostr-gold"
										><bdi>{v.title}</bdi></a
									>
								{:else}
									<span class="break-words text-gray-100"><bdi>{v.title}</bdi></span>
								{/if}
								{#if v.client !== '' || v.status !== '' || v.isExpired}
									<div class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500">
										{#if v.client !== ''}<span>via <bdi>{v.client}</bdi></span>{/if}
										<!-- NEVER amber or gold: those are Bitcoin's on this page (a bitcoin price
										     in this very table). Green for a deal done, red for one pulled, grey
										     for another word meaning for-sale - statusInk above. -->
										{#if v.status !== ''}<span class={v.statusInk}><bdi>{v.status}</bdi></span>{/if}
										{#if v.isExpired}<span class="text-red-300/80">expired</span>{/if}
									</div>
								{/if}
								<div class="mt-0.5 text-xs text-gray-400 sm:hidden">
									<bdi>{v.seller}</bdi>
									{#if v.priceText}&nbsp;&middot;&nbsp;<span
											class="tabular-nums text-gray-300"
											style:color={v.priceText.ink}
											>{v.priceText.amount}{#if v.priceText.cur !== ''}&nbsp;<bdi>{v.priceText.cur}</bdi
											>{:else}&nbsp;?{/if}</span
										>{/if}
									{#if v.where !== ''}&nbsp;&middot;&nbsp;<bdi>{v.where}</bdi>{/if}
									{#if v.cats !== ''}&nbsp;&middot;&nbsp;<bdi>{v.cats}</bdi>{/if}
								</div>
							</td>
							<td class="hidden max-w-[12rem] py-2 pr-3 sm:table-cell {sortInk(sortKey, 'seller')}">
								{#if v.sellerHref}
									<!-- `noreferrer` DEPENDS ON WHERE THIS GOES, which is the whole reason the
									     two cases are distinguished. A marketplace link drops it, exactly as the
									     Listing name above does, so the browser sends our origin and they can
									     see the traffic is ours (the operator, 2026-10-23: "let's not block the
									     attribution path"). The njump fallback keeps it: that is an event
									     viewer, not a shop whose goodwill this page is trying to earn, and there
									     is nothing to attribute. `noopener` and `nofollow` are on both - a new
									     tab must not reach back into this one, and a seller's rank is not ours
									     to vouch for. -->
									<a
										href={v.sellerHref}
										target="_blank"
										rel={v.sellerIsMarket ? 'noopener nofollow' : 'noopener noreferrer nofollow'}
										title={v.sellerIsMarket && v.target
											? `More from this seller on ${v.target.marketplace.label}`
											: undefined}
										class="break-words transition-colors hover:text-gray-200"><bdi>{v.seller}</bdi></a
									>
								{:else}
									<bdi class="break-words">{v.seller}</bdi>
								{/if}
							</td>
							<td
								class="hidden whitespace-nowrap py-2 pr-3 text-right tabular-nums sm:table-cell {sortInk(
									sortKey,
									'price'
								)}"
								style:color={v.priceText?.ink}
							>
								{#if v.priceText}
									{v.priceText.amount}
									{#if v.priceText.cur !== ''}<span class="text-xs text-gray-500" style:color={v.priceText.ink}
											><bdi>{v.priceText.cur}</bdi></span
										>{:else}<span class="text-xs text-gray-500" title="the listing quotes an amount and no currency">?</span>{/if}
								{:else}
									<span class="text-gray-600">-</span>
								{/if}
							</td>
							<td class="hidden max-w-[10rem] break-words py-2 pr-3 sm:table-cell {sortInk(sortKey, 'where')}">
								{#if v.where !== ''}<bdi>{v.where}</bdi>{:else}<span class="text-gray-600">-</span>{/if}
							</td>
							<td class="hidden max-w-[12rem] break-words py-2 sm:table-cell {sortInk(sortKey, 'cats')}">
								{#if v.cats !== ''}<bdi>{v.cats}</bdi>{:else}<span class="text-gray-600">-</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
