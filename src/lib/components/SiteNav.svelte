<script lang="ts">
	import { page } from '$app/stores';
	import { visibleNavItems } from '$lib/nav';
	import { seesUnreleased } from '$lib/unreleased';
	import { session } from '$lib/auth/session';
	import NavAuth from './NavAuth.svelte';

	/**
	 * The site's top-level navigation - ONE definition, used by the landing page and
	 * by (app)/+layout.svelte. It started life inside the landing page and was
	 * replicated outward: the landing wears the site's palette, so there is no reason
	 * for the chrome above it to look like a different product one click later.
	 *
	 * Extracting it also closed a real hazard - for a while the nav existed in two
	 * files, and adding a section meant remembering to edit both.
	 */

	/** Class for the inner width-limiting element. The landing runs at its own 1120px
	 *  `wrap`; app routes pass Tailwind's `container`, so the bar lines up with the
	 *  page content underneath it rather than with a different edge. */
	export let container = 'wrap';

	/**
	 * Server-verified session, from the session cookie via +layout.server.ts. Passed as a prop
	 * rather than read from the store so the SERVER-RENDERED html is already correct: the
	 * identity chip renders there instead of flashing "Log in" on every page load, and the
	 * operator's unreleased items do not pop in after hydration. Once the store has hydrated
	 * it takes over, which is what makes login and logout update the nav without a navigation.
	 */
	export let ssrSession: { pubkey: string } | null = null;

	// The store wins once it knows the answer; before that, trust the server.
	$: items = visibleNavItems(seesUnreleased($session.hydrated ? $session : ssrSession));

	let open = false;

	// Highlight the section you are in. The landing has no answer (it is not one of
	// the sections), so nothing lights up there - which is correct.
	$: current = $page?.url?.pathname ?? '/';
	const isActive = (href: string, path: string) => path === href || path.startsWith(href + '/');
	// The link to the domain the reader is on never preloads. The site preloads a link's data on
	// hover (app.html), and on one of the domain's own addresses (/git/hosting) a hover over
	// "Git-on-Nostr" fetched /git's data: a request the log reads as a visit to /git that never
	// happened (fresh-context review, 2026-10-19). Undefined elsewhere: the body's setting stands.
	const preload = (href: string, path: string) => (isActive(href, path) ? 'off' : undefined);
</script>

