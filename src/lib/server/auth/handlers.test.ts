// @vitest-environment node
// The login endpoints end to end, as functions from Request to Response.
//
// The unit suites cover each primitive; this one covers the SEAM - that the pieces are wired
// in the right order and that the whole flow behaves correctly with the headers a real request
// carries behind Caddy. Every login here signs a real kind-27235 (NIP-98 HTTP auth) event with
// a real key; nothing cryptographic is stubbed. The real HTTP server is in socket.test.ts.

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { AUTH_BODY_LIMIT_BYTES } from './body';
import {
	DEFAULT_COOKIE_NAME,
	NONCE_TTL_MS,
	OPERATOR_MARKER_COOKIE,
	OPERATOR_SESSION_TTL_MS,
	REPLAY_WINDOW_MS,
	SESSION_TTL_MS
} from './config';
import { verifySessionCookie } from './cookie';
import { authDeps, handleChallenge, handleLogin, handleLogout, type AuthDeps, type LogFn } from './handlers';
import { NIP98_KIND } from './nip98';
import { SpentNonces } from './nonce';

const ORIGIN = 'https://nostrolo.gy';
const SECRET = 'handlers-test-secret-at-least-32-chars-long';
const LOGIN_URL = `${ORIGIN}/api/auth/login`;
const ENV = { ORIGIN, AUTH_SESSION_SECRET: SECRET };

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const OTHER_SK = generateSecretKey();
const OTHER_PK = getPublicKey(OTHER_SK);

// The operator, for this suite: a key generated here, since the real operator's secret key is
// not ours to sign with. `isOperator` is the one rule that names the operator ($lib/unreleased,
// tested there); what this suite tests is what the handlers do with its answer.
const OPERATOR_SK = generateSecretKey();
const operatorKey = vi.hoisted(() => ({ pubkey: '' }));
operatorKey.pubkey = getPublicKey(OPERATOR_SK);
vi.mock('$lib/unreleased', () => ({
	isOperator: (viewer: { pubkey?: string | null } | null | undefined) =>
		viewer?.pubkey === operatorKey.pubkey
}));
const MARKER = randomBytes(32).toString('hex');
const OPERATOR_ENV = { ...ENV, OPERATOR_MARKER: MARKER };

type Line = { level: string; msg: string; fields: Record<string, unknown> };

function harness(
	env: Record<string, string | undefined> = ENV,
	now?: () => number,
	spent = new SpentNonces(NONCE_TTL_MS, REPLAY_WINDOW_MS)
) {
	const lines: Line[] = [];
	const log: LogFn = (level, msg, fields = {}) => void lines.push({ level, msg, fields });
	const deps: AuthDeps = { env, spent, log, now };
	return { deps, lines };
}

function post(path: string, body: string | null, headers: Record<string, string> = {}): Request {
	// The container sees itself as nostrology-web:3000, and Caddy passes X-Forwarded-* through:
	// neither may decide what URL a token must have signed. Content-Length is set by hand,
	// because a Request built in memory carries none, while one adapter-node builds from a
	// real connection carries the client's.
	const all: Record<string, string> = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'nostrolo.gy' };
	if (body !== null) {
		all['content-type'] = 'application/json';
		all['content-length'] = String(Buffer.byteLength(body));
	}
	return new Request(`http://nostrology-web:3000${path}`, {
		method: 'POST',
		headers: { ...all, ...headers },
		body
	});
}

async function challenge(deps: AuthDeps, pubkey = PK): Promise<string> {
	const res = await handleChallenge(post('/api/auth/challenge', JSON.stringify({ pubkey })), deps);
	expect(res.status).toBe(200);
	return ((await res.json()) as { nonce: string }).nonce;
}

