import { describe, expect, it } from 'vitest';
import { decode } from 'nostr-tools/nip19';

import { LISTING_KIND, MARKETPLACES, listingTarget, liveMarketplaces } from './links';

const PK = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b';
const ID = '49a1d8111ed72770793c7a5756c43a65ac833654c4a0aba14b1707e104428194';
const market = (key: string) => MARKETPLACES.find((m) => m.key === key)!;
const SHOWABLE = { market_image: true };

describe('the marketplaces', () => {
	it('addresses a listing on Conduit by its coordinate, percent-encoded whole', () => {
		// A `d` tag holds whatever the seller typed; an unencoded `/` or `?` would address
		// a different path on their router.
		expect(market('conduit').url({ pubkey: PK, d_tag: 'barattolo-3195', ...SHOWABLE })).toBe(
			`https://shop.conduit.market/products/30402%3A${PK}%3Abarattolo-3195`
		);
		expect(market('conduit').url({ pubkey: PK, d_tag: 'a/b?c d', ...SHOWABLE })).toBe(
			`https://shop.conduit.market/products/30402%3A${PK}%3Aa%2Fb%3Fc%20d`
		);
	});

	it('addresses a listing on Plebeian by its event id, and nowhere without one', () => {
		expect(market('plebeian').url({ pubkey: PK, d_tag: 'x', event_id: ID })).toBe(
			`https://plebeian.market/products/${ID}`
		);
		expect(market('plebeian').url({ pubkey: PK, d_tag: 'x' })).toBeNull();
		expect(market('plebeian').url({ pubkey: PK, d_tag: 'x', event_id: 'nope' })).toBeNull();
	});

	it('addresses a listing on Shopstr by an naddr that decodes back to the coordinate', () => {
		const PREFIX = 'https://shopstr.market/listing/';
		const url = market('shopstr').url({ pubkey: PK, d_tag: 'barattolo-3195' })!;
		expect(url.startsWith(PREFIX)).toBe(true);
		const naddr = url.slice(PREFIX.length);
		expect(decode(naddr)).toEqual({
			type: 'naddr',
			data: { kind: LISTING_KIND, pubkey: PK, identifier: 'barattolo-3195', relays: [] }
		});
	});

	// THE EXACT STRINGS A BROWSER WAS SENT, 2026-10-23. Each URL below was loaded in a real
	// browser and rendered the listing it names, so these are not "the form we believe in" but
	// the form that was seen to work. A round-trip test cannot replace them: our naddr encoder
	// writes its TLV fields in a different ORDER from the one `nak` writes (ours puts the kind
	// first), both decode to the same coordinate, and every earlier probe in this work used a
	// nak-built naddr - so the Shopstr leg was unverified until the string below was loaded.
	it('builds the URL each marketplace was seen to serve, byte for byte', () => {
		const BARATTOLO = { pubkey: PK, d_tag: 'barattolo-3195' };
		expect(market('conduit').url({ ...BARATTOLO, ...SHOWABLE })).toBe(
			'https://shop.conduit.market/products/30402%3A2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b%3Abarattolo-3195'
		);
		expect(market('shopstr').url(BARATTOLO)).toBe(
			'https://shopstr.market/listing/naddr1qvzqqqrkcgpzqtn6lcle47xrmjgdd69v4awh42fx548scgh3c42hqucfcpvlaqcmqq8xyctjv968gmmvduknxvfex57he8my'
		);
		expect(
			market('plebeian').url({
				pubkey: PK,
				d_tag: 'deca-rx',
				event_id: '13ff3a0b637c5aa49926fd3014812e99a5465c09ef6d88e1002173770819aba1'
			})
		).toBe('https://plebeian.market/products/13ff3a0b637c5aa49926fd3014812e99a5465c09ef6d88e1002173770819aba1');
	});

	it('writes a bare URL - no query, no fragment - so a marker is never added by accident', () => {
		// Conduit's own attribution keys live in a CHECKOUT fragment and its parser rejects the
		// whole intent on an unknown key, so a stray param here would be a broken link there
		// rather than a marked one. Whether to add a marker at all is
		// nostrology-web#27 (Recent listings: let the marketplaces see that the traffic is ours).
		for (const c of MARKETPLACES) {
			const url = c.url({ pubkey: PK, d_tag: 'barattolo-3195', event_id: ID, ...SHOWABLE });
			if (url === null) continue;
			expect(new URL(url).search, c.key).toBe('');
			expect(new URL(url).hash, c.key).toBe('');
		}
	});

	it('refuses a `d` tag too long for an naddr, rather than building one nothing can decode', () => {
		// NIP-19's TLV writes each length in ONE byte and nostr-tools does not check it, so 256
		// bytes wraps to 0 and yields a valid-looking naddr that decode() rejects - silently,
		// so the try/catch never sees it. Conduit's own encoder throws on exactly this bound
		// ("Product identifier must not exceed 255 UTF-8 bytes"), which is how the limit was
		// confirmed. Measured in BYTES: 64 emoji are 256 bytes, well under 256 characters.
		const at = (identifier: string) => market('shopstr').url({ pubkey: PK, d_tag: identifier });
		const ok = at('a'.repeat(255))!;
		expect(ok).not.toBeNull();
		expect(decode(ok.slice('https://shopstr.market/listing/'.length))).toMatchObject({ type: 'naddr' });
		expect(at('a'.repeat(256))).toBeNull();
		expect(at('\u{1f600}'.repeat(64))).toBeNull(); // 256 bytes, 64 characters
		expect(at('\u{1f600}'.repeat(63))).not.toBeNull(); // 252 bytes
		// and the row then has no marketplace at all rather than a dead link
		expect(listingTarget({ pubkey: PK, d_tag: 'a'.repeat(256) })).toBeNull();
	});

	it('lowercases the pubkey and the event id, because their routes match lowercase hex', () => {
		// HEX64 is case-insensitive, so an uppercase pubkey passes the gate; Conduit's own
		// address pattern is `[0-9a-f]{64}` and its match would then fail.
		const UP = PK.toUpperCase();
		expect(market('conduit').url({ pubkey: UP, d_tag: 'x', ...SHOWABLE })).toContain(PK);
		expect(market('conduit').url({ pubkey: UP, d_tag: 'x', ...SHOWABLE })).not.toContain(UP);
		const shop = market('shopstr').url({ pubkey: UP, d_tag: 'barattolo-3195' })!;
		expect(shop).toBe(market('shopstr').url({ pubkey: PK, d_tag: 'barattolo-3195' }));
		expect(market('plebeian').url({ pubkey: PK, d_tag: 'x', event_id: ID.toUpperCase() })).toBe(
			`https://plebeian.market/products/${ID}`
		);
	});

	it('treats an nsfw warning exactly as Plebeian does: raw and case-sensitive', () => {
		// Their test is `getProductContentWarning(event)?.[1] === 'nsfw'` - no fold, no trim -
		// so `NSFW` and ` nsfw` render in full there. A tidied-up version of their rule would
		// decline a listing they show.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID };
		expect(market('plebeian').url({ ...row, content_warning: 'nsfw' })).toBeNull();
		expect(market('plebeian').url({ ...row, content_warning: 'NSFW' })).not.toBeNull();
		expect(market('plebeian').url({ ...row, content_warning: ' nsfw' })).not.toBeNull();
		expect(market('plebeian').url({ ...row, content_warning: null })).not.toBeNull();
	});

	it('does not read an expiration of 0 or a negative one as expired', () => {
		// A pipeline that writes 0 for "no expiration tag" must not retire every listing.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		expect(listingTarget({ ...row, expires_at: 0 })).not.toBeNull();
		expect(listingTarget({ ...row, expires_at: -1 })).not.toBeNull();
		expect(listingTarget({ ...row, expires_at: 1 })).toBeNull();
	});

	it('gives no link at all for a pubkey that is not 64-hex, rather than a broken one', () => {
		// The two coordinate forms carry the pubkey, so a malformed one would be a link to
		// a listing that cannot exist. Plebeian's does not: an event id addresses the event
		// by itself, so that link is still good, and the row keeps it.
		expect(market('conduit').url({ pubkey: 'beef', d_tag: 'x', event_id: ID, ...SHOWABLE })).toBeNull();
		expect(market('shopstr').url({ pubkey: 'beef', d_tag: 'x', event_id: ID })).toBeNull();
		expect(market('plebeian').url({ pubkey: 'beef', d_tag: 'x', event_id: ID })).toBe(
			`https://plebeian.market/products/${ID}`
		);
	});

	it('sends no imageless listing to Conduit, which hides it from its Market', () => {
		// Its own evaluateListingAvailability needs an http(s) image; measured 2026-10-23,
		// a listing without one answers "Listing not available - Current state: Hidden",
		// whether or not it quotes a price. Plebeian renders it, so the row goes there.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, market_image: false };
		expect(market('conduit').url(row)).toBeNull();
		expect(market('conduit').url({ ...row, market_image: true })).not.toBeNull();
		expect(market('plebeian').url(row)).not.toBeNull();
		expect(market('shopstr').url(row)).not.toBeNull();
		expect(listingTarget(row)!.marketplace.key).not.toBe('conduit');
	});

	it('sends no listing with no identifier to Conduit, whose address form needs one', () => {
		// PRODUCT_ADDRESS_PATTERN is /^30402:([0-9a-f]{64}):([\s\S]+)$/ - the empty `d` tag
		// is a legal identifier that has no address there. Any other character is fine.
		expect(market('conduit').url({ pubkey: PK, d_tag: '', ...SHOWABLE })).toBeNull();
		expect(market('conduit').url({ pubkey: PK, d_tag: ':', ...SHOWABLE })).not.toBeNull();
	});

	it('sends no listing Conduit\'s own schema would throw on', () => {
		// productSchema bounds `title` at 1..200 characters and the fallback parse passes
		// the title TAG through unsliced, so either end of that is a "Product not found"
		// page. A row with NO title tag is fine: it is titled from the content there.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		expect(market('conduit').url({ ...row, title_tag: 'x'.repeat(200) })).not.toBeNull();
		expect(market('conduit').url({ ...row, title_tag: 'x'.repeat(201) })).toBeNull();
		expect(market('conduit').url({ ...row, title_tag: '' })).toBeNull();
		expect(market('conduit').url({ ...row, title_tag: null })).not.toBeNull();
		// Plebeian reads none of that: it renders what the event says.
		expect(market('plebeian').url({ ...row, title_tag: 'x'.repeat(201) })).not.toBeNull();
	});

	it("sends no listing whose summary is over Conduit's 5,000-character cap", () => {
		// The same productSchema, the other bound: `summary: z.string().max(5000)`, and the
		// fallback parse passes the tag through unsliced, so a longer one throws at parse and
		// reads as "Product not found". The column carries the LENGTH in UTF-16 units, which is
		// what that cap counts (nostrology-data's markets_medialib.summary_tag_len).
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		expect(market('conduit').url({ ...row, summary_len: 5000 })).not.toBeNull();
		expect(market('conduit').url({ ...row, summary_len: 5001 })).toBeNull();
		// absent is not "over": a row that does not carry the fact keeps its link
		expect(market('conduit').url({ ...row, summary_len: null })).not.toBeNull();
		expect(market('conduit').url(row)).not.toBeNull();
		// and the other two do not read a summary at all
		expect(market('plebeian').url({ ...row, summary_len: 99999 })).not.toBeNull();
		expect(market('shopstr').url({ ...row, summary_len: 99999 })).not.toBeNull();
	});

	it('sends no hidden listing to Conduit, which refuses a non-public visibility', () => {
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		expect(market('conduit').url({ ...row, visibility: 'hidden' })).toBeNull();
		expect(market('conduit').url({ ...row, visibility: 'private' })).toBeNull();
		expect(market('conduit').url({ ...row, visibility: 'on-sale' })).not.toBeNull();
		expect(market('conduit').url({ ...row, visibility: '' })).not.toBeNull();
		// Plebeian renders a hidden listing and only disables its cart button.
		expect(market('plebeian').url({ ...row, visibility: 'hidden' })).not.toBeNull();
	});

	it('sends no nsfw-marked listing to Plebeian, whose gate names nothing', () => {
		// content-warning: nsfw replaces the page with a confirmation that deliberately
		// carries neither title, description nor image. Only that exact value gates.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		expect(market('plebeian').url({ ...row, content_warning: 'nsfw' })).toBeNull();
		expect(market('plebeian').url({ ...row, content_warning: 'nudity' })).not.toBeNull();
		expect(market('plebeian').url({ ...row, content_warning: null })).not.toBeNull();
		// Conduit has no content-warning gate at all, so the row still opens there.
		expect(market('conduit').url({ ...row, content_warning: 'nsfw' })).not.toBeNull();
		expect(listingTarget({ ...row, content_warning: 'nsfw' })!.marketplace.key).not.toBe('plebeian');
	});

	it('takes no link at all from a row that cannot say whether it has an image', () => {
		// Null is "the pipeline does not carry it yet", not "no image": a guess either way
		// would be a link that lands on "Listing not available".
		expect(market('conduit').url({ pubkey: PK, d_tag: 'x', market_image: null })).toBeNull();
		expect(market('conduit').url({ pubkey: PK, d_tag: 'x' })).toBeNull();
	});

	it('sends traffic to every marketplace it has, now that all three answer', () => {
		// `enabled` is the switch, and it was false for Shopstr until 2026-10-23 - on the
		// strength of shopstr.STORE answering nothing, which turned out to be a parked
		// domain rather than a dead client. The app is at shopstr.MARKET and is live.
		expect(liveMarketplaces().map((c) => c.key)).toEqual(['conduit', 'plebeian', 'shopstr']);
		for (const c of MARKETPLACES) expect(c.enabled).toBe(true);
		for (const c of MARKETPLACES) expect(c.home.startsWith('https://')).toBe(true);
	});
});

