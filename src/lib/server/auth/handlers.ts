// Logging in with Nostr: the three endpoints under /api/auth, as plain functions from a
// Request to a Response so they can be tested without SvelteKit. src/routes/api/auth/*
// /+server.ts wire them in.
//
//   1. POST /api/auth/challenge {pubkey} -> {nonce}
//   2. the client signs ONE kind-27235 (NIP-98 HTTP auth) event over the login URL, the
//      method, and a body containing that nonce
//   3. POST /api/auth/login, Authorization: Nostr <token>, body {nonce} -> the session cookie
//   and POST /api/auth/logout clears it.
//
// THE OPERATOR'S LOGIN is the one that differs: its session lasts 400 days rather than 30, and
// the same response sets the operator marker beside it (./config, OPERATOR_MARKER_COOKIE), which
// is what tags the operator's requests in the access log. Every login response sends the
// marker's Set-Cookie, clearing it for anyone else, so a browser that signs in with a second key
// over the operator's session stops being tagged. Logout clears both cookies.
//
// ONE signature per session, not per request. With a NIP-46 (remote signer) every signature is
// a relay round trip and often a person approving it on a phone, so per-request NIP-98 (HTTP
// auth) would work for an extension user and be unusable for a remote-signer user.
//
// The nonce exists because NIP-98 has NO replay protection: within its clock-skew window a
// captured token replays verbatim. A server-issued nonce inside the body that the token's
// `payload` tag commits to closes that without leaving the spec.
//
// ORDER IN EVERY HANDLER: configuration, then the Origin fence, then the body (capped), then
// the cheap checks, then the one expensive one - the signature - then the claim. SvelteKit's own
// CSRF check covers only form content types, so a JSON or type-less POST from a foreign page
// reaches these handlers; the fence refuses it before anything else runs - the sharpest case
// being a third-party page logging a visitor out. The nonce is checked, and its spent set
// asked, BEFORE the signature, so a resent token costs a hash and not a secp256k1 verify; it is
// claimed only AFTER the signature, so a forged attempt cannot burn someone's challenge.
//
// LOGGING: refusals are logged with a reason code, because several failure modes look
// identical from the browser. NEVER logged, at any level: who logged in (the pubkey), the
// client's address, the Authorization header, the token, the nonce, the cookie or the secret.
// Caddy's access line already records each request's path, status and User-Agent.

import type { LoginConfig } from './config';
import {
	loginConfig,
	LOGIN_PATH,
	MAX_SKEW_SECONDS,
	NONCE_TTL_MS,
	OPERATOR_MARKER_COOKIE,
	OPERATOR_SESSION_TTL_MS,
	operatorMarker,
	REPLAY_WINDOW_MS,
	SESSION_TTL_MS
} from './config';
import { bodyMayBePending, readCappedBody } from './body';
import { cookieHeader, mintSessionCookie } from './cookie';
import { decodeToken, Nip98Error, signedUrlFor, verifyNip98 } from './nip98';
import { mintNonce, SpentNonces, verifyNonce } from './nonce';
import { isOperator } from '$lib/unreleased';