function signLogin(sk: Uint8Array, nonce: string, url = LOGIN_URL, createdAt?: number) {
	const body = JSON.stringify({ nonce });
	const event = finalizeEvent(
		{
			kind: NIP98_KIND,
			created_at: createdAt ?? Math.floor(Date.now() / 1000),
			tags: [
				['u', url],
				['method', 'POST'],
				['payload', createHash('sha256').update(body).digest('hex')]
			],
			content: ''
		},
		sk
	);
	return { body, authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` };
}

async function login(deps: AuthDeps, sk = SK, nonce?: string, headers: Record<string, string> = {}) {
	const n = nonce ?? (await challenge(deps, getPublicKey(sk)));
	const { body, authorization } = signLogin(sk, n);
	return handleLogin(post('/api/auth/login', body, { authorization, ...headers }), deps);
}

/** The one Set-Cookie header for cookie `name`, or undefined. Fails if there are two. */
function setCookie(res: Response, name = DEFAULT_COOKIE_NAME): string | undefined {
	const all = res.headers.getSetCookie().filter((h) => h.startsWith(`${name}=`));
	expect(all.length).toBeLessThanOrEqual(1);
	return all[0];
}

function cookieValue(res: Response, name = DEFAULT_COOKIE_NAME): string | undefined {
	const header = setCookie(res, name);
	if (header === undefined) return undefined;
	const rest = header.slice(name.length + 1);
	return rest.slice(0, rest.indexOf(';'));
}

describe('POST /api/auth/challenge', () => {
	it('issues a nonce for a well-formed pubkey, never cached', async () => {
		const { deps } = harness();
		const res = await handleChallenge(post('/api/auth/challenge', JSON.stringify({ pubkey: PK })), deps);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = (await res.json()) as { nonce: string; expiresInMs: number };
		expect(body.nonce).toMatch(/^n1\./);
		expect(body.expiresInMs).toBe(NONCE_TTL_MS);
	});

	it('issues one for ANY pubkey, and accepts uppercase hex', async () => {
		// Who may log in is everyone; refusing some keys would make this an oracle.
		const { deps } = harness();
		const res = await handleChallenge(
			post('/api/auth/challenge', JSON.stringify({ pubkey: OTHER_PK.toUpperCase() })),
			deps
		);
		expect(res.status).toBe(200);
	});

	it.each([
		['too short', '{"pubkey":"abc"}'],
		['not hex', JSON.stringify({ pubkey: 'z'.repeat(64) })],
		['missing', '{}'],
		['a number', '{"pubkey":42}']
	])('answers 400 (bad request) for a %s pubkey', async (_l, body) => {
		const { deps } = harness();
		expect((await handleChallenge(post('/api/auth/challenge', body), deps)).status).toBe(400);
	});

	it.each([
		['not JSON', 'nope'],
		['JSON null', 'null'],
		['a JSON array', '[1]'],
		['a JSON string', '"x"']
	])('answers 400 (bad request), not 500 (internal server error), for %s', async (_l, body) => {
		const { deps } = harness();
		const res = await handleChallenge(post('/api/auth/challenge', body), deps);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'request body must be a JSON object' });
	});

	it('never logs the nonce it minted, nor the pubkey it was asked about', async () => {
		const { deps, lines } = harness();
		const nonce = await challenge(deps);
		const logged = JSON.stringify(lines);
		expect(logged).not.toContain(nonce);
		expect(logged).not.toContain(PK);
	});
});

describe('POST /api/auth/login', () => {
	it('completes the flow and sets a session cookie the hook will verify', async () => {
		const { deps } = harness();
		const res = await login(deps);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ pubkey: PK, expiresAt: expect.any(Number) });
		const session = verifySessionCookie(SECRET, cookieValue(res), Date.now());
		expect(session.ok && session.claims.pubkey).toBe(PK);
	});

	it('mints a 30-day session', async () => {
		const now = 1_900_000_000_000;
		const { deps } = harness(ENV, () => now);
		const nonce = await challenge(deps);
		const { body, authorization } = signLogin(SK, nonce, LOGIN_URL, Math.floor(now / 1000));
		const res = await handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { expiresAt: number }).expiresAt).toBe(now + SESSION_TTL_MS);
		expect(setCookie(res)).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
	});

	it('sets HttpOnly, Secure, SameSite=Lax and Path=/, and no Domain', async () => {
		const { deps } = harness();
		const header = setCookie(await login(deps)) ?? '';
		expect(header.startsWith(`${DEFAULT_COOKIE_NAME}=s2.`)).toBe(true);
		for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(header).toContain(attr);
		expect(header.toLowerCase()).not.toContain('domain=');
	});

	it('is never cached', async () => {
		const { deps } = harness();
		expect((await login(deps)).headers.get('cache-control')).toBe('no-store');
	});

	it('REFUSES A REPLAYED REQUEST', async () => {
		// NIP-98 (HTTP auth) has no replay protection, so single-use is the only thing between
		// a captured login request and an impersonated session.
		const { deps } = harness();
		const { body, authorization } = signLogin(SK, await challenge(deps));
		const send = () => handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect((await send()).status).toBe(200);
		const second = await send();
		expect(second.status).toBe(401);
		await expect(second.json()).resolves.toEqual({ error: 'challenge already used' });
		expect(second.headers.get('set-cookie')).toBeNull();
	});

	it('REFUSES A RE-SPELLED NONCE, so single-use actually holds', async () => {
		const { deps } = harness();
		const nonce = await challenge(deps);
		const parts = nonce.split('.');
		for (const variant of [`${parts[1]}x`, `+${parts[1]}`, ` ${parts[1]}`]) {
			const respelled = [parts[0], variant, parts[2], parts[3]].join('.');
			expect((await login(deps, SK, respelled)).status).toBe(401);
		}
		expect((await login(deps, SK, nonce)).status).toBe(200);
	});

	it("refuses a nonce issued for somebody else's pubkey", async () => {
		const { deps } = harness();
		expect((await login(deps, SK, await challenge(deps, OTHER_PK))).status).toBe(401);
	});

	it('refuses a forged nonce', async () => {
		const { deps } = harness();
		expect((await login(deps, SK, 'n1.1.salt.forged')).status).toBe(401);
	});

	it('refuses a nonce minted under another secret', async () => {
		const other = harness({ ORIGIN, AUTH_SESSION_SECRET: `${SECRET}-other` });
		const nonce = await challenge(other.deps);
		const { deps } = harness();
		expect((await login(deps, SK, nonce)).status).toBe(401);
	});

	it('refuses an expired challenge', async () => {
		let now = 1_900_000_000_000;
		const { deps } = harness(ENV, () => now);
		const nonce = await challenge(deps);
		now += NONCE_TTL_MS + 1;
		const { body, authorization } = signLogin(SK, nonce, LOGIN_URL, Math.floor(now / 1000));
		const res = await handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ error: 'invalid or expired challenge' });
	});

	it('refuses a missing Authorization header', async () => {
		const { deps } = harness();
		const body = JSON.stringify({ nonce: await challenge(deps) });
		expect((await handleLogin(post('/api/auth/login', body), deps)).status).toBe(401);
	});

	it('refuses a token signed for a different URL', async () => {
		const { deps } = harness();
		const { body, authorization } = signLogin(SK, await challenge(deps), 'https://nostrolo.gy/api/auth/challenge');
		expect((await handleLogin(post('/api/auth/login', body, { authorization }), deps)).status).toBe(401);
	});

	it('refuses a body swapped after signing', async () => {
		// The payload tag binds the body, so the nonce inside it cannot be substituted.
		const { deps } = harness();
		const { authorization } = signLogin(SK, await challenge(deps));
		const other = JSON.stringify({ nonce: await challenge(deps) });
		expect((await handleLogin(post('/api/auth/login', other, { authorization }), deps)).status).toBe(401);
	});

	it('does NOT let a forwarded header redirect the signed URL', async () => {
		// Caddy sets X-Forwarded-Host only when it is absent, so a client value passes straight
		// through. A token signed for evil.example, replayed with that header, must not log the
		// signer in here.
		const { deps } = harness();
		const nonce = await challenge(deps);
		const { body, authorization } = signLogin(SK, nonce, 'https://evil.example/api/auth/login');
		const res = await handleLogin(
			post('/api/auth/login', body, {
				authorization,
				'x-forwarded-host': 'evil.example',
				host: 'evil.example'
			}),
			deps
		);
		expect(res.status).toBe(401);
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it('works whatever host the container is reached as', async () => {
		// The client signs ORIGIN; the request arrives as nostrology-web:3000. That this passes
		// is what proves the signed URL comes from configuration.
		const { deps } = harness();
		expect((await login(deps, SK, undefined, { host: 'nostrology-web:3000' })).status).toBe(200);
	});

	it('rejects structurally malformed events with a 401 (unauthorized), not a crash', async () => {
		const { deps } = harness();
		const nonce = await challenge(deps);
		for (const broken of [
			{ kind: 27235, tags: 'not-an-array', pubkey: PK, sig: 'x', id: 'y', content: '' },
			{ kind: 27235, tags: [], pubkey: 42, sig: 'x', id: 'y', content: '' },
			{ kind: 27235, tags: [], pubkey: PK, content: '' }
		]) {
			const res = await handleLogin(
				post('/api/auth/login', JSON.stringify({ nonce }), {
					authorization: `Nostr ${Buffer.from(JSON.stringify(broken)).toString('base64')}`
				}),
				deps
			);
			expect(res.status).toBe(401);
		}
	});

	it.each([
		['JSON null', 'null'],
		['a JSON array', '[]'],
		['not JSON', 'nope']
	])('answers 400 (bad request) for a body that is %s', async (_l, body) => {
		const { deps } = harness();
		expect((await handleLogin(post('/api/auth/login', body), deps)).status).toBe(400);
	});

	it('logs the outcome without ever logging who, or any credential', async () => {
		const { deps, lines } = harness();
		const nonce = await challenge(deps);
		// Sign ONCE and send THAT token: schnorr signing is nondeterministic, so asserting the
		// absence of a second token would prove nothing.
		const { body, authorization } = signLogin(SK, nonce);
		const res = await handleLogin(post('/api/auth/login', body, { authorization }), deps);
		const cookie = cookieValue(res);
		const logged = JSON.stringify(lines);
		expect(lines.map((l) => l.msg)).toContain('auth login ok');
		for (const secretish of [PK, authorization, nonce, cookie!, SECRET]) {
			expect(logged).not.toContain(secretish);
		}
	});

	it('logs the signed URL on a mismatch, so a wrong ORIGIN is diagnosable, and not the pubkey', async () => {
		const { deps, lines } = harness();
		const { body, authorization } = signLogin(SK, await challenge(deps), 'https://wrong.example/x');
		await handleLogin(post('/api/auth/login', body, { authorization }), deps);
		const warn = lines.find((l) => l.level === 'warn');
		expect(warn?.fields).toMatchObject({ stage: 'nip98', signed_url: LOGIN_URL });
		expect(JSON.stringify(lines)).not.toContain(PK);
	});

	it('logs a nonce refusal with its reason and without the pubkey', async () => {
		const { deps, lines } = harness();
		await login(deps, SK, 'n1.1.salt.forged');
		const warn = lines.find((l) => l.level === 'warn');
		expect(warn?.fields).toEqual({ stage: 'nonce', reason: 'bad_signature' });
	});
});

describe("the operator's login: a 400-day session and the marker beside it", () => {
	const ATTRS = 'Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure';

	it('mints a 400-day session, and the marker with the same lifetime and attributes', async () => {
		const now = 1_900_000_000_000;
		const { deps } = harness(OPERATOR_ENV, () => now);
		const nonce = await challenge(deps, operatorKey.pubkey);
		const { body, authorization } = signLogin(OPERATOR_SK, nonce, LOGIN_URL, Math.floor(now / 1000));
		const res = await handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { expiresAt: number }).expiresAt).toBe(now + OPERATOR_SESSION_TTL_MS);
		expect(OPERATOR_SESSION_TTL_MS).toBe(400 * 24 * 60 * 60 * 1000);
		expect(setCookie(res)).toMatch(new RegExp(`^${DEFAULT_COOKIE_NAME}=s2\\.[^;]+; ${ATTRS}$`));
		expect(setCookie(res, OPERATOR_MARKER_COOKIE)).toBe(`${OPERATOR_MARKER_COOKIE}=${MARKER}; ${ATTRS}`);
		const session = verifySessionCookie(SECRET, cookieValue(res), now);
		expect(session.ok && session.claims).toEqual({ pubkey: operatorKey.pubkey, expiresAt: now + OPERATOR_SESSION_TTL_MS });
	});

	it("anyone else's login clears the marker, so a second key over the operator's session is untagged", async () => {
		const { deps } = harness(OPERATOR_ENV);
		const res = await login(deps);
		expect(res.status).toBe(200);
		expect(setCookie(res)).toContain(`Max-Age=${SESSION_TTL_MS / 1000};`);
		expect(setCookie(res, OPERATOR_MARKER_COOKIE)).toBe(
			`${OPERATOR_MARKER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`
		);
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['too short', 'a'.repeat(63)],
		['too long', 'a'.repeat(65)],
		['upper case', 'A'.repeat(64)],
		['not hex', 'g'.repeat(64)]
	])('sets no marker when OPERATOR_MARKER is %s: untagged, never tagged with a guessable value', async (_what, marker) => {
		const { deps } = harness({ ...ENV, OPERATOR_MARKER: marker });
		const res = await login(deps, OPERATOR_SK);
		expect(res.status).toBe(200);
		expect(setCookie(res)).toContain(`Max-Age=${OPERATOR_SESSION_TTL_MS / 1000};`);
		expect(cookieValue(res, OPERATOR_MARKER_COOKIE)).toBe('');
		expect(setCookie(res, OPERATOR_MARKER_COOKIE)).toContain('Max-Age=0;');
	});

	it('names a __Host- cookie, so no other host can plant or shadow it', () => {
		expect(OPERATOR_MARKER_COOKIE.startsWith('__Host-')).toBe(true);
	});

	it('never logs the marker, nor that this login was the operator\'s', async () => {
		const { deps, lines } = harness(OPERATOR_ENV);
		await login(deps, OPERATOR_SK);
		const ok = lines.filter((l) => l.msg === 'auth login ok');
		expect(ok).toHaveLength(1);
		expect(Object.keys(ok[0].fields)).toEqual(['ms']);
		expect(JSON.stringify(lines)).not.toContain(MARKER);
		expect(JSON.stringify(lines)).not.toContain(operatorKey.pubkey);
	});

	it('a refused operator login sets no cookie at all', async () => {
		const { deps } = harness(OPERATOR_ENV);
		const nonce = await challenge(deps, operatorKey.pubkey);
		const { body } = signLogin(OPERATOR_SK, nonce);
		const res = await handleLogin(post('/api/auth/login', body, { authorization: 'Nostr e30=' }), deps);
		expect(res.status).toBe(401);
		expect(res.headers.getSetCookie()).toEqual([]);
	});
});

describe('POST /api/auth/logout', () => {
	it('clears the cookie with the attributes it was set with', async () => {
		// A mismatched Path or Secure means the browser keeps the original cookie and the user
		// stays silently logged in.
		const { deps } = harness();
		const res = await handleLogout(post('/api/auth/logout', null), deps);
		expect(res.status).toBe(200);
		const header = setCookie(res) ?? '';
		expect(header.startsWith(`${DEFAULT_COOKIE_NAME}=;`)).toBe(true);
		for (const attr of ['Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
			expect(header).toContain(attr);
		}
	});

	it('clears the operator marker too, so signing out ends the operator treatment', async () => {
		const { deps } = harness(OPERATOR_ENV);
		const header = setCookie(await handleLogout(post('/api/auth/logout', null), deps), OPERATOR_MARKER_COOKIE);
		expect(header).toBe(`${OPERATOR_MARKER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
	});

	it('succeeds when not logged in, so a second click is not an error', async () => {
		const { deps } = harness();
		expect((await handleLogout(post('/api/auth/logout', null), deps)).status).toBe(200);
		expect((await handleLogout(post('/api/auth/logout', null), deps)).status).toBe(200);
	});
});

