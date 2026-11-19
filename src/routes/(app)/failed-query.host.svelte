<!-- Test host for failed-query.test.ts. It renders a page from a store, so a new `data`
     reaches the page as an ordinary update, the way SvelteKit applies a re-run load.
     @testing-library's rerender() updates inside flushSync instead, which hides the
     Svelte 5.51 {#await} bug that /relays works around with {#key}. -->
<script lang="ts">
	import type { Component } from 'svelte';
	import type { Readable } from 'svelte/store';

	// Any page: each takes its own `data` shape.
	export let Page: Component<any>;
	export let store: Readable<unknown>;
</script>

<svelte:component this={Page} data={$store} />
