// Signer tests.
//
// The NIP-46 (remote signer / bunker) paths need a real relay and a real bunker, so they
// are not unit-testable here; what IS testable, and is where the bugs actually live, is
// the NIP-07 (browser extension signer) readiness probe and the timeout wrapper. Both
// correspond to defects shipping in real clients today. One bunker fact is pinned with
// nostr-tools' BunkerSigner mocked: the page a bunker asks us to open reaches login's
// callback unchanged, which is where login checks it (session.test.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every statement, so the spy is hoisted with them.
const { fromBunker } = vi.hoisted(() => ({ fromBunker: vi.fn() }));
vi.mock('nostr-tools/nip46', async (importOriginal) => {
	const actual = await importOriginal<typeof import('nostr-tools/nip46')>();
	// Only fromBunker is replaced: the class's other statics resolve through the prototype,
	// and parseBunkerInput stays the real one.
	return { ...actual, BunkerSigner: Object.assign(Object.create(actual.BunkerSigner), { fromBunker }) };
});

import { SignerError, bunkerSigner, extensionSigner, hasNip07, waitForNip07, withTimeout } from './signer';

afterEach(() => {
	delete (window as { nostr?: unknown }).nostr;
	vi.useRealTimers();
});

function fakeExtension(overrides: Record<string, unknown> = {}) {
	return {
		getPublicKey: vi.fn(async () => 'a'.repeat(64)),
		signEvent: vi.fn(async (t: unknown) => ({ ...(t as object), id: 'x', sig: 'y' })),
		...overrides
	};
}

describe('withTimeout', () => {
	it('resolves a fast promise untouched', async () => {
		await expect(withTimeout(Promise.resolve('ok'), 50, 'thing')).resolves.toBe('ok');
	});

	it('rejects when the promise never settles', async () => {
		// THE reason this wrapper exists: nostr-tools' BunkerSigner.sendRequest resolves
		// only when a matching relay event arrives, with no timeout at all - so an offline
		// bunker hangs the UI forever and leaks the listener. applesauce has the same
		// defect; snort is the only surveyed client that sets a timeout.
		await expect(withTimeout(new Promise(() => {}), 10, 'bunker sign')).rejects.toThrow(
			/bunker sign timed out after 10ms/
		);
	});

	it('propagates the original rejection rather than masking it as a timeout', async () => {
		await expect(withTimeout(Promise.reject(new Error('user declined')), 50, 'x')).rejects.toThrow(
			'user declined'
		);
	});

	it('clears its timer on success so the process can exit', async () => {
		vi.useFakeTimers();
		const promise = withTimeout(Promise.resolve(1), 10_000, 'x');
		await expect(promise).resolves.toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('hasNip07', () => {
	it('is false with no extension and true with one', () => {
		expect(hasNip07()).toBe(false);
		(window as { nostr?: unknown }).nostr = fakeExtension();
		expect(hasNip07()).toBe(true);
	});
});

describe('waitForNip07', () => {
	it('resolves immediately when the extension is already present', async () => {
		const ext = fakeExtension();
		(window as { nostr?: unknown }).nostr = ext;
		await expect(waitForNip07(50)).resolves.toBe(ext);
	});

	it('RESOLVES FOR AN EXTENSION THAT INJECTS LATE', async () => {
		// The bug this exists to avoid. NIP-07 (browser extension signer) defines no ready event - its whole
		// mitigation is a recommendation that extensions load at `document_end` - so a
		// synchronous check at mount misses a late injection and the login button never
		// lights up. Coracle, snort, noStrudel and habla all ship exactly that.
		const ext = fakeExtension();
		setTimeout(() => {
			(window as { nostr?: unknown }).nostr = ext;
		}, 60);
		await expect(waitForNip07(2000, 10)).resolves.toBe(ext);
	});

	it('rejects after the timeout when no extension ever appears', async () => {
		await expect(waitForNip07(40, 10)).rejects.toThrow(SignerError);
	});

	it('stops polling once it has given up', async () => {
		vi.useFakeTimers();
		const promise = waitForNip07(40, 10);
		const assertion = expect(promise).rejects.toThrow(/no NIP-07 extension found/);
		await vi.advanceTimersByTimeAsync(60);
		await assertion;
		// A leaked interval would keep the tab busy forever on a page with no extension.
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('extensionSigner', () => {
	it('reports its method, so the auth path can be logged', () => {
		expect(extensionSigner().method).toBe('nip07');
	});

	it('delegates to window.nostr', async () => {
		const ext = fakeExtension();
		(window as { nostr?: unknown }).nostr = ext;
		const signer = extensionSigner();
		await expect(signer.getPublicKey()).resolves.toBe('a'.repeat(64));
		await signer.signEvent({ kind: 27235, created_at: 0, tags: [], content: '' });
		expect(ext.signEvent).toHaveBeenCalledOnce();
	});

	it('fails with a clear error when no extension is installed', async () => {
		await expect(extensionSigner(20).getPublicKey()).rejects.toThrow(/no NIP-07 extension/);
	});

	it('closes without error even though there is nothing to tear down', async () => {
		// The extension owns its own lifecycle; close() must still be safe to call so the
		// login flow can use one `finally` for both signer kinds.
		await expect(extensionSigner().close()).resolves.toBeUndefined();
	});
});

describe('bunkerSigner', () => {
	it("hands login's callback to nostr-tools unchanged, as the onauth it calls with the bunker's page", async () => {
		const BUNKER_PUBKEY = 'b'.repeat(64);
		const onAuthUrl = vi.fn();
		const remote = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
		fromBunker.mockReturnValueOnce(remote);

		const signer = await bunkerSigner(`bunker://${BUNKER_PUBKEY}?relay=wss://relay.example`, onAuthUrl);

		expect(fromBunker).toHaveBeenCalledTimes(1);
		const [, pointer, params] = fromBunker.mock.calls[0];
		expect(pointer.pubkey).toBe(BUNKER_PUBKEY);
		expect(params.onauth).toBe(onAuthUrl);
		expect(remote.connect).toHaveBeenCalledTimes(1);
		await signer.close();
		expect(remote.close).toHaveBeenCalledTimes(1);
	});
});
