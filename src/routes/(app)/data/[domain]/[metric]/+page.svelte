<script lang="ts">
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { cardCopy } from '$lib/social/card-copy';

	export let data: PageData;
	$: m = data.metric;
	$: r = data.record;
	$: windowed = m?.params?.window.accepted === true;
	$: entityFilters = m?.params?.entity_filters ?? null;
	$: paid = data.priceSats != null;
	// Page identity, resolved once so <SocialMeta> below is unconditional. `data.metric` and
	// `data.record` are the two live shapes; the fallbacks are what a future third shape
	// would get - a plain, correct title rather than none.
	$: entityKey = r?.key ?? m?.key ?? 'Nostrology data';
	$: entitySummary = r?.summary ?? m?.summary ?? '';
	$: entityTitle = r
		? `${r.key} - Nostrology reference data (MCP)`
		: m
			? `${m.key} - Nostrology metric (MCP)`
			: 'Nostrology data (MCP)';
	// A paid metric's example MUST carry the credential argument, or the page
	// hands out a call that cannot succeed. The placeholder is deliberately not
	// a real token: it names the shape and nothing else.
	$: exampleCall = m
		? JSON.stringify(
				{
					name: data.tool,
					arguments: {
						metric: m.metric,
						domain: m.domain,
						grain: m.grain,
						...(paid ? { cashu_token: 'cashuB<one 21-sat token>' } : {})
					}
				},
				null,
				2
			)
		: '';
	// Second example for windowable metrics: the from/to contract is easiest to
	// learn from a concrete call. Static dates on purpose - a computed "today"
	// would make the page's HTML unstable for crawlers.
	$: exampleWindowed = m
		? JSON.stringify(
				{
					name: data.tool,
					arguments: {
						metric: m.metric,
						domain: m.domain,
						grain: m.grain,
						from: '2026-07-01',
						to: '2026-07-31',
						...(paid ? { cashu_token: 'cashuB<one 21-sat token>' } : {})
					}
				},
				null,
				2
			)
		: '';

	// Reference-record examples. The Zapstore curator pubkey is stable, public,
	// and present in every record's population - the one safe static scope.
	const EXAMPLE_PUB = '78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d';
	const EXAMPLE_APP = 'net.mullvad.mullvadvpn';
	// The record's scope, read generically: `scope` names the parameter (null =
	// the record takes none - the Routstr catalog/exclusions records); the legacy
	// `publisher_pubkey` block is the v2 shape an older MCP container still serves.
	$: recordScope = r
		? (r.params.scope ??
			(r.params.publisher_pubkey
				? { param: 'publisher_pubkey', ...r.params.publisher_pubkey }
				: { param: null, required: false, note: 'this record takes no entity scope' }))
		: null;
	$: recordCall = r
		? JSON.stringify(
				{
					name: data.tool,
					arguments: {
						record: r.record,
						domain: r.domain,
						...(recordScope?.required && recordScope.param
							? { [recordScope.param]: EXAMPLE_PUB }
							: {})
					}
				},
				null,
				2
			)
		: '';
	$: recordAppCall =
		r && r.params.app_id
			? JSON.stringify(
					{
						name: data.tool,
						arguments: {
							record: r.record,
							domain: r.domain,
							publisher_pubkey: EXAMPLE_PUB,
							app_id: EXAMPLE_APP
						}
					},
					null,
					2
				)
			: '';
	$: appScopeCols = r ? r.columns.filter((c) => c.app_scope_only).map((c) => c.name) : [];
</script>

