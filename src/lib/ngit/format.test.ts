import { afterEach, describe, expect, it, vi } from 'vitest';

import { shortNpub } from '$lib/auth/profile';
import {
	CLONE_HOST_KIND_LABEL,
	cloneHostLabel,
	cloneHostTitle,
	compact,
	cutOf,
	dayName,
	fmtDay,
	HOSTING_CLASS_DEF,
	HOST_CLASS_KIND,
	HOST_KIND_LABEL,
	HOST_KIND_ORDER,
	hostClassKind,
	hostKindsInOrder,
	HOSTING_CLASS_LABEL,
	labelFor,
	labelText,
	LEDGER_LABEL,
	n,
	NO_VISIBLE_TEXT,
	pct,
	personLabel,
	repoLabel,
	satsFromMsats,
	sortNote,
	unitFor,
	upperFirst,
	visibleText
} from './format';

describe('n', () => {
	it('thousands-separates and never prints NaN', () => {
		expect(n(4527)).toBe('4,527');
		expect(n(0)).toBe('0');
		expect(n(null)).toBe('-');
		expect(n(Number.NaN)).toBe('-');
	});
});

describe('compact', () => {
	it.each([
		[0, '0'],
		[950, '950'],
		[1000, '1k'],
		[1234, '1.2k'],
		[12_345, '12.3k'],
		[123_456, '123k'],
		[999_950, '1M'],
		[4_500_000, '4.5M'],
		[2_100_000_000, '2.1B'],
		[-1500, '-1.5k']
	])('%d -> %s', (v, out) => {
		expect(compact(v)).toBe(out);
	});

	it('prints a dash for a missing value', () => {
		expect(compact(undefined)).toBe('-');
	});
});

describe('satsFromMsats', () => {
	it('rounds millisats to whole sats, like the rest of the site', () => {
		expect(satsFromMsats(21_000)).toBe(21);
		expect(satsFromMsats(1_500)).toBe(2);
		expect(satsFromMsats(499)).toBe(0);
		expect(satsFromMsats(null)).toBe(0);
	});
});

describe('pct', () => {
	it('formats a 0..1 share', () => {
		expect(pct(0.3137)).toBe('31.4%');
		expect(pct(0)).toBe('0.0%');
		expect(pct(1)).toBe('100.0%');
		expect(pct(0.5, 0)).toBe('50%');
	});

	it('never lets a tiny or near-total share read as none or all', () => {
		expect(pct(0.0004)).toBe('<0.1%');
		expect(pct(0.9996)).toBe('>99.9%');
	});

	it('says n/a for a missing share', () => {
		expect(pct(null)).toBe('n/a');
		expect(pct(Number.POSITIVE_INFINITY)).toBe('n/a');
	});
});

describe('fmtDay', () => {
	it('passes a YYYY-MM-DD date through and trims a timestamp to its day', () => {
		expect(fmtDay('2026-09-24')).toBe('2026-09-24');
		expect(fmtDay('2026-09-24 03:15:00Z')).toBe('2026-09-24');
	});

	it('prints a dash for null and empty', () => {
		expect(fmtDay(null)).toBe('-');
		expect(fmtDay('')).toBe('-');
		expect(fmtDay(undefined)).toBe('-');
	});
});

describe('dayName', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('spells a day in UTC, and returns anything else unchanged', () => {
		expect(dayName('2026-06-14')).toBe('Jun 14, 2026');
		expect(dayName('never')).toBe('never');
	});

	it('spells the UTC day whatever the reader timezone', () => {
		// Midnight UTC is still the previous day in Los Angeles: a label formatted in local
		// time says "Jun 13" there. CI runs in UTC, where that bug is invisible.
		const tz = process.env.TZ;
		process.env.TZ = 'America/Los_Angeles';
		try {
			expect(new Date('2026-06-14T00:00:00Z').getDate()).toBe(13); // the switch took effect
			expect(dayName('2026-06-14')).toBe('Jun 14, 2026');
			expect(dayName('2026-01-01')).toBe('Jan 1, 2026');
		} finally {
			if (tz === undefined) delete process.env.TZ;
			else process.env.TZ = tz;
		}
	});

	it('never reads a local-time accessor', () => {
		// Any getDate / getMonth / getFullYear / getHours in the formatting path throws here,
		// so a label computed in the reader's timezone cannot pass by the calendar's luck.
		for (const m of ['getDate', 'getMonth', 'getFullYear', 'getHours'] as const) {
			vi.spyOn(Date.prototype, m).mockImplementation(() => {
				throw new Error(`local-time accessor ${m} called`);
			});
		}
		expect(dayName('2026-06-14')).toBe('Jun 14, 2026');
		expect(dayName('2026-12-31')).toBe('Dec 31, 2026');
	});
});

