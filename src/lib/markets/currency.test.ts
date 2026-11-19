import { describe, expect, it } from 'vitest';

import { BTC_UNITS, isBitcoinUnit } from './currency';

describe('isBitcoinUnit', () => {
	it('holds exactly the pipeline\'s BTC_UNITS, word for word', () => {
		// nostrology-data's dagster_code/pipeline/marketplaces.py. A literal, on purpose: this is
		// the copy that a change to that set has to reach, and no test can read across the
		// repositories, so what this pins is that the copy is whole AND adds nothing. A unit added
		// here alone would paint rows the Priced in bitcoin card does not count.
		const pipeline = ['btc', 'sats', 'sat', 'msat', 'msats', 'satoshi', 'satoshis', 'bitcoin', 'xbt', 'sat(s)'];
		expect([...BTC_UNITS].sort()).toEqual([...pipeline].sort());
		for (const unit of pipeline) {
			expect(isBitcoinUnit(unit), unit).toBe(true);
		}
	});

	it('takes every spelling the live pool carried on 2026-11-04', () => {
		// These nine spellings summed to 3,219, the listings the snapshot counts as bitcoin.
		for (const unit of ['SATS', 'SAT', 'sats', 'sat', 'BTC', 'msat', 'btc', 'Sats', 'msats']) {
			expect(isBitcoinUnit(unit), unit).toBe(true);
		}
	});

	it('says no to money that is not bitcoin, and to test money that only sounds like it', () => {
		// TESTSAT is what the first rows of the live table quoted on 2026-11-04: the pipeline counts
		// it under "Other", so drawing it orange would claim a row the Priced in bitcoin card does not
		// count.
		for (const unit of ['TESTSAT', 'testsat', 'USD', 'EUR', 'USDC', 'USDT', 'GBP', 'sat s', 'bits', 'lightning', 'ecash']) {
			expect(isBitcoinUnit(unit), unit).toBe(false);
		}
	});

	it('folds a unit the way the pipeline does', () => {
		// Each of these comes out of markets_geolib.norm as a member of BTC_UNITS, so the snapshot
		// counts it: full-width letters, a zero-width space and a soft hyphen inside the word, an
		// accent on a letter or on nothing, surrounding space of every kind, and the four separators
		// only Python calls whitespace.
		for (const unit of ['\uff33\uff21\uff34', 's\u200bats', 'sa\u00adts', '  SATS\t', '\u00a0sat\u00a0', '\x1csats\x1f', '\nBTC\n', 's\u00e1ts', 's\u0301ats']) {
			expect(isBitcoinUnit(unit), JSON.stringify(unit)).toBe(true);
		}
		// and the same fold leaves these out of the set: an inner space survives it as one space,
		// a control character that is not whitespace stays, and nothing is left of a blank unit.
		for (const unit of ['s ats', 'sa\x01ts', '', '   ', '\u200b']) {
			expect(isBitcoinUnit(unit), JSON.stringify(unit)).toBe(false);
		}
	});

	it('answers false rather than throwing for a tag element that is not a string', () => {
		// The tag is a stranger's, and a throw while the server renders is a 500 (internal server
		// error) for the whole page.
		for (const unit of [undefined, null, 21, true, ['sat'], { unit: 'sat' }]) {
			expect(isBitcoinUnit(unit)).toBe(false);
		}
	});
});