<!--
	ONE unconditional SocialMeta, not one per branch. This route renders either a metric or
	a reference record, and an {#if}/{:else if} pair means a third state - or a load that
	stops throwing on the not-found path - silently produces a page with no <title> and no
	card at all. The coverage guard cannot see that: it greps for the tag, and the tag would
	still be there. Resolving the identity in the script keeps the page total by construction.
-->
<SocialMeta
	title={entityTitle}
	socialTitle={entityKey}
	description={entitySummary}
	socialDescription={cardCopy(entitySummary)}
/>

{#if r}
	<div class="space-y-8">
		<div>
			<p class="text-sm text-gray-500">
				<a href="/data" class="text-teal-400 hover:underline">Data</a> /
				<a href="/data/{r.domain}" class="text-teal-400 hover:underline capitalize"
					>{r.domain}</a
				>
				/ {r.record}
			</p>
			<h1 class="text-3xl font-bold text-white mt-2 font-mono">{r.record}</h1>
			<p class="text-gray-300 mt-3 text-lg leading-relaxed max-w-3xl">{r.summary}</p>
		</div>

		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">kind</p>
				<p class="text-white font-mono">reference data</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">series</p>
				<p class="text-white font-mono">
					{r.snapshot_note ? 'current state' : 'event listing'}
				</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">row cap</p>
				<p class="text-white font-mono">{r.params.row_cap.toLocaleString()}</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">key</p>
				<p class="text-white font-mono text-sm break-all">{r.key}</p>
			</div>
		</div>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Parameters</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm max-w-3xl">
					<thead>
						<tr class="text-gray-500 border-b border-gray-700">
							<th class="py-2 pr-4">param</th>
							<th class="py-2">accepted values</th>
						</tr>
					</thead>
					<tbody>
						{#if recordScope?.param}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">{recordScope.param}</td>
								<td class="py-2 text-gray-300">
									<span class="font-semibold"
										>{recordScope.required ? 'required' : 'optional'}</span
									>
									- {recordScope.note}
								</td>
							</tr>
						{:else if recordScope}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-gray-500">(no entity scope)</td>
								<td class="py-2 text-gray-300">{recordScope.note}</td>
							</tr>
						{/if}
						{#if r.params.app_id}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">app_id</td>
								<td class="py-2 text-gray-300">optional - {r.params.app_id.note}</td>
							</tr>
						{/if}
						<!-- No rejected-params row here: unlike a metric (where sibling
						     grains of the same tool accept windows, so the rejection is
						     worth stating), a current-state record simply has no from/to
						     - listing a parameter only to say it is refused invites the
						     mistake it warns about. The tool still rejects instructively. -->
						{#if r.params.window.accepted}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">from</td>
								<td class="py-2 text-gray-300">{r.params.window.from}</td>
							</tr>
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">to</td>
								<td class="py-2 text-gray-300">{r.params.window.to}</td>
							</tr>
						{/if}
						<tr class="border-b border-gray-800">
							<td class="py-2 pr-4 font-mono text-teal-300">format</td>
							<td class="py-2 text-gray-300 font-mono">{r.params.format.join(' | ')}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p class="text-gray-500 text-sm">
				Responses are capped at {r.params.row_cap.toLocaleString()} rows; a capped response
				carries an explicit <span class="font-mono">truncated:</span> envelope line naming
				the remedy.
			</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Query it</h2>
			<p class="text-gray-400 text-sm">
				MCP tool call against <code class="text-teal-300 select-all">{data.endpoint}</code>
				(<a href="/data#connect" class="text-teal-400 hover:underline">connect your agent</a>):
			</p>
			<pre
				class="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-teal-300 text-sm overflow-x-auto max-w-3xl"><code
					>{recordCall}</code
				></pre>
			{#if recordAppCall}
				<p class="text-gray-400 text-sm">
					Single-app scope (adds the {appScopeCols.join(', ')} column{appScopeCols.length ===
					1
						? ''
						: 's'}):
				</p>
				<pre
					class="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-teal-300 text-sm overflow-x-auto max-w-3xl"><code
						>{recordAppCall}</code
					></pre>
			{/if}
			<p class="text-gray-500 text-sm">
				Response: a plain-text envelope (scope, {r.snapshot_note ? 'state' : 'window'},
				freshness, column contract, this page's caveats) followed by the table (csv, or
				<code>format: "markdown"</code>).
			</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Response columns</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="text-gray-500 border-b border-gray-700">
							<th class="py-2 pr-4">name</th>
							<th class="py-2 pr-4">type</th>
							<th class="py-2">description</th>
						</tr>
					</thead>
					<tbody>
						{#each r.columns as c (c.name)}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">{c.name}</td>
								<td class="py-2 pr-4 font-mono text-gray-400">{c.type}</td>
								<td class="py-2 text-gray-300">
									{c.description}{#if c.app_scope_only}
										<span class="text-amber-400"> (app scope only)</span>{/if}{#if c.max_chars}
										<span class="text-gray-500">
											- capped at {c.max_chars.toLocaleString()} chars</span
										>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Population</h2>
			<p class="text-gray-300 leading-relaxed max-w-3xl">{r.partition}</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Caveats</h2>
			<ul class="list-disc list-outside ml-5 space-y-2 text-gray-300 leading-relaxed max-w-3xl">
				{#each r.caveats as caveat}
					<li>{caveat}</li>
				{/each}
			</ul>
			<p class="text-gray-500 text-sm">
				Freshness in every response is data-derived: {r.as_of_source}.
			</p>
		</section>
	</div>
{:else if m}
	<div class="space-y-8">
		<div>
			<p class="text-sm text-gray-500">
				<a href="/data" class="text-teal-400 hover:underline">Metrics</a> /
				<a href="/data/{m.domain}" class="text-teal-400 hover:underline capitalize"
					>{m.domain}</a
				>
				/ {m.metric}
			</p>
			<h1 class="text-3xl font-bold text-white mt-2 font-mono">{m.metric}</h1>
			<p class="text-gray-300 mt-3 text-lg leading-relaxed max-w-3xl">{m.summary}</p>
		</div>

		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">unit</p>
				<p class="text-white font-mono">{m.unit}</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">grain</p>
				<p class="text-white font-mono">
					{m.params ? m.params.grain.values.join(' | ') : m.grain} (UTC)
				</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">series</p>
				<p class="text-white font-mono">
					{#if m.series_type === 'snapshot'}current state{:else}{m.output}, full history{/if}
				</p>
			</div>
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-3">
				<p class="text-gray-500 text-xs uppercase">key</p>
				<p class="text-white font-mono text-sm break-all">{m.key}</p>
			</div>
		</div>

		<!-- The price, directly under the facts grid: someone deciding whether to
		     call this metric reads unit/grain/series and then wants the cost, and
		     it was previously stated only on the /data card that links here.
		     Deliberately NOT the amber treatment of the site's dev-environment
		     warning - a price is a fact about the endpoint, not a hazard, and
		     dressing it as one reads like a reason to leave. Same gray card and
		     teal accent as everything else on the page; it stands out by sitting
		     alone at full width, not by shouting. -->
		{#if paid}
			<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 max-w-3xl">
				<p class="text-gray-500 text-xs uppercase">price</p>
				<p class="text-teal-300 text-lg font-semibold mt-0.5">
					{data.priceSats} sats per call - paid in Cashu ecash
				</p>
				<p class="text-gray-400 text-sm mt-2 leading-relaxed">
					Served by <code class="font-mono text-teal-300">{data.tool}</code>, which takes
					the payment as a single-use token in its
					<code class="font-mono text-teal-300">cashu_token</code> argument.
					<span class="text-gray-300">Calling it without one costs nothing</span> and
					returns the terms - price, accepted mints, and a NUT-18 payment request - so an
					agent can discover the price by asking.
				</p>
			</div>
		{/if}

		{#if m.params}
			<section class="space-y-2">
				<h2 class="text-xl font-bold text-white">Parameters</h2>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm max-w-3xl">
						<thead>
							<tr class="text-gray-500 border-b border-gray-700">
								<th class="py-2 pr-4">param</th>
								<th class="py-2">accepted values</th>
							</tr>
						</thead>
						<tbody>
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">grain</td>
								<td class="py-2 text-gray-300">
									<span class="font-mono">{m.params.grain.values.join(' | ')}</span>
									- default <span class="font-mono">{m.params.grain.default}</span>
									({m.params.grain.note})
								</td>
							</tr>
							{#if m.params.window.accepted}
								<tr class="border-b border-gray-800">
									<td class="py-2 pr-4 font-mono text-teal-300">from</td>
									<td class="py-2 text-gray-300">{m.params.window.from}</td>
								</tr>
								<tr class="border-b border-gray-800">
									<td class="py-2 pr-4 font-mono text-teal-300">to</td>
									<td class="py-2 text-gray-300">{m.params.window.to}</td>
								</tr>
							{:else}
								<tr class="border-b border-gray-800">
									<td class="py-2 pr-4 font-mono text-teal-300">from / to</td>
									<td class="py-2 text-gray-300">{m.params.window.reason}</td>
								</tr>
							{/if}
							{#if entityFilters}
								{#each Object.entries(entityFilters) as [name, note] (name)}
									<tr class="border-b border-gray-800">
										<td class="py-2 pr-4 font-mono text-teal-300">{name}</td>
										<td class="py-2 text-gray-300">{note}</td>
									</tr>
								{/each}
							{/if}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">format</td>
								<td class="py-2 text-gray-300 font-mono">{m.params.format.join(' | ')}</td>
							</tr>
						</tbody>
					</table>
				</div>
				{#if data.grainEntries.length > 1}
					<p class="text-gray-500 text-sm">
						Columns per grain:
						{#each data.grainEntries as g, i (g.grain)}{i > 0 ? ' - ' : ''}<span
								class="font-mono text-gray-400">{g.grain}</span
							>: <span class="font-mono">{g.columns.join(', ')}</span>{/each}.
					</p>
				{/if}
			</section>
		{/if}

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Query it</h2>
			<p class="text-gray-400 text-sm">
				MCP tool call against <code class="text-teal-300 select-all">{data.endpoint}</code>
				(<a href="/data#connect" class="text-teal-400 hover:underline">connect your agent</a>):
			</p>
			<pre
				class="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-teal-300 text-sm overflow-x-auto max-w-3xl"><code
					>{exampleCall}</code
				></pre>
			{#if windowed}
				<p class="text-gray-400 text-sm">Windowed (inclusive UTC days; both optional):</p>
				<pre
					class="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-teal-300 text-sm overflow-x-auto max-w-3xl"><code
						>{exampleWindowed}</code
					></pre>
			{/if}
			<p class="text-gray-500 text-sm">
				Response: a plain-text envelope (window, freshness, column contract, this page's
				caveats) followed by the data table (csv, or <code>format: "markdown"</code>) at
				<!-- Not "the {m.grain}-grain table": m is the DEFAULT grain's entry, so on a
				     multi-grain metric that sentence told every reader they would get the
				     default grain no matter which one they asked for. -->
				{#if data.grainEntries.length > 1}the grain you request{:else}{m.grain} grain{/if}.
				{#if paid}
					A paid response adds one line naming the receipt - the sha256 of the token that
					bought it. The same token cannot buy a second response.
				{/if}
			</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Response columns</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="text-gray-500 border-b border-gray-700">
							<th class="py-2 pr-4">name</th>
							<th class="py-2 pr-4">type</th>
							<th class="py-2">description</th>
						</tr>
					</thead>
					<tbody>
						{#each m.columns as c (c.name)}
							<tr class="border-b border-gray-800">
								<td class="py-2 pr-4 font-mono text-teal-300">{c.name}</td>
								<td class="py-2 pr-4 font-mono text-gray-400">{c.type}</td>
								<td class="py-2 text-gray-300">{c.description}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">What is counted</h2>
			<p class="text-gray-300 leading-relaxed max-w-3xl">{m.partition}</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-bold text-white">Caveats</h2>
			<ul class="list-disc list-outside ml-5 space-y-2 text-gray-300 leading-relaxed max-w-3xl">
				{#each m.caveats as caveat}
					<li>{caveat}</li>
				{/each}
			</ul>
			<p class="text-gray-500 text-sm">
				Freshness in every response is data-derived: {m.as_of_source}.
			</p>
		</section>
	</div>
{/if}