describe('visibleText', () => {
	it('removes the bidi controls that reorder the text around them', () => {
		// U+202E RIGHT-TO-LEFT OVERRIDE, U+202A-202D embeddings, U+2066-2069 isolates,
		// U+200E / U+200F / U+061C marks
		expect(visibleText('\u202Egnp.tpircs')).toBe('gnp.tpircs');
		expect(visibleText('a\u202Ab\u202Bc\u202Cd\u202De')).toBe('abcde');
		expect(visibleText('\u2066x\u2067y\u2068z\u2069')).toBe('xyz');
		expect(visibleText('\u200Eleft\u200Fright\u061C')).toBe('leftright');
	});

	it('removes zero-width and other format characters, and the C0 and C1 controls', () => {
		expect(visibleText('zero\u200Bwidth\u200C\u200D\u2060\uFEFF')).toBe('zerowidth');
		expect(visibleText('soft\u00ADhyphen')).toBe('softhyphen');
		expect(visibleText('bell\u0007\u009Bcsi')).toBe('bellcsi');
		// a line or tab break becomes a space, so no two words are glued together
		expect(visibleText('two\nlines\tand\rtab')).toBe('two lines and tab');
	});

	it('says nothing is left when nothing visible is', () => {
		expect(visibleText('\u200B\u200B')).toBe('');
		expect(visibleText('  \u200B \uFEFF ')).toBe('');
		// not format characters, but they draw nothing: Hangul fillers, the blank braille
		// pattern, a lone variation selector
		expect(visibleText('\u3164\u3164')).toBe('');
		expect(visibleText('\u2800')).toBe('');
		expect(visibleText('\uFE0F')).toBe('');
		expect(visibleText(null)).toBe('');
		expect(visibleText(42)).toBe('');
	});

	it('keeps real text, right-to-left scripts and emoji presentation selectors', () => {
		expect(visibleText('  ngit  ')).toBe('ngit');
		expect(visibleText('\u05D2\u05D9\u05D8')).toBe('\u05D2\u05D9\u05D8'); // Hebrew letters
		expect(visibleText('love \u2764\uFE0F')).toBe('love \u2764\uFE0F'); // U+FE0F is Mn, not Cf
	});

	it('labelText says so rather than rendering blank', () => {
		expect(labelText('relay.ngit.dev')).toBe('relay.ngit.dev');
		expect(labelText('\u200B')).toBe(NO_VISIBLE_TEXT);
		expect(labelText(undefined)).toBe(NO_VISIBLE_TEXT);
	});
});

describe('repoLabel', () => {
	it('prefers the name, falls back to d, and never renders blank', () => {
		expect(repoLabel({ name: 'ngit', d: 'ngit-id' })).toBe('ngit');
		expect(repoLabel({ name: '   ', d: 'ngit-id' })).toBe('ngit-id');
		expect(repoLabel({ name: null, d: 'x' })).toBe('x');
		expect(repoLabel({ name: '', d: '' })).toBe('(no identifier)');
	});

	it('falls back to d when the name is only invisible characters, and cleans both', () => {
		expect(repoLabel({ name: '\u200B\u200B', d: 'visible-id' })).toBe('visible-id');
		expect(repoLabel({ name: '\u202Egnp.tpircs', d: 'x' })).toBe('gnp.tpircs');
		expect(repoLabel({ name: '', d: '\u202Eevil' })).toBe('evil');
		expect(repoLabel({ name: '\u200B', d: '\u200B' })).toBe(NO_VISIBLE_TEXT);
	});
});

