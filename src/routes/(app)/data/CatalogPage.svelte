<!-- The catalog itself - connect instructions, the domain pills, and the
     selected domain's endpoints. Rendered by BOTH of the catalog's addresses:
     /data (lead domain selected) and /data/<domain> (that domain selected).
     Those two routes differ ONLY in their loader's `selectedDomain` and in the
     social-card copy their +page.svelte supplies; the page a visitor sees is
     this one either way, which is what keeps the domain address from being a
     second, thinner copy of the index. -->
<script lang="ts">
	import { HARNESSES, stdioShim } from '$lib/mcp/harnesses';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { metricCardLabel, metricCardPrice } from '$lib/shared/metricCard';
	import { openHarness, showHarnesses } from './harness-panel';
	import type { CatalogData } from './catalog';

	export let data: CatalogData;

	// Both stores, not `let`s: this component is destroyed and recreated when a
	// pill navigates from /data to /data/<domain>, which would collapse the panel
	// mid-interaction. See harness-panel.ts for the full mechanism.
	//
	// Harness instructions collapse into the endpoint row, toggled in JS rather
	// than with <details> because the summary has to sit BESIDE the URL while the
	// panel opens BELOW it, which one <details> element cannot express. Every
	// panel is rendered and merely `hidden`, so all snippets stay in the served
	// HTML for the crawlers and agents this page exists to be read by; picking one
	// only changes which is visible.
</script>

