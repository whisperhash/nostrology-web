import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import { selectShowable } from '$lib/markets/recent';
import { BTC_ORANGE } from '$lib/ngit/palette';
import type { MarketsRecentListing } from '$lib/shared/data-types';
import RecentListings from './RecentListings.svelte';

const PK_A = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b';
const PK_B = 'e0803a8e9b38bc9957ebbc5fcfd62c76ab4265fb906c66fcbd23bbb8a4aac0b5';
const ID = '49a1d8111ed72770793c7a5756c43a65ac833654c4a0aba14b1707e104428194';

const DEFAULTS: MarketsRecentListing = {
	pubkey: PK_A,
	d_tag: 'barattolo-3195',
	event_id: ID,
	effective_ts: 1792686600, // 2026-10-22 16:30:00Z
	title: 'Buono Amazon 25 scontato',
	status: 'active',
	client: '',
	location: 'Italia',
	cc: 'IT',
	categories: ['collezionismo', 'buoni', 'terzo'],
	price: ['price', '23.50', 'EUR'],
	seller_name: 'Barattolo',
	market_image: true,
	expires_at: null,
	summary_len: null,
	title_tag: 'Buono Amazon 25 scontato',
	visibility: '',
	content_warning: null
};

/**
 * One row. THE PUBLISHED TITLE FOLLOWS `title` unless a case sets it: the two are the same
 * string for a real listing whose title is already lowercase, and a case that is about the
 * DIFFERENCE between them - the page draws `title_tag` and falls back to the pipeline's
 * lowercased `title` - says so by passing `title_tag` itself.
 */
const row = (over: Partial<MarketsRecentListing> = {}): MarketsRecentListing => {
	const base = { ...DEFAULTS, ...over };
	return 'title_tag' in over ? base : { ...base, title_tag: base.title };
};

const COUNTRIES = [{ cc: 'IT', name: 'Italy' }];
const props = (rows: MarketsRecentListing[], perSeller: number | null = null) => ({
	rows,
	countries: COUNTRIES,
	perSeller
});

