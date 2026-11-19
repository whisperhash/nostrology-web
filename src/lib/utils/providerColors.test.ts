// @vitest-environment node
//
// Unit tests for getProviderColor — the stable per-provider color map used
// by the /lightning trend charts. Critical property: same domain → same
// color across reloads, sessions, and charts.

import { describe, expect, it } from 'vitest';
import {
	getProviderColor,
	_providerColorPalette,
	_providerColorOther,
} from './providerColors';

describe('getProviderColor', () => {
	it("returns the muted-grey 'other' color for the 'other' bucket", () => {
		expect(getProviderColor('other')).toBe(_providerColorOther);
	});

	it("'other' color is NOT in the regular palette (avoids accidental collisions)", () => {
		expect(_providerColorPalette).not.toContain(_providerColorOther);
	});

	it('returns hand-pinned colors for the well-known top providers', () => {
		// Pin invariants: top-3 providers get the first 3 palette entries.
		// If the mapping's rank order shifts and the pin changes, this test
		// should be updated alongside it — that's the trip wire.
		expect(getProviderColor('primal.net')).toBe(_providerColorPalette[0]);
		expect(getProviderColor('walletofsatoshi.com')).toBe(_providerColorPalette[1]);
		expect(getProviderColor('getalby.com')).toBe(_providerColorPalette[2]);
	});

	it('is deterministic — same domain always returns same color', () => {
		const c1 = getProviderColor('newcomer.example');
		const c2 = getProviderColor('newcomer.example');
		const c3 = getProviderColor('newcomer.example');
		expect(c1).toBe(c2);
		expect(c2).toBe(c3);
	});

	it('returns a palette entry (not "other") for unknown domains', () => {
		const c = getProviderColor('completely-novel.example');
		expect(_providerColorPalette).toContain(c);
		expect(c).not.toBe(_providerColorOther);
	});

	it('case-folds domains so PRIMAL.NET and primal.net hash to the same bucket if unpinned', () => {
		// Both pin'd domains test: 'primal.net' is hand-pinned — the
		// PINNED lookup is case-sensitive on purpose (canonical lud16
		// is lowercase), so 'PRIMAL.NET' falls through to the hash.
		// Verify the hash itself is case-insensitive so an accidentally
		// uppercase domain doesn't get a different color from another
		// caller's lowercase.
		const a = getProviderColor('newdomain.example');
		const b = getProviderColor('NEWDOMAIN.example');
		const c = getProviderColor('NewDomain.Example');
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('every palette entry is a 7-char hex color (#RRGGBB)', () => {
		for (const c of _providerColorPalette) {
			expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
		expect(_providerColorOther).toMatch(/^#[0-9a-fA-F]{6}$/);
	});

	it("multiple unknown domains spread across the palette (no all-collide-on-one bug)", () => {
		const colors = new Set<string>();
		for (let i = 0; i < 50; i += 1) {
			colors.add(getProviderColor(`hashtest${i}.example`));
		}
		// 50 random-ish strings into a 17-color palette: we should hit at
		// least 8 distinct colors (very loose bound — birthday paradox
		// would predict ~14 typical, ~10 worst-case). Catches the "all
		// strings hash to the same index" bug class.
		expect(colors.size).toBeGreaterThan(8);
	});
});
