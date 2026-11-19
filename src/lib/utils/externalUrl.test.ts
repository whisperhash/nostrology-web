// @vitest-environment node
//
// Unit tests for sanitizeExternalUrl, the guard that turns a URL a third party
// chose (a Zapstore catalog or release tag, a bunker's approval page) into a safe
// href (or null). The cases below mirror the dirty values actually observed in
// the dev catalog sweep (scheme-less hosts, bech32 "naddr1..." junk) plus the
// standard set of href-injection vectors. Critical property: every value that
// reaches an href is a validated, canonical http(s) URL, never raw input. The
// Zapstore readers' use of it is pinned in $lib/db/zapstore-links.test.ts, and
// login's in $lib/auth/session.test.ts.

import { describe, expect, it } from 'vitest';
import { sanitizeExternalUrl } from './externalUrl';

describe('sanitizeExternalUrl', () => {
	describe('valid links pass through (canonicalized)', () => {
		it('keeps an absolute https URL with a path verbatim', () => {
			expect(sanitizeExternalUrl('https://github.com/YakiHonne/mobile-app')).toBe(
				'https://github.com/YakiHonne/mobile-app'
			);
		});

		it('keeps http (not just https)', () => {
			expect(sanitizeExternalUrl('http://example.com')).toBe('http://example.com/');
		});

		it('preserves port, path, query and fragment', () => {
			expect(sanitizeExternalUrl('https://host.com:8443/a/b?x=1#frag')).toBe(
				'https://host.com:8443/a/b?x=1#frag'
			);
		});

		it('trims surrounding whitespace', () => {
			expect(sanitizeExternalUrl('  https://x.com/a  ')).toBe('https://x.com/a');
		});

		it('lowercases the scheme and host but preserves path case', () => {
			expect(sanitizeExternalUrl('HTTPS://YakiHonne.COM/Path')).toBe('https://yakihonne.com/Path');
		});
	});

	describe('scheme-less but domain-like values are coerced to https (real catalog data)', () => {
		it('prefixes https:// for a bare host', () => {
			expect(sanitizeExternalUrl('www.cgeo.org')).toBe('https://www.cgeo.org/');
		});

		it('prefixes https:// and keeps the path for a host/path value', () => {
			expect(sanitizeExternalUrl('github.com/Lobanokivan11/NewBlackbox')).toBe(
				'https://github.com/Lobanokivan11/NewBlackbox'
			);
		});

		it('prefixes https:// for a short TLD host', () => {
			expect(sanitizeExternalUrl('stablekraft.app')).toBe('https://stablekraft.app/');
		});

		it('coerces a host:port value', () => {
			expect(sanitizeExternalUrl('example.com:8080/p')).toBe('https://example.com:8080/p');
		});
	});

	describe('dangerous schemes are rejected (allowlist, not denylist)', () => {
		for (const evil of [
			'javascript:alert(1)',
			' javascript:alert(1)',
			'JavaScript:alert(1)',
			'java\tscript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'ftp://host.com/file',
			'mailto:a@b.com',
			'file:///etc/passwd'
		]) {
			it(`rejects ${JSON.stringify(evil)}`, () => {
				expect(sanitizeExternalUrl(evil)).toBeNull();
			});
		}

		it('rejects a protocol-relative URL (//evil.com)', () => {
			expect(sanitizeExternalUrl('//evil.com')).toBeNull();
		});
	});

	describe('host-spoofing via embedded credentials is rejected', () => {
		it('rejects https://github.com@evil.com', () => {
			expect(sanitizeExternalUrl('https://github.com@evil.com')).toBeNull();
		});

		it('rejects user:pass credentials', () => {
			expect(sanitizeExternalUrl('https://user:pass@host.com')).toBeNull();
		});

		it('rejects scheme-less credentials', () => {
			expect(sanitizeExternalUrl('user@evil.com')).toBeNull();
		});
	});

	describe('control characters cannot create a validate-one/emit-another gap', () => {
		// The WHATWG URL parser strips TAB/LF/CR. We must emit the PARSED url so the
		// stripped form (what we validated) is exactly what reaches the href — here
		// the embedded chars collapse to a benign google.com link, never evil.com.
		it('strips embedded TAB/LF and emits the canonical parsed URL', () => {
			expect(sanitizeExternalUrl('http://goo\tgle.com/\n@evil.com')).toBe(
				'http://google.com/@evil.com'
			);
		});

		it('never returns a string containing raw control characters', () => {
			const out = sanitizeExternalUrl('https://exa\tmp\nle.com/pa\rth');
			expect(out).not.toBeNull();
			expect(out).not.toMatch(/[\t\n\r]/);
		});
	});

	describe('junk and empty values return null', () => {
		for (const junk of [
			'naddr1qq8x7arnw45hgefdd4hky6tvv5q3gamnw', // bech32 stored in the field (no dot)
			'localhost', // single-label host — not a public site
			'localhost:3000',
			'just some text',
			'https://', // scheme with no host
			'.',
			'..'
		]) {
			it(`rejects ${JSON.stringify(junk)}`, () => {
				expect(sanitizeExternalUrl(junk)).toBeNull();
			});
		}
	});

	describe('nullish / blank input returns null', () => {
		for (const blank of [null, undefined, '', '   ', '\t\n']) {
			it(`returns null for ${JSON.stringify(blank)}`, () => {
				expect(sanitizeExternalUrl(blank)).toBeNull();
			});
		}
	});

	describe('a host name holds only what a real host name can', () => {
		// The URL parser lets these through in a host. No real host has them, and a quote
		// is what would break out of an attribute in markup built as a string.
		for (const odd of [
			'github.com"onmouseover=alert(1)//x',
			'https://github.com"onmouseover=alert(1)//x',
			"https://git'hub.com/",
			'https://git`hub.com/',
			'https://git{hub}.com/',
			'https://*.example.com/'
		]) {
			it(`rejects ${JSON.stringify(odd)}`, () => {
				expect(sanitizeExternalUrl(odd)).toBeNull();
			});
		}

		it('keeps an international name in its xn-- form, an underscore, and IP addresses', () => {
			expect(sanitizeExternalUrl('https://b\u00fccher.example/')).toBe('https://xn--bcher-kva.example/');
			expect(sanitizeExternalUrl('https://under_score.example.com/')).toBe('https://under_score.example.com/');
			expect(sanitizeExternalUrl('http://192.0.2.1:8080/x')).toBe('http://192.0.2.1:8080/x');
			expect(sanitizeExternalUrl('http://[2001:db8::1]/')).toBe('http://[2001:db8::1]/');
		});
	});

	describe('a value that is not a string returns null', () => {
		// A signer's message is JSON, so its auth_url can arrive as any JSON value.
		for (const odd of [42, 0, true, {}, [], ['https://x.com'], { href: 'https://x.com' }]) {
			it(`returns null for ${JSON.stringify(odd)}`, () => {
				expect(sanitizeExternalUrl(odd)).toBeNull();
			});
		}
	});

	it('never throws — always returns string | null', () => {
		const inputs = [null, undefined, '', 'x', 'http://[::1]', '%%%', 'http://', '://nope'];
		for (const i of inputs) {
			const out = sanitizeExternalUrl(i as string);
			expect(out === null || typeof out === 'string').toBe(true);
		}
	});
});
