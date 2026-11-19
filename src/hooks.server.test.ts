// Request-hook tests: identity resolution and the page-view line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintSessionCookie } from '$lib/server/auth/cookie';
import { OPERATOR_PUBKEY } from '$lib/unreleased';

const SECRET = 'hooks-test-secret-at-least-32-characters';
const PK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab';
const VALID_COOKIE = mintSessionCookie(SECRET, { pubkey: PK, expiresAt: 4_000_000_000_000 });

const COOKIE_NAME = '__Host-nostrology_session';
const MARKER_NAME = '__Host-nozzl_op';
const MARKER = 'c'.repeat(64);
const dynamicEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: dynamicEnv }));

let logged: Record<string, unknown>[] = [];

beforeEach(() => {
	logged = [];
	vi.spyOn(console, 'log').mockImplementation((line: string) => {
		try {
			logged.push(JSON.parse(line));
		} catch {
			logged.push({ raw: line });
		}
	});
	for (const k of Object.keys(dynamicEnv)) delete dynamicEnv[k];
	dynamicEnv.AUTH_SESSION_SECRET = SECRET;
});

afterEach(() => vi.restoreAllMocks());

async function run(
	pathname: string,
	cookie?: string,
	status = 200,
	headers: Record<string, string> = {},
	/** Headers on the response `resolve` returns, i.e. what SvelteKit itself produced. */
	responseHeaders: Record<string, string> = {},
	/** Other cookies the request carries, by name (the session cookie is `cookie`). */
	otherCookies: Record<string, string> = {}
) {
	const { handle } = await import('./hooks.server');
	const url = new URL(`https://nostrolo.gy${pathname}`);
	const event = {
		url,
		request: new Request(url, { headers }),
		// Exact name, not a prefix: the previous version returned the cookie for ANY
		// `__Host-` name and so never proved the lookup matches at all.
		cookies: { get: (name: string) => (name === COOKIE_NAME ? cookie : otherCookies[name]) },
		locals: {} as App.Locals
	};
	const response = await handle({
		event: event as never,
		// 304 is a null-body status - the Response constructor throws if given one.
		resolve: async () =>
			new Response(status === 304 ? null : 'ok', { status, headers: responseHeaders })
	} as never);
	return { event, response };
}

/** A page response shaped like SvelteKit's: HTML plus the content-hash ETag it sets. */
const PAGE = { 'content-type': 'text/html', etag: '"abc123"' };