describe('Recent listings', () => {
	it('draws nothing at all when there are no rows', () => {
		// A failed read of the one table this section needs must not leave a headed, empty
		// card on a page whose every other figure is fine.
		const { container } = render(RecentListings, { props: props([]) });
		expect(container.textContent).toBe('');
	});

	it('draws a row per listing, in the order it was given', () => {
		const rows = [row(), row({ d_tag: 'b', title: 'Second' }), row({ d_tag: 'c', title: 'Third' })];
		const { container } = render(RecentListings, { props: props(rows) });
		const titles = [...container.querySelectorAll('tbody tr')].map(
			(tr) => tr.querySelector('td:nth-child(2) a')?.textContent?.trim()
		);
		expect(titles).toEqual(['Buono Amazon 25 scontato', 'Second', 'Third']);
	});

	it('links the title out to a marketplace, in a new tab, without passing rank on', () => {
		const { container } = render(RecentListings, { props: props([row()]) });
		const a = container.querySelector('tbody a') as HTMLAnchorElement;
		expect(a.href).toMatch(/^https:\/\/(shop\.conduit\.market|plebeian\.market|shopstr\.market)\//);
		expect(a.target).toBe('_blank');
		// nofollow: a listing's rank is not ours to vouch for. noopener: a new tab must not
		// reach back into this one.
		expect(a.rel.split(/\s+/).sort()).toEqual(['nofollow', 'noopener']);
	});

	it('sends the referrer to the marketplace, so the traffic is attributable to us', () => {
		// The operator's decision, 2026-10-23: "let's not block the attribution path".
		// `noreferrer` strips the Referer header, which made every reader we send arrive as
		// direct, unattributable traffic - and it is the ONLY signal the marketplaces get,
		// since we add no query marker. Conduit Market's own referral code reads exactly this
		// (checkoutSourceFromReferrer -> the referrer's hostname). The browser's default
		// policy sends the origin alone, so this reveals nothing about the reader.
		// nostrology-web#27 (Recent listings: let the marketplaces see that the traffic is
		// ours) holds the open part - whether a query marker is added on top.
		const { container } = render(RecentListings, { props: props([row()]) });
		const a = container.querySelector('tbody a') as HTMLAnchorElement;
		expect(a.rel.split(/\s+/)).not.toContain('noreferrer');
	});

	it('draws the title AS PUBLISHED, not the lowercased copy the pipeline stores', () => {
		// The whole point of the column: `title` is folded for the farm and synthetic
		// classifiers, so the Listing column read "arcanine for abra" for every row until
		// nostrology-data#29 (/marketplaces: the listings table drops the title as published and
		// four other per-listing facts the web needs) landed. Every other case here has the two
		// the same string, which is why this one sets them apart.
		const { container } = render(RecentListings, {
			props: props([row({ title: 'arcanine for abra', title_tag: 'Arcanine for Abra' })])
		});
		const cell = container.querySelector('tbody td:nth-child(2)')!;
		expect(cell.textContent).toContain('Arcanine for Abra');
		expect(cell.textContent).not.toContain('arcanine for abra');
	});

	it('falls back to the lowercased title for a row that carries no title tag', () => {
		// A listing with no `title` tag at all: the fold is all there is, and Conduit titles
		// such a listing from its content rather than refusing it.
		const { container } = render(RecentListings, {
			props: props([row({ title: 'a listing with no title tag', title_tag: null })])
		});
		expect(container.querySelector('tbody td:nth-child(2)')!.textContent).toContain(
			'a listing with no title tag'
		);
	});

	it('sends the seller name to the SAME marketplace the listing opens on', () => {
		// The rule nostrology-web#26 (Recent listings: open the Seller name on the same
		// marketplace the listing opens on, not njump) settled: a reader who wants the rest of
		// a shop's stock lands in that shop, not on a raw event viewer. Which of the three it
		// is comes from the coordinate's hash, so this asserts the AGREEMENT rather than a
		// name - the rotation is pinned in links.test.ts.
		const { container } = render(RecentListings, { props: props([row()]) });
		const listing = container.querySelector('tbody td:nth-child(2) a') as HTMLAnchorElement;
		const seller = container.querySelector('tbody td:nth-child(3) a') as HTMLAnchorElement;
		expect(new URL(seller.href).host).toBe(new URL(listing.href).host);
		expect(seller.title).toMatch(/^More from this seller on /);
		// and it sends the referrer, for the same reason the listing link does
		expect(seller.rel.split(/\s+/).sort()).toEqual(['nofollow', 'noopener']);
	});

	it('falls back to njump, quietly, for a row no marketplace can show', () => {
		// The server drops those rows ($lib/markets/recent), so this is reachable only by
		// handing the component uncut rows - and njump keeps `noreferrer`, because an event
		// viewer is not a shop whose goodwill is the point. An EXPIRED listing is the row that
		// no marketplace can show whatever else it carries: relays delete the event, so none of
		// the three can fetch it, which is why listingTarget tests expiry before anything else.
		const nowhere = row({ expires_at: 1 });
		const { container } = render(RecentListings, { props: props([nowhere]) });
		const seller = container.querySelector('tbody td:nth-child(3) a') as HTMLAnchorElement;
		expect(seller.href).toMatch(/^https:\/\/njump\.me\/npub1/);
		expect(seller.rel.split(/\s+/).sort()).toEqual(['nofollow', 'noopener', 'noreferrer']);
		expect(seller.title).toBe('');
		// the listing's own name is then plain text, as it was before
		expect(container.querySelector('tbody td:nth-child(2) a')).toBeNull();
	});

	it('counts the rows it was GIVEN, so a short table says so instead of claiming 60', () => {
		// The server's openability cut runs after the database's limit, so the table can be
		// short (see recent.test.ts). The caption must then state the real number: it is the
		// one sentence a reader checks the table against.
		const rows = Array.from({ length: 7 }, (_, i) => row({ d_tag: `d-${i}` }));
		const { container } = render(RecentListings, { props: props(rows, 2) });
		expect(container.querySelector('p')?.textContent).toContain('The 7 most recent live listings');
		expect(container.querySelectorAll('tbody tr')).toHaveLength(7);
	});

	it('never lets a seller\'s price tag throw: 101 decimals would have 500ed the whole page', () => {
		// Intl's minimumFractionDigits throws a RangeError above 100 (above 20 on older Node),
		// and this formatting runs inside a reactive block the SERVER render materialises - so
		// the throw was not scoped to this section, it was 500 (internal server error) for all
		// of /marketplaces. The live pool's maximum is 20 decimals today; the seller chooses it.
		const long = '1.' + '0'.repeat(101);
		const { container } = render(RecentListings, { props: props([row({ price: ['price', long, 'USD'] })]) });
		expect(container.querySelector('tbody tr')).not.toBeNull();
		expect(container.textContent).toContain(long.slice(0, 24));
	});

	it('quotes an amount verbatim rather than printing a different number', () => {
		// Number() accepts all of these and would quote a price the listing does not name.
		for (const [raw, shown] of [
			['1e9', '1e9'],
			['0x10', '0x10'],
			['111111111111111111111111111111', '111111111111111111111111'],
			['Infinity', 'Infinity']
		] as const) {
			const { container, unmount } = render(RecentListings, {
				props: props([row({ price: ['price', raw, 'USD'] })])
			});
			const cell = container.querySelector('tbody td:nth-child(4)')!.textContent ?? '';
			expect(cell, raw).toContain(shown);
			expect(cell, raw).not.toMatch(/,/); // not grouped, i.e. not treated as a number
			unmount();
		}
	});

	it('survives a date it cannot represent, and two rows with the same coordinate', () => {
		// Both are a throw inside the same reactive block, i.e. a 500 (internal server error)
		// for the whole page rather than one bad cell. The duplicate is reachable because
		// marketplaces_listings has no unique index and the read coalesces a null `d` tag to
		// the empty string, and Svelte 5 throws on a duplicate key even in production - which
		// is why the rows are keyed by index.
		const far = render(RecentListings, { props: props([row({ effective_ts: 9e15 })]) });
		expect(far.container.querySelector('tbody tr')).not.toBeNull();
		far.unmount();
		const twins = render(RecentListings, { props: props([row({ d_tag: '' }), row({ d_tag: '' })]) });
		expect(twins.container.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	it('does what the LIVE page does: with no pipeline facts, every row opens on Shopstr', () => {
		// The production shape, which nothing covered before review: the five columns read
		// null, so Conduit and Plebeian decline every row and the rotation has one candidate.
		// Several rows, because a single row cannot tell a reaching rotation from a stuck one.
		const rows = Array.from({ length: 6 }, (_, i) =>
			row({
				d_tag: `live-${i}`,
				event_id: null,
				market_image: null,
				expires_at: null,
				title_tag: null,
				content_warning: null,
				seller_name: null
			})
		);
		const { container } = render(RecentListings, { props: props(rows, 2) });
		const hrefs = [...container.querySelectorAll('tbody td:nth-child(2) a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toHaveLength(6);
		expect(hrefs.every((h) => h!.startsWith('https://shopstr.market/listing/'))).toBe(true);
		expect(container.textContent).toContain('the one marketplace');
		expect(container.textContent).not.toContain('spread between');
	});

	it('draws the title exactly as the column holds it, lowercase and all', () => {
		// Pins the known gap rather than leaving it to be noticed: marketplaces_listings.title
		// is lowercased for classification, so the Listing column reads "arcanine for abra"
		// until the pipeline carries the title as published. When it does, this test fails and
		// says why.
		const { container } = render(RecentListings, {
			props: props([row({ title: 'arcanine for abra', title_tag: null })])
		});
		expect(container.querySelector('tbody td:nth-child(2) a')!.textContent!.trim()).toBe('arcanine for abra');
	});

	it('says what the cut is, in a caption the operator kept short', () => {
		// Trimmed on the operator's wording, 2026-10-23: no live total, no seller count, no
		// "sortable by any column" - the headers show that themselves - and no methodology
		// footnote at all (that prose is kept for the Marketplaces MCP, in nostrology-data).
		const rows = [row(), row({ pubkey: PK_B, d_tag: 'b', seller_name: 'Hexbox Tools' })];
		const capped = render(RecentListings, { props: props(rows, 2) });
		const text = () => capped.container.textContent!.replace(/\s+/g, ' ');
		expect(text()).toContain('The 2 most recent live listings.');
		expect(text()).toContain('At most 2 per seller');
		for (const gone of ['sellers are in it', 'sortable by any column', 'of 9,251', 'published_at'])
			expect(text()).not.toContain(gone);
		capped.unmount();
		// Not "in date order": the table re-sorts, so a caption claiming an order would stop
		// being true the moment a reader clicked a header.
		const plain = render(RecentListings, { props: props(rows) });
		expect(plain.container.textContent!.replace(/\s+/g, ' ')).toContain('No cap per seller');
	});

	it('says one row per title in the caption, whether or not a seller cap is on', () => {
		// recent.ts: a cut that is not stated is a lie about the order, and this one drops a real
		// listing because another seller used its name. Not a claim to make only some of the time.
		for (const perSeller of [2, null]) {
			const { container, unmount } = render(RecentListings, { props: props([row()], perSeller) });
			expect(container.querySelector('p')!.textContent!.replace(/\s+/g, ' ')).toContain(
				'Of those, each title appears once, on its newest listing, so a repeat is left out even when a different seller published it.'
			);
			unmount();
		}
	});

	it('draws what the cut compared, so no two rows read the same', () => {
		// The table and the cut share listingTitle. Two definitions could disagree, and the table
		// would then show a pair the cut believed were different names.
		const rows = [
			row({ d_tag: 'a', title: 'fresas', title_tag: 'Fresas' }),
			row({ d_tag: 'b', title: 'fresas', title_tag: null }),
			row({ d_tag: 'c', title: 'fresas ', title_tag: 'FRESAS ' }),
			row({ d_tag: 'd', title: '', title_tag: null }),
			row({ d_tag: 'e', title: '', title_tag: '\u200b' }),
			row({ d_tag: 'f', title: 'kilohash', title_tag: 'Kilohash' })
		];
		const { container } = render(RecentListings, { props: props(selectShowable(rows).rows) });
		const drawn = [...container.querySelectorAll('tbody td:nth-child(2) a')].map((a) =>
			a.textContent!.trim()
		);
		expect(drawn).toEqual(['Fresas', '(no visible characters)', 'Kilohash']);
	});

	it('writes the marketplace list as prose, with "or" before the last name', () => {
		// Three names joined with commas alone read as a list with a comma splice before the
		// clause after it ("on A, B, C , picked from...").
		const { container } = render(RecentListings, {
			props: props([row(), row({ d_tag: 'b' }), row({ d_tag: 'c' }), row({ d_tag: 'd' })])
		});
		const text = container.textContent!.replace(/\s+/g, ' ');
		expect(text).toMatch(/opens that listing on [^,]+(, [^,]+)* or [^,]+, picked from/);
	});

	it('claims a spread only while more than one marketplace is in the rotation', () => {
		// Against today's database no row carries an event id, so every row goes to the one
		// marketplace that addresses by coordinate - and the caption must not then say the
		// traffic is spread between them.
		const one = render(RecentListings, { props: props([row({ event_id: null })]) });
		expect(one.container.textContent).toContain('the one marketplace');
		expect(one.container.textContent).not.toContain('spread between');
		one.unmount();
		const both = render(RecentListings, { props: props([row(), row({ d_tag: 'b' }), row({ d_tag: 'c' })]) });
		expect(both.container.textContent).toContain('spread between');
	});

	it('sorts by any column, and the bright ink follows the sort', async () => {
		const rows = [
			row({ d_tag: 'a', title: 'Banana', price: ['price', '10', 'SAT'] }),
			row({ d_tag: 'b', title: 'Apple', price: ['price', '30', 'SAT'], effective_ts: 1792686000 }),
			row({ d_tag: 'c', title: 'Cherry', price: ['price', '20', 'SAT'], effective_ts: 1792685000 })
		];
		const { container, getByLabelText } = render(RecentListings, { props: props(rows) });
		const titles = () =>
			[...container.querySelectorAll('tbody td:nth-child(2) a')].map((a) => a.textContent?.trim());
		const inkOf = (nth: number) =>
			container.querySelector(`tbody td:nth-child(${nth})`)?.className ?? '';

		// Newest first before any click, and the date column is the bright one.
		expect(titles()).toEqual(['Banana', 'Apple', 'Cherry']);
		expect(inkOf(1)).toContain('text-gray-200');
		expect(inkOf(4)).toContain('text-gray-400');

		await fireEvent.click(getByLabelText('Sort by Price'));
		expect(titles()).toEqual(['Apple', 'Cherry', 'Banana']); // a new numeric column: largest first
		expect(inkOf(4)).toContain('text-gray-200');
		expect(inkOf(1)).toContain('text-gray-400');

		await fireEvent.click(getByLabelText('Sort by Price'));
		expect(titles()).toEqual(['Banana', 'Cherry', 'Apple']); // the open column flips

		await fireEvent.click(getByLabelText('Sort by Listing'));
		expect(titles()).toEqual(['Apple', 'Banana', 'Cherry']); // a new text column: A first
	});

	it('marks a listing whose expiry has passed, and links it nowhere', () => {
		// Relays delete an expired event (NIP-40), so no client can open it. The server
		// drops such a row; handed one uncut, the table says why it is not a link.
		const { container } = render(RecentListings, {
			props: props([row({ expires_at: 1700000000 })])
		});
		expect(container.querySelector('tbody td:nth-child(2) a')).toBeNull();
		expect(container.textContent).toContain('expired');
		expect(container.textContent).not.toContain('Every row here opens');
	});

	it('colours a status by what the word means, and never in Bitcoin\'s colour', () => {
		// The operator's rules, 2026-10-23: amber and gold are this page's Bitcoin colours
		// (the map's gold ring), and a completed trade is a POSITIVE outcome, so it cannot
		// carry the red that marks a withdrawal.
		const badge = (status: string) => {
			const { container } = render(RecentListings, { props: props([row({ status })]) });
			expect(container.innerHTML).not.toMatch(/amber|orange/);
			return [...container.querySelectorAll('tbody span')].find(
				(e) => e.textContent?.trim() === status
			)!;
		};
		expect(badge('traded').className).toContain('text-emerald');
		expect(badge('sold-hidden').className).toContain('text-emerald');
		expect(badge('withdrawn').className).toContain('text-red-300');
		// A seller's own synonym for "for sale" is neither good news nor bad.
		expect(badge('open').className).toContain('text-gray-400');
		expect(badge('unheard-of').className).toContain('text-gray-400');
	});

	it('caps the seller-chosen strings, so one listing cannot widen a column without end', () => {
		// status, the publishing app's name and a category are all a stranger's text of any
		// length; `where` and the unparseable price were already capped.
		const { container } = render(RecentListings, {
			props: props([
				row({
					status: 'w'.repeat(80),
					client: 'c'.repeat(80),
					categories: ['k'.repeat(80), 'k2'.repeat(80)],
					location: 'l'.repeat(120),
					cc: null
				})
			])
		});
		const text = container.textContent ?? '';
		expect(text).not.toContain('w'.repeat(25));
		expect(text).not.toContain('c'.repeat(41));
		expect(text).not.toContain('k'.repeat(41));
		expect(text).not.toContain('l'.repeat(41));
	});

	it('marks an expired listing in red: nobody can buy it, whatever it says', () => {
		const { container } = render(RecentListings, {
			props: props([row({ status: 'traded', expires_at: 1700000000 })])
		});
		const expired = [...container.querySelectorAll('tbody span')].find(
			(e) => e.textContent?.trim() === 'expired'
		)!;
		expect(expired.className).toContain('text-red-300');
	});

	it('writes the date in UTC, the day over the time', () => {
		const { container } = render(RecentListings, { props: props([row()]) });
		const cell = container.querySelector('tbody td')!;
		expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('2026-10-22 16:30');
	});

	it('shows the place the seller resolved to, else their own words', () => {
		const { container } = render(RecentListings, { props: props([row(), row({ d_tag: 'b', cc: 'NONGEO', location: 'Online' })]) });
		const where = [...container.querySelectorAll('tbody tr')].map(
			(tr) => tr.querySelector('td:nth-child(5)')?.textContent?.trim()
		);
		// IT resolves to its name from the snapshot's own table; NONGEO is this site's
		// bucket, so the cell says what the seller wrote instead.
		expect(where).toEqual(['Italy', 'Online']);
	});

	it('strips the characters that would reorder or hide a seller-written line, and isolates the rest', () => {
		// U+202E (right-to-left override) past a title would flip the row's punctuation; a
		// title of nothing but format characters must not render an invisible link.
		const rows = [
			row({ title: 'Lamp‮', client: 'Shop\u0007', categories: ['cat​'] }),
			row({ d_tag: 'b', title: '​​' })
		];
		const { container } = render(RecentListings, { props: props(rows) });
		const cells = [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');
		expect(cells[0]).toContain('Lamp');
		expect(cells.join('')).not.toMatch(/[‪-‮⁦-⁩\u0007​]/);
		expect(cells[1]).toContain('(no visible characters)');
		expect(container.querySelectorAll('tbody bdi').length).toBeGreaterThan(0);
	});

	it('gives the seller a column of their own, linked to their page on that marketplace', () => {
		const { container } = render(RecentListings, { props: props([row()]) });
		const cell = container.querySelector('tbody td:nth-child(3)')!;
		expect(cell.textContent?.trim()).toBe('Barattolo');
		const href = cell.querySelector('a')?.getAttribute('href') ?? '';
		// one of the three forms, each driven in a browser on 2026-10-23 (links.ts)
		expect(href).toMatch(
			/^https:\/\/(shop\.conduit\.market\/npub1|plebeian\.market\/profile\/[0-9a-f]{64}|shopstr\.market\/marketplace\/npub1)/
		);
	});

	it('marks a price that is quoted with no currency, in the cell itself', () => {
		// One shop publishes exactly ["price", "190.00"] - no currency anywhere in the event.
		// A bare number in a column of SAT and EUR would read as though the unit were obvious.
		// The mark now has to carry the explanation on its own: the footnote that used to
		// count these rows is gone.
		const { container } = render(RecentListings, { props: props([row({ price: ['price', '190.00'] })]) });
		const cell = container.querySelector('tbody td:nth-child(4)')!;
		expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('190.00 ?');
		expect(cell.querySelector('[title]')?.getAttribute('title')).toContain('no currency');
	});

	it('says nothing rather than a price when the listing quotes none', () => {
		const { container } = render(RecentListings, { props: props([row({ price: null })]) });
		expect(container.querySelector('tbody td:nth-child(4)')?.textContent?.trim()).toBe('-');
	});

	it("keeps the seller's own decimals, and groups the thousands", () => {
		const rows = [
			row({ price: ['price', '23.50', 'EUR'] }),
			row({ d_tag: 'b', price: ['price', '1000', 'SAT'] }),
			row({ d_tag: 'c', price: ['price', 'ask me', 'USD'] })
		];
		const { container } = render(RecentListings, { props: props(rows) });
		const prices = [...container.querySelectorAll('tbody tr')].map((tr) =>
			tr.querySelector('td:nth-child(4)')?.textContent?.replace(/\s+/g, ' ').trim()
		);
		// "23.5" would be a different price from the one on the listing.
		expect(prices).toEqual(['23.50 EUR', '1,000 SAT', 'ask me USD']);
	});
});

// The operator's call, 2026-11-04: a listing priced in any denomination of bitcoin wears the
// orange of the Priced in bitcoin card, so the table and that card say the same thing about a
// row. $lib/markets/currency decides which listings those are; this is what the cells do with it.
describe('Recent listings: a bitcoin price', () => {
	/** A colour as this DOM reports one back, so a comparison does not depend on how it spells it. */
	const asDrawn = (colour: string) => {
		const probe = document.createElement('div');
		probe.style.color = colour;
		return probe.style.color;
	};
	const ORANGE = asDrawn(BTC_ORANGE);
	const inkOf = (el: Element | null | undefined) => (el as HTMLElement | null | undefined)?.style.color ?? '';

	/** The three places a price's ink lands: the column's cell, the unit inside it, and the line
	 * under the title that a phone gets in place of the column. */
	const paint = (container: Element, nth = 1) => {
		const tr = container.querySelector(`tbody tr:nth-child(${nth})`)!;
		const cell = tr.querySelector('td:nth-child(4)')!;
		return {
			cell: inkOf(cell),
			unit: inkOf(cell.querySelector('span')),
			phone: inkOf(tr.querySelector('td:nth-child(2) .tabular-nums'))
		};
	};
	const IN_ORANGE = { cell: ORANGE, unit: ORANGE, phone: ORANGE };
	const UNTOUCHED = { cell: '', unit: '', phone: '' };

	it('compares with a colour this DOM can read, or every case here would pass on nothing', () => {
		expect(ORANGE).not.toBe('');
	});

	it.each(['SATS', 'sats', 'SAT', 'sat', 'Sats', 'BTC', 'btc', 'msat', 'msats', 'satoshi', 'bitcoin', 'xbt', 'sat(s)'])(
		'draws the amount and the unit of a %s price in the orange, in the column and on the phone',
		(unit) => {
			const { container } = render(RecentListings, { props: props([row({ price: ['price', '1700', unit] })]) });
			expect(paint(container)).toEqual(IN_ORANGE);
		}
	);

	it.each(['USD', 'EUR', 'USDC', 'TESTSAT'])('leaves a %s price in the ink of the sort', (unit) => {
		// TESTSAT above all: the first rows of the live table quoted it on 2026-11-04, it sounds like
		// bitcoin, and the Priced in bitcoin card does not count it.
		const { container } = render(RecentListings, { props: props([row({ price: ['price', '16', unit] })]) });
		expect(paint(container)).toEqual(UNTOUCHED);
	});

	it('leaves alone a price with no currency, and the dash of a listing with no price', () => {
		const { container } = render(RecentListings, {
			props: props([row({ price: ['price', '190.00'] }), row({ d_tag: 'b', price: null })])
		});
		expect(paint(container, 1)).toEqual(UNTOUCHED);
		expect(paint(container, 2)).toEqual(UNTOUCHED);
	});

	it('goes by the unit, so an amount shown verbatim wears the orange too', () => {
		// The pipeline counts these by their unit whatever the amount says, so the card counts them.
		const { container } = render(RecentListings, { props: props([row({ price: ['price', 'ask me', 'sats'] })]) });
		expect(container.querySelector('tbody td:nth-child(4)')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('ask me sats');
		expect(paint(container)).toEqual(IN_ORANGE);
	});

	it('reads the third element of a longer tag, and only that', () => {
		// NIP-99's fourth element is a frequency. The pipeline reads the third alone, so a word that
		// merely appears elsewhere in the tag says nothing about what the listing is priced in.
		const { container } = render(RecentListings, {
			props: props([row({ price: ['price', '12', 'sats', 'month'] }), row({ d_tag: 'b', price: ['price', 'sats', 'USD', 'sats'] })])
		});
		expect(paint(container, 1)).toEqual(IN_ORANGE);
		expect(paint(container, 2)).toEqual(UNTOUCHED);
	});

	it('has no price to colour when a listing names a bitcoin unit and no amount', () => {
		const { container } = render(RecentListings, { props: props([row({ price: ['price', '', 'SAT'] })]) });
		expect(container.querySelector('tbody td:nth-child(4)')?.textContent?.trim()).toBe('-');
		expect(paint(container)).toEqual(UNTOUCHED);
	});

	it('still draws the unit as the listing spells it: the colour is all that reads its meaning', () => {
		const { container } = render(RecentListings, { props: props([row({ price: ['price', '1000', 'sAtOsHi'] })]) });
		expect(container.querySelector('tbody td:nth-child(4)')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1,000 sAtOsHi');
		expect(paint(container)).toEqual(IN_ORANGE);
	});

	it('reads the tag itself and not the text the cell draws, so the colour agrees with the count', () => {
		// visibleText strips a control character, so the cell reads "sats"; the pipeline's fold keeps
		// it, so the snapshot counts this listing under "Other" and the card does not count it.
		const { container } = render(RecentListings, { props: props([row({ price: ['price', '10', 'sa\x01ts'] })]) });
		expect(container.querySelector('tbody td:nth-child(4)')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('10 sats');
		expect(paint(container)).toEqual(UNTOUCHED);
	});

	it('does not throw for a tag whose unit is not a string', () => {
		// The tag is a stranger's, and this runs in a block the server render materialises.
		const odd = ['price', '10', 21] as unknown as string[];
		const { container } = render(RecentListings, { props: props([row({ price: odd })]) });
		expect(paint(container)).toEqual(UNTOUCHED);
	});

	it('keeps the orange whichever column is sorted, while a dollar price follows the sort', async () => {
		// $lib/sort-ink: a colour that carries meaning stays, and the bright ink moves between the
		// others. A screenshot of a re-sorted table has to read true either way.
		const rows = [
			row({ d_tag: 'a', title: 'Paid in sats', price: ['price', '2000', 'SAT'] }),
			row({ d_tag: 'b', title: 'Paid in dollars', price: ['price', '10', 'USD'], effective_ts: 1792686000 })
		];
		const { container, getByLabelText } = render(RecentListings, { props: props(rows) });
		const cellOf = (title: string) =>
			[...container.querySelectorAll('tbody tr')]
				.find((tr) => tr.querySelector('td:nth-child(2) a')?.textContent?.trim() === title)!
				.querySelector('td:nth-child(4)')!;

		for (const column of ['Price', 'Listing', 'Seller', 'Where', 'Category', 'Dated (UTC)', 'Price']) {
			await fireEvent.click(getByLabelText(`Sort by ${column}`));
			const bright = column === 'Price';
			expect(inkOf(cellOf('Paid in sats')), column).toBe(ORANGE);
			expect(inkOf(cellOf('Paid in sats').querySelector('span')), column).toBe(ORANGE);
			expect(inkOf(cellOf('Paid in sats').closest('tr')!.querySelector('td:nth-child(2) .tabular-nums')), column).toBe(ORANGE);
			expect(inkOf(cellOf('Paid in dollars')), column).toBe('');
			expect(cellOf('Paid in dollars').className, column).toContain(bright ? 'text-gray-200' : 'text-gray-400');
		}
	});
});