describe('the Origin fence, on all three endpoints', () => {
	// SvelteKit's CSRF check covers form content types only: a JSON POST from a foreign page
	// reaches these handlers. Without the fence a third-party page could log a visitor out.
	const cases = [
		['challenge', (r: Request, d: AuthDeps) => handleChallenge(r, d), JSON.stringify({ pubkey: PK })],
		['login', (r: Request, d: AuthDeps) => handleLogin(r, d), '{}'],
		['logout', (r: Request, d: AuthDeps) => handleLogout(r, d), null]
	] as const;

	it.each(cases)('%s refuses a foreign Origin with a 403 (forbidden)', async (name, handler, body) => {
		const { deps } = harness();
		const res = await handler(post(`/api/auth/${name}`, body, { origin: 'https://evil.example' }), deps);
		expect(res.status).toBe(403);
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it.each(cases)('%s refuses Origin: null, which sandboxed pages send', async (name, handler, body) => {
		const { deps } = harness();
		expect((await handler(post(`/api/auth/${name}`, body, { origin: 'null' }), deps)).status).toBe(403);
	});

	it('admits the site itself and a request with no Origin at all', async () => {
		const { deps } = harness();
		expect((await login(deps, SK, undefined, { origin: ORIGIN })).status).toBe(200);
		expect((await handleLogout(post('/api/auth/logout', null), deps)).status).toBe(200);
	});

	it('checks the Origin BEFORE reading the body', async () => {
		const { deps } = harness();
		const res = await handleLogin(
			post('/api/auth/login', 'x'.repeat(AUTH_BODY_LIMIT_BYTES + 1), { origin: 'https://evil.example' }),
			deps
		);
		expect(res.status).toBe(403);
	});
});

describe('an unconfigured site', () => {
	it.each([
		['no ORIGIN', { AUTH_SESSION_SECRET: SECRET }],
		['no secret', { ORIGIN }],
		['a secret under 32 characters', { ORIGIN, AUTH_SESSION_SECRET: 'x'.repeat(31) }]
	])('answers 503 (service unavailable) with %s, on every endpoint', async (_l, env) => {
		const { deps, lines } = harness(env);
		expect((await handleChallenge(post('/api/auth/challenge', JSON.stringify({ pubkey: PK })), deps)).status).toBe(503);
		expect((await handleLogin(post('/api/auth/login', '{}'), deps)).status).toBe(503);
		expect((await handleLogout(post('/api/auth/logout', null), deps)).status).toBe(503);
		expect(lines.every((l) => l.level === 'error' && l.msg === 'auth endpoint unconfigured')).toBe(true);
	});
});

describe('bodies', () => {
	it('refuses a body over the cap with a 413 (content too large)', async () => {
		const { deps } = harness();
		const res = await handleLogin(post('/api/auth/login', 'x'.repeat(AUTH_BODY_LIMIT_BYTES + 1)), deps);
		expect(res.status).toBe(413);
	});

	it('closes the connection whenever it answers without reading a body that was sent', async () => {
		// Otherwise Node keeps the connection alive and drains the rest in the background, and
		// the next request on it - another visitor's, behind Caddy - waits for it.
		const { deps } = harness();
		const big = post('/api/auth/login', 'x'.repeat(AUTH_BODY_LIMIT_BYTES + 1));
		expect((await handleLogin(big, deps)).headers.get('connection')).toBe('close');
		const foreign = post('/api/auth/challenge', '{}', { origin: 'https://evil.example' });
		expect((await handleChallenge(foreign, deps)).headers.get('connection')).toBe('close');
		const logout = post('/api/auth/logout', '{"x":1}');
		expect((await handleLogout(logout, deps)).headers.get('connection')).toBe('close');
	});

	it('keeps the connection when the body was read, or there was none', async () => {
		const { deps } = harness();
		expect((await login(deps)).headers.get('connection')).toBeNull();
		expect((await handleLogout(post('/api/auth/logout', null), deps)).headers.get('connection')).toBeNull();
	});
});

describe('regressions from the blind review', () => {
	it.each(['https://nostrolo.gy.evil.example', 'https://nostrolo.gy:8443', 'http://nostrolo.gy'])(
		'refuses Origin %s on every endpoint: an exact match, never a prefix',
		async (origin) => {
			const { deps } = harness();
			const body = JSON.stringify({ pubkey: PK });
			expect((await handleChallenge(post('/api/auth/challenge', body, { origin }), deps)).status).toBe(403);
			expect((await handleLogin(post('/api/auth/login', '{}', { origin }), deps)).status).toBe(403);
			expect((await handleLogout(post('/api/auth/logout', null, { origin }), deps)).status).toBe(403);
		}
	);

	it('closes the connection on EVERY answer that leaves a sent body unread', async () => {
		const big = 'x'.repeat(AUTH_BODY_LIMIT_BYTES + 1);
		const typeless = { 'content-type': '' };
		const evil = { origin: 'https://evil.example' };
		const cases: [string, (r: Request, d: AuthDeps) => Promise<Response>, string, string, Record<string, string>, number, boolean][] = [
			// [name, handler, path, body, extra headers, expected status, configured?]
			['challenge unconfigured', handleChallenge, '/api/auth/challenge', '{}', {}, 503, false],
			['login unconfigured', handleLogin, '/api/auth/login', '{}', {}, 503, false],
			['logout unconfigured', handleLogout, '/api/auth/logout', '{}', {}, 503, false],
			['challenge foreign Origin', handleChallenge, '/api/auth/challenge', '{}', evil, 403, true],
			['login foreign Origin', handleLogin, '/api/auth/login', '{}', evil, 403, true],
			['logout foreign Origin', handleLogout, '/api/auth/logout', '{}', evil, 403, true],
			['challenge over the cap', handleChallenge, '/api/auth/challenge', big, {}, 413, true],
			['login over the cap', handleLogin, '/api/auth/login', big, {}, 413, true],
			['challenge with no Content-Type', handleChallenge, '/api/auth/challenge', '{}', typeless, 415, true],
			['login with no Content-Type', handleLogin, '/api/auth/login', '{}', typeless, 415, true],
			['logout with a body', handleLogout, '/api/auth/logout', '{}', {}, 200, true]
		];
		for (const [name, handler, path, body, extra, status, configured] of cases) {
			const { deps } = harness(configured ? ENV : {});
			// A typeless request is modelled the way SvelteKit hands one over: NO body object at
			// all, while the headers say bytes follow. (A Request built here with a string body
			// would be given a text/plain Content-Type.) socket.test.ts proves the real path.
			const req = post(path, body, extra);
			const request =
				'content-type' in extra && extra['content-type'] === ''
					? ({
							url: req.url,
							method: 'POST',
							headers: new Headers([...req.headers].filter(([k]) => k !== 'content-type')),
							body: null
						} as unknown as Request)
					: req;
			const res = await handler(request, deps);
			expect(res.status, name).toBe(status);
			expect(res.headers.get('connection'), name).toBe('close');
		}
	});

	it('does not burn a challenge on a forged attempt: the claim follows the signature', async () => {
		const { deps } = harness();
		const nonce = await challenge(deps);
		const { body, authorization } = signLogin(SK, nonce);
		const event = JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8'));
		const forged = `Nostr ${Buffer.from(JSON.stringify({ ...event, sig: '0'.repeat(128) })).toString('base64')}`;
		expect((await handleLogin(post('/api/auth/login', body, { authorization: forged }), deps)).status).toBe(401);
		expect((await handleLogin(post('/api/auth/login', body, { authorization }), deps)).status).toBe(200);
	});

	it('logs no client address on any path, and only fields from a fixed list', async () => {
		const addressed = {
			'x-forwarded-for': '203.0.113.7',
			'x-real-ip': '203.0.113.8',
			forwarded: 'for=203.0.113.9',
			'cf-connecting-ip': '203.0.113.10'
		};
		const { deps, lines } = harness();
		await handleChallenge(post('/api/auth/challenge', JSON.stringify({ pubkey: PK }), addressed), deps);
		await handleChallenge(post('/api/auth/challenge', '{"pubkey":"x"}', addressed), deps);
		await handleChallenge(post('/api/auth/challenge', 'nope', addressed), deps);
		await login(deps, SK, undefined, addressed);
		await login(deps, SK, 'n1.1.salt.forged', addressed);
		await handleLogin(post('/api/auth/login', '{}', { ...addressed, authorization: 'Nostr x' }), deps);
		await handleLogin(post('/api/auth/login', '{}', { ...addressed, origin: 'https://evil.example' }), deps);
		await handleLogout(post('/api/auth/logout', null, addressed), deps);
		const unconfigured = harness({});
		await handleLogin(post('/api/auth/login', '{}', addressed), unconfigured.deps);
		const all = [...lines, ...unconfigured.lines];
		expect(all.length).toBeGreaterThan(5);
		expect(JSON.stringify(all)).not.toMatch(/203\.0\.113\./);
		const ALLOWED = new Set(['path', 'reason', 'stage', 'signed_url', 'needs', 'ms']);
		for (const line of all) {
			for (const key of Object.keys(line.fields)) expect(ALLOWED.has(key), `${line.msg}: ${key}`).toBe(true);
		}
	});

	it('sets Max-Age to exactly 30 days, in seconds', async () => {
		const { deps } = harness();
		const header = setCookie(await login(deps)) ?? '';
		expect(header).toMatch(/(^|;\s*)Max-Age=2592000(;|$)/);
	});

	it.each([
		[-60, 200],
		[-61, 401],
		[60, 200],
		[61, 401]
	])('takes a token dated %i s from now with %i: the skew is 60 s either way', async (delta, status) => {
		const now = 1_900_000_000_000;
		const { deps } = harness(ENV, () => now);
		const nonce = await challenge(deps);
		const { body, authorization } = signLogin(SK, nonce, LOGIN_URL, Math.floor(now / 1000) + delta);
		expect((await handleLogin(post('/api/auth/login', body, { authorization }), deps)).status).toBe(status);
	});

	it('verifies the exact bytes sent, however they are formatted', async () => {
		const { deps } = harness();
		const nonce = await challenge(deps);
		const body = `{ "nonce" :  "${nonce}" }`;
		const event = finalizeEvent(
			{
				kind: NIP98_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['u', LOGIN_URL],
					['method', 'POST'],
					['payload', createHash('sha256').update(body).digest('hex')]
				],
				content: ''
			},
			SK
		);
		const authorization = `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
		expect((await handleLogin(post('/api/auth/login', body, { authorization }), deps)).status).toBe(200);
	});

	it('runs in production with the replay-safe set: the nonce lifetime and the replay window', () => {
		// Every other test builds its own set; this is the one the routes use.
		const { spent } = authDeps({});
		expect(spent.ttlMs).toBe(NONCE_TTL_MS);
		expect(spent.protectMs).toBe(REPLAY_WINDOW_MS);
		expect(spent.maxEntries).toBeGreaterThanOrEqual(1000);
	});

	it('asks the spent set BEFORE the signature: a spent nonce on an expired token is "already used"', async () => {
		let now = 1_900_000_000_000;
		const { deps } = harness(ENV, () => now);
		const nonce = await challenge(deps);
		const { body, authorization } = signLogin(SK, nonce, LOGIN_URL, Math.floor(now / 1000));
		const send = () => handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect((await send()).status).toBe(200);
		now += 61_000; // the token has expired, the nonce has not
		const again = await send();
		expect(again.status).toBe(401);
		await expect(again.json()).resolves.toEqual({ error: 'challenge already used' });
	});

	it('a flood of logins cannot evict a spent nonce and let a captured request replay', async () => {
		const { deps, lines } = harness(ENV, undefined, new SpentNonces(NONCE_TTL_MS, REPLAY_WINDOW_MS, 3));
		const { body, authorization } = signLogin(SK, await challenge(deps));
		const send = () => handleLogin(post('/api/auth/login', body, { authorization }), deps);
		expect((await send()).status).toBe(200);
		// The attacker's own logins, one per fresh key, until the set is full.
		const statuses = [];
		for (let i = 0; i < 3; i += 1) statuses.push((await login(deps, generateSecretKey())).status);
		expect(statuses).toEqual([200, 200, 503]);
		expect(lines.some((l) => l.fields.reason === 'spent_set_full')).toBe(true);
		const replay = await send();
		expect(replay.status).toBe(401);
		expect(replay.headers.get('set-cookie')).toBeNull();
	});
});