describe('identity resolution', () => {
	it('puts a verified session on locals', async () => {
		const { event } = await run('/zapstore', VALID_COOKIE);
		expect(event.locals.session).toEqual({ pubkey: PK });
	});

	it('treats a forged cookie exactly like no cookie', async () => {
		const forged = VALID_COOKIE.slice(0, -4) + 'AAAA';
		const { event } = await run('/zapstore', forged);
		expect(event.locals.session).toBeNull();
	});

	it('is null for an anonymous visitor', async () => {
		const { event } = await run('/zapstore');
		expect(event.locals.session).toBeNull();
	});

	it('is null - not a crash - when the secret is not configured', async () => {
		delete dynamicEnv.AUTH_SESSION_SECRET;
		const { event } = await run('/zapstore', VALID_COOKIE);
		expect(event.locals.session).toBeNull();
	});

	it('treats a secret under 32 characters as no secret: the session is null', async () => {
		// The same rule as the login endpoints ($lib/server/auth/config): a key short enough to
		// guess is refused, or a weakly configured site would accept forged operator sessions.
		dynamicEnv.AUTH_SESSION_SECRET = 'x'.repeat(31);
		const forged = mintSessionCookie('x'.repeat(31), { pubkey: PK, expiresAt: 4_000_000_000_000 });
		const { event } = await run('/zapstore', forged);
		expect(event.locals.session).toBeNull();
		expect(logged.some((l) => l.level === 'error' && String(l.msg).includes('not configured'))).toBe(
			true
		);
	});

	it('accepts a secret of exactly 32 characters', async () => {
		dynamicEnv.AUTH_SESSION_SECRET = 'y'.repeat(32);
		const cookie = mintSessionCookie('y'.repeat(32), { pubkey: PK, expiresAt: 4_000_000_000_000 });
		const { event } = await run('/zapstore', cookie);
		expect(event.locals.session).toEqual({ pubkey: PK });
	});

	it('reads the cookie under a configured name, and only that name', async () => {
		dynamicEnv.AUTH_COOKIE_NAME = '__Host-other_session';
		const { event } = await run('/zapstore', VALID_COOKIE);
		// run() offers the cookie under the default name only.
		expect(event.locals.session).toBeNull();
	});

	it('ignores a configured name without the __Host- prefix, and keeps the default', async () => {
		dynamicEnv.AUTH_COOKIE_NAME = 'other_session';
		const { event } = await run('/zapstore', VALID_COOKIE);
		expect(event.locals.session).toEqual({ pubkey: PK });
	});

	it('logs an ERROR when a cookie arrives but the secret is missing', async () => {
		// A deploy error that would otherwise present only as "login silently never
		// works" - the single most likely way this feature breaks on rollout.
		delete dynamicEnv.AUTH_SESSION_SECRET;
		await run('/zapstore', VALID_COOKIE);
		expect(logged.some((l) => l.level === 'error' && String(l.msg).includes('not configured'))).toBe(
			true
		);
	});

	it('does not log that error for an anonymous visitor', async () => {
		delete dynamicEnv.AUTH_SESSION_SECRET;
		await run('/zapstore');
		expect(logged.some((l) => l.level === 'error')).toBe(false);
	});
});

describe('page-view logging', () => {
	it('emits one line per page view, saying whether it was signed in', async () => {
		await run('/marketplaces', VALID_COOKIE);
		const view = logged.find((l) => l.msg === 'page view');
		expect(view).toMatchObject({
			path: '/marketplaces',
			logged_in: true,
			status: 200
		});
	});

	it('logs anonymous page views as not signed in', async () => {
		await run('/zapstore');
		expect(logged.find((l) => l.msg === 'page view')).toMatchObject({
			logged_in: false
		});
	});

	it('logs a fixed set of fields, and never the signed-in visitor\'s pubkey', async () => {
		await run('/marketplaces', VALID_COOKIE);
		const view = logged.find((l) => l.msg === 'page view');
		// Pinned, so that a new field - an npub, a prefix or a hash of the key - fails here
		// rather than reaching Loki.
		expect(Object.keys(view ?? {}).sort()).toEqual([
			'analytics_off',
			'level',
			'logged_in',
			'ms',
			'msg',
			'path',
			'status',
			'ts'
		]);
		expect(JSON.stringify(logged)).not.toContain(PK);
	});

	it('NEVER logs the cookie value', async () => {
		await run('/zapstore', VALID_COOKIE);
		expect(JSON.stringify(logged)).not.toContain(VALID_COOKIE);
	});

	it('does not log the query string', async () => {
		// A query string can carry a share token or a marketing identifier; the path is
		// what a page view needs.
		await run('/zapstore?secret=shh', VALID_COOKIE);
		const view = logged.find((l) => l.msg === 'page view');
		expect(view?.path).toBe('/zapstore');
		expect(JSON.stringify(logged)).not.toContain('shh');
	});

	it.each([
		['/_app/immutable/chunks/abc.js'],
		['/api/nutzaps'],
		['/api/auth/login'],
		['/favicon.ico'],
		['/nostr-logo.png'],
		['/robots.txt']
	])('does not treat %s as a page view', async (path) => {
		// Otherwise the handful of meaningful page views drown under hundreds of asset
		// fetches per navigation.
		await run(path, VALID_COOKIE);
		expect(logged.find((l) => l.msg === 'page view')).toBeUndefined();
	});

	it('records the response status, so an error page is visible in the log', async () => {
		await run('/nope', VALID_COOKIE, 404);
		expect(logged.find((l) => l.msg === 'page view')?.status).toBe(404);
	});

	it('emits one self-contained JSON object per line, for Loki | json', async () => {
		await run('/zapstore', VALID_COOKIE);
		const view = logged.find((l) => l.msg === 'page view')!;
		expect(typeof view.ts).toBe('string');
		expect(view.level).toBe('info');
		expect(typeof view.ms).toBe('number');
	});
});

