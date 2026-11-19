<script lang="ts">
	// One source of truth for a page's identity: <title>, description, canonical, and the
	// Open Graph / Twitter card tags that decide what a shared link LOOKS like.
	//
	// WHY THIS EXISTS. Until 2026-08-23 only the landing page carried og:/twitter: tags.
	// Every other route - including /marketplaces, which took 249 distinct IPs from a single
	// Nostr note - unfurled as bare text with no image and no summary. This site's audience
	// arrives overwhelmingly through link previews in Nostr clients, X, Telegram and
	// WhatsApp (on the Marketplaces launch, 195 of 249 IPs fetched the HTML and nothing
	// else - preview fetchers, which run no JavaScript). A missing card is therefore not
	// cosmetic; it is the first impression for most of the traffic.
	//
	// Use it in place of a hand-written <svelte:head> meta block. A page may still have its
	// own <svelte:head> alongside this for anything else (stylesheets, scripts).
	import { page } from '$app/stores';

	/** Full document <title>. */
	export let title: string;
	/** Meta description. Also the default og:/twitter: description. */
	export let description = '';
	/**
	 * Card image url, or null for the site's own 1200x630 card. Pass publisher-controlled
	 * values through `sanitizeExternalUrl` FIRST - this is dirty data (see the note in
	 * $lib/utils/externalUrl: scheme-less hosts and stray bech32 strings both occur), and a
	 * relative or junk value here is a silently image-less card. Anything that is not an
	 * absolute https url is ignored in favour of the site card, because an unfurler cannot
	 * resolve a relative path and X drops http images outright.
	 */
	export let image: string | null = null;
	/**
	 * Card shape. Defaults to `summary` when a page supplies its own image (those are app
	 * icons here, which are square, and a square image in a large card is letterboxed or
	 * dropped) and `summary_large_image` for the site card, which IS 1200x630.
	 */
	export let card: 'summary' | 'summary_large_image' | null = null;
	/** og:/twitter: title, when the social headline should differ from the <title>. */
	export let socialTitle: string | null = null;
	/** og:/twitter: description, when it should differ from the meta description. */
	export let socialDescription: string | null = null;
	/** Emit `<meta name="robots" content="noindex">`. */
	export let noindex = false;
	/** Canonical path override. Defaults to the current pathname. */
	export let canonicalPath: string | null = null;
	/**
	 * Origin override. Defaults to the request's own origin. The landing page passes the
	 * value its server load already computes; see the note there on why the page's origin
	 * must never be derived from PUBLIC_MCP_ENDPOINT, which may name a different host.
	 */
	export let origin: string | null = null;

	const SITE_CARD = '/social-card.png';
	/** The site card's real pixel size. Emitting it stops Facebook and LinkedIn rendering
	 *  an image-less card on a first scrape, which they do while the size is unknown. */
	const SITE_CARD_W = 1200;
	const SITE_CARD_H = 630;
	/**
	 * Last-resort origin. `$page.url` is always populated under adapter-node (the deploy
	 * compose pins ORIGIN), but two cases would otherwise break the page rather than just
	 * the card: a component rendered outside a router throws on `.origin`, and a prerender
	 * pass reports SvelteKit's `http://sveltekit-prerender` sentinel, which would bake a
	 * nonsense host into every canonical and og:image. Nothing prerenders today; the
	 * DB-free /data subtree is the obvious future candidate.
	 */
	const SITE_ORIGIN = 'https://nostrolo.gy';

	function usableImage(candidate: string | null): string | null {
		const trimmed = candidate?.trim();
		if (!trimmed) return null; // '' must fall back, and `??` would have kept it
		return trimmed.startsWith('https://') ? trimmed : null;
	}

	$: pageUrl = $page?.url;
	$: rawOrigin = origin ?? pageUrl?.origin;
	$: resolvedOrigin =
		!rawOrigin || rawOrigin.startsWith('http://sveltekit-prerender') ? SITE_ORIGIN : rawOrigin;
	$: canonical = `${resolvedOrigin}${canonicalPath ?? pageUrl?.pathname ?? '/'}`;
	$: ownImage = usableImage(image);
	$: imageUrl = ownImage ?? `${resolvedOrigin}${SITE_CARD}`;
	// Shape follows the IMAGE, not the caller's intent: the site card is 1200x630, while a
	// page-supplied image here is an app icon or profile picture and is square. A square
	// image in a large card is letterboxed or dropped.
	$: cardType = card ?? (ownImage ? 'summary' : 'summary_large_image');
	$: headline = socialTitle ?? title;
	$: blurb = socialDescription ?? description;
</script>

<svelte:head>
	<title>{title}</title>
	{#if description}<meta name="description" content={description} />{/if}
	<link rel="canonical" href={canonical} />
	{#if noindex}<meta name="robots" content="noindex" />{/if}

	<meta property="og:type" content="website" />
	<meta property="og:url" content={canonical} />
	<meta property="og:site_name" content="nostrolo.gy" />
	<meta property="og:title" content={headline} />
	{#if blurb}<meta property="og:description" content={blurb} />{/if}
	<meta property="og:image" content={imageUrl} />
	<meta property="og:image:alt" content={headline} />
	{#if !ownImage}
		<meta property="og:image:width" content={String(SITE_CARD_W)} />
		<meta property="og:image:height" content={String(SITE_CARD_H)} />
	{/if}

	<meta name="twitter:card" content={cardType} />
	<meta name="twitter:title" content={headline} />
	{#if blurb}<meta name="twitter:description" content={blurb} />{/if}
	<meta name="twitter:image" content={imageUrl} />
	<meta name="twitter:image:alt" content={headline} />
</svelte:head>
