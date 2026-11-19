// Client-side login orchestration and the session store.
//
// The store is DISPLAY state only. The authoritative session is the HttpOnly cookie
// minted by POST /api/auth/login, which the browser cannot read - so nothing here can grant
// itself access, and a page load is hydrated from the server (hooks.server.ts ->
// +layout.server.ts) rather than from anything persisted locally.
//
// The only thing kept in localStorage is the last fetched PROFILE, cached per pubkey so
// the avatar paints instantly on the next page load instead of flashing a letter tile
// while a relay round trip completes. It is a rendering convenience holding public data;
// losing it costs one fetch. No key, no token, no session material - ever.
//
// A `svelte/store` writable rather than a rune, deliberately: this module is imported by
// SiteNav, which is written in Svelte 4 style (`export let`, `$:`), and a store works
// identically in both dialects.

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';
import {
	displayHandle,
	fetchProfile,
	placeholderProfile,
	safeName,
	safePictureUrl,
	shortNpub,
	type Profile
} from './profile';
import { extensionSigner, bunkerSigner, nostrConnectSigner, type LoginSigner } from './signer';
import { reloadPage } from './reload';
import { isOperator } from '$lib/unreleased';
import { sanitizeExternalUrl } from '$lib/utils/externalUrl';

export interface SessionState {
	/**
	 * True once hydrate() has run in the browser.
	 *
	 * This flag decides WHO IS AUTHORITATIVE about the identity. Before hydration the store
	 * holds nothing, so the nav must trust the server-rendered value passed as a prop;
	 * after hydration the store is authoritative, which is what lets a login or a logout
	 * update the nav immediately without a navigation. Without the flag, logout would
	 * fall back to the stale SSR prop and an operator-only item would linger until the next
	 * page load.
	 */
	hydrated: boolean;
	pubkey: string | null;
	profile: Profile | null;
	/** Where we are in the login flow, for the UI to narrate. */
	status: 'anonymous' | 'connecting' | 'awaiting-signature' | 'authenticated' | 'error';
	error: string | null;
	/** Set while a nostrconnect:// QR should be displayed. */
	connectUri: string | null;
}

const INITIAL: SessionState = {
	hydrated: false,
	pubkey: null,
	profile: null,
	status: 'anonymous',
	error: null,
	connectUri: null
};

export const session = writable<SessionState>(INITIAL);

const PROFILE_KEY = (pubkey: string) => `nostrology:profile:${pubkey}`;
/** How long a cached profile is served before a background refresh. */
const PROFILE_STALE_MS = 60 * 60 * 1000;

function readCachedProfile(pubkey: string): { profile: Profile; at: number } | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(PROFILE_KEY(pubkey));
		if (raw === null) return null;
		const parsed = JSON.parse(raw) as { profile?: Profile; at?: number };
		if (parsed.profile?.pubkey !== pubkey || typeof parsed.at !== 'number') return null;
		// Re-sanitize on the way OUT, not just on the way in.
		//
		// What lands here was sanitized by parseProfile() when it was written - but
		// localStorage is same-origin-writable, so the value that comes back is not
		// necessarily the value we put in. An entry written by an XSS, a browser
		// extension, or simply a future build with a different Profile shape would
		// otherwise reach the nav with NO sanitization at all: an RTL override in
		// `name` reverses the surrounding chip text, and a `data:` URL in `picture`
		// puts attacker-controlled bytes of unbounded size straight into an <img>.
		// Both are the exact primitives safeName() and safePictureUrl() exist to stop.
		//
		// The cost is three cheap string passes on a cache hit. Cheaper than reasoning
		// about whether every writer of this key, forever, was the one we expect.
		const cached = parsed.profile;
		return {
			profile: {
				pubkey,
				name: safeName(typeof cached.name === 'string' ? cached.name : '') || shortNpub(pubkey),
				picture: safePictureUrl(cached.picture),
				nip05: displayHandle(cached.nip05),
				createdAt: typeof cached.createdAt === 'number' ? cached.createdAt : 0
			},
			at: parsed.at
		};
	} catch {
		// Private mode, quota, corrupt entry - all non-events.
		return null;
	}
}

function writeCachedProfile(profile: Profile): void {
	if (!browser) return;
	try {
		localStorage.setItem(PROFILE_KEY(profile.pubkey), JSON.stringify({ profile, at: Date.now() }));
	} catch {
		/* storage unavailable - the profile simply re-fetches next time */
	}
}

