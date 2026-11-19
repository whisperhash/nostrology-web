<script lang="ts">
	// The identity control in the site nav: "Log in" when anonymous, an avatar + name
	// chip with a dropdown when signed in.
	//
	// WORDING: "Log in" / "Log out", not "Sign in" / "Sign out". Two reasons. In a Nostr
	// context "sign" already means signing an event with your key - the literal thing
	// that happens during login - so "Sign in" is ambiguous here in a way it is not on an
	// ordinary website. And NIP-46 (remote signer / bunker) names the operation `logout`
	// in its own methods table, under a section headed "Ending a session"; for an Amber
	// user this button really does send that RPC. The ecosystem agrees 16 clients to 2.
	//
	// The word "account" is deliberately absent from every string here. On Nostr the user
	// has a keypair, not an account we issue - and nothing is created at login. That is
	// where the community's objection actually bites, not in the verb.
	//
	// No confirm dialog on log out. Every such dialog in the ecosystem (nsec.app,
	// nostr-login, Amethyst) exists because that client STORES the user's key and is
	// about to delete it. We never hold key material, so there is nothing to warn about.
	import { onMount } from 'svelte';
	import { session, login, logout } from '$lib/auth/session';
	import { hasNip07 } from '$lib/auth/signer';
	import { shortNpub } from '$lib/auth/profile';
	import NavAvatar from './NavAvatar.svelte';

	/**
	 * Server-verified session from +layout.server.ts, for the SSR render.
	 *
	 * Without it a logged-in user gets a "Log in" button in the server-rendered HTML that
	 * flips to their avatar a moment after hydration - on every page load. Same pattern,
	 * and same reason, as SiteNav's `ssrSession` prop.
	 */
	export let ssrSession: { pubkey: string } | null = null;

	let open = false;
	let showLogin = false;
	let bunkerInput = '';
	/**
	 * Whether a NIP-07 (browser extension signer) is present.
	 *
	 * Re-probed on a timer rather than read once: NIP-07 (browser extension signer) defines NO ready event, so an
	 * extension that injects after mount would otherwise leave the button permanently
	 * disabled. That exact bug ships in Coracle, snort, noStrudel and habla.
	 */
	let extensionPresent = false;

	onMount(() => {
		extensionPresent = hasNip07();
		if (extensionPresent) return;
		const started = Date.now();
		const timer = setInterval(() => {
			extensionPresent = hasNip07();
			if (extensionPresent || Date.now() - started > 3000) clearInterval(timer);
		}, 100);
		return () => clearInterval(timer);
	});

	$: state = $session;
	// The store wins once it has hydrated; before that, trust the server.
	$: pubkey = state.hydrated ? state.pubkey : (ssrSession?.pubkey ?? null);
	// ONE source for the name shown in the chip, the menu heading, and the letter that
	// stands in for a missing picture - so the chip and the menu can never disagree, and
	// the fallback tile always carries the initial of the name actually on screen.
	// `|| `, not `?? ` - an EMPTY name has to fall back too, and `??` only catches
	// undefined. parseProfile() never returns one, but a profile restored from the
	// localStorage cache is validated on `pubkey` alone, so a corrupt entry reached
	// the chip as a blank space where the name should be.
	$: displayName = pubkey === null ? '' : (state.profile?.name?.trim() || shortNpub(pubkey));
	$: busy = state.status === 'connecting' || state.status === 'awaiting-signature';

	async function loginWithExtension() {
		if (await login({ kind: 'extension' })) closeAll();
	}

	async function loginWithBunker() {
		if (bunkerInput.trim() === '') return;
		if (await login({ kind: 'bunker', input: bunkerInput })) {
			bunkerInput = '';
			closeAll();
		}
	}

	async function doLogout() {
		open = false;
		await logout();
	}

	function closeAll() {
		showLogin = false;
		open = false;
	}
</script>

<svelte:window
	on:keydown={(e) => {
		if (e.key === 'Escape') closeAll();
	}}
/>