export type LogFn = (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;

export interface AuthDeps {
	env: Record<string, string | undefined>;
	/** Single-use enforcement for challenges, shared by every request in the process. */
	spent: SpentNonces;
	/** Test seam. */
	now?: () => number;
	/** Test seam; defaults to one JSON object per line on stdout, the app's log format. */
	log?: LogFn;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The process's spent-challenge set: one app process, so one set. */
const SPENT = new SpentNonces(NONCE_TTL_MS, REPLAY_WINDOW_MS);

const stdoutLog: LogFn = (level, msg, fields = {}) => {
	console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
};

/** The dependencies the routes run with: the real environment, the process's set, the clock. */
export function authDeps(env: Record<string, string | undefined>): AuthDeps {
	return { env, spent: SPENT };
}

/**
 * A JSON response that is never cached and, when the request's body was left unread, closes
 * its connection (see $lib/server/auth/body, bodyMayBePending).
 */
function respond(
	request: Request,
	status: number,
	body: unknown,
	bodyRead: boolean,
	setCookies: string[] = []
): Response {
	const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
	for (const cookie of setCookies) headers.append('set-cookie', cookie);
	if (!bodyRead && bodyMayBePending(request)) headers.set('connection', 'close');
	return new Response(JSON.stringify(body), { status, headers });
}


/** Configuration and the Origin fence, shared by all three handlers. */
function preflight(
	request: Request,
	deps: AuthDeps,
	log: LogFn,
	path: string
): { cfg: LoginConfig } | { refusal: Response } {
	const cfg = loginConfig(deps.env);
	if (cfg === null) {
		// A deploy error, not a client one: it should be zero lines in a healthy deployment.
		log('error', 'auth endpoint unconfigured', { path, needs: 'ORIGIN and AUTH_SESSION_SECRET' });
		return { refusal: respond(request, 503, { error: 'login is not configured' }, false) };
	}
	const origin = request.headers.get('origin');
	// A request with no Origin (curl, a server) passes: the fence is against a browser on
	// another site, and a browser always sends Origin on a POST.
	if (origin !== null && origin !== '' && origin !== cfg.origin) {
		log('info', 'auth request refused', { path, reason: 'origin_not_allowed' });
		return { refusal: respond(request, 403, { error: 'origin not allowed' }, false) };
	}
	return { cfg };
}

/** The body as a JSON object, or null for anything else (`null`, an array, a string, bad UTF-8). */
function jsonObject(bytes: Uint8Array): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export async function handleChallenge(request: Request, deps: AuthDeps): Promise<Response> {
	const log = deps.log ?? stdoutLog;
	const now = deps.now ?? Date.now;
	const path = '/api/auth/challenge';
	const pre = preflight(request, deps, log, path);
	if ('refusal' in pre) return pre.refusal;

	const read = await readCappedBody(request);
	if (!read.ok) {
		log('info', 'auth request refused', { path, reason: read.reason });
		return respond(request, read.status, { error: read.error }, false);
	}
	const body = jsonObject(read.bytes);
	if (body === null) {
		log('info', 'auth request refused', { path, reason: 'bad_body' });
		return respond(request, 400, { error: 'request body must be a JSON object' }, true);
	}
	const pubkey = typeof body.pubkey === 'string' ? body.pubkey.toLowerCase() : '';
	if (!HEX64.test(pubkey)) {
		log('info', 'auth request refused', { path, reason: 'bad_pubkey' });
		return respond(request, 400, { error: 'pubkey must be 64-char hex' }, true);
	}
	// Issued for ANY well-formed pubkey: who may log in is everyone, and refusing some keys
	// here would turn this endpoint into an oracle for whatever list decided it.
	const nonce = mintNonce(pre.cfg.secret, pubkey, now());
	return respond(request, 200, { nonce, expiresInMs: NONCE_TTL_MS }, true);
}

export async function handleLogin(request: Request, deps: AuthDeps): Promise<Response> {
	const log = deps.log ?? stdoutLog;
	const now = deps.now ?? Date.now;
	const started = now();
	const path = LOGIN_PATH;
	const pre = preflight(request, deps, log, path);
	if ('refusal' in pre) return pre.refusal;
	const { cfg } = pre;

	const read = await readCappedBody(request);
	if (!read.ok) {
		log('info', 'auth request refused', { path, reason: read.reason });
		return respond(request, read.status, { error: read.error }, false);
	}
	const body = jsonObject(read.bytes);
	if (body === null) {
		log('info', 'auth request refused', { path, reason: 'bad_body' });
		return respond(request, 400, { error: 'request body must be a JSON object' }, true);
	}
	const nonce = typeof body.nonce === 'string' ? body.nonce : '';
	const authorization = request.headers.get('authorization') ?? undefined;

	// The URL the CLIENT signed, from configuration alone: see signedUrlFor().
	const url = signedUrlFor(LOGIN_PATH, cfg.origin);

	// The cheap half first. The nonce is bound to the pubkey the token CLAIMS: unverified yet,
	// which costs nothing, because the signature below must then be that key's.
	let claimed: string;
	try {
		claimed = decodeToken(authorization).pubkey.toLowerCase();
	} catch (err) {
		const reason = err instanceof Nip98Error ? err.message : 'verification failed';
		log('warn', 'auth login refused', { stage: 'nip98', reason, signed_url: url });
		return respond(request, 401, { error: 'invalid authorization token' }, true);
	}
	const check = verifyNonce(cfg.secret, claimed, nonce, now(), NONCE_TTL_MS);
	if (!check.ok) {
		log('warn', 'auth login refused', { stage: 'nonce', reason: check.reason });
		return respond(request, 401, { error: 'invalid or expired challenge' }, true);
	}
	if (deps.spent.has(nonce, now())) {
		log('warn', 'auth login refused', { stage: 'nonce', reason: 'nonce_replayed' });
		return respond(request, 401, { error: 'challenge already used' }, true);
	}

	let pubkey: string;
	try {
		const event = verifyNip98({
			authorization,
			url,
			method: 'POST',
			body: read.bytes,
			nowSeconds: Math.floor(now() / 1000),
			maxSkewSeconds: MAX_SKEW_SECONDS
		});
		pubkey = event.pubkey.toLowerCase();
	} catch (err) {
		// signed_url is logged because a `u`-tag mismatch is THE symptom of a misconfigured
		// ORIGIN, and it is otherwise invisible. It is configuration, not a secret.
		const reason = err instanceof Nip98Error ? err.message : 'verification failed';
		log('warn', 'auth login refused', { stage: 'nip98', reason, signed_url: url });
		return respond(request, 401, { error: 'invalid authorization token' }, true);
	}

	// `pubkey` is `claimed`: verifyNip98 decodes the same header, and its signature check covers
	// that pubkey. No await since has(), so nothing can have claimed the nonce in between.
	const claim = deps.spent.claim(nonce, now());
	if (claim === 'spent') {
		log('warn', 'auth login refused', { stage: 'nonce', reason: 'nonce_replayed' });
		return respond(request, 401, { error: 'challenge already used' }, true);
	}
	if (claim === 'full') {
		log('warn', 'auth login refused', { stage: 'nonce', reason: 'spent_set_full' });
		return respond(request, 503, { error: 'too many logins at once; try again in a minute' }, true);
	}

	// The operator's session and marker share one lifetime, so they expire together. Nothing
	// here is logged about which kind of login this was: the line below never says who.
	const operator = isOperator({ pubkey });
	const ttlMs = operator ? OPERATOR_SESSION_TTL_MS : SESSION_TTL_MS;
	const maxAge = Math.floor(ttlMs / 1000);
	const expiresAt = now() + ttlMs;
	const cookie = mintSessionCookie(cfg.secret, { pubkey, expiresAt });
	const marker = operator ? operatorMarker(deps.env) : undefined;
	log('info', 'auth login ok', { ms: now() - started });
	return respond(request, 200, { pubkey, expiresAt }, true, [
		cookieHeader(cfg.cookieName, cookie, maxAge),
		marker === undefined
			? cookieHeader(OPERATOR_MARKER_COOKIE, '', 0)
			: cookieHeader(OPERATOR_MARKER_COOKIE, marker, maxAge)
	]);
}

export async function handleLogout(request: Request, deps: AuthDeps): Promise<Response> {
	const log = deps.log ?? stdoutLog;
	const pre = preflight(request, deps, log, '/api/auth/logout');
	if ('refusal' in pre) return pre.refusal;
	// Max-Age=0 clears each. The attributes must match the ones it was set with, or the browser
	// keeps the original. The operator marker goes with the session, so signing out ends the
	// operator's treatment at once. No session is needed: logging out twice is not an error. The
	// body, which a logout never needs, is never read.
	return respond(request, 200, { ok: true }, false, [
		cookieHeader(pre.cfg.cookieName, '', 0),
		cookieHeader(OPERATOR_MARKER_COOKIE, '', 0)
	]);
}
