// Where a Recent listings row links: the listing's own page on one of three open
// marketplaces, rotated across them so no single one takes all the traffic this page sends
// (the operator's request, 2026-10-23). Kept out of the page so it can be unit-tested, as
// $lib/ngit/links is for /git.
//
// MARKETPLACE, NOT "CLIENT". Two of the three are Nostr clients - Conduit Market and
// Plebeian Market read a listing from relays in the browser - and the third is not:
// Shopstr's listing page has no relay subscription at all, it is server-rendered from
// Shopstr's own database (see its block below). The word also already means something else
// in our own data: `client` is a column of marketplaces_listings, the `client` tag on the
// listing event, i.e. the app the SELLER published with, which the table prints as
// "via <name>". So `Marketplace` here, and `client` only for the seller's app.
//
// WHY THE CHOICE IS DETERMINISTIC, NOT RANDOM PER RENDER. A listing always opens on the
// same marketplace: a reload, a second visit and a shared screenshot agree, the server's
// HTML and the browser's hydration agree, and a reader who clicks two rows of one shop
// still sees the rotation. The spread comes from the listings, not from a coin flip - with
// the coordinate hashed, consecutive rows scatter across the three.
//
// A ROW NONE OF THEM CAN SHOW IS NOT DRAWN AT ALL. listingTarget returns null for it and
// $lib/markets/recent drops it before the page sees it, so the table cannot offer a name
// that opens on "Listing not available" or spins for ever. Which is why every condition
// below is transcribed from the marketplace's DEPLOYED source, not from how it behaved
// once:
//
// All three ship continuously and document none of this, so this file goes stale
// silently - nostrology-web#25 (Re-read each marketplace client's listing-visibility rules
// periodically, at the versions they are serving) carries the re-read.
//
//   Conduit Market   Conduit-BTC/conduit-mono @ 3a4dbe3b5d56754ed96a9b797535428e8a82fe59
//                    - the tip of main, committed 2026-10-22 16:31Z.
//                    The deployed bundle names its own commit: every page builds a
//                    bug-report link carrying `build=commit 3a4dbe3b5d56 / branch main /
//                    channel production`, and that sha appears once in
//                    shop.conduit.market's index bundle (read 2026-10-23 06:43Z).
//   Plebeian Market  PlebeianApp/market, a tree IDENTICAL to master's tip d4757b40; the
//                    rules were read at 80636869de0738bf3049d223c6a3893fa17785e6. Its
//                    bundle is content-hashed and carries no commit. The first pin here
//                    said "master at the deploy's Last-Modified of 2026-10-17 09:53Z"
//                    and review disproved it: that commit is on no branch,
//                    it is the second parent of a merge that landed 33 minutes later, and
//                    master before the merge had no spam-filter file at all - while the
//                    content check proves the filter ships. What rescues the reading is
//                    that its tree equals master's tip, so every rule below is current
//                    for that tip. The content check itself stands: the one
//                    functional change in that window, a hard-coded spam filter, is in
//                    the shipped bundle.
//
// The URL FORMS were also driven in a browser against real listings of ours on
// 2026-10-23, because a client's route is not a contract and each form is undocumented.
import { naddrEncode } from 'nostr-tools/nip19';
import { npubOf } from '$lib/ngit/links';

/** The kind the open-market spec (NIP-99, GammaMarkets market-spec) gives a product. */
export const LISTING_KIND = 30402;

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * What a client needs to decide whether it can show one listing. Every field but the
 * coordinate is optional, and an ABSENT fact is never read as a good one: a client that
 * needs it takes no link rather than a broken one, and a client that only rejects on it
 * lets the row through. So the rotation gets stricter, never wronger, as the pipeline
 * carries more of them.
 */
