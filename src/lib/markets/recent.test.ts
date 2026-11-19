import { describe, expect, it } from 'vitest';

import { RECENT_LIMIT, RECENT_READ, listingTitle, selectShowable } from './recent';
import { NO_VISIBLE_TEXT } from '$lib/ngit/format';
import type { MarketsRecentListing } from '$lib/shared/data-types';

const PK = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b';
const PK_B = 'e0803a8e9b38bc9957ebbc5fcfd62c76ab4265fb906c66fcbd23bbb8a4aac0b5';
const ID = '49a1d8111ed72770793c7a5756c43a65ac833654c4a0aba14b1707e104428194';

/** A row the rotation can open: Conduit has its image, Plebeian its event id. */
const row = (i: number, over: Partial<MarketsRecentListing> = {}): MarketsRecentListing => ({
	pubkey: PK,
	d_tag: `listing-${i}`,
	event_id: ID,
	effective_ts: 1761200000 - i,
	title: `listing ${i}`,
	title_tag: `listing ${i}`,
	status: 'active',
	visibility: '',
	content_warning: null,
	summary_len: null,
	client: '',
	location: '',
	cc: null,
	categories: [],
	price: ['price', '1000', 'SAT'],
	market_image: true,
	expires_at: null,
	seller_name: null,
	...over
});

