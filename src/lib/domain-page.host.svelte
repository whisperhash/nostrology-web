<!-- Test host for domain-page.test.ts: a stand-in domain page. It calls domainPage() while it
     initialises, as a page does, hands the result to the test, and draws an element for each
     section of the table so that opening at one has somewhere to land. -->
<script lang="ts">
	import { domainPage, type DomainPage } from './domain-page';
	import type { SlugTable, Target } from './slug-table';

	export let table: SlugTable;
	export let data: { target?: Target };
	export let expose: (dp: DomainPage) => void;

	const dp = domainPage(table, () => data.target);
	expose(dp);
	const { methodologyOpen } = dp;
</script>

{#each Object.values(table.sections) as s (s.elementId)}
	<section id={s.elementId} data-open={s.elementId === 'methodology' ? String($methodologyOpen) : undefined}>
		<h2>{s.title}</h2>
	</section>
{/each}
