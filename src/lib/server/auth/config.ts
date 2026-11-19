// What login needs from the environment, read in one place, so the hook that verifies
// sessions and the endpoints that mint them can never disagree about it.
//
// Two settings, both required for login to exist at all:
//
//  - AUTH_SESSION_SECRET, the HMAC key for the challenge nonce and the session cookie. At least
//    MIN_SESSION_SECRET_CHARS characters, or the site is treated as UNCONFIGURED: every session
//    reads as anonymous and the login endpoints answer 503 (service unavailable). A short key is
//    refused rather than used because whoever can guess the key can forge any session,
//    including the operator's (see $lib/unreleased). The deployment generates 32 random bytes,
//    44 characters of base64.
//  - ORIGIN, the site's public origin, which adapter-node also builds every request URL from.
//    Login signs it into each token's `u` tag (./nip98, signedUrlFor) and checks each browser
//    request's Origin header against it. Unset, the request URL would come from the Host header
//    a client controls, so login refuses to run instead.

export const MIN_SESSION_SECRET_CHARS = 32;

/** 30 days. Rolling: every login mints a fresh cookie. There is no server-side revocation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The operator's session lasts 400 days instead: the longest a browser keeps a cookie (Chrome
 * and Firefox cap a cookie's lifetime there), so the operator signs in once a year per browser,
 * however long that browser sits unused. Nobody else gets it: for them a
 * session only changes the nav, and a long-lived bearer cookie that cannot be revoked is not
 * worth handing to every visitor.
 */
export const OPERATOR_SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * THE OPERATOR MARKER: a second cookie, set beside the operator's session by the same login
 * response and cleared with it by the same logout response, so the two are born and die
 * together. Its value is OPERATOR_MARKER from the environment, a secret the edge also holds:
 * Caddy tags `operator=1` in the access log for a request whose marker equals it (the
 * Caddyfile's (operator-marker) snippet). A marker that arrives without the operator's session
 * is cleared by the hook (src/hooks.server.ts), so it outlives no session.
 *
 * WHY A SECOND COOKIE, when the session already says who this is: Caddy cannot check the
 * session's HMAC, and the session's pubkey is in clear, so an edge rule keyed on it could be
 * met by any stranger writing a fake session cookie. A value nobody else knows cannot. And the
 * tag must come from the edge, not the app: the app never sees static assets (adapter-node
 * serves them before any hook runs) nor what Caddy answers itself, and the traffic analysis
 * counts every request a browser makes.
 *
 * WHAT A LEAKED MARKER WOULD GIVE: the tag, and nothing else. Analytics and the unreleased
 * sections follow the session alone (hooks.server.ts, $lib/unreleased).
 *
 * The `__Host-` prefix makes the browser enforce Secure, Path=/ and no Domain, so a page on the
 * blob subdomain, which serves content other people supply, cannot set a cookie of that name
 * for this host. And the tag itself is unforgeable: only the exact secret makes it, so no
 * other cookie can fake it.
 */
export const OPERATOR_MARKER_COOKIE = '__Host-nozzl_op';

/** The operator marker's value: exactly 64 lowercase hex characters, as the deployment generates. */
const MARKER_FORMAT = /^[0-9a-f]{64}$/;

/** How long a challenge stays usable. A NIP-46 (remote signer) round trip fits easily. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Clock-skew tolerance for the signed token's created_at, in both directions. */
export const MAX_SKEW_SECONDS = 60;

/**
 * How long a spent nonce must be remembered whatever the pressure on the set: a captured login
 * request stays replayable while its token's created_at is inside the window, which from the
 * moment of the claim is at most twice the skew (a token dated up to the skew ahead, accepted
 * until the skew behind). Plus a margin. See SpentNonces.
 */
export const REPLAY_WINDOW_MS = (2 * MAX_SKEW_SECONDS + 30) * 1000;

/**
 * The session cookie's default name. The `__Host-` prefix makes the browser itself enforce
 * Secure, Path=/ and no Domain, so a sibling subdomain (this site serves user blobs from one)
 * can neither plant nor overwrite the session. A configured name must keep the prefix.
 */
export const DEFAULT_COOKIE_NAME = '__Host-nostrology_session';

/** The login endpoint's path: the URL a client signs is ORIGIN plus exactly this. */
export const LOGIN_PATH = '/api/auth/login';

type Env = Record<string, string | undefined>;

/** The session key, or undefined when it is missing or too short to be one. */
export function sessionSecret(env: Env): string | undefined {
	const secret = env.AUTH_SESSION_SECRET;
	return typeof secret === 'string' && secret.length >= MIN_SESSION_SECRET_CHARS
		? secret
		: undefined;
}

/** AUTH_COOKIE_NAME if it keeps the `__Host-` prefix, else the default. */
export function cookieName(env: Env): string {
	const name = env.AUTH_COOKIE_NAME;
	return typeof name === 'string' && /^__Host-[A-Za-z0-9_-]+$/.test(name) ? name : DEFAULT_COOKIE_NAME;
}

/**
 * OPERATOR_MARKER, or undefined when it is missing or not 64 lowercase hex characters. Then an
 * operator login sets no marker (it clears any it finds), so the operator's requests go untagged
 * rather than tagged with a guessable value. Caddy refuses to match an empty one either.
 */
export function operatorMarker(env: Env): string | undefined {
	const marker = env.OPERATOR_MARKER;
	return typeof marker === 'string' && MARKER_FORMAT.test(marker) ? marker : undefined;
}

/** The configured public origin (scheme, host and port only), or undefined if unusable. */
export function siteOrigin(env: Env): string | undefined {
	const raw = env.ORIGIN;
	if (typeof raw !== 'string' || raw === '') return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
	} catch {
		return undefined;
	}
}

export interface LoginConfig {
	origin: string;
	secret: string;
	cookieName: string;
}

/** Everything login needs, or null when the deployment is not configured for it. */
export function loginConfig(env: Env): LoginConfig | null {
	const origin = siteOrigin(env);
	const secret = sessionSecret(env);
	if (origin === undefined || secret === undefined) return null;
	return { origin, secret, cookieName: cookieName(env) };
}
