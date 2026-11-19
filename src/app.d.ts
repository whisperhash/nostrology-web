// Ambient types for the app.
//
// `window.nostr` is declared HERE and not imported, because neither library ships a
// usable global augmentation: nostr-tools' `nip07` entry is a ZERO-BYTE JavaScript file
// whose exports map has only a `types` condition (a runtime import from it throws
// ERR_PACKAGE_PATH_NOT_EXPORTED), and applesauce has the augmentation in its repo but
// does not publish it. So every app writes these few lines itself.

import type { Event, EventTemplate } from 'nostr-tools/core';

declare global {
	/**
	 * NIP-07 (browser extension signer). Injected by an extension (Alby, nos2x, ...) at
	 * an unspecified time - the NIP defines NO ready event, only a recommendation that
	 * extensions load at `document_end`. Always probe for it rather than reading it once
	 * at module scope; see $lib/auth/signer.ts.
	 */
	interface Window {
		nostr?: {
			getPublicKey(): Promise<string>;
			signEvent(event: EventTemplate): Promise<Event>;
			nip04?: {
				encrypt(pubkey: string, plaintext: string): Promise<string>;
				decrypt(pubkey: string, ciphertext: string): Promise<string>;
			};
			nip44?: {
				encrypt(pubkey: string, plaintext: string): Promise<string>;
				decrypt(pubkey: string, ciphertext: string): Promise<string>;
			};
		};
	}

	namespace App {
		interface Locals {
			/**
			 * Verified Nostr identity for this request, or null.
			 *
			 * Set by hooks.server.ts from the session cookie's HMAC - never from anything
			 * the client asserts. The pubkey is 64 lowercase hex.
			 */
			session: { pubkey: string } | null;
			/**
			 * This request is the operator's signed-in session, so no analytics may load.
			 * Set by hooks.server.ts from `session` alone ($lib/unreleased, isOperator).
			 */
			analyticsOff: boolean;
		}
	}
}

export {};
