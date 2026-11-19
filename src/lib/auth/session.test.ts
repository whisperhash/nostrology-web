// Session store + login flow.
//
// The login flow is mocked at the fetch boundary (the network) and at the signer
// boundary (the extension, or a bunker), so what is exercised here is our
// orchestration: the order of the calls, the exact bytes signed, and - most
// importantly - that the signer is always released and no key material is ever
// persisted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildNip98Token, hydrate, login, logout, session } from './session';
import type { LoginSigner } from './signer';
import { installStorage } from '$lib/testing/mem-storage';
import { OPERATOR_PUBKEY } from '$lib/unreleased';
import { reloadPage } from './reload';

const PK = 'a'.repeat(63) + 'b';

vi.mock('./profile', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./profile')>();
	return {
		...actual,
		// The network half is covered in profile.test.ts; here it must merely not fire.
		fetchProfile: vi.fn(async (pubkey: string) => ({
			pubkey,
			name: 'Alice',
			createdAt: 1
		}))
	};
});

function fakeSigner(overrides: Partial<LoginSigner> = {}): LoginSigner & { closed: number } {
	const signer = {
		method: 'nip07' as const,
		closed: 0,
		getPublicKey: async () => PK,
		signEvent: async (t: { kind: number; tags: string[][] }) => ({
			...t,
			id: 'id',
			pubkey: PK,
			sig: 'sig',
			content: ''
		}),
		close: async () => {
			signer.closed += 1;
		},
		...overrides
	};
	return signer as LoginSigner & { closed: number };
}

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('./reload', () => ({ reloadPage: vi.fn() }));

vi.mock('./signer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./signer')>();
	return {
		...actual,
		extensionSigner: () => currentSigner,
		// A bunker that, while connecting, asks for approval in its own web page: the NIP-46
		// (remote signer / bunker) `auth_url`, which arrives as whatever JSON value it sent.
		bunkerSigner: async (_input: string, onAuthUrl: (url: unknown) => void) => {
			if (bunkerAuthUrl !== NO_AUTH_URL) onAuthUrl(bunkerAuthUrl);
			return currentSigner;
		}
	};
});

let currentSigner: LoginSigner & { closed: number };
const NO_AUTH_URL = Symbol('no auth_url');
let bunkerAuthUrl: unknown = NO_AUTH_URL;

beforeEach(() => {
	currentSigner = fakeSigner();
	bunkerAuthUrl = NO_AUTH_URL;
	session.set({
		hydrated: false,
		pubkey: null,
		profile: null,
		status: 'anonymous',
		error: null,
		connectUri: null
	});
	// The test environment stubs localStorage as an inert empty object, so anything that
	// actually persists needs a real Storage installed to be exercised at all.
	installStorage();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Mock the two-call login handshake. */
function stubLoginFetch(loginResponse: { ok: boolean; body?: unknown; status?: number }) {
	const calls: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			if (String(url).includes('/auth/challenge')) {
				return new Response(JSON.stringify({ nonce: 'n1.123.salt.mac' }), { status: 200 });
			}
			return new Response(JSON.stringify(loginResponse.body ?? {}), {
				status: loginResponse.ok ? 200 : (loginResponse.status ?? 401)
			});
		})
	);
	return calls;
}

