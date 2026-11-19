<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import LeaderboardTable from '$lib/components/LeaderboardTable.svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import RelayRoleMixScatter from '$lib/components/RelayRoleMixScatter.svelte';
	import RelayRoleStackedBars from '$lib/components/RelayRoleStackedBars.svelte';
	import RelayTierHistogram from '$lib/components/RelayTierHistogram.svelte';
	import RelayUserRelayCountHistogram from '$lib/components/RelayUserRelayCountHistogram.svelte';
	import type { RelayStat } from '$lib/shared/data-types';
	import {
		DEFAULT_RELAY_MIN_USERS,
		RELAY_MIN_USERS_THRESHOLDS,
		restoreRelayMinUsers
	} from '$lib/shared/relayThresholds';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';

	export let data: PageData;

	// Yield to the browser between marking "pending" and the heavy buildRows +
	// DOM reconciliation so the loading overlay actually paints (the lowest
	// tier re-renders ~1.9k <tr>s, which blocks the main thread). Two rAFs
	// guarantee the prior frame has flushed. No-op on the server.
	function nextPaint(): Promise<void> {
		if (!browser) return Promise.resolve();
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	// Tiers below 100+ are deliberately absent — they materialize enough <tr>s
	// to get the iOS Safari WebContent process killed. See the measurements and
	// the DO-NOT-re-add note in $lib/shared/relayThresholds.
	const userThresholds = RELAY_MIN_USERS_THRESHOLDS;
	const STORAGE_KEY = 'relays:minUsers';
	let minUsers = DEFAULT_RELAY_MIN_USERS;
	// Gate persistence writes until after we've loaded the stored value in
	// onMount — otherwise the initial reactive run would clobber the saved
	// preference with the SSR default.
	let persistReady = false;

	onMount(() => {
		// A browser that stored a since-removed tier (e.g. "1") resolves back to
		// the default here, which is what unsticks a phone already crash-looping
		// on it.
		minUsers = restoreRelayMinUsers(localStorage.getItem(STORAGE_KEY));
		persistReady = true;
	});

	$: if (persistReady) localStorage.setItem(STORAGE_KEY, String(minUsers));

	$: selectedLabel =
		userThresholds.find((t) => t.value === String(minUsers))?.label ?? userThresholds[0].label;

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	// Strip wss:// or ws:// for display — the leaderboard cell is short and
	// users recognize relays by host. The route URL also drops the scheme.
	function shortRelayUrl(url: string): string {
		return url.replace(/^wss?:\/\//, '');
	}

	// Per-relay route mirrors /nutzaps/mints/[...mint] — rest param so paths
	// with slashes (e.g. relay.example.com/inbox) work without encoding.
	function relayHref(url: string): string {
		return `/relays/${shortRelayUrl(url)}`;
	}

	function filterRelays(relays: RelayStat[], min: number): RelayStat[] {
		return relays.filter((r) => r.user_count >= min);
	}

	function buildRows(relays: RelayStat[], maxUsers: number) {
		return relays.map((r) => [
			{
				label: shortRelayUrl(r.relay_url),
				href: relayHref(r.relay_url),
				// Bar fraction is relative to the GLOBAL max (i.e. the top relay
				// across the unfiltered set), not the current view's max. Per
				// product intent: "% of users relative to the relay with the
				// most users" — so #1 is always full and lower tiers stay
				// proportionally short even when the user filters to a high
				// threshold.
				barFraction: r.user_count / maxUsers
			},
			formatNumber(r.user_count),
			formatNumber(r.both_count),
			formatNumber(r.read_count),
			formatNumber(r.write_count),
			// Read-only / Write-only — derived by inclusion-exclusion from the
			// arrays the loader stores (no extra SQL). A user shows up here only
			// if they explicitly added a `read` or `write` marker on the r-tag,
			// i.e. they intentionally narrowed the relay's role away from the
			// NIP-65 default.
			formatNumber(r.read_count - r.both_count),
			formatNumber(r.write_count - r.both_count)
		]);
	}

	// Keep the previous rows mounted during a rebuild so the table doesn't
	// collapse and the charts below don't jump up. A monotonic build token
	// lets a fresh selector click supersede an in-flight rebuild.
	//
	// Loading-hint timing has two distinct slow cases that need different
	// machinery:
	//   1. Slow data fetch: with relay_stats_mv this is sub-50 ms in the
	//      common case, so the early timer at 200 ms is mostly defensive
	//      (covers the rare cold-DB / stalled-pool scenario where the main
	//      thread is free during a long await).
	//   2. Slow buildRows + DOM reconciliation: the main thread is BLOCKED, so
	//      the timer above can't fire — its callback sits queued and the
	//      finally block clearTimeout's it before the event loop ever gets to
	//      it. We instead trigger off the row count synchronously and flip the
	//      hint *before* buildRows runs, then yield with nextPaint() so the
	//      paint lands before the main thread blocks. With the lethal tiers
	//      dropped this now fires only on the 100+ tier (~1.9k rows).
	const LARGE_ROW_COUNT = 1500;
	const EARLY_HINT_DELAY_MS = 200;
	let currentRows: ReturnType<typeof buildRows> = [];
	let filteredCount = 0;
	let initialLoaded = false;
	let loadFailed = false;
	let showLoadingHint = false;
	let buildToken = 0;

	async function rebuild(
		source: Promise<RelayStat[]> | RelayStat[],
		threshold: number
	): Promise<void> {
		const myToken = ++buildToken;

		// Case 1: catches a slow data fetch. Token-guarded so a stale timer
		// from a superseded rebuild can't flip the hint.
		let earlyTimer: ReturnType<typeof setTimeout> | null = null;
		if (browser) {
			earlyTimer = setTimeout(() => {
				if (myToken === buildToken) showLoadingHint = true;
			}, EARLY_HINT_DELAY_MS);
		}

		try {
			const relays = await Promise.resolve(source);
			if (myToken !== buildToken) return;

			const filtered = filterRelays(relays, threshold);
			// getRelayStats returns relays sorted by user_count DESC, so the
			// global max is just the head of the array. Fall back to 1 to
			// avoid a divide-by-zero when the corpus is empty.
			const maxUsers = relays[0]?.user_count ?? 1;
			// Case 2: catches a slow buildRows. Skip if the early timer
			// already raised the hint.
			if (browser && !showLoadingHint && filtered.length > LARGE_ROW_COUNT) {
				showLoadingHint = true;
				await nextPaint();
				if (myToken !== buildToken) return;
			}

			currentRows = buildRows(filtered, maxUsers);
			filteredCount = filtered.length;
			initialLoaded = true;
			loadFailed = false;
		} catch (err) {
			// The query failed (the server has logged why) or building the rows threw. Say
			// so in place of the rows, clearing any that an earlier load left. Only for the
			// current build: a superseded one either awaited the same promise (the same
			// failure, logged twice) or an older one, whose failure must not replace newer rows.
			if (myToken === buildToken) {
				loadFailed = true;
				currentRows = [];
				console.error('[relays] could not load the relay table', err);
			}
		} finally {
			if (myToken === buildToken) {
				if (earlyTimer !== null) clearTimeout(earlyTimer);
				showLoadingHint = false;
			}
		}
	}

	// Browser only. The rows are client work: a server render is synchronous, so the
	// table has gone out empty before any query can resolve. And on the server a rejected
	// rebuild() is an unhandled rejection; Node's default for one is to exit, which would
	// take every page of the site down until the container restarts. Reproduced in the
	// production image on 2026-09-24, never seen in production (failed-query.ssr.test.ts).
	$: if (browser) void rebuild(data.relays, minUsers);
</script>

<SocialMeta
	title="Nostrology - Relays"
	socialTitle="Nostr relays, measured"
	description="Nostr relay reach and role mix, measured from actual published relay lists."
	noindex
/>

<div class="space-y-8">
	<div>
		<h1 class="text-3xl font-bold text-white mb-2">Relays</h1>
		<p class="text-gray-400 mb-3">
			NIP-65 relay-list adoption, derived from each profile's latest
			kind-10002 event.
		</p>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
			<!-- Every {#await} here has a {:catch}: without one, Svelte rethrows the rejection
			     in the browser. Each keeps its placeholder's size. And each that awaits a
			     promise straight from `data` sits in a {#key}: Svelte 5.51's client {#await}
			     files {:catch} under the same key as {:then}, so a new promise that is already
			     settled when it arrives (a load re-run on login or logout, its streamed data
			     read in one go) can switch between the two without redrawing. Fixed in
			     svelte 5.53.3 (sveltejs/svelte#17769): drop the {#key}s with that bump,
			     nostrology-web#17. A Promise.all needs none - it is a new promise, and
			     settles a tick late. -->
			{#key data.perUserDistribution}
				{#await data.perUserDistribution}
					<!-- Reserve the chart's height so the page doesn't reflow when
						 the streamed data arrives. -->
					<div style="height: 304px"></div>
				{:then buckets}
					<RelayUserRelayCountHistogram {buckets} heightPx={304} />
				{:catch}
					<div style="height: 304px" class="flex items-center justify-center text-sm italic text-gray-500">
						Chart data unavailable.
					</div>
				{/await}
			{/key}
		</div>
		<div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
			{#await Promise.all([data.relays, data.tierUserCounts])}
				<div style="height: 304px"></div>
			{:then [relays, tierUserCounts]}
				<RelayTierHistogram {relays} {tierUserCounts} heightPx={304} />
			{:catch}
				<div style="height: 304px" class="flex items-center justify-center text-sm italic text-gray-500">
					Chart data unavailable.
				</div>
			{/await}
		</div>
	</div>

	<div class="space-y-3">
		<div class="text-gray-400 text-sm space-y-1">
			<p><span class="text-gray-300 font-medium">Users</span> — profiles that list the relay.</p>
			<p><span class="text-gray-300 font-medium">Read &amp; Write</span> — profiles that effectively list the relay for both read and write.</p>
			<p>
				<span class="text-gray-300 font-medium">Read</span> — profiles that effectively list the relay for read.
				<span class="text-gray-300 font-medium">Read-only</span> — profiles that effectively list the relay for read only.
			</p>
			<p>
				<span class="text-gray-300 font-medium">Write</span> — profiles that effectively list the relay for write.
				<span class="text-gray-300 font-medium">Write-only</span> — profiles that effectively list the relay for write only.
			</p>
		</div>
		<div class="flex justify-between items-center">
			<p class="text-gray-400">
				{#if loadFailed}
					Relay data unavailable - reload the page to try again.
				{:else if initialLoaded}
					{formatNumber(filteredCount)} {filteredCount === 1 ? 'relay' : 'relays'} with {selectedLabel} users.
				{/if}
			</p>
			<div class="flex items-center gap-3">
				<span class="text-gray-400">Relay users</span>
				<PeriodSelector
					selected={String(minUsers)}
					onChange={(v) => (minUsers = Number(v))}
					periods={userThresholds}
				/>
			</div>
		</div>
		<!-- "Loading…" floats absolute-centered just above the table — no
			 vertical layout space when idle, and the table's position stays
			 fixed whether or not the hint is showing. -->
		<div class="relative">
			{#if showLoadingHint}
				<div
					class="absolute left-1/2 -translate-x-1/2 -top-5 text-gray-400 text-sm pointer-events-none"
				>
					Loading…
				</div>
			{/if}
			<LeaderboardTable
				headers={['Relay', 'Users', 'Read & Write', 'Read', 'Write', 'Read-only', 'Write-only']}
				rows={currentRows}
				sortable={true}
				defaultSortIndex={1}
				defaultSortDirection="desc"
				groupBoundary={2}
				minHeightPx={600}
			/>
		</div>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
		<div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
			{#key data.relays}
				{#await data.relays}
					<div style="height: 450px"></div>
				{:then relays}
					<RelayRoleStackedBars {relays} />
				{:catch}
					<div style="height: 450px" class="flex items-center justify-center text-sm italic text-gray-500">
						Chart data unavailable.
					</div>
				{/await}
			{/key}
		</div>
		<div class="bg-gray-800 rounded-lg p-4 border border-gray-700 flex flex-col">
			<div class="flex-1 min-h-0">
				{#key data.relays}
					{#await data.relays}
						<!-- Must mirror the chart's own sizing (h-full, plus the 450px
						     fallback floor below lg) or the card jumps 450px when the data
						     lands: below lg the placeholder is the only thing holding the
						     space open, since there is no taller sibling in the row. -->
						<div class="h-full min-h-[450px] lg:min-h-0"></div>
					{:then relays}
						<RelayRoleMixScatter {relays} heightPx={null} />
					{:catch}
						<div class="h-full min-h-[450px] lg:min-h-0 flex items-center justify-center text-sm italic text-gray-500">
							Chart data unavailable.
						</div>
					{/await}
				{/key}
			</div>
		</div>
	</div>
</div>