describe('the cut Recent listings draws', () => {
	it('reads more rows than it shows, so the table is full after the drop', () => {
		expect(RECENT_READ).toBeGreaterThan(RECENT_LIMIT);
	});

	it('keeps the rows a marketplace can show, in the order they were read', () => {
		const rows = [row(0), row(1), row(2)];
		const sel = selectShowable(rows);
		expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-0', 'listing-1', 'listing-2']);
		expect(sel).toMatchObject({ read: 3, unopenable: 0 });
	});

	it('drops a listing no marketplace can show, and counts it', () => {
		// Expired: relays delete it, so no marketplace can answer for it.
		const expiresAt = 1792697446;
		const rows = [row(0), row(1, { expires_at: 1 }), row(2, { expires_at: expiresAt })];
		const sel = selectShowable(rows, expiresAt * 1000 + 1);
		expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-0']);
		expect(sel).toMatchObject({ read: 3, unopenable: 2 });
	});

	it('still opens a row that carries none of the pipeline facts yet', () => {
		// Every one of those columns null is what the database serves today. Conduit needs
		// the image fact and Plebeian the event id, so both decline - but Shopstr addresses
		// a listing by its coordinate alone and shows it with no content conditions, so the
		// row keeps a link. This is why the section is not blocked on the pipeline change.
		const blind = [row(0), row(1)].map((r) => ({ ...r, event_id: null, market_image: null }));
		const sel = selectShowable(blind);
		expect(sel).toMatchObject({ read: 2, unopenable: 0 });
		expect(sel.rows).toHaveLength(2);
	});

	it('drops a row no marketplace can address at all', () => {
		// A coordinate needs a 64-hex pubkey; without one, the two coordinate-addressed
		// marketplaces have no address and the id-addressed one has no id.
		const broken = [row(0), row(1)].map((r) => ({ ...r, pubkey: 'beef', event_id: null }));
		expect(selectShowable(broken)).toMatchObject({ rows: [], read: 2, unopenable: 2 });
	});

	it('cuts to RECENT_LIMIT, counting the drop over everything it read', () => {
		const rows = Array.from({ length: RECENT_READ }, (_, i) =>
			i % 10 === 0 ? row(i, { expires_at: 1 }) : row(i)
		);
		const sel = selectShowable(rows);
		expect(sel.rows).toHaveLength(RECENT_LIMIT);
		expect(sel.read).toBe(RECENT_READ);
		expect(sel.unopenable).toBe(RECENT_READ / 10);
		// The cut keeps the newest, not a sample: every shown row is openable.
		expect(sel.rows.every((r) => r.expires_at === null)).toBe(true);
	});

	it('is empty, not an error, for no rows at all', () => {
		expect(selectShowable([])).toMatchObject({ rows: [], read: 0, unopenable: 0 });
	});

	it('SHORTENS rather than breaks when the cut takes more than the read can spare', () => {
		// The openability test runs here, AFTER the database's LIMIT, so a sharp change in what
		// the marketplaces will render can leave fewer than RECENT_LIMIT rows. It cannot make
		// the table wrong - the caption counts the rows it was given - only short. Headroom
		// today: the read is 4x the table and the measured loss is 3 of 400, while the capped
		// pool the read comes from is 2,540 rows from 1,798 live sellers (measured against the
		// live database, 2026-10-23), so the cap can never be what shortens it.
		const rows = Array.from({ length: RECENT_READ }, (_, i) =>
			i % 5 === 0 ? row(i) : row(i, { expires_at: 1 })
		);
		const sel = selectShowable(rows);
		expect(sel.rows).toHaveLength(RECENT_READ / 5);
		expect(sel.rows.length).toBeLessThan(RECENT_LIMIT);
		expect(sel.unopenable).toBe(RECENT_READ - RECENT_READ / 5);
		expect(sel.read).toBe(RECENT_READ);
	});

	it('leaves nothing at all when no row can be opened, rather than drawing dead names', () => {
		const sel = selectShowable(Array.from({ length: 20 }, (_, i) => row(i, { expires_at: 1 })));
		expect(sel.rows).toEqual([]);
		expect(sel.unopenable).toBe(20);
	});

	describe('one row per title', () => {
		/** The d tags of the rows kept, from rows named by these published titles, newest first. */
		const kept = (...titles: (string | null)[]) =>
			selectShowable(titles.map((t, i) => row(i, { title_tag: t, title: (t ?? '').toLowerCase() })))
				.rows.map((r) => r.d_tag);

		it('keeps the newest of a repeated title and counts the rest', () => {
			// The operator's report of 2026-11-04: "Fresas" twice, 2 s apart, from one seller.
			const sel = selectShowable([
				row(0, { title_tag: 'Fresas' }),
				row(1, { title_tag: 'Kilohash' }),
				row(2, { title_tag: 'Fresas' })
			]);
			expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-0', 'listing-1']);
			expect(sel).toMatchObject({ read: 3, unopenable: 0, repeated: 1 });
		});

		it('takes the first in the order read, which is what makes a same-second tie stable', () => {
			// The read's own order is effective_ts DESC, pubkey, d_tag: "Text translation" was two
			// sellers in the same second. This must not re-sort, or the winner would depend on it.
			const same = row(0, { title_tag: 'Text translation', effective_ts: 1761200000 });
			const a = { ...same, d_tag: 'one' };
			const b = { ...same, pubkey: PK_B, d_tag: 'two' };
			expect(selectShowable([a, b]).rows).toEqual([a]);
			expect(selectShowable([b, a]).rows).toEqual([b]);
		});

		it('leaves the rows it keeps in the order they were read', () => {
			// Newest first across sellers: the seller whose key sorts last is the newest here.
			const rows = [
				row(0, { title_tag: 'Newest', pubkey: PK_B }),
				row(1, { title_tag: 'Middle', pubkey: PK }),
				row(2, { title_tag: 'Newest', pubkey: PK }),
				row(3, { title_tag: 'Oldest', pubkey: PK_B })
			];
			expect(selectShowable(rows).rows.map(listingTitle)).toEqual(['Newest', 'Middle', 'Oldest']);
		});

		it('applies across sellers as well as within one', () => {
			const sel = selectShowable([
				row(0, { title_tag: 'Kilohash' }),
				row(1, { title_tag: 'Kilohash', pubkey: PK_B })
			]);
			expect(sel.rows.map((r) => r.pubkey)).toEqual([PK]);
			expect(sel.repeated).toBe(1);
		});

		it.each([
			['case', 'Fresas', 'FRESAS'],
			['outer whitespace', 'Fresas', '  Fresas\t'],
			['a run of spaces, which a browser collapses', 'Red shoes', 'Red   shoes'],
			['a line break, which the table draws as a space', 'Red shoes', 'Red\nshoes'],
			['a zero-width character, which draws as nothing', 'Fresas', 'Fre\u200bsas'],
			['a composed and a decomposed accent', 'Caf\u00e9', 'Cafe\u0301']
		])('treats titles differing only by %s as one', (_why, first, second) => {
			expect(kept(first, second)).toEqual(['listing-0']);
		});

		it.each([
			['another word', 'Fresas', 'Fresas frescas'],
			['a real difference in the accent', 'Fresas', 'Fres\u00e1s'],
			['a lookalike from another alphabet, which is a different title', 'Cafe', '\u0421afe']
		])('keeps titles that differ by %s apart', (_why, first, second) => {
			expect(kept(first, second)).toEqual(['listing-0', 'listing-1']);
		});

		it('reads the title the table draws, not the stored fold', () => {
			// One row's published title and another's lowercased copy (it carries no title tag) draw
			// differently but say the same name, so the case fold is what joins them.
			const sel = selectShowable([
				row(0, { title_tag: 'Fresas', title: 'fresas' }),
				row(1, { title_tag: null, title: 'fresas' })
			]);
			expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-0']);
			// And the stored fold can differ where the drawn title does not: only the first of
			// these keeps a trailing space, which comparing `title` would treat as two names.
			const twins = selectShowable([
				row(0, { title_tag: 'Fresas ', title: 'fresas ' }),
				row(1, { title_tag: 'Fresas', title: 'fresas' })
			]);
			expect(twins.rows.map((r) => r.d_tag)).toEqual(['listing-0']);
		});

		it('leaves one row for all the listings that show the placeholder', () => {
			// Missing, empty and invisible all draw the same words, and untitled listings filled up
			// to 10 rows of 60 before this. A seller who publishes only those nearly leaves the table.
			const sel = selectShowable([
				row(0, { title_tag: null, title: '' }),
				row(1, { title_tag: '', title: '' }),
				row(2, { title_tag: '\u200b', title: '\u200b' }),
				row(3, { title_tag: 'Fresas' })
			]);
			expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-0', 'listing-3']);
			expect(listingTitle(sel.rows[0])).toBe(NO_VISIBLE_TEXT);
			expect(sel.repeated).toBe(2);
		});

		it('never lets a row nobody can open claim a title from one somebody can', () => {
			// The newest row of the title is expired, so nothing can show it. Run the other way
			// round, these two cuts would draw neither.
			const sel = selectShowable([
				row(0, { title_tag: 'Fresas', expires_at: 1 }),
				row(1, { title_tag: 'Fresas' })
			]);
			expect(sel.rows.map((r) => r.d_tag)).toEqual(['listing-1']);
			expect(sel).toMatchObject({ read: 2, unopenable: 1, repeated: 0 });
		});

		it('cuts repeats before the limit, so they do not cost the table rows', () => {
			// Half the read repeats one title. Run the other way round, the 60 newest would be cut
			// first and leave 31 distinct rows in a table that had 120 more to offer.
			const rows = Array.from({ length: RECENT_READ }, (_, i) =>
				row(i, { title_tag: i % 2 === 0 ? 'Fresas' : `listing ${i}` })
			);
			const sel = selectShowable(rows);
			expect(sel.rows).toHaveLength(RECENT_LIMIT);
			expect(new Set(sel.rows.map(listingTitle)).size).toBe(RECENT_LIMIT);
			expect(sel.repeated).toBe(RECENT_READ / 2 - 1);
		});

		it('SHORTENS rather than breaks when one title takes more than the read can spare', () => {
			const sel = selectShowable(
				Array.from({ length: RECENT_READ }, (_, i) => row(i, { title_tag: 'Fresas' }))
			);
			expect(sel.rows).toHaveLength(1);
			expect(sel).toMatchObject({ read: RECENT_READ, unopenable: 0, repeated: RECENT_READ - 1 });
		});
	});
});