<div class="space-y-8">
	<div>
		<h1 class="text-3xl font-bold text-white mb-3">Nostr Ecosystem Metrics over MCP</h1>
		<p class="text-gray-300 leading-relaxed max-w-3xl">
			Curated, methodology-documented metrics over Nostr ecosystem data - starting with the
			<a href="/zapstore" class="text-teal-400 hover:underline">Zapstore app store</a> - queryable
			by AI agents over the Model Context Protocol. Free at present, no authentication.
		</p>
	</div>

	<!-- Connect. Deliberately compact: the endpoint is the only thing that must be
	     seen at a glance, everything else folds away so the catalog below is what
	     the page is actually about. -->
	<section id="connect" class="space-y-3">
		<!-- A GRID, not nested flex rows, so the heading row can be pinned to the same
		     column as the URL box: that is what puts "MCP server URL" flush with the
		     box's right edge instead of the container's (the harness button lives in
		     column 2 and must not push the caption past the box).
		     One column below `sm`, where the three children stack in DOM order -
		     heading, URL, button - and the heading row's own flex-wrap drops the
		     caption under "Connect your agent" as soon as the two no longer fit.
		     `minmax(16rem,...)` floors the URL column: a grid does not wrap, so an
		     unbounded 1fr would let a wider button squeeze the URL back to
		     "https://d" (the phone bug), while a floor that is too high would push
		     the button out of the container instead. -->
		<div class="grid gap-3 sm:grid-cols-[minmax(16rem,1fr)_auto]">
			<div
				class="flex items-baseline justify-between gap-4 flex-wrap sm:col-start-1 sm:row-start-1"
			>
				<h2 class="text-2xl font-bold text-white">Connect your agent</h2>
				<span class="text-gray-500 text-sm">MCP server URL</span>
			</div>

			<!-- min-w-0: a grid track floors at its items' min-content, and the URL is
			     one unbreakable mono token, so without this the column refuses to go
			     narrower than the full endpoint and the PAGE scrolls sideways on a
			     320px screen. Zeroing it hands the overflow to the code element's own
			     overflow-x-auto, where it belongs. Does not affect `sm` and up - the
			     16rem floor there lives on the track, not the item. -->
			<div class="relative min-w-0 sm:col-start-1 sm:row-start-2">
				<!-- text-base, matching the metric names in the catalog below: this
				     section reads at the same scale as that one rather than announcing
				     itself as the bigger thing on the page. -->
				<code
					class="block bg-gray-900 border border-gray-700 rounded-lg pl-4 pr-12 py-3 text-teal-300 text-base select-all overflow-x-auto"
					>{data.endpoint}</code
				>
				<CopyButton
					text={data.endpoint}
					label="endpoint URL"
					class="absolute right-2 top-1/2 -translate-y-1/2"
				/>
			</div>

			<button
				type="button"
				class="flex items-center justify-center sm:justify-start gap-2 px-4 py-3 sm:py-0 sm:col-start-2 sm:row-start-2 rounded-lg border border-gray-700 bg-gray-800/50 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
				aria-expanded={$showHarnesses}
				aria-controls="harness-instructions"
				on:click={() => showHarnesses.update((v) => !v)}
			>
				<svg
					class="h-4 w-4 transition-transform {$showHarnesses ? 'rotate-90' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7" />
				</svg>
				Harness instructions
			</button>
		</div>

		<!-- Always rendered, merely hidden: <details>-equivalent for machine readers
		     (all 13 snippets stay in the served HTML while collapsed). -->
		<div id="harness-instructions" hidden={!$showHarnesses}>
			<div class="border border-gray-700 rounded-lg p-4 space-y-3">
				<!-- Harness picker: a wrapping row of names (horizontal space instead of a
				     tall accordion), with exactly one panel open at a time. -->
				<div
					class="flex flex-wrap gap-2"
					role="tablist"
					aria-label="Harness registration instructions"
				>
					{#each HARNESSES as h (h.id)}
						<button
							type="button"
							role="tab"
							aria-selected={$openHarness === h.id}
							aria-controls="harness-{h.id}"
							class="px-3 py-1.5 rounded-md text-sm border transition-colors {$openHarness === h.id
								? 'bg-teal-500/15 border-teal-600 text-teal-200'
								: 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white'}"
							on:click={() => openHarness.set(h.id)}
						>
							{h.name}
						</button>
					{/each}
				</div>

				<!-- Every panel is in the DOM; only the selected one is visible. Keeps all
				     snippets in the served HTML for crawlers/agents (see harness-panel.ts). -->
				{#each HARNESSES as h (h.id)}
					<div
						id="harness-{h.id}"
						role="tabpanel"
						aria-label="{h.name} registration"
						hidden={$openHarness !== h.id}
						class="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2"
					>
						{#if h.configPath}
							<p class="text-gray-500 text-sm">
								{h.kind === 'command' ? 'Run' : 'Edit'}
								<span class="font-mono text-gray-400">{h.configPath}</span>
							</p>
						{/if}
						<div class="relative">
							<pre
								class="bg-gray-900 rounded pl-3 pr-12 py-2 text-teal-300 text-sm overflow-x-auto"><code
									>{h.snippet(data.endpoint)}</code
								></pre>
							<CopyButton
								text={h.snippet(data.endpoint)}
								label="{h.name} snippet"
								class="absolute right-1 top-1"
							/>
						</div>
						{#if h.note}<p class="text-gray-500 text-sm">{h.note}</p>{/if}
					</div>
				{/each}

				<!-- The long tail: needed by some, in the way of everyone else. -->
				<details class="text-sm">
					<summary class="cursor-pointer text-gray-400 hover:text-gray-200 select-none">
						Harness has no remote-MCP support?
					</summary>
					<div class="mt-2 space-y-2">
						<p class="text-gray-400 leading-relaxed">
							Bridge the endpoint into a local stdio server with
							<a
								href="https://github.com/geelen/mcp-remote"
								class="text-teal-400 hover:underline"
								rel="noopener">mcp-remote</a
							>:
						</p>
						<div class="relative">
							<code
								class="block bg-gray-900 border border-gray-700 rounded pl-3 pr-12 py-2 text-teal-300 select-all overflow-x-auto"
								>{stdioShim(data.endpoint)}</code
							>
							<CopyButton
								text={stdioShim(data.endpoint)}
								label="mcp-remote command"
								class="absolute right-1 top-1/2 -translate-y-1/2"
							/>
						</div>
					</div>
				</details>
			</div>
		</div>
	</section>

	<!-- Catalog: the point of the page. -->
	<section class="space-y-4">
		<h2 class="text-2xl font-bold text-white">Catalog</h2>
		{#if data.registry}
			<p class="text-gray-400 text-sm leading-relaxed max-w-3xl">
				Three tools. <code class="text-teal-300">{data.registry.tool}</code> serves the
				free quantitative metrics - including the nutzaps payment and mint metrics
				(kind-9321 (nutzaps) payments per day and per Cashu mint) - routed by the
				<code class="text-teal-300">metric</code> parameter;
				<code class="text-teal-300"
					>{data.registry.tools?.reference ?? 'nostrology_query_reference'}</code
				>
				serves the free reference records (qualitative entity data - catalog entries,
				publisher profiles, release history), routed by the
				<code class="text-teal-300">record</code> parameter; and
				<code class="text-teal-300"
					>{data.registry.tools?.nutzaps ?? 'nostrology_query_nutzaps'}</code
				>
				serves the one paid metric, network-wide nutzaps active users
				(<code class="text-teal-300">active_users</code>), paid per call in Cashu ecash - its
				card states the price (pick the Nutzaps pill), and calling it without a token returns
				the payment terms for free. Every response carries its own envelope: scope, window,
				freshness, column contract, and the methodology caveats stating what is and is not
				counted. Pick a domain below; more arrive as their data is exposed.
			</p>
			<!-- The domain pills ARE the filter: one row of chips, the selected one
			     filled teal, and only that domain's endpoints below. Every domain that
			     lands (Lightning, Relays, ...) adds a chip and nothing else.

			     Ordinary links to /data/<domain>, not buttons and not a `?domain=`
			     query: the selection is the page's IDENTITY (single-valued, mutually
			     exclusive), which is what a path segment encodes and a query parameter
			     does not. It also survives a reload and a share, needs no JS, gives
			     each domain a crawlable address, and nests with the metric URLs one
			     segment deeper (/data/nutzaps -> /data/nutzaps/active_users). The href
			     is ABSOLUTE for a reason: the old `?domain=` form was query-only and
			     therefore relative, so a client resolving it against the site root
			     requested /?domain=zapstore - a URL nothing links to, observed in the
			     access logs.

			     `data-sveltekit-noscroll` is what makes a click on an already-open page
			     read as "select this pill" rather than a page load: SvelteKit navigates
			     client-side and the scroll position is kept, so the chips and the grid
			     below them stay exactly where the eye left them. Arriving at the URL
			     fresh starts at the top, banner and connect section first, as any
			     page load does. -->
			<h3 class="sr-only">Domains</h3>
			<div class="flex flex-wrap gap-2" role="group" aria-label="Filter the catalog by domain">
				{#each data.domains as domain (domain)}
					<a
						href="/data/{domain}"
						data-sveltekit-noscroll
						aria-current={domain === data.selectedDomain ? 'true' : undefined}
						class="inline-flex items-center rounded-full border px-4 py-1.5 text-lg font-semibold capitalize transition-colors {domain ===
						data.selectedDomain
							? 'border-teal-500 bg-teal-500/20 text-teal-200 shadow-[0_0_0_3px_rgba(20,184,166,0.10)] hover:bg-teal-500/30 hover:text-teal-100'
							: 'border-gray-700 bg-gray-800 text-gray-400 hover:border-teal-700 hover:text-teal-300'}"
						>{domain}</a
					>
				{/each}
			</div>
			{#each data.domains.filter((d) => d === data.selectedDomain) as domain (domain)}
				<div class="space-y-3">
					{#if data.metricCards.some((m) => m.domain === domain)}
						<h4 class="text-sm font-semibold uppercase tracking-wide text-gray-500">
							{domain} metrics
						</h4>
						<div class="grid gap-3 lg:grid-cols-2">
							{#each data.metricCards.filter((m) => m.domain === domain) as m (m.key)}
								<a
									href="/data/{m.domain}/{m.metric}"
									class="block bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-teal-600 transition-colors"
								>
									<div class="flex items-baseline justify-between gap-4 flex-wrap">
										<span class="text-teal-300 font-mono">{m.metric}</span>
										<span class="text-gray-500 text-sm">
											{metricCardLabel(m)}{#if metricCardPrice(m)}{' - '}<span class="text-nostr-gold">{metricCardPrice(m)}</span>{/if}
										</span>
									</div>
									<p class="text-gray-400 text-sm mt-2">{m.summary}</p>
								</a>
							{/each}
						</div>
					{/if}
					{#if data.referenceCards.some((r) => r.domain === domain)}
						<h4 class="text-sm font-semibold uppercase tracking-wide text-gray-500">
							{domain} reference data
						</h4>
						<div class="grid gap-3 lg:grid-cols-2">
							{#each data.referenceCards.filter((r) => r.domain === domain) as r (r.key)}
								<a
									href="/data/{r.domain}/{r.record}"
									class="block bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-amber-600 transition-colors"
								>
									<div class="flex items-baseline justify-between gap-4 flex-wrap">
										<span class="text-amber-300 font-mono">{r.record}</span>
										<span class="text-gray-500 text-sm"
											>reference - {r.snapshotNote ? 'current state' : 'event listing'}</span
										>
									</div>
									<p class="text-gray-400 text-sm mt-2">{r.summary}</p>
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{:else}
			<div class="bg-gray-800 border border-yellow-700 rounded-lg p-4 text-yellow-300">
				The metric registry is temporarily unavailable (the MCP server could not be reached).
				The connect instructions above remain valid; the catalog is also readable in-protocol
				as the <code>nostrology://registry</code> MCP resource.
			</div>
		{/if}
	</section>
</div>
