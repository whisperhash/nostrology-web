// Client-side signers: NIP-07 (browser extension signer) and NIP-46 (remote signer /
// bunker, e.g. Amber or nsec.app). Never a pasted nsec - the key never touches this app.
//
// The signer is used EXACTLY ONCE, at login, to sign one kind-27235 (NIP-98 HTTP auth)
// event. After that a server session cookie carries the identity and the signer is
// closed and discarded. That is the whole reason the login flow is shaped this way: with
// NIP-46 (remote signer / bunker) every signature is a relay round trip plus, for Amber, a human picking up a
// phone. Per-request signing is fine for an extension and unusable for a bunker, and we
// support both.
//
// NOTHING is persisted client-side. In particular the NIP-46 (remote signer / bunker) client secret key is
// generated per login and thrown away: it is an XSS-exfiltratable signing credential,
// and persisting it (as several libraries do by default) would buy us nothing, because
// we never need to sign again.

import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { generateSecretKey, getPublicKey, type EventTemplate, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

/** Relays used to reach a bunker when the user scans our nostrconnect:// QR. */
export const NOSTR_CONNECT_RELAYS = ['wss://relay.nsec.app', 'wss://relay.nsecbunker.com'];

/** Permission we request up front: signing kind-27235 (NIP-98 HTTP auth) and nothing else. */
export const REQUESTED_PERMS = ['sign_event:27235'];

export interface LoginSigner {
	readonly method: 'nip07' | 'nip46';
	getPublicKey(): Promise<string>;
	signEvent(template: EventTemplate): Promise<Event>;
	close(): Promise<void>;
}

export class SignerError extends Error {}

/**
 * Race a promise against a timeout.
 *
 * MANDATORY around every NIP-46 (remote signer / bunker) call. `nostr-tools`' BunkerSigner.sendRequest stores the
 * pending promise and resolves it only when a matching relay event arrives - there is no
 * timeout at all, so an offline bunker hangs the UI forever and leaks the listener.
 * (applesauce has the identical defect; snort is the only surveyed client that sets one.)
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new SignerError(`${what} timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

/**
 * Wait for a NIP-07 (browser extension signer) to appear.
 *
 * NIP-07 (browser extension signer) defines NO ready event - its entire mitigation is a recommendation that
 * extensions inject at `document_end`. A synchronous `if (window.nostr)` at mount
 * therefore misses every extension that injects late, and the login button silently
 * never lights up. That exact bug ships in Coracle, snort, noStrudel and habla today.
 * Poll instead, briefly.
 */
export function waitForNip07(timeoutMs = 2000, pollMs = 100): Promise<NonNullable<Window['nostr']>> {
	return new Promise((resolve, reject) => {
		if (typeof window === 'undefined') {
			reject(new SignerError('no window (server-side render)'));
			return;
		}
		if (window.nostr) {
			resolve(window.nostr);
			return;
		}
		const interval = setInterval(() => {
			if (window.nostr) {
				clearInterval(interval);
				clearTimeout(deadline);
				resolve(window.nostr);
			}
		}, pollMs);
		const deadline = setTimeout(() => {
			clearInterval(interval);
			reject(new SignerError('no NIP-07 extension found'));
		}, timeoutMs);
	});
}

/** True if an extension is available right now. Cheap, synchronous, no waiting. */
export function hasNip07(): boolean {
	return typeof window !== 'undefined' && Boolean(window.nostr);
}

export function extensionSigner(timeoutMs = 2000): LoginSigner {
	return {
		method: 'nip07',
		async getPublicKey() {
			const nostr = await waitForNip07(timeoutMs);
			// Extensions prompt the user here on first use, so this needs a human-scale
			// timeout rather than the probe's.
			return withTimeout(nostr.getPublicKey(), 60_000, 'extension getPublicKey');
		},
		async signEvent(template) {
			const nostr = await waitForNip07(timeoutMs);
			return withTimeout(nostr.signEvent(template), 120_000, 'extension signEvent');
		},
		async close() {
			/* nothing to tear down - the extension owns its own lifecycle */
		}
	};
}

/**
 * Connect to a bunker from a `bunker://` URI (or a NIP-05 (DNS identifier) that
 * advertises one). This is the paste path, and it covers Amber.
 */
export async function bunkerSigner(
	input: string,
	// The page a bunker asks the user to approve in: its JSON value as sent, so `unknown`.
	onAuthUrl: (url: unknown) => void
): Promise<LoginSigner> {
	const pointer = await parseBunkerInput(input.trim());
	if (pointer === null) {
		throw new SignerError('not a bunker:// URI or a NIP-05 identifier with a bunker');
	}
	const pool = new SimplePool();
	// A fresh, disposable client key per login. Never persisted - see the file header.
	const signer = BunkerSigner.fromBunker(generateSecretKey(), pointer, {
		pool,
		onauth: onAuthUrl
	});
	await withTimeout(signer.connect(), 45_000, 'bunker connect');
	return wrapBunker(signer, pool, pointer.relays);
}

/**
 * Client-initiated connection: we generate a `nostrconnect://` URI, show it as a QR, and
 * the signer scans it.
 *
 * NIP-46 (remote signer / bunker) requires the client to generate a `secret` and validate the one the signer
 * echoes back - without that check any relay observer can answer our connect request and
 * become our signer. nostr-tools enforces this from 2.24.3 onward (2.23.3 accepted a URI
 * with no secret at all), which is part of why the version floor matters.
 */
export async function nostrConnectSigner(
	onUri: (uri: string) => void,
	signal?: AbortSignal,
	relays: string[] = NOSTR_CONNECT_RELAYS
): Promise<LoginSigner> {
	const pool = new SimplePool();
	const clientKey = generateSecretKey();
	// crypto.randomUUID() needs a secure context, as does the SHA-256 in session.ts - fine
	// on https and on localhost, absent on a plain-http host.
	const uri = createNostrConnectURI({
		clientPubkey: getPublicKey(clientKey),
		relays,
		secret: crypto.randomUUID(),
		perms: REQUESTED_PERMS,
		name: 'Nostrology'
	});
	onUri(uri);
	const signer = await BunkerSigner.fromURI(clientKey, uri, { pool }, signal);
	return wrapBunker(signer, pool, relays);
}

function wrapBunker(signer: BunkerSigner, pool: SimplePool, relays: string[]): LoginSigner {
	return {
		method: 'nip46',
		getPublicKey: () => withTimeout(signer.getPublicKey(), 45_000, 'bunker get_public_key'),
		// Generous: this is where an Amber user picks up their phone and taps approve.
		signEvent: (template) => withTimeout(signer.signEvent(template), 120_000, 'bunker sign_event'),
		async close() {
			// NIP-46 (remote signer / bunker) says logout is "a courtesy hint and is not a security boundary" and
			// that the client MUST delete its local keypair regardless. Ours is a local
			// const that goes out of scope here; the RPC is best-effort and its failure
			// must never surface to the user.
			try {
				await withTimeout(signer.close(), 5_000, 'bunker close');
			} catch {
				/* best effort */
			}
			try {
				pool.close(relays);
				pool.destroy();
			} catch {
				/* best effort */
			}
		}
	};
}
