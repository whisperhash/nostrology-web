// Verify, on a running site, that logging in with Nostr works and refuses what it must.
//
//   node scripts/verify-login.mjs                        # https://nostrolo.gy
//   node scripts/verify-login.mjs http://127.0.0.1:3000  # a local `node build`
//
// It logs in with a THROWAWAY key, generated for the run and never stored, through the same
// three requests a browser makes (src/lib/auth/session.ts): a challenge, ONE signed kind-27235
// (NIP-98 HTTP auth) event over the login URL, and the login itself. Then it checks:
//   - the session cookie: its name, its s2 format for this key, HttpOnly, Secure, SameSite=Lax,
//     Path=/, 30 days, no Domain, and an uncached response;
//   - that the operator marker (__Host-nozzl_op) is CLEARED by a stranger's login, so a second
//     key over the operator's session would not be tagged as the operator;
//   - that a page rendered with the cookie shows the identity in the nav, server-side;
//   - that replaying the exact login request is refused, 401 (unauthorized);
//   - that a foreign Origin is refused, 403 (forbidden), on the challenge and on logout;
//   - that GET on an endpoint is 405 (method not allowed): they are POST only;
//   - that an over-cap declared body is refused, 413 (content too large), and that an over-cap
//     body with NO declared length never gets a 200 (ok): a reset, or a 502 (bad gateway) from
//     Caddy, are both right;
//   - that logout clears the cookie with the attributes it was set with, and the marker too;
//   - and, on nostrolo.gy only, that this stranger still cannot see what is in development
//     (verify-unreleased.mjs is the full check of that).
// A local `node build` needs ORIGIN set to the base URL given here, and an AUTH_SESSION_SECRET
// of at least 32 characters; the page check uses /wip, which reads no database.
//
// It cannot check a real browser extension or remote signer: after a change to login, log in
// with one by hand.
//
// FIRST-PARTY MARKING. Every request carries the User-Agent `nozzl-verify-login`, so its lines
// can be told apart in the access log, where no address is kept. It is a stranger, not the
// operator, so it is never tagged `operator=1`.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error.

import { createHash } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://nostrolo.gy').replace(/\/+$/, '');
if (args.some((a) => a.startsWith('--')) || !/^https?:\/\//.test(base)) {
	console.error('usage: node scripts/verify-login.mjs [<base-url>]');
	process.exit(2);
}
const LIVE = /(^|\.)nostrolo\.gy$/.test(new URL(base).hostname);
const MARK = 'nozzl-verify-login';
const COOKIE = '__Host-nostrology_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

let failures = 0;
const fail = (msg) => {
	failures += 1;
	console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);
const check = (ok, msg, detail) => (ok ? pass(msg) : fail(detail ? `${msg} (${detail})` : msg));

async function post(path, { body, headers = {} } = {}) {
	const res = await fetch(base + path, {
		method: 'POST',
		redirect: 'manual',
		headers: { 'user-agent': MARK, ...headers },
		body,
		...(body instanceof ReadableStream ? { duplex: 'half' } : {})
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* not JSON */
	}
	return { res, json };
}

const jsonHeaders = { 'content-type': 'application/json' };

console.log(`${base}: login with a throwaway key`);

// --- the refusals that need no key -------------------------------------------------------
{
	const res = await fetch(`${base}/api/auth/challenge`, { headers: { 'user-agent': MARK } });
	await res.arrayBuffer();
	check(res.status === 405, 'GET /api/auth/challenge: 405 (method not allowed)', `got ${res.status}`);

	const foreign = await post('/api/auth/challenge', {
		body: JSON.stringify({ pubkey: 'a'.repeat(64) }),
		headers: { ...jsonHeaders, origin: 'https://evil.example' }
	});
	check(foreign.res.status === 403, 'a foreign Origin on the challenge: 403 (forbidden)', `got ${foreign.res.status}`);

	const foreignOut = await post('/api/auth/logout', { headers: { origin: 'https://evil.example' } });
	check(foreignOut.res.status === 403, 'a foreign Origin on logout: 403 (forbidden)', `got ${foreignOut.res.status}`);

	const big = await post('/api/auth/login', { body: 'x'.repeat(5000), headers: jsonHeaders });
	check(big.res.status === 413, 'a 5,000-byte declared body: 413 (content too large)', `got ${big.res.status}`);

	// 64 KB with no declared length, in 1 KB chunks.
	let sent = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (sent >= 64) return controller.close();
			sent += 1;
			controller.enqueue(new Uint8Array(1024).fill(120));
		}
	});
	let outcome;
	try {
		const chunked = await post('/api/auth/login', { body: stream, headers: jsonHeaders });
		outcome = `status ${chunked.res.status}`;
	} catch (e) {
		outcome = `reset (${e.cause?.code ?? e.message})`;
	}
	check(outcome !== 'status 200', `a 64 KB body with no declared length is stopped: ${outcome}`);
}

