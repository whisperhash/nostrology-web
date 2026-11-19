<script lang="ts">
	import { supportedNips, type RelayInfoStatus, type RelayNip11Info } from '$lib/utils/relayInfo';

	export let relayUrl: string;
	export let info: RelayNip11Info | null;
	export let status: RelayInfoStatus;

	$: nipNumbers = supportedNips(info);
	// NIP-77 is the negentropy sync protocol. NIP-11 advertisement and runtime
	// support can diverge (e.g. operators disable it under load), but the
	// declaration is what we have to go on. See MEMORY for the nos.lol case.
	$: supportsNegentropy = nipNumbers.includes(77);
	// The /api/v1 label in the heading links to the live NIP-11 endpoint
	// (relay's HTTP origin) so curious users can inspect the raw JSON.
	$: nip11EndpointUrl = relayUrl.replace(/\/$/, '').replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
</script>

{#if status === 'loaded' && info}
	<div class="space-y-3 text-sm">
		<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
			Relay Info
			<a
				href={nip11EndpointUrl}
				class="text-gray-600 font-normal normal-case hover:text-nostr-gold transition-colors"
				target="_blank"
				rel="noopener noreferrer">NIP-11</a
			>
		</h3>

		{#if nipNumbers.length > 0}
			<div>
				<div class="text-gray-500 text-xs">Supported NIPs</div>
				<div class="text-gray-300 font-mono text-xs">
					{nipNumbers.map((n) => `NIP-${String(n).padStart(2, '0')}`).join(', ')}
				</div>
			</div>
			<div>
				<div class="text-gray-500 text-xs">Negentropy (NIP-77)</div>
				<div class="text-xs {supportsNegentropy ? 'text-emerald-400' : 'text-gray-500'}">
					{supportsNegentropy ? 'Supported' : 'Not advertised'}
				</div>
			</div>
		{/if}

		{#if info.limitation}
			{@const lim = info.limitation}
			{#if lim.payment_required || lim.auth_required || lim.restricted_writes || (lim.min_pow_difficulty ?? 0) > 0}
				<div>
					<div class="text-gray-500 text-xs">Restrictions</div>
					<ul class="text-gray-300 text-xs space-y-0.5">
						{#if lim.payment_required}<li>Payment required</li>{/if}
						{#if lim.auth_required}<li>AUTH required (NIP-42)</li>{/if}
						{#if lim.restricted_writes}<li>Restricted writes</li>{/if}
						{#if (lim.min_pow_difficulty ?? 0) > 0}<li>Min PoW: {lim.min_pow_difficulty}</li>{/if}
					</ul>
				</div>
			{/if}
		{/if}

		{#if info.pubkey}
			<div>
				<div class="text-gray-500 text-xs">Pubkey</div>
				<div class="font-mono text-gray-400 text-xs break-all">{info.pubkey}</div>
			</div>
		{/if}

		{#if info.software || info.version}
			<div>
				<div class="text-gray-500 text-xs">Software</div>
				<div class="font-mono text-gray-300 text-xs break-all">
					{[info.software, info.version].filter(Boolean).join(' ')}
				</div>
			</div>
		{/if}
	</div>
{:else if status === 'loading'}
	<div class="text-xs text-gray-500">
		<span class="inline-block animate-spin">⚡</span> Fetching relay info…
	</div>
{:else}
	<div class="text-xs text-gray-500 italic">
		Relay info unavailable (offline, CORS, or non-NIP-11 relay).
	</div>
{/if}