/**
 * Hydrate from the server-rendered session, then fill in the profile.
 *
 * BROWSER ONLY, and call it ONCE on mount - never from a reactive statement.
 *
 * Two bugs live here if you get that wrong, both found in review:
 *
 *  1. `+layout.server.ts` reads only `locals`, so it declares no dependencies and
 *     SvelteKit does NOT re-run it on client-side navigation - `data.session` stays
 *     whatever it was at the last full page load. But SvelteKit rebuilds `data` on every
 *     navigation, so a reactive `$: hydrate(data.session)` re-fires with a STALE null and
 *     logs the user straight back out. That is the demo path: log in, click a nav link,
 *     watch the chip revert.
 *  2. A reactive statement in a Svelte 5 component body also runs during SSR. That would
 *     fire a third-party POST to Primal from our server on every page render (telling
 *     them which pubkey is browsing which page - exactly what +layout.server.ts's comment
 *     says the client-side fetch exists to avoid) and would mutate this module-scope
 *     store, which adapter-node shares across concurrent requests.
 */
export async function hydrate(server: { pubkey: string } | null): Promise<void> {
	if (!browser) return;
	if (server === null) {
		session.set({ ...INITIAL, hydrated: true });
		return;
	}
	const cached = readCachedProfile(server.pubkey);
	session.set({
		hydrated: true,
		pubkey: server.pubkey,
		// Paint immediately: cached profile, else a short-npub placeholder. Never a
		// spinner in the nav.
		profile: cached?.profile ?? placeholderProfile(server.pubkey),
		status: 'authenticated',
		error: null,
		connectUri: null
	});

	// Fresh enough - leave it.
	if (cached !== null && Date.now() - cached.at < PROFILE_STALE_MS) return;

	const profile = await fetchProfile(server.pubkey);
	writeCachedProfile(profile);
	session.update((state) =>
		// Guard against a logout (or a different login) landing while the fetch was in
		// flight, which would otherwise resurrect a stale identity in the nav.
		state.pubkey === server.pubkey ? { ...state, profile } : state
	);
}

export type LoginMethod =
	| { kind: 'extension' }
	| { kind: 'bunker'; input: string }
	| { kind: 'nostrconnect'; signal?: AbortSignal };

function makeSigner(
	method: LoginMethod,
	onConnectUri: (uri: string) => void,
	onAuthUrl: (url: unknown) => void
): Promise<LoginSigner> {
	switch (method.kind) {
		case 'extension':
			return Promise.resolve(extensionSigner());
		case 'bunker':
			return bunkerSigner(method.input, onAuthUrl);
		case 'nostrconnect':
			return nostrConnectSigner(onConnectUri, method.signal);
	}
}

/**
 * The full login: connect a signer, get a challenge, sign ONE kind-27235
 * (NIP-98 HTTP auth) event, exchange it for a session cookie.
 *
 * The signer is closed and dropped in the `finally` regardless of outcome - we never
 * need it again, and holding a NIP-46 (remote signer / bunker) client key any longer than necessary is pure risk.
 */
