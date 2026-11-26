<script lang="ts">
	import { visibleNavItems } from '$lib/nav';
	import { seesUnreleased } from '$lib/unreleased';
	import { session } from '$lib/auth/session';

	/** The site's footer - one definition, shared by the landing page and every
	 *  (app) route, for the same reason SiteNav is shared. */

	/** Class for the inner width-limiting element; see SiteNav. */
	export let container = 'wrap';

	/**
	 * Server-verified session, same contract as SiteNav's.
	 *
	 * The footer carries its own copy of the destination list, so it needs the same gate -
	 * otherwise an unreleased domain hidden from the nav would be published in the footer,
	 * which is worse than not gating at all. The nav's own suite cannot see the footer, so
	 * nav.gating.test.ts asserts every surface together.
	 */
	export let ssrSession: { pubkey: string } | null = null;

	// Store wins once hydrated; before that, trust the server. Same rule as SiteNav.
	$: items = visibleNavItems(seesUnreleased($session.hydrated ? $session : ssrSession));
</script>

<footer>
	<div class="{container} foot">
		<span
			>Nostrology is <a
				class="source"
				href="https://github.com/whisperhash/nostrology-data"
				target="_blank"
				rel="noopener">open-source software</a
			>.</span
		>
		<span class="foot-nav">
			{#each items as item, i (item.href)}
				{#if i > 0}<span aria-hidden="true">&middot;</span>{/if}
				<a class={item.accent ? 'mcp' : ''} href={item.href}>{item.label}</a>
			{/each}
		</span>
	</div>
</footer>

<style>
	footer {
		--line-2: #2a3444;
		--text: #f3f4f6;
		--dim: #6b7280;
		--teal-2: #5eead4;

		border-top: 1px solid var(--line-2);
		padding: 32px 0 48px;
		color: var(--dim);
		font-size: 13px;
		font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
	.wrap {
		width: 100%;
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 22px;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 16px 30px;
		justify-content: space-between;
		align-items: center;
	}
	.foot-nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	footer a {
		color: inherit;
		text-decoration: none;
	}
	footer a:hover {
		color: var(--text);
	}
	footer a.mcp {
		color: var(--teal-2);
	}
	/* The link inside the footer's sentence. In the footer's own link style (the text's grey, no
	   underline) it would read as plain text, so it is underlined the way the site underlines the
	   links in its tables (/git's repositories, /marketplaces' Recent listings): a gray-600 line
	   2px below the text. On hover the rule above brightens the text, and the line follows it. */
	footer a.source {
		text-decoration: underline;
		text-decoration-color: #4b5563;
		text-underline-offset: 2px;
	}
	footer a.source:hover {
		text-decoration-color: currentColor;
	}
</style>
