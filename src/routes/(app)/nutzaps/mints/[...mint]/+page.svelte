<script lang="ts">
	import { onMount } from 'svelte';
	import ActiveUsersChart from '$lib/components/ActiveUsersChart.svelte';
	import MintInfoPanel from '$lib/components/MintInfoPanel.svelte';
	import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';
	import {
		contactHref,
		loadMintInfo,
		normalizeContacts,
		type MintInfoStatus,
		type MintV1Info
	} from '$lib/utils/mintInfo';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { mintLabel } from '$lib/utils/mintUrl';

	export let data: PageData;


	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	$: detail = data.detail;
	$: shortName = mintLabel(detail.mint_url);
	$: satsDaily = detail.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_sats }));
	$: satsCumulative = detail.daily.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_sats
	}));
	$: countDaily = detail.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_count }));
	$: countCumulative = detail.daily.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_count
	}));

	// Client-side fetch of NUT-06 /v1/info. Lifted up from MintInfoPanel so
	// both the left-side bits (name/description/contact) and the right-side
	// technical panel render from a single fetch.
	let mintInfo: MintV1Info | null = null;
	let mintInfoStatus: MintInfoStatus = 'loading';
	$: contacts = normalizeContacts(mintInfo?.contact);

	// Combine `description` and `description_long` (NUT-06 fields) into one
	// body, then split into a 3-line preview head and an optional tail (line 4
	// onwards) hidden behind a "More…" expander. Lines = explicit "\n" splits;
	// matches the splitContent pattern in /zapstore/apps/[pubkey]/[d_tag].
	const DESC_PREVIEW_LINES = 3;
	$: descriptionFull = (() => {
		const short = mintInfo?.description ?? '';
		const long = mintInfo?.description_long ?? '';
		if (!short && !long) return '';
		if (!short) return long;
		if (!long || long === short) return short;
		return `${short}\n\n${long}`;
	})();
	$: descriptionParts = (() => {
		const lines = descriptionFull.split('\n');
		if (lines.length <= DESC_PREVIEW_LINES) {
			return { head: descriptionFull, tail: '' };
		}
		return {
			head: lines.slice(0, DESC_PREVIEW_LINES).join('\n'),
			tail: lines.slice(DESC_PREVIEW_LINES).join('\n')
		};
	})();

	onMount(async () => {
		const fetched = await loadMintInfo(detail.mint_url);
		if (fetched) {
			mintInfo = fetched;
			mintInfoStatus = 'loaded';
		} else {
			mintInfoStatus = 'unavailable';
		}
	});
</script>

<SocialMeta
	title="Nostrology - {shortName}"
	socialTitle="{shortName} - Cashu mint"
	description="Nutzap activity for the Cashu mint {shortName}, measured from actual events."
/>