{#if pubkey === null}
	<button class="auth-btn" type="button" on:click={() => (showLogin = !showLogin)}>Log in</button>
{:else}
	<button
		class="auth-chip"
		type="button"
		aria-expanded={open}
		aria-controls="navAuthPanel"
		on:click={() => (open = !open)}
	>
		<NavAvatar picture={state.profile?.picture} name={displayName} size={22} />
		<span class="auth-name">{displayName}</span>
	</button>

	{#if open}
		<!-- A DISCLOSURE, not a `role="menu"`. ARIA requires a menu's owned elements to be
		     menuitem/group/separator, and this panel leads with an identity block that is
		     none of those - under the old roles a screen reader announced "menu, 1 item,
		     Log out" and skipped the identity entirely, which is the whole point of the
		     panel. `aria-expanded` + `aria-controls` on the chip describes what is
		     actually here. (Focus is still not trapped or returned, and only Escape
		     closes - both pre-existing.) -->
		<div class="auth-menu" id="navAuthPanel">
			<div class="auth-menu-id">
				<!-- The same avatar as the chip, one size up, to the LEFT of the two text
				     lines - the shape every Nostr client uses for this menu. -->
				<NavAvatar picture={state.profile?.picture} name={displayName} size={32} />
				<div class="auth-menu-text">
					<div class="auth-menu-name">{displayName}</div>
					{#if state.profile?.nip05}
						<!-- No verification checkmark, deliberately. NIP-05 (DNS identifier) is
						     "identification, not verification" per its own spec, and a tick next to
						     a lookalike domain legitimizes it. This is the user's own handle, so
						     the trust question does not arise - showing it is enough. -->
						<div class="auth-menu-sub">{state.profile.nip05}</div>
					{:else}
						<div class="auth-menu-sub">{shortNpub(pubkey)}</div>
					{/if}
				</div>
			</div>
			<button class="auth-menu-item" type="button" on:click={doLogout}>
				Log out
			</button>
		</div>
	{/if}
{/if}

{#if showLogin}
	<div class="auth-menu auth-login" role="dialog" aria-label="Log in with Nostr">
		<p class="auth-login-lead">Log in with your Nostr signer.</p>

		<button
			class="auth-login-primary"
			type="button"
			disabled={!extensionPresent || busy}
			on:click={loginWithExtension}
		>
			{busy ? 'Waiting for your signer...' : 'Browser extension'}
		</button>
		{#if !extensionPresent}
			<p class="auth-login-hint">
				No browser extension detected. Use a remote signer below, or install one such as
				Alby or nos2x.
			</p>
		{/if}

		<label class="auth-login-label" for="bunker-uri">Remote signer (Amber, nsec.app)</label>
		<input
			id="bunker-uri"
			class="auth-login-input"
			type="text"
			autocomplete="off"
			spellcheck="false"
			placeholder="bunker://..."
			bind:value={bunkerInput}
			disabled={busy}
			on:keydown={(e) => {
				if (e.key === 'Enter') loginWithBunker();
			}}
		/>
		<button
			class="auth-login-secondary"
			type="button"
			disabled={busy || bunkerInput.trim() === ''}
			on:click={loginWithBunker}
		>
			Connect
		</button>

		{#if state.status === 'awaiting-signature'}
			<p class="auth-login-hint">Approve the signature request in your signer.</p>
		{/if}
		{#if state.error}
			<p class="auth-login-error">{state.error}</p>
		{/if}
		<!-- Never a "paste your nsec" field. The key stays in the signer, always. -->
		<p class="auth-login-foot">Your key never leaves your signer.</p>
	</div>
{/if}

<style>
	/* Same palette tokens as SiteNav, declared locally so the component renders the same
	   wherever it is mounted. */
	.auth-btn,
	.auth-chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 5px 11px;
		border: 1px solid #374151;
		border-radius: 7px;
		background: transparent;
		color: #9ca3af;
		font-size: 13.5px;
		font-family: inherit;
		cursor: pointer;
		flex: 0 0 auto;
		white-space: nowrap;
	}
	.auth-btn:hover,
	.auth-chip:hover {
		color: #fff;
		background: #374151;
	}
	/* Both halves of the truncation defence: the value is hard-capped in safeName(), and
	   the layout caps it again here. A name that overflows its box is a phishing
	   primitive, and noStrudel ships exactly that bug. */
	.auth-name {
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.auth-menu {
		position: absolute;
		top: 52px;
		right: 0;
		z-index: 60;
		min-width: 248px;
		padding: 8px;
		border: 1px solid #374151;
		border-radius: 10px;
		background: #111827;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		text-align: left;
	}
	.auth-menu-id {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 6px 8px 10px;
		border-bottom: 1px solid #2a3444;
		margin-bottom: 6px;
	}
	/* min-width:0 is what lets the two text lines ellipsize inside a flex row; without
	   it the column takes its content's intrinsic width and a long name overflows the
	   menu - the same overflow .auth-name's max-width defends against in the chip. */
	.auth-menu-text {
		min-width: 0;
		flex: 1 1 auto;
	}
	.auth-menu-name {
		color: #f3f4f6;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.auth-menu-sub {
		color: #9ca3af;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.auth-menu-item {
		display: block;
		width: 100%;
		padding: 8px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: #9ca3af;
		font-size: 13.5px;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	.auth-menu-item:hover {
		color: #fff;
		background: #374151;
	}
	.auth-login {
		min-width: 268px;
	}
	.auth-login-lead {
		margin: 2px 4px 10px;
		color: #d1d5db;
		font-size: 13px;
	}
	.auth-login-primary,
	.auth-login-secondary {
		display: block;
		width: 100%;
		padding: 8px;
		margin-bottom: 8px;
		border-radius: 7px;
		font-size: 13.5px;
		font-family: inherit;
		cursor: pointer;
	}
	.auth-login-primary {
		border: 1px solid rgba(45, 212, 191, 0.4);
		background: rgba(45, 212, 191, 0.12);
		color: #5eead4;
		font-weight: 600;
	}
	.auth-login-secondary {
		border: 1px solid #374151;
		background: transparent;
		color: #9ca3af;
	}
	.auth-login-primary:disabled,
	.auth-login-secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.auth-login-label {
		display: block;
		margin: 4px 4px 4px;
		color: #9ca3af;
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.auth-login-input {
		width: 100%;
		padding: 7px 8px;
		margin-bottom: 8px;
		border: 1px solid #374151;
		border-radius: 7px;
		background: #0b1220;
		color: #e5e7eb;
		font-size: 13px;
		font-family: inherit;
	}
	.auth-login-hint,
	.auth-login-foot {
		margin: 0 4px 6px;
		color: #9ca3af;
		font-size: 11.5px;
	}
	.auth-login-error {
		margin: 0 4px 6px;
		color: #fca5a5;
		font-size: 12px;
		word-break: break-word;
	}
</style>
