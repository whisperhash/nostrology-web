import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_RELAY_MIN_USERS,
	RELAY_MIN_USERS_FLOOR,
	RELAY_MIN_USERS_THRESHOLDS,
	restoreRelayMinUsers
} from './relayThresholds';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAYS_PAGE = resolve(HERE, '../../routes/(app)/relays/+page.svelte');

/**
 * The floor is a memory-safety constraint, not a taste call: /relays renders one
 * <tr> per matching relay with no virtualization, and the 1+/10+ tiers measured
 * 375k/81k DOM nodes — enough to get the iOS Safari WebContent process killed,
 * repeatedly, because the choice is persisted in localStorage.
 */
describe('relay minUsers thresholds', () => {
	it('offers no tier below the memory-safety floor', () => {
		const belowFloor = RELAY_MIN_USERS_THRESHOLDS.filter(
			(t) => Number(t.value) < RELAY_MIN_USERS_FLOOR
		);
		expect(belowFloor).toEqual([]);
	});

	it('exposes only finite, positive, strictly ascending tiers', () => {
		const values = RELAY_MIN_USERS_THRESHOLDS.map((t) => Number(t.value));
		expect(values.length).toBeGreaterThan(0);
		for (const v of values) {
			expect(Number.isFinite(v)).toBe(true);
			expect(v).toBeGreaterThan(0);
		}
		expect([...values].sort((a, b) => a - b)).toEqual(values);
	});

	it('keeps every tier labelled', () => {
		for (const t of RELAY_MIN_USERS_THRESHOLDS) {
			expect(t.label.trim()).not.toBe('');
		}
	});

	it('has a default that is itself a selectable tier', () => {
		expect(
			RELAY_MIN_USERS_THRESHOLDS.some((t) => t.value === String(DEFAULT_RELAY_MIN_USERS))
		).toBe(true);
		expect(DEFAULT_RELAY_MIN_USERS).toBeGreaterThanOrEqual(RELAY_MIN_USERS_FLOOR);
	});
});

describe('restoreRelayMinUsers', () => {
	it('restores a value that is still an offered tier', () => {
		for (const t of RELAY_MIN_USERS_THRESHOLDS) {
			expect(restoreRelayMinUsers(t.value)).toBe(Number(t.value));
		}
	});

	it('falls back to the default when nothing is stored', () => {
		expect(restoreRelayMinUsers(null)).toBe(DEFAULT_RELAY_MIN_USERS);
	});

	// The self-healing property: a phone that stored "1" before that tier was
	// removed would otherwise re-apply it on every reload and crash again.
	it('rejects a removed lethal tier and unsticks the browser', () => {
		expect(restoreRelayMinUsers('1')).toBe(DEFAULT_RELAY_MIN_USERS);
		expect(restoreRelayMinUsers('10')).toBe(DEFAULT_RELAY_MIN_USERS);
	});

	it('rejects junk, empty, and non-numeric values', () => {
		for (const junk of ['', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '{}', 'null']) {
			expect(restoreRelayMinUsers(junk)).toBe(DEFAULT_RELAY_MIN_USERS);
		}
	});

	it('rejects numbers that are not exactly an offered tier', () => {
		for (const off of ['0', '-1', '99', '101', '500', '999', '1000000']) {
			expect(restoreRelayMinUsers(off)).toBe(DEFAULT_RELAY_MIN_USERS);
		}
	});

	// Number('1000.0') === 1000, but String(1000) === '1000' matches a tier, so
	// these normalize rather than fall back. Pinning the behaviour so a future
	// refactor to strict string equality is a visible decision, not a silent one.
	it('normalizes numerically-equal spellings of an offered tier', () => {
		expect(restoreRelayMinUsers('1000.0')).toBe(1000);
		expect(restoreRelayMinUsers(' 1000 ')).toBe(1000);
		expect(restoreRelayMinUsers('1e3')).toBe(1000);
	});

	it('always returns a value that is itself selectable', () => {
		const inputs = [null, '', 'abc', '1', '10', '99', '100', '1000', '100000', '1e9'];
		for (const input of inputs) {
			const out = restoreRelayMinUsers(input);
			expect(RELAY_MIN_USERS_THRESHOLDS.some((t) => t.value === String(out))).toBe(true);
		}
	});
});

/**
 * The route must not reintroduce a local tier list that bypasses the floor —
 * the whole point of extracting this module is that the constraint lives in one
 * testable place.
 */
describe('/relays route wiring', () => {
	const source = readFileSync(RELAYS_PAGE, 'utf8');

	it('sources its thresholds from the shared module', () => {
		expect(source).toContain('RELAY_MIN_USERS_THRESHOLDS');
		expect(source).toContain('restoreRelayMinUsers');
	});

	it('declares no inline tier below the floor', () => {
		const inlineTiers = [...source.matchAll(/\{\s*value:\s*'(\d+)'\s*,\s*label:/g)].map((m) =>
			Number(m[1])
		);
		expect(inlineTiers.filter((v) => v < RELAY_MIN_USERS_FLOOR)).toEqual([]);
	});
});
