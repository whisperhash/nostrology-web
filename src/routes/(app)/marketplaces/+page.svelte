<script lang="ts">
	// DB-POWERED since 2026-08-23: the server load hands this page the newest
	// marketplaces_snapshot row - the full dataset as ONE precomputed document,
	// written daily by nostrology-data's marketplaces_refresh Dagster job
	// (pipeline/marketplaces.py). Nothing on this page is
	// computed per-request, and nothing renders that is not in the snapshot.
	// The independent cross-check of the numbers is nostrology-data's
	// crosscheck/build_markets_snapshot.py + compare_markets_snapshots.py.
	import type { MarketsSnapshot } from '$lib/shared/data-types';
	import { METHODOLOGY } from '$lib/methodology';
	import PillBar from '$lib/components/PillBar.svelte';
	import TransientNote from '$lib/components/TransientNote.svelte';
	import { domainPage } from '$lib/domain-page';
	import { addressOf, own, pageTitle, type Target } from '$lib/slug-table';
	import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
	import MethodologySection from '$lib/components/MethodologySection.svelte';
	import SectionLink from '$lib/components/SectionLink.svelte';
	import LineChart from '$lib/components/markets/LineChart.svelte';
	import HBar from '$lib/components/markets/HBar.svelte';
	import Donut from '$lib/components/markets/Donut.svelte';
	import BubbleMap from '$lib/components/markets/BubbleMap.svelte';
	import RecentListings from '$lib/components/markets/RecentListings.svelte';
	import StackedBars from '$lib/components/ngit/StackedBars.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { dayName } from '$lib/ngit/format';
	import { BTC_ORANGE } from '$lib/ngit/palette';
	import { RECENT_PER_SELLER } from '$lib/markets/recent';
	import { nearestTop } from '$lib/section-link';
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import type { MarketsRecentListing } from '$lib/shared/data-types';

	/** `target`: what the address names, as the server answered it ($lib/slug-table) - the
	 * page is served at every /marketplaces/<slug> too. Absent where a test passes a snapshot
	 * alone, which is the bare /marketplaces. */
	export let data: {
		snapshot: MarketsSnapshot;
		target?: Target;
		recent?: MarketsRecentListing[];
		/** When the server read those rows: the one clock read for the request. */
		recentAt?: number;
	};
	// Bound once at init. A move between this page's addresses (a pill click) keeps this
	// component and hands it new `data`, but the same snapshot: the layout's load, which
	// fetches it, does not run again (+layout.server.ts). Only `data.target` is read again
	// ($lib/domain-page); the derived consts below would not track `data` if it changed.
	const D = data.snapshot;

	// The pills are /marketplaces's slug table's (MARKETPLACES_SLUGS), and so is everything about which
	// one is open, What is counted and the note: $lib/domain-page, shared by every domain page.
	// They are client-side rather than routes of their own because all five read the same
	// embedded snapshot - five routes would ship five copies of it - but each has an address
	// (/marketplaces/growth), answered by the server like any other.
	const { tab, methodologyOpen, note, pick } = domainPage(MARKETPLACES_SLUGS, () => data.target);
	/** The section the address names (/marketplaces/recent-listings), from the slug table: a
	 * section with a preview of its own draws it instead of the page's. */
	$: section =
		data.target?.kind === 'page' && data.target.section
			? own(MARKETPLACES_SLUGS.sections, data.target.section)
			: undefined;
	// The link icon on each section with an address (SectionLink): on a phone it is drawn on one
	// card only, the section whose heading is on screen nearest the top (P1, the operator's
	// choice, 2026-10-19), worked out again - once a frame at most - as the page scrolls,
	// resizes or shifts with no scroll at all (a <details> above closing moves the headings
	// under a still page), and whenever the open pill changes which headings exist. The same
	// machinery /git runs; What is counted's own icon is hover-only and never on a phone.
	const LINKED = Object.entries(MARKETPLACES_SLUGS.sections);
	let phoneLink: string | null = null;
	function placePhoneLink() {
		const navBottom = document.querySelector('nav.nav')?.getBoundingClientRect().bottom ?? 0;
		const heads = LINKED.flatMap(([slug, sec]) => {
			const h = document.getElementById(sec.elementId)?.querySelector('h2');
			if (!h) return [];
			const r = h.getBoundingClientRect();
			return [{ name: slug, top: r.top, bottom: r.bottom }];
		});
		phoneLink = nearestTop(heads, navBottom, window.innerHeight);
	}
	let placing = 0;
	function schedulePlace() {
		if (!placing)
			placing = requestAnimationFrame(() => {
				placing = 0;
				placePhoneLink();
			});
	}
	onMount(() => {
		placePhoneLink();
		window.addEventListener('scroll', schedulePlace, { passive: true });
		window.addEventListener('resize', schedulePlace);
		const shifts = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePlace) : undefined;
		shifts?.observe(document.body);
		return () => {
			window.removeEventListener('scroll', schedulePlace);
			window.removeEventListener('resize', schedulePlace);
			shifts?.disconnect();
			cancelAnimationFrame(placing);
		};
	});
	$: if (browser && $tab) void tick().then(placePhoneLink);

	const n = (v: number) => v.toLocaleString('en-US');
	const s = D.summary;

	// Bitcoin keeps the orange wherever it appears; the fiat/other slices take
	// a neutral ramp so the eye reads "bitcoin vs the rest" at a glance. BRL has no entry on
	// purpose: it was amber, which is bitcoin's too, so since 2026-11-05 it takes the slate of
	// any currency without a colour of its own.
	const CUR_COLORS: Record<string, string> = {
		'Bitcoin (BTC / sats)': BTC_ORANGE,
		USD: '#4ade80',
		EUR: '#60a5fa',
		GBP: '#c084fc',
		'Stablecoin (USDT / USDC)': '#2dd4bf',
		ARS: '#f472b6',
		Other: '#64748b'
	};
	const curRows = D.currency.map((c) => ({ label: c.cur, value: c.listings, sub: c.sellers }));
	const curColors = curRows.map((r) => CUR_COLORS[r.label] ?? '#64748b');
	const btcSellers = D.currency.find((c) => c.cur.startsWith('Bitcoin'))?.sellers ?? 0;
	const btcShare = (() => {
		const tot = D.currency.reduce((a, c) => a + c.listings, 0);
		const btc = D.currency.find((c) => c.cur.startsWith('Bitcoin'))?.listings ?? 0;
		return tot ? Math.round((btc / tot) * 100) : 0;
	})();

	// New listings per month, drawn as /git draws its weekly bars (StackedBars): first-time
	// sellers as a line on a second axis at the right, and the month still filling faded and
	// outlined, the line dimmed into it, and named in a caption under the plot. `s` counts each
	// seller once, ever, in the month of their earliest live listing: arrivals, not monthly
	// activity.
	//
	// The month still filling is partial_month, the run's own month (since nostrology-data's
	// 2026-10-08 change; before that the newest listing's month, which on the 1st named the month just
	// completed). While nothing is dated in it, it has no bar and nothing is marked; otherwise it
	// is the last bar, because no listing is dated after the run (since that day;
	// until then a listing dated past the month's end could draw a bar after it). The caption
	// gives the run's own time, generated_utc, to the minute: each extract flushes nozzl's
	// buffer for its kind first (fail-loud, pipeline/extract.py), so the run counts every listing
	// received up to its flush, under a minute before generated_utc (02:15:43 and 02:16:36 UTC
	// on 2026-10-08) - its data runs INTO that day, where /git's runs through its as_of_day.
	// summary.last_listing is not the cut: it is the newest listing's day, a day behind the run
	// whenever nothing is dated between midnight and the run (5 of the 30 runs from 2026-09-09
	// to 2026-10-08).
	const newMonths = D.new_monthly.map((r) => r.m);
	//
	// Listings are teal and sellers purple (the operator's pick, 2026-11-05), as in the cumulative
	// charts above this one and the two country lists on Geography. The bars were purple and the
	// line orange until then, and orange is bitcoin's on this site. Measured with the dataviz
	// validator on #1f2937, the line against the bars is Delta E 15.7 at worst under colour-vision
	// deficiency and 25.3 with normal vision (the targets are 8 and 15), and 1.46:1 in brightness.
	const newListingsSeries = [{ label: 'New listings', color: '#2dd4bf', values: D.new_monthly.map((r) => r.v) }];
	const firstTimeSellersLine = {
		label: 'First-time sellers',
		color: '#a78bfa',
		values: D.new_monthly.map((r) => r.s),
		axisLabel: 'first-time sellers'
	};
	const cutTime = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(D.generated_utc)?.[1];
	const partialMonthNote = `partial month: data to ${dayName(D.generated_utc)}${cutTime ? `, ${cutTime} UTC` : ''}`;

	const catRows = D.categories.map((c) => ({ label: c.cat, value: c.listings, sub: c.sellers }));
	/** The Categories card's id and heading are its slug-table entry's, as Recent listings' are
	 * (/marketplaces/categories): the address lands on that id, and the icon is named that title. */
	const CATEGORIES = MARKETPLACES_SLUGS.sections.categories;

	const nonattr = D.geo_nonattr;
	const NONATTR_LABEL: Record<string, string> = {
		NOTAG: 'No usable location tag',
		NONGEO: 'Non-geographic ("Online", "Worldwide", "Remote")',
		UNRES: 'Free text that could not be resolved',
		REGION: 'Multi-country region ("Europe", "US & Canada")',
		AMBIG: 'Ambiguous place name'
	};
	const nonattrRows = ['NOTAG', 'NONGEO', 'UNRES', 'REGION', 'AMBIG']
		.map((k) => ({ k, ...(nonattr as any)[k] }))
		.filter((r) => r.listings > 0);

	const geoPct = Math.round((D.geo_attributable / s.active_listings) * 100);
	const withdrawnPct = ((s.withdrawn_any / s.current_coordinates) * 100).toFixed(1);

	// The four headline cards. `vc` overrides the default white value colour, and is
	// set only where the number IS the bitcoin share - the orange is carrying meaning
	// (it matches the donut's bitcoin slice), so it must not spread to the other cards.
	const CARDS: { l: string; v: string; vc?: string; sub: string }[] = [
		{ l: 'Live listings', v: n(s.active_listings), sub: `${n(s.added_30d)} dated in the last 30 days` },
		{ l: 'Sellers', v: n(s.sellers), sub: `${n(s.sellers_90d)} active in the last 90 days` },
		{
			l: 'Priced in bitcoin',
			v: `${btcShare}%`,
			vc: BTC_ORANGE,
			// `sub` is rendered with {@html}: every interpolation here is a number we
			// formatted ourselves, never relay text.
			sub: `of ${n(D.currency_coverage.priced)} priced listings; <span style="color:${BTC_ORANGE}">${n(btcSellers)} sellers</span>`
		},
		{ l: 'Countries', v: n(s.countries), sub: `${geoPct}% of listings place-able` }
	];
