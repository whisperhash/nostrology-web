import { describe, expect, it } from 'vitest';

import { gitworkshopUrl, irisGitUrl, njumpUrl, npubOf, repoUrl } from './links';

// A published, well-known key/npub pair (jb55), so the encoding is checked against the
// outside world rather than against nostr-tools' own round trip.
const HEX = '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245';
const NPUB = 'npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s';

describe('npubOf', () => {
	it('encodes a 64-hex pubkey, either case', () => {
		expect(npubOf(HEX)).toBe(NPUB);
		expect(npubOf(HEX.toUpperCase())).toBe(NPUB);
	});

	it.each([
		['too short', HEX.slice(1)],
		['too long', HEX + '0'],
		// Even lengths too: nip19 rejects the odd ones (63, 65) on its own, but a 62- or
		// 66-character hex encodes to a bogus npub, and the 66-character one shares the real
		// npub's prefix - only the 64-hex check stands between it and a link.
		['one byte short (62, even)', HEX.slice(2)],
		['one byte long (66, even)', HEX + '00'],
		['not hex', 'z'.repeat(64)],
		['an npub already', NPUB],
		['empty', ''],
		['null', null],
		['a number', 42]
	])('refuses %s', (_why, v) => {
		expect(npubOf(v)).toBeNull();
	});
});

describe('gitworkshopUrl', () => {
	it('addresses the repository by npub and percent-encoded identifier', () => {
		expect(gitworkshopUrl(HEX, 'ngit')).toBe(`https://gitworkshop.dev/${NPUB}/ngit`);
	});

	it('encodes identifiers that would otherwise change the path or start a query', () => {
		expect(gitworkshopUrl(HEX, 'a/b c?d#e&f')).toBe(
			`https://gitworkshop.dev/${NPUB}/a%2Fb%20c%3Fd%23e%26f`
		);
	});

	it('links the author page for the legal empty identifier', () => {
		expect(gitworkshopUrl(HEX, '')).toBe(`https://gitworkshop.dev/${NPUB}`);
	});

	it('gives no link at all for a malformed pubkey', () => {
		expect(gitworkshopUrl('not-a-key', 'ngit')).toBeNull();
		expect(gitworkshopUrl(HEX.slice(2), 'ngit')).toBeNull();
		expect(gitworkshopUrl(HEX + '00', 'ngit')).toBeNull();
	});
});

// hashtree's own repository (pubkey 336f3197..., d `hashtree`), linked exactly so from its
// README: the URL scheme is checked against the outside world, not against irisGitUrl itself.
const HT_HEX = '336f319763657d6b0e65a5b5876719e8c8dcdcf9396852be71ee26b73368b29b';
const HT_PAGE = 'https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/hashtree';

describe('irisGitUrl', () => {
	it('builds the address hashtree itself publishes', () => {
		expect(irisGitUrl(HT_HEX, 'hashtree')).toBe(HT_PAGE);
	});

	it('percent-encodes the identifier as one tree name (a slash stays %2F)', () => {
		expect(irisGitUrl(HEX, 'a/b c?d#e&f')).toBe(`https://git.iris.to/#/${NPUB}/a%2Fb%20c%3Fd%23e%26f`);
	});

	it('links the author page for the legal empty identifier', () => {
		expect(irisGitUrl(HEX, '')).toBe(`https://git.iris.to/#/${NPUB}`);
	});

	it('gives no link at all for a malformed pubkey', () => {
		expect(irisGitUrl('not-a-key', 'ngit')).toBeNull();
		expect(irisGitUrl(HEX.slice(2), 'ngit')).toBeNull();
		expect(irisGitUrl(HEX + '00', 'ngit')).toBeNull();
	});
});

describe('repoUrl', () => {
	it('opens a hashtree-class repository on git.iris.to', () => {
		expect(repoUrl(HT_HEX, 'hashtree', 'hashtree')).toBe(HT_PAGE);
	});

	it.each(['grasp_only', 'grasp_mixed', 'forge_only', 'other_hosts', 'none'])(
		'opens a %s repository on gitworkshop.dev',
		(cls) => {
			expect(repoUrl(HEX, 'ngit', cls)).toBe(gitworkshopUrl(HEX, 'ngit'));
		}
	);

	it.each([
		['no class (a leaderboard row before 2026-10-09)', undefined],
		['null', null],
		['an unknown class', 'hashtree2'],
		['another letter case', 'Hashtree']
	])('opens gitworkshop.dev for %s', (_why, cls) => {
		expect(repoUrl(HEX, 'ngit', cls)).toBe(gitworkshopUrl(HEX, 'ngit'));
	});

	it('gives no link for a malformed pubkey, whichever the viewer', () => {
		expect(repoUrl('abc', 'ngit', 'hashtree')).toBeNull();
		expect(repoUrl('abc', 'ngit', 'grasp_only')).toBeNull();
	});
});

describe('njumpUrl', () => {
	it('links the profile by npub', () => {
		expect(njumpUrl(HEX)).toBe(`https://njump.me/${NPUB}`);
	});

	it('gives no link for a malformed pubkey', () => {
		expect(njumpUrl('abc')).toBeNull();
		expect(njumpUrl(HEX.slice(2))).toBeNull();
		expect(njumpUrl(HEX + '00')).toBeNull();
	});
});
