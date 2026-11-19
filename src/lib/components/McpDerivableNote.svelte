<script lang="ts">
	// A one-line footnote under a chart naming the MCP metrics the chart can be
	// rebuilt from. The claim is DERIVABILITY, not provenance: these charts are
	// still served by their own loaders, but every series they draw is reachable
	// through the public MCP endpoint - which is the point being made to a reader
	// who wants the numbers without the page.
	//
	// Link colour matches the /data registry pages (text-teal-400) so the two
	// surfaces read as one system.

	/** Metric slugs as they appear in the registry, e.g. 'zap_count'. */
	export let metrics: string[];
	/** Registry domain the metrics live under. */
	export let domain = 'zapstore';

	// The separator BEFORE each item, so the template can interleave links with
	// plain text without an {@html} escape hatch. A plain comma list, no "and":
	// these are identifiers, not prose.
	$: separators = metrics.map((_, i) => (i === 0 ? '' : ', '));
</script>

<p class="text-right text-sm text-gray-500 mt-2">
	<!-- The registry link rides on "data", not "MCP": /data is the data
	     catalog, and the protocol name is context, not the destination. -->
	Underlying <a href="/data" class="text-teal-400 hover:underline">data</a> available via
	MCP:
	{#each metrics as m, i (m)}{separators[i]}<a
			href="/data/{domain}/{m}"
			class="text-teal-400 hover:underline font-mono">{m}</a
		>{/each}.
</p>