export type ListingRef = {
	pubkey: string;
	d_tag: string;
	/** The newest version's event id. */
	event_id?: string | null;
	/**
	 * Whether the listing carries an image URL Conduit's own normalizePublicMediaUrl
	 * accepts - see point 3 below for what that rule really is, and for why an `image` tag
	 * alone is not the whole answer. Null means the row does not carry the fact.
	 */
	market_image?: boolean | null;
	/**
	 * The listing's NIP-40 `expiration` tag, unix seconds, where it set one. THAT tag
	 * specifically: relays delete an event past its NIP-40 expiration, which is why an
	 * expired listing can be opened nowhere and is dropped. Shopstr reads a different field
	 * of its own, the Gamma `valid_until`, and only to draw an "Outdated" chip and disable
	 * its buy buttons - the listing still renders in full, so `valid_until` is NOT a
	 * visibility condition and must not be folded into this column (review, 2026-10-23).
	 */
	expires_at?: number | null;
	/**
	 * The `visibility` tag LOWERCASED, '' when untagged - and not trimmed, which is the
	 * pipeline's doing and cannot change there (the `withdrawn` exclusion matches it exactly).
	 * The gate below trims before comparing, as Conduit does.
	 */
	visibility?: string | null;
	/**
	 * The `content-warning` tag value AS PUBLISHED - NOT lowercased, not trimmed - or null
	 * when untagged. Raw, because the only reader of it compares raw: Plebeian's
	 * `isNSFWProduct` is `getProductContentWarning(event)?.[1] === 'nsfw'`, on the first
	 * `content-warning` tag, with no fold and no trim (its src/queries/products.tsx). So
	 * `NSFW` and ` nsfw` are NOT gated there, and a lowercased column would have us decline
	 * Plebeian for a listing it renders in full. Found in review 2026-10-23.
	 */
	content_warning?: string | null;
	/**
	 * The `title` tag AS PUBLISHED, or null for a listing that carries none. Its LENGTH is
	 * load-bearing for Conduit, and the empty string is a different case from null there.
	 */
	title_tag?: string | null;
	/**
	 * The `summary` tag's length in UTF-16 units, or null when untagged. Conduit's schema
	 * caps `summary` at 5,000 and its fallback parse does not truncate, so a longer one
	 * throws at parse and the listing reads as "Product not found" there.
	 */
	summary_len?: number | null;
};

export type Marketplace = {
	key: string;
	/** How the client names itself, for the caption and the link's title. */
	label: string;
	/** Its own front page, for naming it in prose. */
	home: string;
	/**
	 * Whether this page sends readers there today. A client that cannot be reached is
	 * worse than one client fewer: every row that rotated onto it would be a dead link.
	 */
	enabled: boolean;
	/** The listing's page, or null when this marketplace cannot show this row. */
	url: (row: ListingRef) => string | null;
	/**
	 * The seller's own page on this marketplace, by their pubkey, or null for a pubkey that
	 * is not one. Every one of the three has such a page, and it is where the Seller name
	 * goes: a reader who wants the rest of a shop's stock should land in the shop, not on a
	 * raw event viewer (nostrology-web#26 (Recent listings: open the Seller name on the same
	 * marketplace the listing opens on, not njump), the operator's call of 2026-10-24).
	 *
	 * The same marketplace the row's LISTING opens on, which is the rule that keeps a reader
	 * in one shop. Its oddity, worth knowing rather than fixing: the rotation is per listing,
	 * so two rows from one seller can send their seller links to two different marketplaces.
	 *
	 * THE RESIDUAL IS THE SAME AS THE LISTING LINK'S: each marketplace answers from its own
	 * index - Conduit from two commerce relays plus the seller's advertised ones, Plebeian
	 * from its relay set, Shopstr from its own database - so a seller we hold listings for
	 * can have a thin page on the one a row picked, and nothing in a row of ours predicts it.
	 * A sample probe was considered and skipped on purpose: the rule is forced by "the same
	 * marketplace as the listing", so a measurement could only have told us the size of a
	 * residual we cannot act on.
	 */
	sellerUrl: (pubkey: string) => string | null;
};

