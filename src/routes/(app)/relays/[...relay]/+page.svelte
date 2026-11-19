<script lang="ts">
	import { onMount } from 'svelte';
	import RelayInfoPanel from '$lib/components/RelayInfoPanel.svelte';
	import {
		loadRelayInfo,
		type RelayInfoStatus,
		type RelayNip11Info
	} from '$lib/utils/relayInfo';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';

	export let data: PageData;

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	function shortRelayUrl(url: string): string {
		return url.replace(/^wss?:\/\//, '');
	}

	$: detail = data.detail;
	$: shortName = shortRelayUrl(detail.relay_url);

	// Client-side fetch of NIP-11 info (relay's HTTPS origin with
	// `Accept: application/nostr+json`). Lifted up here so the header (name
	// from NIP-11) and the right-side panel render from a single fetch.
	let relayInfo: RelayNip11Info | null = null;
	let relayInfoStatus: RelayInfoStatus = 'loading';

	onMount(async () => {
		const fetched = await loadRelayInfo(detail.relay_url);
		if (fetched) {
			relayInfo = fetched;
			relayInfoStatus = 'loaded';
		} else {
			relayInfoStatus = 'unavailable';
		}
	});

	// Combine NIP-11 description + posting_policy into one block, with a 3-line
	// preview head and the rest behind "More…". Same pattern as the per-mint
	// page. NIP-11 has no description_long counterpart; posting_policy is the
	// closest analog (often longer-form).
	const DESC_PREVIEW_LINES = 3;
	$: descriptionFull = (() => {
		const desc = relayInfo?.description ?? '';
		const policy = relayInfo?.posting_policy ?? '';
		if (!desc && !policy) return '';
		if (!desc) return policy;
		if (!policy || policy === desc) return desc;
		return `${desc}\n\n${policy}`;
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
</script>

<SocialMeta
	title="Nostrology - {shortName}"
	socialTitle="{shortName} - Nostr relay"
	description="Reach and role mix for the Nostr relay {shortName}, measured from published relay lists."
	noindex
/>

<div class="space-y-8">
	<div>
		<a
			href="/relays"
			class="text-nostr-purple hover:text-nostr-gold text-sm transition-colors">← Relays</a
		>
	</div>

	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<!-- Left column: header (icon + name + URL + contact) at the top,
			     description below, totals (users + the 5-column breakdown
			     mirroring the /relays index) pinned to the bottom on md+ via
			     flex-col + mt-auto. Right column hosts the NIP-11 panel and
			     starts at the same top edge. -->
			<div class="md:col-span-2 flex flex-col md:h-full">
				<div class="flex items-start gap-4">
					{#if relayInfo?.icon}
						<!-- NIP-11 icons vary in aspect ratio. Fixed 96×96 with
						     object-contain letterboxes non-square icons against
						     the gray background instead of cropping. -->
						<img
							src={relayInfo.icon}
							alt=""
							class="w-24 h-24 rounded shrink-0 bg-gray-700 object-contain"
							loading="lazy"
							referrerpolicy="no-referrer"
							on:error={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline gap-2 flex-wrap">
							{#if relayInfo?.name && relayInfo.name.toLowerCase() !== shortName.toLowerCase()}
								<h1 class="text-3xl font-bold text-white break-all">{relayInfo.name}</h1>
								<span class="text-sm text-gray-500 font-mono break-all">{shortName}</span>
							{:else}
								<h1 class="text-3xl font-bold text-white break-all">{shortName}</h1>
							{/if}
						</div>
						{#if relayInfo?.contact}
							<p class="text-sm text-gray-400 mt-1">
								<span class="text-gray-500">Contact:</span>
								<span class="text-gray-300 break-all">{relayInfo.contact}</span>
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
						Listed by
						<span class="font-medium text-gray-300">{formatNumber(detail.user_count)}</span>
						{detail.user_count === 1 ? 'Nostr profile' : 'Nostr profiles'}.
					</p>
					<p>
						<span class="font-medium text-gray-300">{formatNumber(detail.both_count)}</span> read &amp; write |
						<span class="font-medium text-gray-300">{formatNumber(detail.read_count)}</span> read |
						<span class="font-medium text-gray-300">{formatNumber(detail.write_count)}</span> write |
						<span class="font-medium text-gray-300">{formatNumber(detail.read_count - detail.both_count)}</span> read-only |
						<span class="font-medium text-gray-300">{formatNumber(detail.write_count - detail.both_count)}</span> write-only.
					</p>
				</div>
			</div>
			<div class="md:border-l md:border-gray-700 md:pl-6">
				<RelayInfoPanel relayUrl={detail.relay_url} info={relayInfo} status={relayInfoStatus} />
			</div>
		</div>
	</div>
</div>