describe('the seller pages', () => {
	// Each form was driven in a browser on 2026-10-23 against one of our own sellers and
	// rendered their name and their listings (nostrology-web#26 (Recent listings: open the
	// Seller name on the same marketplace the listing opens on, not njump)). They are
	// literals here for the same reason the listing URLs are: a route is not a contract, and
	// a changed one has to fail a test rather than a reader's click.
	it('addresses a seller by the form each marketplace itself uses', () => {
		const npub = 'npub19ea0u0u6lrpaeyxkazk27ht64yn22ncvytcu24tswvyuqk07svds63txqy';
		expect(market('conduit').sellerUrl(PK)).toBe('https://shop.conduit.market/' + npub);
		expect(market('plebeian').sellerUrl(PK)).toBe('https://plebeian.market/profile/' + PK);
		expect(market('shopstr').sellerUrl(PK)).toBe('https://shopstr.market/marketplace/' + npub);
		// the npub is this pubkey's, so the two npub forms are not just the same string twice
		expect(decode(npub)).toEqual({ type: 'npub', data: PK });
	});

	it('writes a bare URL there too - no query, no fragment', () => {
		for (const m of MARKETPLACES) {
			const url = new URL(m.sellerUrl(PK)!);
			expect([url.search, url.hash], m.key).toEqual(['', '']);
		}
	});

	it('gives no seller link at all for a pubkey that is not one, rather than throwing', () => {
		// npubEncode THROWS on a non-hex string, and this runs inside a derived value the
		// server render materialises - where a throw is a 500 (internal server error) for the
		// whole page rather than one missing link.
		for (const m of MARKETPLACES) {
			for (const bad of ['', 'not-a-pubkey', PK.slice(0, 63), PK + 'a', 'z'.repeat(64)]) {
				expect(() => m.sellerUrl(bad), `${m.key} ${bad}`).not.toThrow();
				expect(m.sellerUrl(bad), `${m.key} ${bad}`).toBeNull();
			}
		}
	});

	it('lowercases an uppercase pubkey, as the listing forms do', () => {
		for (const m of MARKETPLACES) {
			expect(m.sellerUrl(PK.toUpperCase()), m.key).toBe(m.sellerUrl(PK));
		}
	});

	it('hands the page the seller page of the SAME marketplace the listing opens on', () => {
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, market_image: true };
		const target = listingTarget(row)!;
		expect(target.sellerUrl).toBe(target.marketplace.sellerUrl(PK));
		expect(new URL(target.sellerUrl!).host).toBe(new URL(target.url).host);
	});

	it('hands it null for a row whose pubkey no seller page can be built from', () => {
		// Plebeian addresses a LISTING by event id and never reads the pubkey, so this row
		// opens there while its seller page cannot be built at all. The component then falls
		// back to njump for the seller name alone.
		const target = listingTarget({ pubkey: 'not-a-pubkey', d_tag: 'x', event_id: ID })!;
		expect(target.marketplace.key).toBe('plebeian');
		expect(target.sellerUrl).toBeNull();
	});
});

