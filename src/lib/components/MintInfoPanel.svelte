<script lang="ts">
	import { supportedNuts, type MintInfoStatus, type MintV1Info } from '$lib/utils/mintInfo';

	export let mintUrl: string;
	export let info: MintV1Info | null;
	export let status: MintInfoStatus;

	$: nutNumbers = supportedNuts(info);
	// The /v1/info label in the heading links to the live endpoint so curious
	// users can inspect the raw JSON. Strip any trailing slash so the result
	// is exactly `<mintUrl>/v1/info`.
	$: infoEndpointUrl = `${mintUrl.replace(/\/$/, '')}/v1/info`;
</script>

{#if status === 'loaded' && info}
	<div class="space-y-3 text-sm">
		<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
			Mint Info
			<a
				href={infoEndpointUrl}
				class="text-gray-600 font-normal normal-case hover:text-nostr-gold transition-colors"
				target="_blank"
				rel="noopener noreferrer">/v1/info</a
			>
		</h3>

		{#if nutNumbers.length > 0}
			<div>
				<div class="text-gray-500 text-xs">Supported NUTs</div>
				<div class="text-gray-300 font-mono text-xs">
					{nutNumbers.map((n) => `NUT-${String(n).padStart(2, '0')}`).join(', ')}
				</div>
			</div>
		{/if}

		{#if info.pubkey}
			<div>
				<div class="text-gray-500 text-xs">Pubkey</div>
				<div class="font-mono text-gray-400 text-xs break-all">{info.pubkey}</div>
			</div>
		{/if}

		{#if info.version}
			<div>
				<div class="text-gray-500 text-xs">Version</div>
				<div class="font-mono text-gray-300 text-xs">{info.version}</div>
			</div>
		{/if}
	</div>
{:else if status === 'loading'}
	<div class="text-xs text-gray-500">
		<span class="inline-block animate-spin">⚡</span> Fetching mint info…
	</div>
{:else}
	<div class="text-xs text-gray-500 italic">
		Mint info unavailable (offline, CORS, or non-NUT-06 mint).
	</div>
{/if}
