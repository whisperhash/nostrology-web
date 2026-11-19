<script lang="ts">
	import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';
	import McpDerivableNote from '$lib/components/McpDerivableNote.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { cardCopy } from '$lib/social/card-copy';
	import { sanitizeExternalUrl } from '$lib/utils/externalUrl';

	export let data: PageData;

	function formatInt(n: number): string {
		return n.toLocaleString();
	}

	function formatDate(unixSec: number): string {
		return new Date(unixSec * 1000).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	$: publisher = data.publisher;
	// A publisher's card leads with their own profile text; when the profile has none,
	// say what the page actually shows rather than emitting no description at all.
	$: publisherCardDescription =
		cardCopy(publisher.about) ||
		`Zapstore apps and zap activity published by ${publisher.display_name}.`;
	$: countDaily = publisher.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_count }));
	$: countCumulative = publisher.daily.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_count
	}));
	$: satsDaily = publisher.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_sats }));
	$: satsCumulative = publisher.daily.map((d) => ({ timestamp: d.timestamp, value: d.cumulative_sats }));

	// Tooltip-friendly markers so a same-day cluster is unambiguous when
	// several of the publisher's apps release together.
	//
	// Two sources:
	// 1. kind-30063 release events — carry an explicit version string.
	// 2. Apps with only a kind-32267 catalog entry (no release event) —
	//    shown on their listing date without a version, so the dot still
	//    appears even when the publisher never published kind-30063 events.
	function releaseLabel(name: string, version: string | null): string {
		if (!version) return name;
		return version.startsWith('v') ? `${name} ${version}` : `${name} v${version}`;
	}

	$: releaseMarkers = [
		...publisher.releases.map((r) => ({
			timestamp: r.created_at,
			label: releaseLabel(r.app_name, r.version)
		})),
		...publisher.apps
			.filter((a) => !a.first_release_is_release_event)
			.map((a) => ({
				timestamp: a.first_release_at,
				label: a.app_name
			}))
	];
</script>

<SocialMeta
	title="Nostrology - {publisher.display_name}"
	socialTitle="{publisher.display_name} on Zapstore"
	description={publisherCardDescription}
	image={sanitizeExternalUrl(publisher.picture_url)}
/>

<div class="space-y-6">
	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<div class="flex items-start gap-4">
			<Avatar pictureUrl={publisher.picture_url} name={publisher.display_name} size="lg" />
			<div class="min-w-0 flex-1">
				<div class="flex items-baseline gap-2 flex-wrap">
					<h1 class="text-3xl font-bold text-white truncate">{publisher.display_name}</h1>
					{#if publisher.nip05}
						<span class="text-sm text-gray-400">{publisher.nip05}</span>
					{/if}
				</div>
				{#if publisher.about}
					<p class="text-sm text-gray-300 italic mt-1 whitespace-pre-wrap">{publisher.about}</p>
				{/if}
				<p class="text-xs text-gray-500 font-mono mt-2 truncate">{publisher.pubkey}</p>
				{#if publisher.is_zapstore_republished}
					<p class="text-xs text-gray-400 mt-2">
						The Zapstore main account — this pubkey republishes apps from GitHub / F-Droid.
					</p>
				{/if}
			</div>
		</div>
		<div class="text-sm text-gray-400 mt-4 space-y-1">
			<p>
				<span class="font-medium text-gray-300">{formatInt(publisher.total_apps)}</span>
				{publisher.total_apps === 1 ? 'app' : 'apps'} published.
			</p>
			<p>
				<span class="font-medium text-gray-300">{formatInt(publisher.total_count_1y)}</span>
				Zapstore-attributed zaps in the past year.
			</p>
			<p>
				<span class="font-medium text-gray-300">{formatInt(publisher.total_sats_1y)}</span>
				sats received in the past year.
			</p>
		</div>
	</div>

	<section class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<h2 class="text-2xl font-bold text-white mb-4">
			Apps
			<span class="text-sm font-normal text-gray-400 ml-2">({formatInt(publisher.total_apps)})</span>
		</h2>
		<ul class="divide-y divide-gray-700">
			{#each publisher.apps as app (app.app_d_tag)}
				<li>
					<a
						href="/zapstore/apps/{publisher.pubkey}/{encodeURIComponent(app.app_d_tag)}"
						class="flex items-center gap-3 py-3 group"
					>
						<AppIcon iconUrl={app.icon_url} name={app.app_name} size="md" />
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2 flex-wrap">
								<span
									class="text-base font-semibold text-white group-hover:text-nostr-gold transition-colors truncate"
								>
									{app.app_name}
								</span>
								<span class="text-xs text-gray-500 font-mono truncate">{app.app_d_tag}</span>
							</div>
							{#if app.summary}
								<p class="text-sm text-gray-400 truncate">{app.summary}</p>
							{/if}
							<p class="text-xs text-gray-500 mt-0.5">
								First release: {formatDate(app.first_release_at)}
							</p>
						</div>
						<div class="text-right text-xs text-gray-400 shrink-0 hidden sm:block ml-3">
							<p>
								<span class="font-mono text-nostr-gold">{formatInt(app.zap_sats_1y)} sats</span>
								·
								<span class="text-nostr-gold"
									>{formatInt(app.zap_count_1y)}
									{app.zap_count_1y === 1 ? 'zap' : 'zaps'}</span
								> (1y)
							</p>
							<p>
								{formatInt(app.stack_count)}
								{app.stack_count === 1 ? 'stack' : 'stacks'}
							</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<div class="grid grid-cols-1 gap-4">
		<!-- Chart and its MCP note share a wrapper so the note hugs its
		     chart (mt-2 only) instead of picking up the full inter-chart
		     grid gap as a separate grid item. -->
		<div>
			<PerAppZapChart
				title="Sats Received"
				dailySeries={satsDaily}
				cumulativeSeries={satsCumulative}
				dailyLabel="Daily sats"
				cumulativeLabel="Cumulative sats"
				dailyColor="#3498db"
				cumulativeColor="#f39c12"
				rightAxisLabel="Cumulative sats"
				releases={releaseMarkers}
			/>
			<McpDerivableNote metrics={['app_zaps', 'app_releases', 'app_catalog']} />
		</div>
		<div>
			<PerAppZapChart
				title="Zap Count"
				dailySeries={countDaily}
				cumulativeSeries={countCumulative}
				dailyLabel="Daily zap count"
				cumulativeLabel="Cumulative zaps"
				dailyColor="#8e44ad"
				cumulativeColor="#1abc9c"
				rightAxisLabel="Cumulative zaps"
				releases={releaseMarkers}
			/>
			<McpDerivableNote metrics={['app_zaps', 'app_releases', 'app_catalog']} />
		</div>
	</div>
</div>