const coordOf = (pubkey: string, dTag: string): string =>
	[LISTING_KIND, pubkey.toLowerCase(), typeof dTag === 'string' ? dTag : ''].join(':');

// The npub form two of the three marketplaces address a seller by is $lib/ngit/links' `npubOf`,
// the site's one copy of it - imported rather than written again here, because a second
// definition of one thing is the defect even when the two agree today. What it buys is exactly
// what a seller page needs: `npubEncode` THROWS on a non-hex string, a seller pubkey is a
// stranger's text, and a throw inside a derived value is a 500 (internal server error) for the
// whole page rather than one missing link (RecentListings.svelte states why). It lives under
// ngit/ because /git needed it first, not because it is a /git concern.

/**
 * Conduit Market, by the ADDRESSABLE COORDINATE: `/products/<kind:pubkey:d>`,
 * percent-encoded whole (its router decodes the segment, and a `/` or `?` in a `d` tag
 * would otherwise address a different path).
 *
 * Verified 2026-10-23: the deployed shop is `shop.conduit.market` (conduit.market/products
 * is 404 (not found) - the repo's routes and the deployed site's differ), its own product
 * cards navigate to exactly this form, and listings of ours published by three other
 * marketplaces rendered there in full - title, seller and price. The coordinate survives an
 * edit, which an event id does not.
 *
 * FOUR WAYS A LISTING FAILS THERE, all read in the deployed source, in the order the
 * client hits them. The first three are what this function rejects on; the fourth it
 * cannot see.
 *
 * 1. IT NEEDS AN IDENTIFIER. The route's coordinate must match
 *    `/^30402:([0-9a-f]{64}):([\s\S]+)$/i` (PRODUCT_ADDRESS_PATTERN,
 *    packages/core/src/protocol/product-reference.ts), so an empty `d` tag - a legal
 *    identifier - has no address here at all. Any other character is fine, `:` and
 *    newlines included.
 * 2. IT MUST PARSE. A kind-30402 (markets-product-listings) event that throws
 *    `productSchema.parse` is dropped per-event inside a try/catch
 *    (dedupeProductEvents, packages/core/src/protocol/commerce.ts) and the reader gets
 *    "Product not found" - the same page a listing that was never published gets. The
 *    schema's hard bounds (packages/core/src/schemas/index.ts) are `title` 1..200 chars
 *    and `summary` at most 5000 - WHICH THIS GATE DOES NOT CHECK, because no column carries
 *    the summary: a `summary` tag over 5,000 characters throws at parse and reads as
 *    "Product not found", and a listing with one would get a Conduit link anyway. Longest in
 *    the live pool today is 1,827 characters; the column belongs with the other five
 *    (nostrology-data#29 (/marketplaces: the listings table drops the title as published and
 *    four other per-listing facts the web needs)). The fallback parse passes the `title` TAG through
 *    unsliced (parseProductFields, protocol/products.ts), so a title tag of 201 characters
 *    is a not-found page. An EMPTY title tag is too: its getTagValue returns "", and
 *    `"" ?? fallback` is "", so the 1-char minimum fails rather than the markdown-title
 *    fallback running. A listing with NO title tag is fine - it is titled from the first
 *    line of the content, or "Untitled". Nothing else a seller writes can throw: price,
 *    stock, weight, dimensions and the image list are all validated into shape or dropped
 *    before the schema sees them.
 * 3. IT MUST BE MARKET-VISIBLE. evaluateListingAvailability
 *    (packages/core/src/protocol/listing-availability.ts) hides a listing that is not
 *    `visibility: public` or carries no image URL its normalizePublicMediaUrl accepts;
 *    the reader gets "Listing not available - Current state: Hidden".
 *    normalizePublicMediaUrl
 *    (packages/core/src/network-target-safety.ts) is stricter than "starts with http":
 *    it also refuses a URL with credentials in it, one longer than 4096 characters, one
 *    that is not trimmed, a hostname over 253 characters or any DNS label over 63, and any
 *    host that is not lexically public - an IP in a private
 *    or special-use range, a single-label name, `.local`, `.internal`, `.onion`, an
 *    underscore in a label. It ACCEPTS a URL fragment (`allowFragment: true` for media), so
 *    a pipeline that refuses one would be over-strict. And it is not the only image source:
 *    whenever `content` is JSON the product schema accepts, Conduit reads the images from
 *    `content.images` and never looks at the `image` TAGS at all (products.ts's legacy path
 *    returns first), so an `image` tag alone can be a FALSE POSITIVE for this gate - a
 *    listing with JSON content, a price tag and an image tag passes here and then renders
 *    "Listing not available". Found in review 2026-10-23. The pipeline must compute
 *    `market_image` by THAT rule, not by the prefix.
 *    OVER-STRICT IN ONE KNOWN DIRECTION: availability accepts a GROUP-donated image
 *    (`!context.hasGroupImage && !hasMarketVisibleListingImage(product)`), and
 *    prepareVariationGroups sets hasGroupImage from the parent or any eligible variation. So
 *    a `variable` parent or `variation` child with no acceptable image of its own still
 *    renders when a sibling has one, and we decline it. 24 of the 400 newest carry one of
 *    those two types; how many of the 59 imageless rows are in a group is unmeasured.
 *    The same function also calls a `variable` or `variation` product type unsupported
 *    WITHOUT a complete variation group - but that group is fetched, so this is a relay
 *    condition and not a property of the row, and it does NOT belong in the gate below.
 *    Driven in a browser on 2026-10-23: a `variable` parent of ours rendered in full, and
 *    a `variation` child opened its parent's page with the variation selector on it. 24 of
 *    the 400 newest live listings carry one of the two types, and rejecting them here
 *    would have moved all 24 off Conduit for nothing.
 * 4. ITS ATTRIBUTION KEYS ARE `source` AND `partner`, AND THEY BELONG TO A CHECKOUT LINK,
 *    NOT TO THIS ONE. docs/knowledge/checkout-with-conduit.md documents
 *    `/checkout#buy=<product-naddr>&qty=2&source=example.com` (and a `cart=` form) as the
 *    way an external marketplace hands a shopper over. We link the PRODUCT PAGE on purpose:
 *    a reader scanning the newest listings has not chosen to buy, and a checkout link would
 *    put them in a purchase flow for one item. The consequence to know is that our link gets
 *    no checkout attribution - `captureCheckoutIntentFragment` runs only on a document load
 *    at `/checkout` with a fragment - so what Conduit sees from us is the Referer in its
 *    access log. Their doc is explicit that neither an explicit `source` nor an observed
 *    referrer "verifies domain control or establishes payment entitlement", and an
 *    unregistered domain counts only in an aggregate `other` bucket; being named needs a
 *    reviewed partner mapping, which is a conversation, not a parameter.
 *    nostrology-web#27 (Recent listings: let the marketplaces see that the traffic is ours)
 *    holds that decision.
 * 5. IT MUST BE ON ONE OF ITS RELAYS, and ITS relay set is narrow. Commerce reads go to
 *    the relays its config marks `commerce: true` - `wss://relay.conduit.market` and
 *    `wss://relay.ditto.pub` (CANONICAL_COMMERCE_DISCOVERY_RELAYS,
 *    packages/core/src/config.ts) - plus the seller's own kind-10002 (relay-list-metadata)
 *    write relays when that list is itself findable on those two, up to a six-relay
 *    fanout. nos.lol and damus are in its config only as historical account storage, NOT
 *    as commerce reads. So "the event is still on the network" does not mean Conduit can
 *    see it, and nothing in a row of ours says whether it is on those two relays. This is
 *    the residual the table cannot filter.
 */