</script>

<!-- Every address names itself as its own, as on every page. The page title names the pill or
	 the section the address opens, and a section with a preview of its own (Categories, Recent
	 listings) draws it; every other address draws /marketplaces's. -->
<!-- `noindex` ONLY at the address of a section still in development, which is the operator's
     own view of it: nobody else is served this page there at all (+page.server.ts answers them
     a 302 (found)), so this is defence in depth - if that gate were ever lost, the leaked 200
     (ok) would at least not be indexed under a heading no reader can see. The domain's other
     addresses are indexable as before, which $lib/seo/indexability.test.ts holds the page to. -->
<SocialMeta
	title={pageTitle(MARKETPLACES_SLUGS, 'Nostrology - Nostr Marketplaces', data.target)}
	socialTitle={section?.preview?.title ?? 'Nostr Marketplaces, measured'}
	description={section?.preview?.description ??
		'The Nostr marketplace layer measured end to end: sellers, listings, categories, currency mix and geography, from actual events.'}
	noindex={section?.unreleased === true}
/>

<TransientNote text={$note} />

<div class="space-y-6">
	<h1 class="text-3xl font-bold text-white">Nostr Marketplaces</h1>

	<PillBar table={MARKETPLACES_SLUGS} current={$tab} label="Nostr Marketplaces" onPick={pick} />

	<!-- Headline numbers ride above the pills' panels: they are the frame for all five. -->
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each CARDS as c}
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-4">
				<div class="text-xs uppercase tracking-wider text-gray-400">{c.l}</div>
				<div class="mt-1 text-3xl font-bold text-white" style:color={c.vc}>{c.v}</div>
				<div class="mt-1 text-sm text-gray-400">{@html c.sub}</div>
			</div>
		{/each}
	</div>

	{#if $tab === 'overview'}
		<div id="panel-overview" class="space-y-4">
			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Who publishes</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						The <code class="text-gray-200">client</code> tag is optional and most listings omit it,
						so this undercounts every app. It still shows the shape: no single client owns the
						seller base.
					</p>
					<HBar
						rows={D.clients.map((c) => ({
							label: c.client,
							value: c.listings,
							sub: c.sellers
						}))}
						labelWidth="minmax(9rem,14rem)"
						color="#818cf8"
					/>
				</div>

				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">The shape of the seller base</h2>
					<dl class="mt-3 space-y-3 text-sm">
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">Sellers with a live listing</dt>
							<dd class="tabular-nums text-white">{n(s.sellers)}</dd>
						</div>
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">...that posted in the last 90 days</dt>
							<dd class="tabular-nums text-white">{n(s.sellers_90d)}</dd>
						</div>
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">Listings posted in the last 90 days</dt>
							<dd class="tabular-nums text-white">{n(s.active_90d)}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-gray-400">Countries represented</dt>
							<dd class="tabular-nums text-white">{n(s.countries)}</dd>
						</div>
					</dl>
					<p class="mt-4 text-sm leading-relaxed text-gray-400">
						There is no expiry in NIP-99: a listing with no <code class="text-gray-200">status</code> tag counts as active
						forever. Only
						{n(s.withdrawn_any)} of the {n(s.current_coordinates)} coordinates counted below are ever marked
						withdrawn
						&mdash; {withdrawnPct}% across three years, which no real marketplace sustains. That is
						why the 90-day figures matter more than the totals.
					</p>
				</div>
			</div>

			<!-- Last on the pill: What is counted closes the Overview, after the figures - and
				 collapsed since 2026-10-17, as on /git, so the figures are not pushed up by it. It has
				 an address of its own and the icon that copies it (MethodologySection;
				 $lib/methodology): /marketplaces/methodology opens this pill with this section
				 expanded, just under the nav. -->
			<MethodologySection bind:open={$methodologyOpen} href={addressOf(MARKETPLACES_SLUGS, METHODOLOGY)}>
				<p class="mt-2 text-sm leading-relaxed text-gray-400">
					A seller revises a listing in place rather than republishing it, so each one is counted
					once, at its latest revision, under its
					<code class="text-gray-300">(pubkey, d-tag)</code> coordinate &mdash;
					{n(s.current_coordinates)} of them. From those, six groups that are not someone selling
					something are removed, and a product published with one listing per size or colour counts
					once. What is left, {n(s.active_listings)} listings, is the pool behind every chart on this
					page.
				</p>
				<div class="mt-4 space-y-2">
					{#each D.exclusions as e}
						<div class="flex items-baseline gap-3 border-l-2 border-gray-600 pl-3">
							<span class="w-16 shrink-0 text-right font-mono tabular-nums text-red-300"
								>&minus;{n(e.v)}</span
							>
							<span>
								<span class="text-gray-200">{e.k}</span>
								<span class="text-sm text-gray-400"> &mdash; {e.why}</span>
							</span>
						</div>
					{/each}
					<div class="flex items-baseline gap-3 border-l-2 border-nostr-purple pl-3 pt-1">
						<span class="w-16 shrink-0 text-right font-mono tabular-nums text-white"
							>{n(s.active_listings)}</span
						>
						<span class="text-gray-200">Live listings</span>
					</div>
				</div>
			</MethodologySection>
		</div>
	{/if}

	{#if $tab === 'growth'}
		<div id="panel-growth" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Cumulative sellers</h2>
					<span class="text-sm text-gray-400">daily</span>
				</div>
				<p class="mb-4 text-sm text-gray-400">
					Every pubkey that has published a listing still live today, counted from the day of its
					first one.
				</p>
				<LineChart series={D.cum_sellers} label="sellers" color="#a78bfa" heightPx={340} />
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Cumulative listings</h2>
					<span class="text-sm text-gray-400">daily</span>
				</div>
				<p class="mb-4 text-sm text-gray-400">
					Every listing live today, counted from the day it was listed.
				</p>
				<LineChart series={D.cum_listings} label="listings" color="#2dd4bf" heightPx={320} />
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<h2 class="mb-1 text-lg font-semibold text-white">New listings per month</h2>
				<p class="mb-4 text-sm text-gray-400">
					Dated by the NIP-99 <code class="text-gray-200">published_at</code> tag where the listing
					carries one, else by the event's
					<code class="text-gray-400">created_at</code>. The line is first-time sellers: sellers whose
					earliest live listing falls in the month, each counted once, ever.
				</p>
				<StackedBars
					series={newListingsSeries}
					line={firstTimeSellersLine}
					labels={newMonths}
					bucket="month"
					partialLabel={D.partial_month}
					partialNote={partialMonthNote}
					yAxisLabel="new listings"
					heightPx={360}
					ariaLabel="New listings per month, and first-time sellers"
				/>
			</div>

			<p class="text-sm leading-relaxed text-gray-400">
				Two caveats worth carrying into every reading of these three charts. Relays keep only the
				<em>current</em> version of an addressable event, so a listing edited since publication is
				dated by that edit unless it carries <code class="text-gray-200">published_at</code> &mdash; the curve is a floor on
				how old the ecosystem is, never an overstatement. And these are
				<em>survivorship</em> curves, not a record of activity as it happened: a listing published in
				2024 and since deleted or withdrawn appears nowhere on them, because only what is live today
				is counted at all.
			</p>
		</div>
	{/if}

	{#if $tab === 'catalogue'}
		<div id="panel-catalogue" class="space-y-4">
			<!-- Every child min-w-0, as on /git: a grid track is otherwise as wide as its widest
				 child's unbreakable content, here a row of the Currency legend (whose `truncate` does
				 nothing until then), and that carried both cards, and Categories' link icon, past the
				 right edge of a phone. /marketplaces/categories lands a reader right on it. -->
			<div class="grid gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
				<!-- `relative`, and the id the slug table names: the link icon is positioned against
					 this card, and /marketplaces/categories lands on it. It is drawn for every reader,
					 from the snapshot, so nothing here depends on `data.recent`. -->
				<div class="relative rounded-xl border border-gray-700 bg-gray-800 p-5" id={CATEGORIES.elementId}>
					<h2 class="text-lg font-semibold text-white">{CATEGORIES.title}</h2>
					<SectionLink
						href={addressOf(MARKETPLACES_SLUGS, 'categories')}
						title={CATEGORIES.title}
						phoneShown={phoneLink === 'categories'}
					/>
					<p class="mb-4 mt-1 text-sm text-gray-400">
						From the NIP-12 <code class="text-gray-200">t</code> tag, lowercased.
						{n(D.categories_coverage.with_tag)} of {n(D.categories_coverage.total)} listings carry at
						least one, spread over {n(D.categories_coverage.distinct_tags)} distinct tags. Only tags
						used by {D.categories_coverage.min_sellers}+ distinct sellers are shown &mdash; without that
						floor the chart is topped by single-shop vanity tags.
					</p>
					<HBar rows={catRows} color="#a78bfa" />
				</div>

				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Currency</h2>
					<p class="mb-2 mt-1 text-sm text-gray-400">
						Third element of the <code class="text-gray-200">price</code> tag, normalised.
						{n(D.currency_coverage.priced)} of {n(D.currency_coverage.total)} listings quote one.
					</p>
					<Donut
						rows={curRows}
						colors={curColors}
						heightPx={260}
						centerTitle={btcShare + '%'}
						centerSub="priced in bitcoin"
					/>
					<div class="mt-4 space-y-1.5">
						{#each D.currency as c, i}
							<div class="flex items-center gap-2 text-sm">
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-sm"
									style="background: {curColors[i]}"
								></span>
								<span class="flex-1 truncate text-gray-300">{c.cur}</span>
								<span class="tabular-nums text-gray-200">{n(c.listings)}</span>
								<span class="w-24 text-right text-xs tabular-nums text-gray-400"
									>{n(c.sellers)} sellers</span
								>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<h2 class="text-lg font-semibold text-white">Bitcoin leads on sellers, not just listings</h2>
				<p class="mt-2 text-sm leading-relaxed text-gray-400">
					{n(D.currency.find((c) => c.cur.startsWith('Bitcoin'))?.sellers ?? 0)} distinct sellers quote
					a bitcoin denomination against
					{n(D.currency.find((c) => c.cur === 'USD')?.sellers ?? 0)} quoting USD &mdash; a wider margin
					than the listing counts alone suggest, because the fiat side is more concentrated in a few
					large catalogues. "Bitcoin" here folds together
					<code class="text-gray-200">btc</code>, <code class="text-gray-200">sats</code>,
					<code class="text-gray-200">sat</code>, <code class="text-gray-200">msat</code>,
					<code class="text-gray-200">satoshi</code>, <code class="text-gray-200">bitcoin</code> and
					<code class="text-gray-200">xbt</code>, which the ecosystem uses interchangeably and in every
					case of capitalisation.
				</p>
			</div>

			<!-- Last on the pill, with an address of its own (/marketplaces/recent-listings), as
				 Categories has: the card carries that id and the icon that copies the address, and
				 on a phone the page says whether this is the card that draws it - with two such
				 sections on this pill, the one whose heading is nearest the top.
				 Whenever the slug table marks it in development ($lib/unreleased), the server
				 sends `recent` only to the operator's own session, so for everyone else there is
				 nothing here to draw. The check is on the field's PRESENCE, not on its length - an
				 empty array is a read that found nothing, which is a different thing from a reader
				 who may not see the section, and only the first should ever be a gate this page can
				 lose. -->
			{#if data.recent}
				<RecentListings
					rows={data.recent}
					countries={D.countries}
					perSeller={RECENT_PER_SELLER}
					now={data.recentAt}
					phoneShown={phoneLink === 'recent-listings'}
				/>
			{/if}
		</div>
	{/if}

	{#if $tab === 'geography'}
		<div id="panel-geography" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Where listings are</h2>
					<span class="text-sm text-gray-400">
						{n(D.geo_attributable)} of {n(s.active_listings)} listings ({geoPct}%) place to a country
					</span>
				</div>
				<p class="mb-4 text-sm text-gray-400">
					Bubble area scales with listing count. A <span class="text-amber-400">gold ring</span> marks
					a bubble on a named town or a geohash precise to ~2 km; a plain bubble sits on its country's
					centroid because the listing named a country but no place inside it. A geohash that decodes
					into Antarctica is ignored: every digit is a valid geohash character, so a number that
					was never a geohash still decodes somewhere. One that lands near a city is still
					believed. The tail is thin
					&mdash; of {n(s.countries)} countries, only {D.countries.filter((c) => c.listings >= 5).length}
					have five or more listings.
				</p>
				<div class="overflow-hidden rounded-xl border border-gray-700">
					<BubbleMap points={D.map_points} weight="listings" weightLabel="listings" heightPx={520} />
				</div>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Top countries by listings</h2>
					<div class="mt-3">
						<HBar
							rows={D.countries.slice(0, 14).map((c) => ({
								label: c.name,
								value: c.listings,
								sub: c.sellers
							}))}
							color="#2dd4bf"
						/>
					</div>
				</div>

				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Top countries by sellers</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Each seller counted once, in the country most of their listings name. This is the
						honest ranking: listing counts let one bulk catalogue outweigh a whole community.
						{n(D.seller_geo_coverage.placed)} of {n(D.seller_geo_coverage.total)} sellers place to a
						country at all.
					</p>
					<!-- Purple, as Cumulative sellers: these bars wore orange until 2026-11-05, and orange
					     is bitcoin's on this site. -->
					<HBar
						rows={D.seller_countries.slice(0, 14).map((c) => ({
							label: c.name,
							value: c.sellers
						}))}
						subLabel=""
						valueLabel="sellers"
						color="#a78bfa"
					/>
				</div>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<h2 class="text-lg font-semibold text-white">The {100 - geoPct}% that cannot be placed</h2>
				<p class="mt-2 text-sm text-gray-400">Geography is optional in NIP-99 and most sellers skip it.</p>
				<div class="mt-3">
					<HBar
						rows={nonattrRows.map((r) => ({
							label: NONATTR_LABEL[r.k],
							value: r.listings,
							sub: r.sellers
						}))}
						labelWidth="minmax(12rem,22rem)"
						color="#94a3b8"
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if $tab === 'shipping'}
		<div id="panel-shipping" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Shipping coverage</h2>
					<span class="text-sm text-gray-400">
						{n(D.shipping_coverage.with_country)} of {n(D.shipping_coverage.options_total)} shipping
						options name a country
					</span>
				</div>
				<p class="mb-4 text-sm text-gray-400">
					A separate event kind &mdash; kind-30406 (markets-shipping-options) &mdash; where a seller
					declares the destinations they will ship to and the price. Bubble area scales with the
					number of distinct sellers covering that country.
				</p>
				<div class="overflow-hidden rounded-xl border border-gray-700">
					<BubbleMap
						points={D.shipping}
						weight="sellers"
						weightLabel="sellers ship here"
						secondary="options"
						secondaryLabel="shipping options"
						color="#34d399"
						heightPx={480}
					/>
				</div>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Destinations by seller count</h2>
					<div class="mt-3">
						<HBar
							rows={D.shipping.slice(0, 20).map((c) => ({
								label: c.name,
								value: c.sellers,
								sub: c.options
							}))}
							subLabel="options"
							valueLabel="sellers"
							color="#34d399"
						/>
					</div>
				</div>

				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Read this one carefully</h2>
					<p class="mt-2 text-sm leading-relaxed text-gray-400">
						Only {n(D.shipping_coverage.sellers)} sellers publish a shipping option with a resolvable
						country at all, so this map describes a small, self-selecting slice of the market rather
						than the whole of it.
					</p>
					<p class="mt-3 text-sm leading-relaxed text-gray-400">
						The country field is free text and arrives as ISO-2, ISO-3 and full names in the same
						corpus, as many as 31 of them in a single tag. Values that resolve to no country are dropped
						rather than guessed at &mdash; that loses a little real coverage (a bare
						<code class="text-gray-200">Prague</code> is ambiguous once Prague, Oklahoma exists) as
						well as the junk.
					</p>
					<p class="mt-3 text-sm leading-relaxed text-gray-400">
						Most of the coverage above comes from a handful of EU-wide options: one
						<code class="text-gray-200">country</code> tag can carry every member state at once, so
						a single "Europe Standard" option lights up most of the continent. Read the map as
						"how many sellers will ship here", not as "how many sellers are here".
					</p>
				</div>
			</div>
		</div>
	{/if}

	<p class="border-t border-gray-700 pt-4 text-xs text-gray-400">
		Snapshot {D.generated_utc}
	</p>

</div>
