<script lang="ts">
	import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';
	import McpDerivableNote from '$lib/components/McpDerivableNote.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { cardCopy } from '$lib/social/card-copy';
	import { sanitizeExternalUrl } from '$lib/utils/externalUrl';
	import type { PageData } from './$types';

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

	// Split release notes into the first PREVIEW_LINES lines (always visible)
	// and the remainder (revealed via <details> if non-empty). Lines are
	// preserved verbatim — no markdown stripping; the writer chose the layout.
	const PREVIEW_LINES = 10;
	function splitContent(content: string): { head: string; tail: string } {
		if (!content) return { head: '', tail: '' };
		const lines = content.split('\n');
		if (lines.length <= PREVIEW_LINES) {
			return { head: content, tail: '' };
		}
		return {
			head: lines.slice(0, PREVIEW_LINES).join('\n'),
			tail: lines.slice(PREVIEW_LINES).join('\n')
		};
	}

	$: app = data.app;
	$: releases = data.releases;

	// What a shared link says about the app: its own one-liner, else the head of the
	// long description. See $lib/social/card-copy for why it is trimmed here.
	$: cardDescription = cardCopy(app.summary, app.description);
	$: stackAppearances = data.stackAppearances;
	$: releaseMarkers = releases.map((r) => ({
		timestamp: r.created_at,
		label: r.version ?? r.d_tag
	}));
	// releases are server-sorted reverse-chronologically (see
	// getZapstoreAppReleases ORDER BY created_at DESC) — first element is
	// the most recent, last element is the oldest.
	$: mostRecentRelease = releases.length > 0 ? releases[0] : null;
	$: firstRelease = releases.length > 0 ? releases[releases.length - 1] : null;
	$: countDaily = app.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_count }));
	$: countCumulative = app.daily.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_count
	}));
	$: satsDaily = app.daily.map((d) => ({ timestamp: d.timestamp, value: d.daily_sats }));
	$: satsCumulative = app.daily.map((d) => ({ timestamp: d.timestamp, value: d.cumulative_sats }));
</script>

<SocialMeta
	title="Nostrology - {app.display_name}"
	socialTitle="{app.display_name} on Zapstore"
	description={cardDescription}
	image={sanitizeExternalUrl(app.icon_url)}
/>

<div class="space-y-6">
	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<div class="flex items-start gap-4">
			<AppIcon iconUrl={app.icon_url} name={app.display_name} size="xl" />
			<div class="min-w-0 flex-1">
				<div class="flex items-baseline gap-2 flex-wrap">
					<h1 class="text-3xl font-bold text-white truncate">{app.display_name}</h1>
					<span class="text-sm text-gray-500 font-mono truncate">{app.app_d_tag}</span>
				</div>
				<a
					href="/zapstore/publishers/{app.app_pubkey}"
					class="group inline-flex items-center gap-2 mt-1 min-w-0 max-w-full"
					title={app.publisher_display_name}
				>
					<span class="text-xs text-gray-500 shrink-0">by</span>
					<Avatar
						pictureUrl={app.publisher_picture_url}
						name={app.publisher_display_name}
						size="xs"
					/>
					<span
						class="text-sm text-gray-300 group-hover:text-nostr-gold transition-colors truncate"
					>
						{app.publisher_display_name}
					</span>
					{#if app.publisher_nip05}
						<span class="text-xs text-gray-500 truncate">{app.publisher_nip05}</span>
					{/if}
				</a>
				{#if app.summary}
					<p class="text-sm text-gray-400 italic mt-3 truncate">{app.summary}</p>
				{/if}
				{#if app.is_zapstore_republished}
					<p class="text-xs text-gray-500 mt-1">
						Republished from GitHub / F-Droid by the Zapstore main account.
					</p>
				{/if}
			</div>
		</div>
		<div class="text-sm text-gray-400 mt-4 space-y-4">
			{#if app.description}
				<p class="text-gray-300 whitespace-pre-wrap">{app.description}</p>
			{/if}
			{#if firstRelease || mostRecentRelease}
				<div class="space-y-1">
					{#if firstRelease}
						<p>
							First release:
							<span class="font-medium text-gray-300">{formatDate(firstRelease.created_at)}</span>,
							<span class="font-medium text-gray-300">{formatInt(releases.length)}</span>
							total {releases.length === 1 ? 'release' : 'releases'}.
						</p>
					{/if}
					{#if mostRecentRelease}
						<p>
							Most recent release:
							<span class="font-medium text-gray-300">{formatDate(mostRecentRelease.created_at)}</span>.
						</p>
					{/if}
				</div>
			{/if}
			{#if app.website_url || app.repository_url}
				<p class="flex gap-4">
					{#if app.website_url}
						<a
							href={app.website_url}
							class="text-nostr-purple hover:text-nostr-gold transition-colors"
							target="_blank"
							rel="noopener noreferrer"
						>
							Website
						</a>
					{/if}
					{#if app.repository_url}
						<a
							href={app.repository_url}
							class="text-nostr-purple hover:text-nostr-gold transition-colors"
							target="_blank"
							rel="noopener noreferrer"
						>
							Repo
						</a>
					{/if}
				</p>
			{/if}
			<p>
				Appears in
				<span class="font-medium text-gray-300">{formatInt(stackAppearances)}</span>
				{stackAppearances === 1 ? 'app stack' : 'app stacks'}.
			</p>
			<p>
				<span class="font-medium text-gray-300">{formatInt(app.total_sats)}</span>
				sats /
				<span class="font-medium text-gray-300">{formatInt(app.total_count)}</span>
				zaps received in the past year.
			</p>
		</div>
	</div>

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
			<McpDerivableNote metrics={['app_zaps', 'app_releases']} />
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
			<McpDerivableNote metrics={['app_zaps', 'app_releases']} />
		</div>
	</div>

	<section class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<h2 class="text-2xl font-bold text-white mb-4">Releases</h2>
		{#if releases.length === 0}
			<p class="text-sm text-gray-400">No releases observed for this app.</p>
		{:else}
			<ul class="divide-y divide-gray-700">
				{#each releases as release (release.event_id)}
					<li class="py-3">
						<div class="flex items-baseline gap-4 flex-wrap">
							<span class="text-xs text-gray-400 font-mono w-28 shrink-0">
								{formatDate(release.created_at)}
							</span>
							<span class="text-base font-semibold text-white">
								{release.version ?? release.d_tag}
							</span>
							{#if release.channel && release.channel !== 'main'}
								<span class="text-xs text-gray-500 font-mono">{release.channel}</span>
							{/if}
							{#if release.repo_url || release.url}
								<a
									href={release.repo_url ?? release.url}
									class="text-xs text-nostr-purple hover:text-nostr-gold transition-colors"
									target="_blank"
									rel="noopener noreferrer"
								>
									Release page →
								</a>
							{/if}
						</div>
						{#if release.content}
							{@const split = splitContent(release.content)}
							<div class="mt-2 pl-32">
								<div class="text-sm text-gray-300 pl-3">
									<div class="whitespace-pre-wrap">{split.head}</div>
									{#if split.tail}
										<details class="mt-2">
											<summary
												class="text-xs text-gray-400 cursor-pointer hover:text-gray-200 italic"
											>
												More…
											</summary>
											<div class="whitespace-pre-wrap mt-1">{split.tail}</div>
										</details>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