/**
 * Conduit's `summary` cap, from the same productSchema as the 1..200 title: `summary:
 * z.string().max(5000)`, and `normalizeProductSummaryForDisplay` only ever removes metadata
 * lines rather than truncating, so a longer `summary` TAG throws at parse and reads as
 * "Product not found". Measured in UTF-16 units, which is what Zod counts and what the
 * pipeline's column carries (nostrology-data's markets_medialib.summary_tag_len); the longest
 * in the live pool on 2026-10-23 was 1,827, so this is a guard against text nobody has
 * published yet rather than a filter that fires today.
 *
 * OVER-STRICT IN ONE CORNER, stated rather than modelled: the tag is what the NIP-99 FALLBACK
 * parse reads. On Conduit's legacy JSON path the schema sees `content.summary` instead and the
 * tag is never looked at, so a listing whose JSON content that path accepts AND whose summary
 * TAG is over the cap would render there while this declines it. That needs a `summary` tag
 * five times longer than any in the live pool, on one of the 90 rows in 18,030 whose JSON
 * content is schema-complete, so it is a corner of a corner - and it costs a link rather than
 * offering a dead one, which is the direction to be wrong in.
 */
const SUMMARY_MAX = 5000;

const conduit: Marketplace = {
	key: 'conduit',
	label: 'Conduit Market',
	home: 'https://shop.conduit.market',
	enabled: true,
	url: ({ pubkey, d_tag, market_image, visibility, title_tag, summary_len }) => {
		if (!HEX64.test(pubkey ?? '')) return null;
		if (typeof d_tag !== 'string' || d_tag === '') return null;
		if (typeof title_tag === 'string' && (title_tag === '' || title_tag.length > 200)) return null;
		if (typeof summary_len === 'number' && summary_len > SUMMARY_MAX) return null;
		// TRIMMED, because Conduit's parseProductVisibilityTag does `.trim().toLowerCase()` and
		// the column is lowercased but NOT trimmed. `["visibility", "Hidden "]` therefore
		// survives the pipeline's own withdrawn test, which is an exact match on `hidden`, stays
		// in the live pool, and would have got a Conduit link to "Listing not available -
		// Current state: Hidden". Found in review 2026-10-24, and fixed HERE rather than in the
		// pipeline on purpose: trimming the column would move the `withdrawn` exclusion, which
		// is a methodology change and would have to land in the reference generator too. The
		// pipeline's own `"<hidden"` literal is the evidence that non-canonical values occur.
		const vis = typeof visibility === 'string' ? visibility.trim() : visibility;
		if (vis === 'hidden' || vis === 'private') return null;
		if (market_image !== true) return null;
		return 'https://shop.conduit.market/products/' + encodeURIComponent(coordOf(pubkey, d_tag));
	},
	// `/<npub>` - the route is `/$identityRef`, resolved by resolveProfileReference, which
	// canonicalises to the npub (its own legacy `/u/<ref>` redirects to this). Driven in a
	// browser on 2026-10-23 against one of our sellers: their name and their listings.
	sellerUrl: (pubkey) => {
		const npub = npubOf(pubkey);
		return npub && 'https://shop.conduit.market/' + npub;
	}
};