describe('hydrate', () => {
	it('marks the store hydrated even for an anonymous visitor', async () => {
		// The flag is what makes the store authoritative over the server-rendered prop -
		// without it, logout would fall back to a stale SSR value and an operator-only nav
		// item would linger until the next page load.
		await hydrate(null);
		expect(get(session).hydrated).toBe(true);
		expect(get(session).pubkey).toBeNull();
	});

	it('paints a placeholder immediately, then fills in the profile', async () => {
		await hydrate({ pubkey: PK });
		const state = get(session);
		expect(state.pubkey).toBe(PK);
		expect(state.profile?.name).toBe('Alice');
	});

	it('caches the fetched profile so the next load paints instantly', async () => {
		await hydrate({ pubkey: PK });
		expect(localStorage.getItem(`nostrology:profile:${PK}`)).toContain('Alice');
	});

	it('serves a fresh cached profile without re-fetching', async () => {
		const profile = await import('./profile');
		localStorage.setItem(
			`nostrology:profile:${PK}`,
			JSON.stringify({ at: Date.now(), profile: { pubkey: PK, name: 'Cached', createdAt: 1 } })
		);
		await hydrate({ pubkey: PK });
		expect(get(session).profile?.name).toBe('Cached');
		expect(vi.mocked(profile.fetchProfile)).not.toHaveBeenCalled();
	});

	it('ignores a corrupt cache entry rather than breaking the nav', async () => {
		localStorage.setItem(`nostrology:profile:${PK}`, 'not json');
		await hydrate({ pubkey: PK });
		expect(get(session).profile?.name).toBe('Alice');
	});

	/**
	 * A cached profile is re-sanitized on READ, not trusted because it was sanitized on
	 * write. localStorage is same-origin-writable, so an XSS, a browser extension, or a
	 * future build with a different Profile shape can put anything under this key - and
	 * what comes back is rendered directly in the site's identity control.
	 *
	 * Values below are written as \u escapes to keep this file plain ASCII.
	 */
	describe('a poisoned cache entry cannot reach the nav', () => {
		const poison = (profile: Record<string, unknown>) =>
			localStorage.setItem(
				`nostrology:profile:${PK}`,
				JSON.stringify({ at: Date.now(), profile: { pubkey: PK, createdAt: 1, ...profile } })
			);

		it('strips an RTL override from the name', async () => {
			// U+202E reverses the text that follows it, which is how a name escapes its box
			// and rewrites the chrome around it.
			poison({ name: '\u202Egnp.exe' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.name).toBe('gnp.exe');
		});

		it('strips zero-width characters used to forge a lookalike', async () => {
			poison({ name: 'Al\u200Bice' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.name).toBe('Alice');
		});

		it('drops a data: picture rather than putting its bytes in an <img>', async () => {
			poison({ name: 'X', picture: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.picture).toBeUndefined();
		});

		it('drops a non-https picture', async () => {
			poison({ name: 'X', picture: 'http://insecure.example/a.jpg' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.picture).toBeUndefined();
		});

		it('keeps a legitimate https picture', async () => {
			poison({ name: 'X', picture: 'https://blossom.example/a.jpg' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.picture).toBe('https://blossom.example/a.jpg');
		});

		it('drops a NIP-05 (DNS identifier) handle that is not one', async () => {
			poison({ name: 'X', nip05: 'not-an-identifier' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.nip05).toBeUndefined();
		});

		it('falls back to the short npub when the name sanitizes to nothing', async () => {
			poison({ name: '\u200B\u200B' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.name).toMatch(/^npub1/);
		});

		it('still serves a clean cached profile unchanged', async () => {
			// The hardening must not cost the cache its purpose.
			poison({ name: 'Cached' });
			await hydrate({ pubkey: PK });
			expect(get(session).profile?.name).toBe('Cached');
		});
	});
});

describe('login', () => {
	it('completes the handshake and authenticates', async () => {
		const calls = stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await expect(login({ kind: 'extension' })).resolves.toBe(true);

		// Both same-origin: a relative challenge path, and a login URL on this page's origin.
		expect(calls[0]?.url).toBe('/api/auth/challenge');
		expect(calls[1]?.url).toBe(new URL('/api/auth/login', window.location.origin).toString());
		expect(get(session).status).toBe('authenticated');
		expect(get(session).pubkey).toBe(PK);
	});

	it('SIGNS THE EXACT BYTES IT SENDS', async () => {
		// The server hashes the RAW request body for the NIP-98 (HTTP auth) payload tag. If the body
		// were re-serialized between hashing and sending, every login would get 401 (unauthorized),
		// with an error that points nowhere near the cause.
		const calls = stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });

		const loginCall = calls[1]!;
		const sentBody = loginCall.init?.body as string;
		const header = (loginCall.init?.headers as Record<string, string>).authorization;
		const event = JSON.parse(atob(header.replace(/^Nostr /, '')));
		const payloadTag = event.tags.find((t: string[]) => t[0] === 'payload')?.[1];

		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sentBody));
		const expected = Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		expect(payloadTag).toBe(expected);
	});

	it('signs a kind-27235 event bound to the login URL and method', async () => {
		const calls = stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		const header = (calls[1]!.init?.headers as Record<string, string>).authorization;
		const event = JSON.parse(atob(header.replace(/^Nostr /, '')));
		expect(event.kind).toBe(27235);
		expect(event.tags.find((t: string[]) => t[0] === 'method')?.[1]).toBe('POST');
		expect(event.tags.find((t: string[]) => t[0] === 'u')?.[1]).toBe(
			new URL('/api/auth/login', window.location.origin).toString()
		);
	});

	it('RELEASES THE SIGNER even when login fails', async () => {
		// Holding a NIP-46 (remote signer / bunker) client key any longer than the one signature is pure risk, and
		// a leaked relay subscription keeps sockets open.
		stubLoginFetch({ ok: false, body: { error: 'invalid or expired challenge' } });
		await expect(login({ kind: 'extension' })).resolves.toBe(false);
		expect(currentSigner.closed).toBe(1);
		expect(get(session).status).toBe('error');
		expect(get(session).error).toContain('invalid or expired challenge');
	});

	it('releases the signer on success too', async () => {
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		expect(currentSigner.closed).toBe(1);
	});

	it('surfaces a declined signature without wedging the UI', async () => {
		currentSigner = fakeSigner({
			signEvent: async () => {
				throw new Error('user rejected');
			}
		});
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await expect(login({ kind: 'extension' })).resolves.toBe(false);
		expect(get(session).status).toBe('error');
		expect(get(session).pubkey).toBeNull();
	});

	it('NEVER PERSISTS KEY MATERIAL', async () => {
		// The single most important property of the whole feature. Most Nostr clients
		// store an nsec in localStorage; we hold no key at all, and the only thing cached
		// is a public profile.
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
		const dump = keys.map((k) => `${k}=${localStorage.getItem(k)}`).join('\n');
		expect(dump).not.toContain('nsec');
		expect(dump).not.toContain('"sig"');
		expect(keys.every((k) => k.startsWith('nostrology:profile:'))).toBe(true);
	});
});

describe("a bunker's approval page (NIP-46 (remote signer / bunker) auth_url)", () => {
	// The bunker chooses this URL, and window.open runs a javascript: URL in this page's origin,
	// so only an http(s) address is ever opened.
	const BUNKER = { kind: 'bunker' as const, input: `bunker://${PK}?relay=wss://relay.example` };

	it('opens an http(s) page, in the form the URL parser gives it', async () => {
		bunkerAuthUrl = 'HTTPS://Signer.Example/approve?request=1';
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await expect(login(BUNKER)).resolves.toBe(true);
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith('https://signer.example/approve?request=1', 'nostr-auth', 'width=420,height=640');
	});

	it.each<unknown>([
		'javascript:alert(document.domain)',
		' JavaScript:alert(1)',
		'java\tscript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'//evil.example/approve',
		'https://signer.example@evil.example/',
		42,
		{ href: 'https://signer.example/approve' },
		null
	])('never opens %j, and says why in the console', async (url) => {
		bunkerAuthUrl = url;
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		// Login itself only declines to open the page. Whether the login then completes is the
		// bunker's to decide (the user may approve inside the signer): this fake connects at once,
		// where a real bunker would hold the request until then or until the connect timeout.
		await expect(login(BUNKER)).resolves.toBe(true);
		expect(open).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('not opened'));
	});
});

describe('logout', () => {
	it('clears the session and the cached profile, through the logout endpoint', async () => {
		const calls = stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		expect(localStorage.getItem(`nostrology:profile:${PK}`)).not.toBeNull();

		await logout();
		expect(calls.at(-1)).toMatchObject({ url: '/api/auth/logout', init: { method: 'POST' } });
		expect(get(session).pubkey).toBeNull();
		expect(get(session).hydrated).toBe(true);
		expect(localStorage.getItem(`nostrology:profile:${PK}`)).toBeNull();
	});

	it('clears locally even if the server call fails', async () => {
		// A user who clicked "Log out" must never still look logged in. The cookie expires
		// on its own regardless.
		await hydrate({ pubkey: PK });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(logout()).resolves.toBeUndefined();
		expect(get(session).pubkey).toBeNull();
	});
});

describe('buildNip98Token', () => {
	it('produces a base64 Nostr authorization header', async () => {
		const token = await buildNip98Token(fakeSigner(), 'https://x.test/a', 'POST', '{"nonce":"n"}');
		expect(token.startsWith('Nostr ')).toBe(true);
		const event = JSON.parse(atob(token.replace(/^Nostr /, '')));
		expect(event.kind).toBe(27235);
		expect(event.content).toBe('');
	});
});

describe('hydration hardening', () => {
	// Regressions from review. Each of these was a real defect.

	it('re-runs the server loads after login, so SSR props stop saying anonymous', async () => {
		// +layout.server.ts reads only `locals`, so it declares no dependencies and
		// SvelteKit will not re-run it on its own. Without this, every component that
		// falls back to the server-rendered prop keeps rendering "logged out".
		const { invalidateAll } = await import('$app/navigation');
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		expect(vi.mocked(invalidateAll)).toHaveBeenCalled();
	});

	it('re-runs the server loads after logout too', async () => {
		const { invalidateAll } = await import('$app/navigation');
		vi.mocked(invalidateAll).mockClear();
		await hydrate({ pubkey: PK });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
		await logout();
		expect(vi.mocked(invalidateAll)).toHaveBeenCalled();
	});
});

describe("the operator's login and logout reload the page", () => {
	// Whether a page loads Google Analytics is decided once per full page load, and the
	// operator's pages must load none while a signed-out page must. A login or logout that
	// only re-ran the server loads would leave the old decision in force in this tab.

	beforeEach(async () => {
		const { invalidateAll } = await import('$app/navigation');
		vi.mocked(invalidateAll).mockClear();
		vi.mocked(reloadPage).mockClear();
	});

	it("reloads after the operator's login, instead of re-running the loads", async () => {
		const { invalidateAll } = await import('$app/navigation');
		stubLoginFetch({ ok: true, body: { pubkey: OPERATOR_PUBKEY } });
		expect(await login({ kind: 'extension' })).toBe(true);
		expect(vi.mocked(reloadPage)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(invalidateAll)).not.toHaveBeenCalled();
	});

	it("does not reload after anyone else's login", async () => {
		stubLoginFetch({ ok: true, body: { pubkey: PK } });
		await login({ kind: 'extension' });
		expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
	});

	it("reloads after the operator's logout", async () => {
		const { invalidateAll } = await import('$app/navigation');
		await hydrate({ pubkey: OPERATOR_PUBKEY });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
		await logout();
		expect(vi.mocked(reloadPage)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(invalidateAll)).not.toHaveBeenCalled();
	});

	it("does not reload after anyone else's logout", async () => {
		await hydrate({ pubkey: PK });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
		await logout();
		expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
	});

	it('trusts the server-rendered session: hydrating calls no auth endpoint', async () => {
		// The session came from the cookie's HMAC on the server; there is nothing to re-check.
		// Only the profile fetch (to relays, stubbed here) may follow.
		const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		await hydrate({ pubkey: PK });
		const urls = fetchSpy.mock.calls.map((c) => String((c as unknown[])[0]));
		expect(urls.filter((u) => u.includes('/auth/'))).toEqual([]);
		expect(get(session)).toMatchObject({ hydrated: true, pubkey: PK, status: 'authenticated' });
	});
});

describe('the token the browser builds, against the server that checks it', () => {
	it('verifies with a real key: the right URL, method, body hash, and created_at in SECONDS', async () => {
		const { verifyNip98 } = await import('$lib/server/auth/nip98');
		const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
		const sk = generateSecretKey();
		const realSigner = {
			getPublicKey: async () => getPublicKey(sk),
			signEvent: async (t: { kind: number; created_at: number; tags: string[][]; content: string }) =>
				finalizeEvent(t, sk),
			close: async () => {}
		};
		const url = 'https://nostrolo.gy/api/auth/login';
		const body = JSON.stringify({ nonce: 'n1.1.s.m' });
		const authorization = await buildNip98Token(realSigner as never, url, 'POST', body);
		const event = verifyNip98({
			authorization,
			url,
			method: 'POST',
			body: new TextEncoder().encode(body),
			nowSeconds: Math.floor(Date.now() / 1000)
		});
		expect(event.pubkey).toBe(getPublicKey(sk));
		expect(Math.abs(event.created_at - Date.now() / 1000)).toBeLessThan(5);
	});
});