<div class="space-y-8">
	<div>
		<a
			href="/nutzaps/mints"
			class="text-nostr-purple hover:text-nostr-gold text-sm transition-colors">← Mints</a
		>
	</div>

	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<!-- Left column spans the full card height: header (icon + name +
			     URL + contact) at the top, optional description below, the
			     two stat lines pinned to the bottom via mt-auto. The right
			     column hosts the technical /v1/info panel and starts at the
			     same top edge — that's the alignment goal. -->
			<div class="md:col-span-2 flex flex-col md:h-full">
				<div class="flex items-start gap-4">
					{#if mintInfo?.icon_url}
						<!-- Mint icons come in varied aspect ratios (square favicons,
						     wide wordmarks, etc.). Fixed 96×96 box with object-contain
						     letterboxes non-square icons against the gray background
						     instead of cropping. The icon appears post-fetch, after
						     the client-side /v1/info round-trip resolves. -->
						<img
							src={mintInfo.icon_url}
							alt=""
							class="w-24 h-24 rounded shrink-0 bg-gray-700 object-contain"
							loading="lazy"
							referrerpolicy="no-referrer"
							on:error={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline gap-2 flex-wrap">
							{#if mintInfo?.name && mintInfo.name.toLowerCase() !== shortName.toLowerCase()}
								<h1 class="text-3xl font-bold text-white break-all">{mintInfo.name}</h1>
								<span class="text-sm text-gray-500 font-mono break-all">{shortName}</span>
							{:else}
								<h1 class="text-3xl font-bold text-white break-all">{shortName}</h1>
							{/if}
						</div>
						{#if contacts.length > 0}
							<p class="text-sm text-gray-400 mt-1">
								<span class="text-gray-500">Contact:</span>
								{#each contacts as c, i}
									{@const href = contactHref(c.method, c.info)}
									{#if i > 0}<span class="text-gray-600"> · </span>{/if}
									{#if href}
										<a
											{href}
											class="text-nostr-purple hover:text-nostr-gold transition-colors break-all"
											target="_blank"
											rel="noopener noreferrer">{c.method || c.info}</a
										>
									{:else}
										<!-- Unknown contact method (no href we can build): show
										     both label and value so the user knows what they're
										     looking at, e.g. "telegram: @handle". -->
										<span class="break-all"
											>{c.method ? `${c.method}: ${c.info}` : c.info}</span
										>
									{/if}
								{/each}
							</p>
						{/if}
					</div>
				</div>
				{#if descriptionParts.head}
					<div class="text-sm text-gray-400 space-y-2 mt-4">
						<div class="text-gray-300 whitespace-pre-wrap">{descriptionParts.head}</div>
						{#if descriptionParts.tail}
							<details>
								<summary class="text-gray-500 text-xs cursor-pointer hover:text-gray-300">
									More…
								</summary>
								<div class="text-gray-300 mt-1 whitespace-pre-wrap">{descriptionParts.tail}</div>
							</details>
						{/if}
					</div>
				{/if}
				<div class="text-sm text-gray-400 space-y-1 md:mt-auto md:pt-4">
					<p>
						Configured on
						<span class="font-medium text-gray-300">{formatNumber(detail.config_count)}</span>
						{detail.config_count === 1 ? 'Nostr profile' : 'Nostr profiles'}.
					</p>
					<p>
						<span class="font-medium text-gray-300">{formatNumber(detail.total_sats)}</span> sats /
						<span class="font-medium text-gray-300">{formatNumber(detail.total_payments)}</span>
						payments in the past year.
					</p>
					<p>
						<span class="font-medium text-gray-300">{formatNumber(detail.all_time_sats)}</span> sats /
						<span class="font-medium text-gray-300">{formatNumber(detail.all_time_payments)}</span>
						payments all time.
					</p>
				</div>
			</div>
			<div class="md:border-l md:border-gray-700 md:pl-6">
				<MintInfoPanel mintUrl={detail.mint_url} info={mintInfo} status={mintInfoStatus} />
			</div>
		</div>
	</div>

	<div>
		<p class="text-gray-400 mb-2">
			The number of Nutzap transactions on Nostr through this mint in the past year.
		</p>
		<PerAppZapChart
			title="Nutzap Payments"
			dailySeries={countDaily}
			cumulativeSeries={countCumulative}
			dailyLabel="Daily payments"
			cumulativeLabel="Cumulative payments"
			dailyColor="#8e44ad"
			cumulativeColor="#1abc9c"
			rightAxisLabel="Cumulative payments"
		/>
	</div>

	<div class="pt-4">
		<p class="text-gray-400 mb-2">
			The amount of Nutzap sats transacted on Nostr through this mint in the past year:
			the face value of the Cashu ecash each nutzap carries in its proof tags.
		</p>
		<PerAppZapChart
			title="Nutzap Sats"
			dailySeries={satsDaily}
			cumulativeSeries={satsCumulative}
			dailyLabel="Daily sats"
			cumulativeLabel="Cumulative sats"
			dailyColor="#3498db"
			cumulativeColor="#f39c12"
			rightAxisLabel="Cumulative sats"
		/>
	</div>

	<div class="pt-4">
		<p class="text-gray-400 mb-2">
			The number of monthly active Nutzap users for this mint in the past year.
		</p>
		<ActiveUsersChart
			title="Nutzap Monthly Active Users"
			granularity="month"
			heightPx={280}
			wrapInCard={false}
			titleAbove={true}
			series={[{ label: 'Monthly Active Users', data: detail.mau, color: '#e74c3c' }]}
		/>
	</div>
</div>