/**
 * Plebeian Market, by the EVENT ID: `/products/<id>`. Its product query filters
 * `{ kinds: [30402], ids: [id], limit: 1 }` (fetchProduct, src/queries/products.tsx), and
 * its own catalogue links are that form.
 *
 * Verified 2026-10-23: two of our listings published by other apps rendered in full
 * (title, price, seller, description, "More from this seller"). A third did not resolve
 * within 14 s, which is the shape of its failure rather than an exception: the route
 * retries the fetch 120 times with a growing delay (products.$productId.tsx), so a reader
 * waits on "Loading product..." for about nine minutes before the page admits "Still
 * loading product". An id filter can only be answered by a relay that still holds that
 * exact version, and a replaceable event's old version is replaced, so a listing the
 * seller edited after our refresh is unreachable by the id we hold. That is the cost of
 * the id form and the reason a row with no event id links elsewhere.
 *
 * WHAT IT DOES NOT MIND, checked in the same source so the rotation does not drop rows
 * for nothing: `visibility: hidden` still renders (only the cart button is disabled), out
 * of stock still renders, a non-'active' `status` tag is not read at all, and neither its
 * hard-coded spam entry nor its remote blacklist touches the detail page - both filter
 * only the grids (filterBlacklistedEvents, src/queries/products.tsx).
 *
 * WHAT IT DOES MIND is an adult-content marker: a `content-warning` tag whose value is
 * exactly `nsfw` replaces the page with a confirmation gate, and the listing's title,
 * description and image are deliberately kept out of that page (isNSFWProduct +
 * `nsfwGated`, products.$productId.tsx). A row whose name opens a page that does not name
 * it has not been shown, so this client declines those.
 *
 * ITS RELAY SET IS WIDE, which is the other half of why it is in the rotation beside
 * Conduit: `wss://relay.plebeian.market` plus sendit.nosflare.com, nostr.mom, nos.lol,
 * relay.nostr.net, relay.damus.io and relay.minibits.cash (MAIN_RELAY_BY_STAGE +
 * DEFAULT_PUBLIC_RELAYS, src/lib/constants.ts). Two of those are relays our own archive
 * reads, so a row we hold is far likelier to be answerable here than on Conduit's two.
 */