describe('cookie name matching', () => {
	it('ignores a cookie under a different name', async () => {
		const { handle } = await import('./hooks.server');
		const event = {
			url: new URL('https://nostrolo.gy/zapstore'),
			request: new Request('https://nostrolo.gy/zapstore'),
			cookies: { get: (name: string) => (name === 'some-other-cookie' ? VALID_COOKIE : undefined) },
			locals: {} as App.Locals
		};
		await handle({
			event: event as never,
			resolve: async () => new Response('ok', { status: 200 })
		} as never);
		expect(event.locals.session).toBeNull();
	});
});

describe("analytics exclusion: the operator's session alone", () => {
	// Signed in as the operator, a page is served without Google Analytics; signed out, or
	// as anyone else, it is measured. Nothing a visitor sends can switch it off.
	const OPERATOR_COOKIE = mintSessionCookie(SECRET, {
		pubkey: OPERATOR_PUBKEY,
		expiresAt: 4_000_000_000_000
	});

	it("marks the operator's verified session", async () => {
		const { event } = await run('/zapstore', OPERATOR_COOKIE);
		expect(event.locals).toMatchObject({
			analyticsOff: true,
			session: { pubkey: OPERATOR_PUBKEY }
		});
	});

	it('leaves anyone else measured, signed in or not', async () => {
		expect((await run('/zapstore', VALID_COOKIE)).event.locals.analyticsOff).toBe(false);
		expect((await run('/zapstore')).event.locals.analyticsOff).toBe(false);
	});

	it("SECURITY: a cookie claiming the operator's pubkey without the key's HMAC is not the operator", async () => {
		const forged = mintSessionCookie('some-other-secret-at-least-32-characters', {
			pubkey: OPERATOR_PUBKEY,
			expiresAt: 4_000_000_000_000
		});
		const { event } = await run('/zapstore', forged);
		expect(event.locals).toMatchObject({ analyticsOff: false, session: null });
	});

	it("an expired operator session is a signed-out visitor: measured", async () => {
		const expired = mintSessionCookie(SECRET, { pubkey: OPERATOR_PUBKEY, expiresAt: 1_000 });
		const { event } = await run('/zapstore', expired);
		expect(event.locals).toMatchObject({ analyticsOff: false, session: null });
	});

	it('SECURITY: the retired edge header switches nothing off', async () => {
		// Caddy used to set X-Nozzl-Analytics-Off for enrolled browsers. It sets it no longer,
		// and a visitor sending it gains nothing.
		const { event } = await run('/zapstore', undefined, 200, { 'X-Nozzl-Analytics-Off': '1' });
		expect(event.locals.analyticsOff).toBe(false);
	});

	it('SECURITY: the operator marker cookie alone switches nothing off', async () => {
		// The marker only tags the access log, at the edge; analytics follows the session.
		const { event } = await run('/zapstore', undefined, 200, {}, {}, { [MARKER_NAME]: MARKER });
		expect(event.locals.analyticsOff).toBe(false);
	});

	it('records the exclusion on the page-view line, so it is verifiable from Loki', async () => {
		await run('/marketplaces', OPERATOR_COOKIE);
		expect(logged.find((l) => l.msg === 'page view')).toMatchObject({ analytics_off: true });
	});

	it('logs analytics_off: false (not absent) for a measured visitor', async () => {
		await run('/marketplaces');
		expect(logged.find((l) => l.msg === 'page view')?.analytics_off).toBe(false);
	});
});

