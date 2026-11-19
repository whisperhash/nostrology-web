<script lang="ts">
	// The same catalog as /data, opened on this domain. The page body is shared
	// (../CatalogPage.svelte); only the social-card copy below is scoped, because
	// a link to /data/nutzaps should unfurl as the nutzaps catalog rather than as
	// the site-wide one.
	import CatalogPage from '../CatalogPage.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { metricCardPrice } from '$lib/shared/metricCard';
	import type { PageData } from './$types';

	export let data: PageData;

	$: domainCards = data.metricCards.filter((m) => m.domain === data.selectedDomain);
	// nutzaps serves metrics only; saying "and reference records" of it was false.
	$: hasRecords = data.referenceCards.some((r) => r.domain === data.selectedDomain);
	$: names = [
		...domainCards.map((m) => m.metric),
		...data.referenceCards.filter((r) => r.domain === data.selectedDomain).map((r) => r.record)
	];
	// "Free, no auth" is a claim per METRIC, and a domain can mix the two: nutzaps
	// serves its payment and mint metrics free and `active_users` paid. Naming the
	// paid ones (with the card's own price string) keeps the copy a crawler reads
	// true for a mixed domain, and leaves an all-free domain's copy unchanged.
	$: paidClause = domainCards
		.filter((m) => m.priceSats != null)
		.map((m) => `${m.metric} at ${metricCardPrice(m)}`)
		.join(', ');
	$: terms = paidClause ? `Free, no auth, except ${paidClause}.` : 'Free, no auth.';
	// The lead domain's address renders a body byte-identical to /data's - both
	// loaders select it - so the two would otherwise compete as separate URLs with
	// the same content on a subtree that exists to be indexed. /data is the hub
	// everything links to (the nav, McpDerivableNote, every metric breadcrumb), so
	// it takes the canonical and this address defers to it. Every other domain is
	// the only URL showing its own catalog and canonicalises to itself.
	$: canonicalPath =
		data.selectedDomain === data.domains[0] ? '/data' : `/data/${data.selectedDomain}`;
</script>

<SocialMeta
	{canonicalPath}
	title="Nostr Ecosystem Metrics - {data.selectedDomain} (MCP)"
	socialTitle="{data.selectedDomain} metrics, over MCP"
	description="{data.selectedDomain} metrics{hasRecords ? ' and reference data' : ''} for AI agents over MCP: {names.join(
		', '
	)}. {terms}"
	socialDescription="{names.length} {data.selectedDomain} metrics{hasRecords ? ' and reference records' : ''}, queryable by an agent over MCP. {terms}"
/>

<CatalogPage {data} />