const plebeian: Marketplace = {
	key: 'plebeian',
	label: 'Plebeian Market',
	home: 'https://plebeian.market',
	enabled: true,
	url: ({ event_id, content_warning }) => {
		if (!HEX64.test(event_id ?? '')) return null;
		// EXACTLY their test, raw and case-sensitive (see the field's doc): matching their
		// semantics rather than a tidied-up version of them is what keeps this gate from
		// being either over-strict (declining a listing they render) or under-strict
		// (sending a reader to a gate page that names nothing).
		if (content_warning === 'nsfw') return null;
		return 'https://plebeian.market/products/' + (event_id as string).toLowerCase();
	},
	// `/profile/<hex pubkey>` - the route is `/profile/$profileId` and its own navigation
	// passes the HEX pubkey, which is why this one is not an npub. Driven in a browser on
	// 2026-10-23: the seller's name and their listings. (The npub form answered 200 (ok) too,
	// but the hex is the form the app itself links, so it is the form we send.)
	sellerUrl: (pubkey) =>
		HEX64.test(pubkey ?? '') ? 'https://plebeian.market/profile/' + pubkey.toLowerCase() : null
};

/**
 * Shopstr, by NIP-19 naddr: `/listing/<naddr>`.
 *
 * ITS DOMAIN IS `shopstr.market`, NOT `shopstr.store`. This file pointed at `.store` until
 * 2026-10-23 and had the client disabled on the strength of that host answering nothing -
 * which was not Shopstr being down. `shopstr.store`'s nameservers are
 * `ns1/ns2.lander.d.parity.domains`, a domain-parking lander, and the operator opening it
 * got a parked page; the app has moved. The right host is the one the repository's own
 * `homepage` field names, which is how this was found.
 *
 * ITS LISTING PAGE IS NOT A NOSTR CLIENT READ, which is why its failure mode differs from the
 * other two: there is no relay subscription on this route at all. The page is server-rendered
 * from Shopstr's own Postgres and the event is seeded into the props, so a listing it has not
 * indexed is a chrome-and-spinner page rather than a relay miss that might resolve. Conduit
 * and Plebeian both read relays in the browser; Shopstr, here, reads its own index.
 *
 * ITS GATES ARE THE LOOSEST OF THE THREE, which is why it carries no row conditions here:
 *
 * - `getServerSideProps` decodes the naddr and looks the listing up in SHOPSTR'S OWN
 *   DATABASE by (pubkey, `d` tag), newest first - `fetchProductByDTagAndPubkey` in
 *   utils/db/db-service.ts, against its `product_events` table. It does not check the kind
 *   it decoded, require the listing to be its own, or filter on a `t` tag.
 * - the content gate is nothing to speak of: `parseTags`
 *   (utils/parsers/product-parser-functions.ts) returns undefined only for an event with no
 *   `tags` array at all. No image is needed, no price, no `visibility`, no product type,
 *   and the `status` tag is not read on this route.
 * - WHAT IT CANNOT DO is show a listing its database has not cached. On a miss the page
 *   falls back to searching the marketplace feed in the browser and, failing that, says
 *   "Listing Not Found"; measured 2026-10-23, a miss renders as page chrome and a spinner.
 *   Nothing in a row of ours predicts cache membership - the same residual class as
 *   Conduit's relay set.
 *
 * Measured 2026-10-23 against its live server-side render (the `og:title` it emits is the
 * listing's own only when its database found the event): 20 of 20 randomly sampled live
 * listings of ours resolved, including imageless ones and ones published by other apps;
 * one of five hand-picked spread cases did not. Call it high coverage, not total.
 *
 * Deployed version: pinned only as `shopstr-eng/shopstr` at or after `75db771`
 * (2026-04-09, which introduced this DB-seeded render), read at `main`'s tip
 * `de6040b7618cd3792e33705ac9462efd8d3c47d0` (2026-10-11 15:59Z). Next.js gives
 * its build a random id carrying no commit, so this pin is a BOUND, not an identity.
 */