export async function login(method: LoginMethod): Promise<boolean> {
	session.update((s) => ({ ...s, status: 'connecting', error: null, connectUri: null }));
	let signer: LoginSigner | undefined;
	try {
		signer = await makeSigner(
			method,
			(uri) => session.update((s) => ({ ...s, connectUri: uri })),
			(url) => {
				// A bunker may need the user to approve in its own web UI. A popup blocker
				// allows this only while the click that started login still counts as
				// recent, so a page that arrives after slow round trips can be blocked, and
				// nothing tells the user yet. The bunker chooses the URL, and window.open runs
				// a javascript: URL in this page's origin, so only an http(s) address is
				// opened, in the form sanitizeExternalUrl parsed.
				const page = sanitizeExternalUrl(url);
				if (page === null) {
					console.warn('[auth] the signer asked to open a page that is not an http(s) address; not opened');
					return;
				}
				if (browser) window.open(page, 'nostr-auth', 'width=420,height=640');
			}
		);
		const pubkey = await signer.getPublicKey();

		const challengeRes = await fetch('/api/auth/challenge', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkey })
		});
		if (!challengeRes.ok) throw new Error(`challenge failed (${challengeRes.status})`);
		const { nonce } = (await challengeRes.json()) as { nonce: string };

		session.update((s) => ({ ...s, status: 'awaiting-signature' }));

		// The body is built ONCE and both hashed and sent, byte for byte. The server
		// hashes the raw bytes it receives, so re-serializing here would break the
		// payload-tag check in a way that is maddening to debug.
		const body = JSON.stringify({ nonce });
		const url = new URL('/api/auth/login', window.location.origin).toString();
		const authorization = await buildNip98Token(signer, url, 'POST', body);

		const loginRes = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization },
			body
		});
		if (!loginRes.ok) {
			const detail = (await loginRes.json().catch(() => ({}))) as { error?: string };
			throw new Error(detail.error ?? `login failed (${loginRes.status})`);
		}
		const result = (await loginRes.json()) as { pubkey: string };
		await hydrate({ pubkey: result.pubkey });
		// The operator's pages carry no Google Analytics, and whether a page loads it is decided
		// once per full page load (src/routes/+layout.svelte). So the operator's login reloads
		// the page: without that, the gtag.js this page loaded before the login would go on
		// counting the operator's in-app navigations. Anyone else's login changes only the nav.
		if (isOperator({ pubkey: result.pubkey })) {
			reloadPage();
			return true;
		}
		// Re-run the server loads so `data.session` matches the cookie we just received.
		// Without this the SSR-rendered props stay anonymous for the rest of the visit,
		// and any component falling back to them (SiteNav, NavAuth) disagrees with the
		// store the moment it re-renders.
		await invalidateAll();
		return true;
	} catch (err) {
		session.update((s) => ({
			...s,
			status: 'error',
			connectUri: null,
			error: err instanceof Error ? err.message : String(err)
		}));
		return false;
	} finally {
		await signer?.close().catch(() => {});
	}
}

/**
 * Build the `Authorization: Nostr <base64>` header for one request.
 *
 * Hand-rolled rather than nostr-tools' `getToken`, for one reason: getToken hashes
 * `JSON.stringify(payload)`, i.e. a RE-SERIALIZED object, while our server hashes the
 * raw request bytes. Passing the exact string we send is the only way the two agree.
 */
export async function buildNip98Token(
	signer: LoginSigner,
	url: string,
	method: string,
	body: string
): Promise<string> {
	const digest = await sha256Hex(body);
	const event = await signer.signEvent({
		kind: 27235,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['u', url],
			['method', method],
			['payload', digest]
		],
		content: ''
	});
	return `Nostr ${btoa(JSON.stringify(event))}`;
}

/**
 * SHA-256 of a UTF-8 string, hex.
 *
 * `crypto.subtle` requires a SECURE CONTEXT. That is satisfied on nostrolo.gy (https)
 * and on http://localhost (which the spec treats as secure), but NOT on a bare-IP or
 * plain-http host - where it is `undefined` and login would fail with a confusing
 * TypeError. This is the same footgun the Bitcoin Connect docs call out for NWC on iOS.
 */
async function sha256Hex(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Log out.
 *
 * Clears the server cookie and the local display state. Nothing needs confirming: unlike
 * nsec.app or nostr-login (whose confirm dialogs exist because they hold the key), we
 * store no key material, so there is nothing to lose. The cached profile is dropped too -
 * it is public data, but leaving one user's avatar in another's browser is untidy.
 */
export async function logout(): Promise<void> {
	const current = get(session).pubkey;
	try {
		await fetch('/api/auth/logout', { method: 'POST' });
	} catch {
		// Even if the call fails, clear locally - the cookie expires on its own and a
		// user who clicked "Log out" must not still look logged in.
	}
	if (browser && current !== null) {
		try {
			localStorage.removeItem(PROFILE_KEY(current));
		} catch {
			/* nothing to clean up */
		}
	}
	session.set({ ...INITIAL, hydrated: true });
	// The operator's logout reloads, for the same reason as their login: this page was loaded
	// without Google Analytics, and a signed-out page must load it.
	if (browser && isOperator({ pubkey: current })) {
		reloadPage();
		return;
	}
	// Same reason as login(): the cookie is gone, so the server-rendered props must be
	// refreshed or they keep asserting an identity that no longer exists.
	if (browser) await invalidateAll();
}