// --- the login ---------------------------------------------------------------------------
const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const challenge = await post('/api/auth/challenge', { body: JSON.stringify({ pubkey }), headers: jsonHeaders });
check(
	challenge.res.status === 200 && typeof challenge.json?.nonce === 'string',
	'POST /api/auth/challenge: 200 (ok) with a nonce',
	`got ${challenge.res.status}`
);

const body = JSON.stringify({ nonce: challenge.json?.nonce ?? '' });
const loginUrl = `${base}/api/auth/login`;
const event = finalizeEvent(
	{
		kind: 27235,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['u', loginUrl],
			['method', 'POST'],
			['payload', createHash('sha256').update(body).digest('hex')]
		],
		content: ''
	},
	sk
);
const loginHeaders = {
	...jsonHeaders,
	origin: new URL(base).origin,
	authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
};
const login = await post('/api/auth/login', { body, headers: loginHeaders });
check(login.res.status === 200, 'POST /api/auth/login: 200 (ok)', `got ${login.res.status} ${JSON.stringify(login.json)}`);
check(login.json?.pubkey === pubkey, 'the answer names the throwaway key', JSON.stringify(login.json));
check(
	(login.res.headers.get('cache-control') ?? '').includes('no-store'),
	'the answer is never cached',
	login.res.headers.get('cache-control')
);

/** The one Set-Cookie header for cookie `name` in a response, or '' (and a FAIL if there are two). */
const setCookieOf = (res, name) => {
	const all = res.headers.getSetCookie().filter((h) => h.startsWith(`${name}=`));
	check(all.length <= 1, `one Set-Cookie for ${name}`, `${all.length}`);
	return all[0] ?? '';
};
const MARKER = '__Host-nozzl_op';
const cleared = (header) => header.startsWith(`${MARKER}=;`) && header.split(';').map((a) => a.trim().toLowerCase()).includes('max-age=0');

const setCookie = setCookieOf(login.res, COOKIE);
const value = setCookie.startsWith(`${COOKIE}=`) ? setCookie.slice(COOKIE.length + 1).split(';')[0] : '';
check(
	new RegExp(`^s2\\.${pubkey}\\.\\d+\\.[A-Za-z0-9_-]+$`).test(value),
	`the cookie is ${COOKIE}, in the s2 format, for this key`,
	setCookie.split(';')[0].slice(0, 40)
);
const attrs = setCookie.split(';').map((a) => a.trim().toLowerCase());
for (const want of ['httponly', 'secure', 'samesite=lax', 'path=/', `max-age=${SESSION_SECONDS}`]) {
	check(attrs.includes(want), `the cookie carries ${want}`, setCookie.replace(value, '<value>'));
}
check(!attrs.some((a) => a.startsWith('domain=')), 'the cookie names no Domain');
check(cleared(setCookieOf(login.res, MARKER)), `a stranger's login clears the operator marker, ${MARKER}`);

const replay = await post('/api/auth/login', { body, headers: loginHeaders });
check(replay.res.status === 401, 'the same login request again: 401 (unauthorized)', `got ${replay.res.status}`);
check(replay.res.headers.get('set-cookie') === null, 'and no cookie for it');

// --- the session, as the site sees it ----------------------------------------------------
if (value) {
	const page = await fetch(`${base}/wip`, { headers: { 'user-agent': MARK, cookie: `${COOKIE}=${value}` } });
	const html = await page.text();
	check(page.status === 200, 'GET /wip with the cookie: 200 (ok)', `got ${page.status}`);
	check(html.includes('auth-chip'), 'the server-rendered nav shows the session, not Log in');

	if (LIVE) {
		const hidden = await fetch(`${base}/marketplaces/recent-listings`, {
			redirect: 'manual',
			headers: { 'user-agent': MARK, cookie: `${COOKIE}=${value}` }
		});
		await hidden.arrayBuffer();
		check(
			hidden.status === 302 && hidden.headers.get('location') === '/marketplaces#gone',
			'a logged-in stranger is still sent away from what is in development',
			`got ${hidden.status} -> ${hidden.headers.get('location')}`
		);
	}

	const out = await post('/api/auth/logout', {
		headers: { origin: new URL(base).origin, cookie: `${COOKIE}=${value}` }
	});
	const emptied = setCookieOf(out.res, COOKIE);
	const emptiedAttrs = emptied.split(';').map((a) => a.trim().toLowerCase());
	check(out.res.status === 200, 'POST /api/auth/logout: 200 (ok)', `got ${out.res.status}`);
	check(emptied.startsWith(`${COOKIE}=;`), 'logout empties the cookie', emptied.slice(0, 40));
	for (const want of ['max-age=0', 'httponly', 'secure', 'samesite=lax', 'path=/']) {
		check(emptiedAttrs.includes(want), `and clears it with ${want}`);
	}
	check(cleared(setCookieOf(out.res, MARKER)), `logout clears the operator marker, ${MARKER}, too`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
