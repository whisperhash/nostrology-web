// @vitest-environment node
// What login reads from the environment. The rules here decide whether login exists at all
// and whether a weak key can be used, so each has its own case.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_COOKIE_NAME,
	MAX_SKEW_SECONDS,
	MIN_SESSION_SECRET_CHARS,
	REPLAY_WINDOW_MS,
	cookieName,
	loginConfig,
	sessionSecret,
	siteOrigin
} from './config';

const GOOD_SECRET = 'x'.repeat(MIN_SESSION_SECRET_CHARS);

describe('sessionSecret', () => {
	it('returns a secret of the minimum length', () => {
		expect(sessionSecret({ AUTH_SESSION_SECRET: GOOD_SECRET })).toBe(GOOD_SECRET);
	});

	it('treats a secret one character short as no secret at all', () => {
		// Whoever can guess the key can forge any session, the operator's included. A short
		// one is refused rather than used, here and in the hook alike.
		expect(sessionSecret({ AUTH_SESSION_SECRET: GOOD_SECRET.slice(1) })).toBeUndefined();
	});

	it.each([undefined, ''])('treats %j as unset', (value) => {
		expect(sessionSecret({ AUTH_SESSION_SECRET: value })).toBeUndefined();
	});

	it('is at least 32 characters, the floor the deployment is generated above', () => {
		expect(MIN_SESSION_SECRET_CHARS).toBeGreaterThanOrEqual(32);
	});
});

describe('siteOrigin', () => {
	it('keeps scheme, host and port, and drops a path or a trailing slash', () => {
		expect(siteOrigin({ ORIGIN: 'https://nostrolo.gy/' })).toBe('https://nostrolo.gy');
		expect(siteOrigin({ ORIGIN: 'https://nostrolo.gy/some/path' })).toBe('https://nostrolo.gy');
		expect(siteOrigin({ ORIGIN: 'http://localhost:5173' })).toBe('http://localhost:5173');
	});

	it.each([undefined, '', 'not a url', 'ftp://nostrolo.gy', 'javascript:alert(1)'])(
		'refuses %j',
		(value) => {
			expect(siteOrigin({ ORIGIN: value })).toBeUndefined();
		}
	);
});

describe('cookieName', () => {
	it('defaults to the __Host- name, and takes a configured one that keeps the prefix', () => {
		expect(cookieName({})).toBe(DEFAULT_COOKIE_NAME);
		expect(DEFAULT_COOKIE_NAME.startsWith('__Host-')).toBe(true);
		expect(cookieName({ AUTH_COOKIE_NAME: '__Host-other_session' })).toBe('__Host-other_session');
		expect(cookieName({ AUTH_COOKIE_NAME: '' })).toBe(DEFAULT_COOKIE_NAME);
	});

	it.each(['other', '__Secure-other', 'x__Host-other', '__Host-', '__Host-a;b'])(
		'refuses %j, which would let a sibling subdomain plant or overwrite the session',
		(name) => {
			expect(cookieName({ AUTH_COOKIE_NAME: name })).toBe(DEFAULT_COOKIE_NAME);
		}
	);
});

describe('REPLAY_WINDOW_MS', () => {
	it('outlasts every token a captured request could still carry: twice the skew, and more', () => {
		// A token dated up to the skew ahead is accepted until the skew behind: from the claim,
		// that is twice the skew. A spent nonce forgotten sooner can be replayed.
		expect(REPLAY_WINDOW_MS).toBeGreaterThan(2 * MAX_SKEW_SECONDS * 1000);
	});
});

describe('loginConfig', () => {
	it('is complete when both settings are usable', () => {
		expect(
			loginConfig({ ORIGIN: 'https://nostrolo.gy', AUTH_SESSION_SECRET: GOOD_SECRET })
		).toEqual({ origin: 'https://nostrolo.gy', secret: GOOD_SECRET, cookieName: DEFAULT_COOKIE_NAME });
	});

	it.each([
		['no ORIGIN', { AUTH_SESSION_SECRET: GOOD_SECRET }],
		['no secret', { ORIGIN: 'https://nostrolo.gy' }],
		['a short secret', { ORIGIN: 'https://nostrolo.gy', AUTH_SESSION_SECRET: 'short' }]
	])('is null with %s', (_l, env) => {
		expect(loginConfig(env)).toBeNull();
	});
});
