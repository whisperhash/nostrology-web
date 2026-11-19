<script lang="ts">
	// The signed-in user's avatar, as drawn in the nav chip AND in the dropdown beneath
	// it. ONE definition used by both, because the two are the same picture at two sizes
	// and a second copy would drift - the dropdown originally had no avatar at all
	// precisely because the chip's markup was inline and there was nothing to reuse.
	//
	// Deliberately NOT $lib/components/Avatar.svelte (the Zapstore publisher avatar):
	// that one is Tailwind-classed and falls back to a purple letter tile, which is the
	// /zapstore palette. The nav declares its own tokens in plain scoped CSS so it renders
	// identically on the landing page and inside the app group, and this follows suit.

	/** https-only, already validated by safePictureUrl() in $lib/auth/profile. */
	export let picture: string | undefined = undefined;
	/** Display name; supplies the letter for the fallback tile. Never empty in practice -
	 *  parseProfile()/placeholderProfile() fall back to a short npub. */
	export let name = '';
	/** Rendered box, in px. The letter scales with it. */
	export let size = 22;

	// A picture that fails to load falls back to the letter tile. The chip previously
	// hid the broken <img>, which left a hole in the layout with no indication that
	// anything was meant to be there. Same contract as IconTile's `errored`.
	let failed = false;
	// Reset when the picture changes (login as someone else, profile refresh lands).
	$: {
		picture;
		failed = false;
	}
	$: letter = ((name || '?').trim().charAt(0) || '?').toUpperCase();
	$: boxStyle = `--avatar-size:${size}px`;
</script>

{#if picture && !failed}
	<!-- The avatar host is named by the USER in their own kind-0 (profile-metadata)
	     event, so it is an arbitrary third party that we hand a request to on every page
	     load. referrerpolicy=no-referrer stops it learning where the request came from.

	     NO crossorigin=anonymous, deliberately, though the obvious reading is that it
	     helps. It puts the request in CORS mode, and per Fetch a CORS-mode request ALWAYS
	     carries an `Origin` header - `referrerpolicy` does not suppress it. So the
	     attribute trades "no cookies" for "the host is told the user is on this site,
	     signed in, right now", keyed to a URL unique to their pubkey. That is the worse
	     half of the trade: third-party cookies are already blocked by default in Safari
	     and Firefox, we never read these pixels back (no canvas, so CORS buys nothing
	     functional), and without the attribute the request carries NEITHER `Origin` nor
	     `Referer`. Dropping it also drops the CORS requirement it imposed - Blossom hosts
	     satisfy that by spec (BUD-01) but a plain S3 or R2 bucket ships with no CORS
	     config at all, and those avatars simply failed to load. -->
	<img
		class="nav-avatar"
		style={boxStyle}
		src={picture}
		alt=""
		width={size}
		height={size}
		decoding="async"
		referrerpolicy="no-referrer"
		on:error={() => (failed = true)}
	/>
{:else}
	<span class="nav-avatar nav-avatar-letter" style={boxStyle} aria-hidden="true">{letter}</span>
{/if}

<style>
	/* Both branches share the box so swapping one for the other cannot shift the layout.
	   The letter tile carries BOTH classes, so it inherits this and then overrides the
	   background below - via a tag-qualified selector, not source order: Svelte's
	   `:where()` scoping adds no specificity, so two bare class rules would tie and a
	   reorder would silently change the tile's colour. */
	.nav-avatar {
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: 999px;
		flex: 0 0 auto;
		object-fit: cover;
		background: #374151;
	}
	span.nav-avatar-letter {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #4b5563;
		color: #e5e7eb;
		/* 11px at the chip's 22px - the size the chip's letter tile used before - and
		   16px in the 32px menu tile. */
		font-size: calc(var(--avatar-size) * 0.5);
		font-weight: 600;
		line-height: 1;
		user-select: none;
	}
</style>