/**
 * NIP-19's TLV writes each value's LENGTH IN ONE BYTE, and nostr-tools does not check it:
 * `encodeTLV` does `entry.set([v.length], 1)`, so an identifier of 256 or more UTF-8 bytes
 * wraps modulo 256 and produces a syntactically valid `naddr1...` that NOTHING can decode
 * ("not enough data to read on TLV"). It does not throw, so the try/catch below never sees
 * it, and the row would be drawn as a link to Shopstr's "Listing Not Found" - exactly what
 * $lib/markets/recent exists to prevent. Found in review 2026-10-23; the longest `d` tag in
 * the live pool is 160 bytes, and the seller chooses it. Measured in BYTES, not characters:
 * 64 emoji are 256 bytes.
 */
const NADDR_MAX_IDENTIFIER_BYTES = 255;
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

const shopstr: Marketplace = {
	key: 'shopstr',
	label: 'Shopstr',
	home: 'https://shopstr.market',
	enabled: true,
	url: ({ pubkey, d_tag }) => {
		if (!HEX64.test(pubkey ?? '')) return null;
		const identifier = typeof d_tag === 'string' ? d_tag : '';
		if (utf8Bytes(identifier) > NADDR_MAX_IDENTIFIER_BYTES) return null;
		try {
			const naddr = naddrEncode({
				kind: LISTING_KIND,
				pubkey: pubkey.toLowerCase(),
				identifier
			});
			return 'https://shopstr.market/listing/' + naddr;
		} catch {
			// Still guarded: bech32 refuses a whole string over 5,000 characters, and a future
			// nostr-tools may start throwing on the length above rather than wrapping.
			return null;
		}
	},
	// `/marketplace/<npub>` - the route is `/marketplace/[[...npub]]`. Driven in a browser on
	// 2026-10-23: that seller's listings. NOT its `/shop/<slug>` form, which is a
	// merchant-chosen storefront name resolved through Shopstr's own lookup and cannot be
	// built from a pubkey at all.
	sellerUrl: (pubkey) => {
		const npub = npubOf(pubkey);
		return npub && 'https://shopstr.market/marketplace/' + npub;
	}
};

/** Every marketplace the rotation knows, in a fixed order; `enabled` decides who is in it. */
export const MARKETPLACES: readonly Marketplace[] = [conduit, plebeian, shopstr];

/** The marketplaces this page sends readers to today. */
export const liveMarketplaces = (): Marketplace[] => MARKETPLACES.filter((c) => c.enabled);