describe('the operator marker outlives no session', () => {
	// The edge tags whatever carries the marker, and cannot see the session. So a marker that
	// arrives without the operator's verified session - left behind by a new session key, a
	// renamed or reformatted session cookie - is cleared here, with the attributes it was set
	// with. Never on the login endpoints, whose own Set-Cookie must be the last word.
	const OPERATOR_COOKIE = mintSessionCookie(SECRET, {
		pubkey: OPERATOR_PUBKEY,
		expiresAt: 4_000_000_000_000
	});
	const CLEARED = `${MARKER_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
	const marker = { [MARKER_NAME]: MARKER };

	it('clears a marker that comes with no session', async () => {
		const { response } = await run('/zapstore', undefined, 200, {}, PAGE, marker);
		expect(response.headers.getSetCookie()).toEqual([CLEARED]);
	});

	it("clears it beside anyone else's session, and beside one that no longer verifies", async () => {
		expect((await run('/zapstore', VALID_COOKIE, 200, {}, PAGE, marker)).response.headers.getSetCookie()).toEqual([CLEARED]);
		const otherKey = mintSessionCookie('a-retired-session-key-at-least-32-chars', {
			pubkey: OPERATOR_PUBKEY,
			expiresAt: 4_000_000_000_000
		});
		expect((await run('/zapstore', otherKey, 200, {}, PAGE, marker)).response.headers.getSetCookie()).toEqual([CLEARED]);
	});

	it('clears it on data requests and other responses too, not only on pages', async () => {
		const { response } = await run('/nutzaps/__data.json', undefined, 200, {}, { 'content-type': 'application/json' }, marker);
		expect(response.headers.getSetCookie()).toEqual([CLEARED]);
	});

	it("keeps it beside the operator's own session, and sets no cookie at all", async () => {
		const { response } = await run('/zapstore', OPERATOR_COOKIE, 200, {}, PAGE, marker);
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	it('leaves the login endpoints alone: their Set-Cookie must be the last word', async () => {
		// A marker cleared here would land AFTER the one a login had just set, and win.
		for (const path of ['/api/auth/login', '/api/auth/logout', '/api/auth/challenge']) {
			const { response } = await run(path, undefined, 200, {}, {}, marker);
			expect(response.headers.getSetCookie(), path).toEqual([]);
		}
	});

	it('leaves it while the site has no session key, when nobody can be verified', async () => {
		delete dynamicEnv.AUTH_SESSION_SECRET;
		const { response } = await run('/zapstore', OPERATOR_COOKIE, 200, {}, PAGE, marker);
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	it('sets no cookie when there is no marker to clear', async () => {
		expect((await run('/zapstore', undefined, 200, {}, PAGE)).response.headers.getSetCookie()).toEqual([]);
		expect((await run('/zapstore', VALID_COOKIE, 200, {}, PAGE)).response.headers.getSetCookie()).toEqual([]);
	});

});

describe('cache headers on HTML', () => {
	// The pages are rendered per-cookie: the nav carries the session's pubkey and the SSR
	// payload carries the analytics flag. SvelteKit ships a strong ETag but no
	// Cache-Control, which leaves a cache free to invent freshness (RFC 9111 4.2.2) and
	// tells a shared cache the URL alone identifies the response.

	it('marks a page private and revalidate-always', async () => {
		const { response } = await run('/zapstore', undefined, 200, {}, PAGE);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('declares that the response varies by Cookie', async () => {
		// Without this, a CDN placed in front would key on the URL alone and serve one
		// visitor's nav - and pubkey - to another.
		const { response } = await run('/zapstore', VALID_COOKIE, 200, {}, PAGE);
		expect(response.headers.get('vary')?.toLowerCase()).toContain('cookie');
	});

	it('keeps the ETag, so revalidation is still a 304', async () => {
		// no-cache without a validator would turn every navigation into a full re-download.
		const { response } = await run('/zapstore', undefined, 200, {}, PAGE);
		expect(response.headers.get('etag')).toBe('"abc123"');
	});

	it('applies to a logged-in page, which is the one that matters most', async () => {
		const { response } = await run('/zapstore', VALID_COOKIE, 200, {}, PAGE);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('applies to an error page, which also renders the session nav', async () => {
		const { response } = await run('/nope', VALID_COOKIE, 404, {}, PAGE);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('logs the page view BEFORE touching headers, so a throw stays traceable', async () => {
		// The position of the header block is justified in the source and had no test:
		// moving it above the log left every test green. Headers.set throws on a response
		// with an immutable guard (one returned straight from fetch or Response.redirect).
		// Nothing in src/ produces one today, but if that changes, the throw becomes
		// 500 (internal server error), and such a response whose request never reached the
		// page-view line is far harder to trace. Frozen headers stand in for the immutable
		// guard.
		const { handle } = await import('./hooks.server');
		const url = new URL('https://nostrolo.gy/zapstore');
		const event = {
			url,
			request: new Request(url),
			cookies: { get: () => undefined },
			locals: {} as App.Locals
		};
		const response = new Response('ok', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
		Object.defineProperty(response, 'headers', {
			value: {
				// Must still look like HTML, or the block under test is skipped entirely
				// and the test passes for the wrong reason.
				get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html' : null),
				has: () => false,
				set: () => {
					throw new TypeError('immutable');
				}
			}
		});
		await expect(
			handle({ event: event as never, resolve: async () => response } as never)
		).rejects.toThrow('immutable');
		// The point: the page-view line survived the throw.
		expect(logged.find((l) => l.msg === 'page view')).toMatchObject({ path: '/zapstore' });
	});

	it('matches text/html as a PREFIX, not as a substring anywhere', async () => {
		// The one mutation the first version of this file did not catch:
		// startsWith('text/html') -> includes('html') survived, because no fixture had a
		// type merely containing "html". These do. Both are non-HTML payloads that a
		// substring test would wrongly claim, and marking a JSON API response private on
		// the strength of its media type name is the kind of thing nobody would look for.
		for (const type of ['application/vnd.api+html-ish', 'application/json; profile=html']) {
			const { response } = await run('/api/thing', undefined, 200, {}, { 'content-type': type });
			expect(response.headers.get('cache-control'), type).toBeNull();
			expect(response.headers.get('vary'), type).toBeNull();
		}
	});

	it('handles a charset on the content type', async () => {
		const { response } = await run('/zapstore', undefined, 200, {}, {
			'content-type': 'text/html; charset=utf-8'
		});
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('leaves a 304 alone, because SvelteKit builds it after this hook and inherits both', async () => {
		// This file previously asserted the opposite, on a false model: that a page 304
		// reaches the hook and must be matched on status. It does not. SvelteKit converts
		// 200 -> 304 downstream of `handle` (respond.js: hooks.handle ~429, conversion
		// ~474) from an allowlist that already carries cache-control and vary across, so
		// the 304 inherits what the 200 was given. Verified live: a conditional GET
		// returns 304 carrying `private, no-cache` and `Vary: Cookie`, while this hook's
		// own page-view line for that same request records 200.
		const { response } = await run('/zapstore', VALID_COOKIE, 304, {}, { etag: '"abc123"' });
		expect(response.headers.get('cache-control')).toBeNull();
		expect(response.headers.get('vary')).toBeNull();
	});

	describe('leaves alone what already decided for itself', () => {
		it('does not override an HTML page that set its own Cache-Control', async () => {
			// The case the guard actually exists for. The others below are also non-HTML,
			// so they would survive even a hook that ignored existing Cache-Control
			// entirely - this one fails the moment the guard goes.
			const { response } = await run('/some-public-page', undefined, 200, {}, {
				...PAGE,
				'cache-control': 'public, max-age=600'
			});
			expect(response.headers.get('cache-control')).toBe('public, max-age=600');
		});

		it('STILL declares Vary: Cookie on a page that opted out of the default', async () => {
			// The inverse of what this file first asserted, and the reason matters: Vary
			// is a fact about the render, Cache-Control is policy. If overriding the
			// policy also dropped the fact, the response would stop declaring its own
			// cache key exactly when it started inviting shared caching.
			// Calibrated deliberately, because an earlier version of this comment called
			// it "the exact leak the header exists to prevent" while the source comment
			// calls Vary "not a load-bearing control" - both could not be true. The
			// source is right: `private` is what forbids shared storage, and Cloudflare,
			// the likeliest CDN here, honours only `Vary: Accept-Encoding`. This test
			// pins correct HTTP, not a guarantee.
			const { response } = await run('/some-public-page', undefined, 200, {}, {
				...PAGE,
				'cache-control': 'public, max-age=600'
			});
			expect(response.headers.get('cache-control')).toBe('public, max-age=600');
			expect(response.headers.get('vary')?.toLowerCase()).toContain('cookie');
		});

		it('does not touch /sitemap.xml, which is public and identical for everyone', async () => {
			const { response } = await run('/sitemap.xml', undefined, 200, {}, {
				'content-type': 'application/xml',
				'cache-control': 'public, max-age=3600'
			});
			expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
			expect(response.headers.get('vary')).toBeNull();
		});

		it("does not weaken SvelteKit's own no-store on __data.json", async () => {
			// private, no-store is STRICTER than private, no-cache; overwriting it would
			// start permitting storage of a payload SvelteKit decided must not be stored.
			const { response } = await run('/__data.json', undefined, 200, {}, {
				'content-type': 'application/json',
				'cache-control': 'private, no-store'
			});
			expect(response.headers.get('cache-control')).toBe('private, no-store');
		});

		it('does not touch immutable asset responses', async () => {
			const { response } = await run('/_app/immutable/chunks/abc.js', undefined, 200, {}, {
				'content-type': 'text/javascript',
				'cache-control': 'public, max-age=31536000, immutable'
			});
			expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		});

		it('does not touch an asset 304, which in reality carries no Cache-Control at all', async () => {
			// The fixture used to hand this a cache-control it does not have. sirv writes
			// the 304 and returns before adapter-node's setHeaders runs (which is itself
			// gated on statusCode === 200), so an asset 304 goes out bare - verified live
			// on /_app/immutable/entry/start.*.js and /favicon.ico. Such a response never
			// reaches this hook either, because sirv answers ahead of SvelteKit in the
			// handler chain; the assertion is that nothing here would touch it if it did.
			const { response } = await run('/_app/immutable/chunks/abc.js', undefined, 304, {}, {});
			expect(response.headers.get('cache-control')).toBeNull();
			expect(response.headers.get('vary')).toBeNull();
		});

		it('leaves a JSON API response uncached rather than marking it private', async () => {
			// Not HTML and no status match: the hook must not reach beyond pages.
			const { response } = await run('/api/nutzaps', undefined, 200, {}, {
				'content-type': 'application/json'
			});
			expect(response.headers.get('cache-control')).toBeNull();
			expect(response.headers.get('vary')).toBeNull();
		});
	});

	describe('Vary is appended, never overwritten', () => {
		it('keeps an existing field alongside Cookie', async () => {
			// Caddy appends Accept-Encoding for `encode`; clobbering Vary would silently
			// un-declare the other axis the response varies on.
			const { response } = await run('/zapstore', undefined, 200, {}, {
				...PAGE,
				vary: 'Accept-Encoding'
			});
			const vary = response.headers.get('vary')!.toLowerCase();
			expect(vary).toContain('accept-encoding');
			expect(vary).toContain('cookie');
		});

		it('does not list Cookie twice when it is already declared', async () => {
			const { response } = await run('/zapstore', undefined, 200, {}, {
				...PAGE,
				vary: 'Cookie'
			});
			expect(response.headers.get('vary')).toBe('Cookie');
		});

		it('matches an existing field case-insensitively', async () => {
			const { response } = await run('/zapstore', undefined, 200, {}, { ...PAGE, vary: 'cookie' });
			expect(response.headers.get('vary')).toBe('cookie');
		});

		it('leaves Vary: * alone, which already means "never reuse"', async () => {
			const { response } = await run('/zapstore', undefined, 200, {}, { ...PAGE, vary: '*' });
			expect(response.headers.get('vary')).toBe('*');
		});
	});
});
