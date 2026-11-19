<script lang="ts">
	import CatalogPage from './CatalogPage.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<SocialMeta
	title="Nostr Ecosystem Metrics - data for AI agents over MCP"
	socialTitle="Nostr ecosystem metrics, over MCP"
	description="Machine-queryable Nostr ecosystem metrics (Zapstore app store analytics) for AI agents over the Model Context Protocol. Free, no auth: {data.endpoint}"
	socialDescription="Query the Nostr ecosystem from your agent. Free, no auth, no infrastructure to run."
/>

<CatalogPage {data} />