// FNV-1a, 32-bit, THEN murmur3's finalizer. No dependency, and identical on the server
// and in the browser.
//
// THE FINALIZER IS NOT DECORATION. `hash % 2` reads FNV-1a's bottom bit, and that bit is
// not mixed at all: the multiplier is odd, so bit 0 of the product is bit 0 of the input,
// and the whole hash's bit 0 is just the parity of the bytes' bit 0. Over coordinates that
// are mostly hex, that parity is skewed - the first ten rows of this page split 8/2 across
// two marketplaces instead of about 5/5 (measured 2026-10-23). fmix32 avalanches the high
// bits down, so every bit of the result depends on every byte of the input. Measured again
// after, over 60 rows: 32 Conduit, 28 Plebeian.
//
// BOTH OF THOSE NUMBERS WERE MEASURED AGAINST ROWS CARRYING THE FIVE PIPELINE FACTS, from the
// archive rather than from the serving table, because the table did not hold them yet
// (review, 2026-10-23 - the comment here read as a claim about the live page, which it was
// not: with `market_image` and `event_id` null for every row, Conduit and Plebeian declined
// all of them, `candidates.length` was always 1 and this hash was never consulted, so 100% of
// the traffic went to Shopstr). THE COLUMNS LANDED ON 2026-10-24 (nostrology-data#29
// (/marketplaces: the listings table drops the title as published and four other per-listing
// facts the web needs)), so the rotation is live and the numbers above are what it does. The
// caption names only the marketplaces some row on the page actually uses
// (RecentListings.svelte), so it stays honest either way.
function fnv1a(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	h ^= h >>> 16;
	h = Math.imul(h, 2246822507);
	h ^= h >>> 13;
	h = Math.imul(h, 3266489909);
	h ^= h >>> 16;
	return h >>> 0;
}

/**
 * A listing whose NIP-40 `expiration` has passed. Relays delete those, so the event is
 * gone from the network however a client addresses it, while our archive keeps it for
 * good - the page can still COUNT the listing, it just stops pretending somebody can open
 * it, and the row leaves the table.
 *
 * Expiry is not the whole of that class. Of 60 rows this page showed on 2026-10-23, 6 were
 * on none of nos.lol, damus, primal and relay.conduit.market when each coordinate was
 * asked for by itself; 3 of the 6 had expired, the other 3 had no expiration tag and went
 * anyway. Those 3 are not predictable from anything a row carries. (One of the 6 still
 * opens on Conduit, which answered from THAT BROWSER's own cache - a per-visitor store the
 * same browser had already filled by viewing the listing, so it is no evidence the link
 * works for a stranger arriving cold (review, 2026-10-23) - so a dead relay is not always a
 * dead link either.)
 */
const expired = (expires_at: number | null | undefined, now: number): boolean =>
	typeof expires_at === 'number' && expires_at > 0 && expires_at * 1000 <= now;

/**
 * Which marketplace a listing opens on, and where - the listing's page, and the seller's page
 * on the same marketplace. The candidates are the live ones that can show THIS row, and the
 * coordinate's hash picks one of them, so the rotation is even across listings while every
 * listing keeps one answer. Null when no live marketplace can show the row, which is also the
 * test $lib/markets/recent uses to leave it out of the table.
 *
 * The expiry test stays here even though the read now cuts expired rows in SQL
 * (SQL_MARKETPLACES_RECENT): this function answers for whatever it is handed, and the two
 * tests are the same test ($lib/shared/data-types says why they agree exactly).
 */
export function listingTarget(
	row: ListingRef,
	now: number = Date.now()
): { marketplace: Marketplace; url: string; sellerUrl: string | null } | null {
	if (expired(row.expires_at, now)) return null;
	const candidates: { marketplace: Marketplace; url: string }[] = [];
	for (const marketplace of liveMarketplaces()) {
		const url = marketplace.url(row);
		if (url) candidates.push({ marketplace, url });
	}
	if (candidates.length === 0) return null;
	const i = fnv1a(coordOf(row.pubkey ?? '', row.d_tag ?? '')) % candidates.length;
	const picked = candidates[i];
	return { ...picked, sellerUrl: picked.marketplace.sellerUrl(row.pubkey ?? '') };
}