describe('personLabel', () => {
	const PK = 'b'.repeat(64);

	it('shows the display name, cleaned, else the short npub', () => {
		expect(personLabel('Dan the maintainer', PK)).toBe('Dan the maintainer');
		expect(personLabel('\u202ESatoshi', PK)).toBe('Satoshi');
		expect(personLabel('\u200B\u200B', PK)).toBe(shortNpub(PK));
		expect(personLabel(null, PK)).toBe(shortNpub(PK));
		expect(personLabel(undefined, PK)).toBe(shortNpub(PK));
	});
});

describe('top-N captions', () => {
	const SERVERS = ['server', 'servers'] as const;

	it('states the cut from the total the document carries', () => {
		expect(cutOf(20, 64, SERVERS)).toBe('the top 20 of 64 servers');
		expect(cutOf(20, 1310, ['maintainer', 'maintainers'])).toBe('the top 20 of 1,310 maintainers');
		expect(cutOf(1, 64, SERVERS)).toBe('the top 1 of 64 servers');
		expect(cutOf(12, 12, SERVERS)).toBe('all 12 servers');
		expect(cutOf(10, 4, SERVERS)).toBe('all 4 servers'); // never "the top 10 of 4"
		expect(cutOf(1, 1, SERVERS)).toBe('the only server');
		expect(cutOf(0, 0, SERVERS)).toBe('no servers');
		expect(upperFirst(cutOf(20, 64, SERVERS))).toBe('The top 20 of 64 servers');
		expect(upperFirst(cutOf(12, 12, SERVERS))).toBe('All 12 servers');
		expect(upperFirst('')).toBe('');
	});

	it('says only "the top N" when the document does not carry the total', () => {
		expect(cutOf(25, null, ['topic', 'topics'])).toBe('the top 25 topics');
		expect(cutOf(25, undefined, ['topic', 'topics'])).toBe('the top 25 topics');
		expect(cutOf(1, null, ['host', 'hosts'])).toBe('the top host');
		expect(cutOf(0, null, ['host', 'hosts'])).toBe('no hosts');
	});

	it('says a sort reorders the rows shown only, unless every row is shown', () => {
		expect(sortNote(20, 64)).toBe('Sorting reorders these 20 only.');
		expect(sortNote(25)).toBe('Sorting reorders these 25 only.');
		expect(sortNote(12, 12)).toBe('');
		expect(sortNote(1)).toBe(''); // one row has no order to change
	});
});