<nav class="nav">
	<div class={container}>
		<div class="nav-in">
			<a class="brand" href="/" on:click={() => (open = false)}>
				<img src="/nostr-logo.png" alt="" />nostrolo&middot;gy
			</a>
			<div class="nav-right">
				<span class="nav-links">
					{#each items.filter((i) => !i.accent) as item (item.href)}
						<a
							href={item.href}
							aria-current={isActive(item.href, current) ? 'page' : undefined}
							data-sveltekit-preload-data={preload(item.href, current)}
						>
							{item.label}
						</a>
					{/each}
				</span>
				<!-- Identity sits between the destination row and the accent items, so the
				     order reads: sections | who you are | MCP. -->
				<div class="nav-auth">
					<NavAuth {ssrSession} />
				</div>
				{#each items.filter((i) => i.accent) as item (item.href)}
					<a
						class="mcp"
						href={item.href}
						title={item.title}
						aria-current={isActive(item.href, current) ? 'page' : undefined}
						data-sveltekit-preload-data={preload(item.href, current)}
					>
						{item.label}
					</a>
				{/each}
				<button
					class="nav-burger"
					type="button"
					aria-label="Toggle navigation menu"
					aria-expanded={open}
					aria-controls="navMobile"
					on:click={() => (open = !open)}
				>
					<svg
						width="22"
						height="22"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						{#if open}
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
						{/if}
					</svg>
				</button>
			</div>
		</div>
		<!-- Always in the DOM, merely hidden, so every link is in the served HTML
		     whether or not the toggle is ever pressed. -->
		<div class="nav-mobile" id="navMobile" hidden={!open}>
			{#each items as item, i (item.href)}
				<!-- ONE rule, before the first accent item, however many follow. -->
				{#if item.accent && !items[i - 1]?.accent}
					<hr />
				{/if}
				<a
					class={item.accent ? 'mcp' : ''}
					href={item.href}
					aria-current={isActive(item.href, current) ? 'page' : undefined}
					data-sveltekit-preload-data={preload(item.href, current)}
					on:click={() => (open = false)}
				>
					{item.label}
				</a>
			{/each}
			<!-- The desktop bar's identity control is hidden below 768px, so the mobile
			     panel needs its own. A second NavAuth instance, not a duplicated
			     implementation: both read the same store, so they can never disagree. -->
			<hr />
			<div class="nav-auth nav-auth-mobile">
				<NavAuth {ssrSession} />
			</div>
		</div>
	</div>
</nav>

<style>
	/* The palette tokens this component needs, declared locally so it renders the
	   same whether or not its host defines them. Same values as the landing page's:
	   the site's gray-900/800/700 with teal-400 as the accent. */
	.nav {
		--line: #374151;
		--line-2: #2a3444;
		--text: #f3f4f6;
		--muted: #9ca3af;
		--teal-2: #5eead4;

		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(17, 24, 39, 0.9);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--line-2);
		color: var(--text);
		font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
	.wrap {
		width: 100%;
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 22px;
	}
	.nav a {
		color: inherit;
		text-decoration: none;
	}
	.nav-in {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 60px;
		gap: 12px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 0.2px;
		flex: 0 0 auto;
	}
	.brand img {
		height: 30px;
	}
	/* Anchor for the auth dropdown, which is absolutely positioned. */
	.nav-auth {
		position: relative;
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		margin-left: 6px;
		/* Wider on the right than on the left, deliberately. WHO YOU ARE and WHERE YOU
		   CAN GO are two different things sitting side by side, and at the row's shared
		   4px gap the identity chip read as the first of the pills. This margin plus the
		   row gap and .mcp's own margin puts 20px between the chip and the accent pill, so
		   the chip stands apart from where you can go, without a divider glyph. */
		margin-right: 10px;
	}
	.nav-right {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1 1 auto;
		justify-content: flex-end;
	}
	.nav-right a {
		padding: 6px 11px;
		border-radius: 7px;
		font-size: 13.5px;
		color: var(--muted);
	}
	.nav-right a:hover {
		color: #fff;
		background: #374151;
	}
	.nav-right a[aria-current='page'] {
		color: var(--text);
		background: #263041;
	}
	.nav-right .mcp {
		color: var(--teal-2);
		border: 1px solid rgba(45, 212, 191, 0.4);
		background: rgba(45, 212, 191, 0.09);
		font-weight: 600;
		margin-left: 6px;
		flex: 0 0 auto;
	}
	.nav-right .mcp[aria-current='page'] {
		background: rgba(45, 212, 191, 0.2);
		color: #99f6e4;
	}
	/* The link row scrolls rather than wraps in the band between 768px and the width
	   where every item fits comfortably; it is the only thing allowed to shrink, so
	   the MCP button can never be pushed off the edge. Below 768px it hides outright,
	   together with the MCP pill, and the hamburger takes over. */
	.nav-links {
		display: flex;
		gap: 3px;
		overflow-x: auto;
		scrollbar-width: none;
		flex: 1 1 auto;
		min-width: 0;
	}
	.nav-links::-webkit-scrollbar {
		display: none;
	}
	.nav-links a {
		flex: 0 0 auto;
		white-space: nowrap;
	}

	@media (max-width: 767px) {
		.nav-links,
		.nav-right .mcp,
		.nav-right .nav-auth {
			display: none;
		}
	}
	/* ...and show the panel's own copy only there. */
	.nav-auth-mobile {
		display: none;
		padding: 2px 4px 0;
	}
	@media (max-width: 767px) {
		.nav-auth-mobile {
			display: flex;
		}
	}
	.nav-burger {
		display: none;
		align-items: center;
		justify-content: center;
		padding: 7px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.nav-burger:hover {
		color: #fff;
		background: #374151;
	}
	@media (max-width: 767px) {
		.nav-burger {
			display: inline-flex;
		}
	}
	.nav-mobile {
		display: none;
		padding: 4px 0 12px;
	}
	@media (max-width: 767px) {
		.nav-mobile:not([hidden]) {
			display: block;
		}
	}
	.nav-mobile a {
		display: flex;
		align-items: center;
		padding: 9px 12px;
		border-radius: 7px;
		font-size: 15px;
		color: var(--muted);
	}
	.nav-mobile a:hover {
		color: #fff;
		background: #374151;
	}
	.nav-mobile a[aria-current='page'] {
		color: var(--text);
		background: #263041;
	}
	.nav-mobile a.mcp {
		color: var(--teal-2);
		font-weight: 600;
		border: 1px solid rgba(45, 212, 191, 0.4);
		background: rgba(45, 212, 191, 0.09);
	}
	.nav-mobile hr {
		border: 0;
		border-top: 1px solid var(--line);
		margin: 9px 0;
	}
</style>