describe('the rotation', () => {
	// REAL-SHAPED COORDINATES, not one pubkey with a decimal counter. The skew the finalizer
	// exists to fix is FNV-1a's bottom bit over coordinates that are mostly hex, and a
	// fixture of `listing-0 .. listing-599` under one pubkey has an alternating low bit, so
	// plain FNV-1a already splits it evenly and the distribution test below passed with the
	// finalizer deleted (found in review, 2026-10-23). These vary the pubkey the way the live
	// pool does - 600 distinct 64-hex keys - and the `d` tags are shaped like real ones.
	const hexPk = (i: number) => (i * 2654435761).toString(16).padStart(8, '0').repeat(8).slice(0, 64);
	const rows = Array.from({ length: 600 }, (_, i) => ({
		pubkey: hexPk(i),
		d_tag: i % 3 === 0 ? `barattolo-${3000 + i}` : i % 3 === 1 ? `cm${i.toString(36)}z00ah74ztxrg7xcvo` : `${1792641442867 + i}`,
		event_id: ID,
		market_image: true
	}));

	it('sends one listing to the same marketplace every time', () => {
		const first = listingTarget(rows[0]);
		for (let i = 0; i < 5; i++) expect(listingTarget(rows[0])).toEqual(first);
	});

	it('mixes the hash, so a two-way split cannot be decided by the parity of the bytes', () => {
		// THIS is the test that pins murmur3's finalizer. `hash % 2` reads FNV-1a's bottom
		// bit, and that bit is not mixed at all: the multiplier is odd, so the hash's bit 0 is
		// just the XOR of the input bytes' bit 0. These 200 coordinates are built from the hex
		// digits whose low bit is 0 (02468bdf), so every one of them has the SAME parity -
		// plain FNV-1a sends all 200 to one marketplace, measured, and the finalizer splits
		// them 107/93. A fixture of sequential d tags cannot show this, which is why the
		// distribution test below passed with the finalizer deleted (review, 2026-10-23).
		const EVEN = '02468bdf';
		const pubkeyOf = (i: number) => {
			let s = '';
			let n = i;
			for (let k = 0; k < 64; k++) {
				s += EVEN[(n + k * 3) % 8];
				n = Math.floor(n / 8) + k;
			}
			return s;
		};
		// market_image absent leaves exactly two candidates, Plebeian and Shopstr, so the
		// rotation is the `% 2` the parity would decide.
		const parity = Array.from({ length: 200 }, (_, i) => ({
			pubkey: pubkeyOf(i),
			d_tag: EVEN[i % 8].repeat(4),
			event_id: ID
		}));
		const seen = new Map<string, number>();
		for (const r of parity) {
			const key = listingTarget(r)!.marketplace.key;
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		expect([...seen.keys()].sort()).toEqual(['plebeian', 'shopstr']);
		for (const [key, n] of seen) expect(n, key).toBeGreaterThan(parity.length / 4);
	});

	it('spreads listings evenly across the live marketplaces', () => {
		// The point of the hash: an even split over coordinates shaped like the real ones.
		// What this does NOT prove on its own is that the murmur3 finalizer is needed - that
		// claim rests on the measurement recorded in links.ts (the first ten rows of the live
		// page split 8/2 across two marketplaces without it).
		const seen = new Map<string, number>();
		for (const r of rows) {
			const key = listingTarget(r)!.marketplace.key;
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		const n = liveMarketplaces().length;
		expect(seen.size).toBe(n);
		for (const count of seen.values()) expect(count).toBeGreaterThan((rows.length / n) * 0.75);
	});

	it('only offers a marketplace that can address the row', () => {
		// With no event id, Plebeian cannot be the answer for any of them - the two
		// coordinate-addressed clients can.
		const noId = rows.map((r) => ({ ...r, event_id: null }));
		const keys = new Set(noId.map((r) => listingTarget(r)!.marketplace.key));
		expect(keys).toEqual(new Set(['conduit', 'shopstr']));
	});

	it('links nothing once a listing has expired, whatever marketplace could address it', () => {
		// NIP-40: relays delete an expired event, so every client answers "not found".
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, market_image: true };
		const expiresAt = 1792697446; // 2026-10-22 19:30Z
		expect(listingTarget({ ...row, expires_at: expiresAt }, expiresAt * 1000 + 1)).toBeNull();
		expect(listingTarget({ ...row, expires_at: expiresAt }, expiresAt * 1000 - 1)).not.toBeNull();
		expect(listingTarget({ ...row, expires_at: null })).not.toBeNull();
	});

	it('is null when no live marketplace can address the row', () => {
		// A malformed pubkey rules out the coordinate forms, and no event id rules out the
		// id form: the page then draws the title as plain text.
		expect(
			listingTarget({ pubkey: 'not-a-pubkey', d_tag: 'x', event_id: null, market_image: true })
		).toBeNull();
	});
});

describe('the gaps review found between a column and the rule that reads it', () => {
	it('trims the visibility before comparing, as Conduit does', () => {
		// The column is lowercased by the pipeline and NOT trimmed, and the pipeline's own
		// withdrawn test is an exact match, so `["visibility", "Hidden "]` reaches the live pool
		// and reached this gate untouched: a Conduit link to "Listing not available".
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, ...SHOWABLE };
		for (const vis of ['hidden ', ' hidden', 'hidden\t', '\nhidden', 'private ', ' private']) {
			expect(market('conduit').url({ ...row, visibility: vis }), JSON.stringify(vis)).toBeNull();
		}
		// and a word that only CONTAINS one of them is not it
		expect(market('conduit').url({ ...row, visibility: 'hiddenish' })).not.toBeNull();
		expect(market('conduit').url({ ...row, visibility: 'on-sale ' })).not.toBeNull();
		// Plebeian renders a hidden listing in full, so it reads none of this
		expect(market('plebeian').url({ ...row, visibility: 'hidden ' })).not.toBeNull();
	});
});
