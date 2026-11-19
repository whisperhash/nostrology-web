<script lang="ts">
	import { page } from '$app/stores';
</script>

<!-- Error boundary for the whole /data subtree. It exists for two reasons.
     (1) With no +error.svelte at this level SvelteKit unwinds to the ROOT
     boundary, and rendering there skips src/routes/data/+layout.svelte - so the
     dev-env notice vanished on exactly the pages that most need it: the 503 every
     /data/[domain]* page throws while the MCP registry is unreachable, i.e. the
     moment the env is visibly mid-change. Declaring the boundary HERE puts the
     /data layout back in the rendered branch, so the notice comes from the layout
     as it does on every other /data page - deliberately NOT repeated below, or it
     would render twice.
     (2) The subtree had no styled error page at all; a bad /data/<typo> URL fell
     through to Kit's unstyled default. -->
<div class="space-y-3">
	<p class="text-sm text-gray-500">
		<a href="/data" class="text-teal-400 hover:underline">Metrics</a>
	</p>
	<h1 class="text-3xl font-bold text-white">{$page.status}</h1>
	<p class="text-gray-300 leading-relaxed max-w-3xl">
		{$page.error?.message ?? 'Something went wrong.'}
	</p>
	<!-- The 5xx here is one specific failure - the MCP container being unreachable -
	     and saying so is more useful than a generic apology. A 404 is just a bad
	     URL, so it gets pointed back at the catalog instead. -->
	{#if $page.status >= 500}
		<p class="text-gray-500 text-sm leading-relaxed max-w-3xl">
			The metric catalog is served by the MCP container; when it is unreachable these pages
			say so rather than showing a stale copy. The
			<a href="/data" class="text-teal-400 hover:underline">connect instructions</a> stay
			valid, and the catalog is also readable in-protocol as the
			<code class="text-teal-300">nostrology://registry</code> MCP resource.
		</p>
	{:else}
		<p class="text-gray-500 text-sm leading-relaxed max-w-3xl">
			The <a href="/data" class="text-teal-400 hover:underline">metric catalog</a> lists every
			domain and metric that exists.
		</p>
	{/if}
</div>