describe('labels', () => {
	it('falls back to the raw key for a class the page does not know yet', () => {
		expect(labelFor(HOSTING_CLASS_LABEL, 'grasp_only')).toBe('GRASP only');
		expect(labelFor(HOSTING_CLASS_LABEL, 'brand_new_class')).toBe('brand_new_class');
		// not fooled by inherited properties
		expect(labelFor(HOSTING_CLASS_LABEL, 'toString')).toBe('toString');
	});

	it('defines every hosting class it labels', () => {
		expect(Object.keys(HOSTING_CLASS_DEF).sort()).toEqual(Object.keys(HOSTING_CLASS_LABEL).sort());
		// the kinds of host of New repositories per week, in the operator's words: not the
		// exclusive classes, so hashtree and Self-hosted carry no "no GRASP"
		expect(HOST_KIND_LABEL).toEqual({
			grasp: 'GRASP',
			hashtree: 'hashtree',
			self_hosted: 'Self-hosted',
			forge: 'Forges',
			none: 'No public host'
		});
		// keyed in the order the page draws the kinds (toEqual above is blind to key order)
		expect(Object.keys(HOST_KIND_LABEL)).toEqual([...HOST_KIND_ORDER]);
		expect(labelFor(HOST_KIND_LABEL, 'brand_new_kind')).toBe('brand_new_kind');
	});

	it("orders the kinds of host as the operator does: GRASP, hashtree, Self-hosted, Forge, then the kind that is not public", () => {
		// 2026-10-12, for Clone hosts' key and New repositories per week's bars and key
		expect(HOST_KIND_ORDER).toEqual(['grasp', 'hashtree', 'self_hosted', 'forge', 'none']);
		expect(HOST_KIND_ORDER.map((k) => HOST_KIND_LABEL[k])).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forges', 'No public host']);
		expect(HOST_KIND_ORDER.map((k) => CLONE_HOST_KIND_LABEL[k])).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forge', 'Not public']);
		// every kind the page words, each once
		expect([...HOST_KIND_ORDER].sort()).toEqual(Object.keys(HOST_KIND_LABEL).sort());
	});

	it("puts the document's kinds of host in the page's order, each once, a kind it does not know yet after them", () => {
		// the document's own order (by_host, host_kinds) is grasp, hashtree, forge, self_hosted
		expect(hostKindsInOrder(['grasp', 'hashtree', 'forge', 'self_hosted', 'none'])).toEqual([...HOST_KIND_ORDER]);
		expect(hostKindsInOrder(['none', 'forge', 'self_hosted', 'hashtree', 'grasp'])).toEqual([...HOST_KIND_ORDER]);
		expect(hostKindsInOrder(['forge', 'self_hosted'])).toEqual(['self_hosted', 'forge']);
		// a kind named twice is drawn once
		expect(hostKindsInOrder(['forge', 'grasp', 'forge', 'grasp'])).toEqual(['grasp', 'forge']);
		// unknown kinds go last, in the order given; property names are no kinds
		expect(hostKindsInOrder(['zeta', 'forge', 'alpha', 'grasp'])).toEqual(['grasp', 'forge', 'zeta', 'alpha']);
		expect(hostKindsInOrder(['toString', 'none', '__proto__', 'hashtree'])).toEqual(['hashtree', 'none', 'toString', '__proto__']);
		expect(hostKindsInOrder([])).toEqual([]);
		// the input is left as it was
		const given = ['forge', 'grasp'];
		hostKindsInOrder(given);
		expect(given).toEqual(['forge', 'grasp']);
	});

	it("gives each clone host's class its kind of host: a public class is its own, the two that are not public are none", () => {
		// every host class of reference 4.2, in its precedence order
		expect(HOST_CLASS_KIND).toEqual({
			hashtree: 'hashtree',
			private: 'none',
			grasp: 'grasp',
			forge: 'forge',
			non_network: 'none',
			self_hosted: 'self_hosted'
		});
		expect(Object.keys(HOST_CLASS_KIND)).toEqual(['hashtree', 'private', 'grasp', 'forge', 'non_network', 'self_hosted']);
		// every kind it names is one New repositories per week words, and every such kind is named
		expect([...new Set(Object.values(HOST_CLASS_KIND))].sort()).toEqual(Object.keys(HOST_KIND_LABEL).sort());
		expect(hostClassKind('private')).toBe('none');
		expect(hostClassKind('non_network')).toBe('none');
		expect(hostClassKind('grasp')).toBe('grasp');
		// a class the page does not know yet is its own kind, which labelFor words as the key
		expect(hostClassKind('brand_new_class')).toBe('brand_new_class');
		expect(labelFor(HOST_KIND_LABEL, hostClassKind('brand_new_class'))).toBe('brand_new_class');
		// not fooled by inherited properties
		expect(hostClassKind('toString')).toBe('toString');
		expect(hostClassKind('__proto__')).toBe('__proto__');
	});

	it("words Clone hosts' kinds as hosts: singular, and the kind that is not public as Not public", () => {
		// one host per bar; "No public host" is New repositories per week's repository with no
		// public clone URL, so it is not this list's word
		expect(CLONE_HOST_KIND_LABEL).toEqual({
			grasp: 'GRASP',
			hashtree: 'hashtree',
			self_hosted: 'Self-hosted',
			forge: 'Forge',
			none: 'Not public'
		});
		// the same kinds as the per-week chart's words, keyed in the same order, the page's
		expect(Object.keys(CLONE_HOST_KIND_LABEL)).toEqual(Object.keys(HOST_KIND_LABEL));
		expect(Object.keys(CLONE_HOST_KIND_LABEL)).toEqual([...HOST_KIND_ORDER]);
		expect(labelFor(CLONE_HOST_KIND_LABEL, hostClassKind('private'))).toBe('Not public');
		expect(labelFor(CLONE_HOST_KIND_LABEL, hostClassKind('non_network'))).toBe('Not public');
		expect(labelFor(CLONE_HOST_KIND_LABEL, hostClassKind('brand_new_class'))).toBe('brand_new_class');
	});

	it("names a hashtree host by its owner's short npub after htree://, the whole npub on hover", () => {
		// the operator's choice, 2026-10-11, in the operator's words: "Seeing pyramid.fiatjaf.com
		// and git.jb55.com in the list makes me lean towards htree://npub1xdhn...eycm in this case"
		expect(
			cloneHostLabel({ host: 'npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm', cls: 'hashtree' })
		).toBe('htree://npub1xdhn...eycm');
		const NPUB = 'npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasxw04hu'; // 'bb' x 32
		const tree = { host: NPUB, cls: 'hashtree' };
		expect(cloneHostLabel(tree)).toBe('htree://npub1hwam...04hu');
		expect(cloneHostLabel(tree)).toBe(`htree://${shortNpub('b'.repeat(64))}`);
		expect(cloneHostTitle(tree)).toBe(`htree://${NPUB}`);
		// cleaned first, like any document text: a bidi override inside the key is dropped, from
		// the label and from its hover title
		const tainted = { host: `npub1hwam\u202E${NPUB.slice(9)}`, cls: 'hashtree' };
		expect(cloneHostLabel(tainted)).toBe('htree://npub1hwam...04hu');
		expect(cloneHostTitle(tainted)).toBe(`htree://${NPUB}`);
		expect(cloneHostLabel({ host: '\u200B', cls: 'hashtree' })).toBe(NO_VISIBLE_TEXT);
		expect(cloneHostTitle({ host: '\u200B', cls: 'hashtree' })).toBe(NO_VISIBLE_TEXT);
	});

	it('leaves every other host as its cleaned text, with no htree:// it never had', () => {
		const NPUB = 'npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasxw04hu';
		const plain = (host: string, cls: string) => {
			expect(cloneHostLabel({ host, cls }), `${cls} ${host}`).toBe(host);
			expect(cloneHostTitle({ host, cls }), `${cls} ${host}`).toBe(host);
		};
		// a hashtree-class host that is no valid npub of a 32-byte key: a broken checksum, a name,
		// an npub of no bytes (nostr-tools decodes it), other bech32 types, and a domain - the
		// pipeline classes a host by the first class over all its URLs, hashtree first
		plain(`${NPUB.slice(0, -1)}q`, 'hashtree');
		plain('self', 'hashtree');
		plain('npub106246s', 'hashtree');
		plain('note1mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwse4wxcy', 'hashtree');
		plain('nprofile1qqsthwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwc8t0qgd', 'hashtree');
		plain('relay.ngit.dev', 'hashtree');
		// an npub string in another class is no hashtree tree, and other hosts are as they are
		plain(NPUB, 'non_network');
		plain(NPUB, 'brand_new_class');
		plain('relay.ngit.dev', 'grasp');
	});

	it('words every ledger key of the reference, codes first for the announcement rules', () => {
		expect(Object.keys(LEDGER_LABEL)).toEqual([
			'N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8a', 'N8b', 'N9', 'N10',
			'state_republish_loop', 'orphan_states', 'daily_cap', 'ephemeral', 'imported', 'mirrored'
		]);
		expect(labelFor(LEDGER_LABEL, 'N0')).toBe('N0 Malformed identifier');
		// dataset reference 2.2: N8b reads reachability (2026-09-26), not the bare absence of a URL
		expect(labelFor(LEDGER_LABEL, 'N8b')).toBe('N8b No public clone URL and no state');
		expect(labelFor(LEDGER_LABEL, 'N9')).toBe('N9 Stateless personal forks');
		expect(labelFor(LEDGER_LABEL, 'daily_cap')).toBe('Pushes above the daily cap');
		// dataset reference 2.2: N10, the nostr.net catalog key (2026-10-12)
		expect(labelFor(LEDGER_LABEL, 'N10')).toBe("N10 Catalog of other people's projects");
		// a key the page does not know yet reads as itself, never as nothing
		expect(labelFor(LEDGER_LABEL, 'N11')).toBe('N11');
	});

	it('speaks each ledger unit in the singular for one', () => {
		expect(unitFor('pushes', 1)).toBe('push');
		expect(unitFor('pushes', 2)).toBe('pushes');
		expect(unitFor('state coordinates', 1)).toBe('state coordinate');
		expect(unitFor('announcements', 0)).toBe('announcements');
		expect(unitFor('furlongs', 1)).toBe('furlongs');
	});
});
