// Reading a login request's body without letting a client make us read a large one.
//
// The login bodies are tiny: about 80 bytes for a challenge and about 120 for a login. The cap
// has to be enforced here, because adapter-node's BODY_SIZE_LIMIT is compared only with the
// Content-Length header: a body sent in chunks, with no declared length, streams through
// uncapped, and `request.arrayBuffer()` would buffer all of it.

/** Raw body cap for the login endpoints. Pure denial-of-service hygiene. */
export const AUTH_BODY_LIMIT_BYTES = 4096;

export type BodyResult =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; status: 400 | 413 | 415; error: string; reason: string };

/**
 * Whether the request may still have body bytes on the connection that nobody read.
 *
 * A response that leaves a body unread has to close the connection (see the handlers'
 * `Connection: close`): Node otherwise keeps it alive and drains the rest in the background,
 * and the next request on that connection - which behind Caddy is another visitor's - waits.
 * SvelteKit hands the endpoint NO body at all when the request has no Content-Type, even if
 * bytes follow, so this reads the headers rather than `request.body`.
 */
export function bodyMayBePending(request: Request): boolean {
	if (request.headers.get('transfer-encoding') !== null) return true;
	const length = request.headers.get('content-length');
	return length !== null && length.trim() !== '0';
}

/**
 * Read the body, refusing anything over `limit` bytes.
 *
 * A declared length over the cap is refused BEFORE a byte is read. A body without one is read
 * chunk by chunk and abandoned the moment it passes the cap; abandoning it makes SvelteKit
 * destroy the connection, so that client sees a reset rather than this function's 413 (content
 * too large), which is the right outcome for a client streaming junk at a login endpoint.
 */
export async function readCappedBody(
	request: Request,
	limit = AUTH_BODY_LIMIT_BYTES
): Promise<BodyResult> {
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		if (!/^\s*\d+\s*$/.test(declared)) {
			return { ok: false, status: 400, error: 'bad Content-Length', reason: 'bad_length' };
		}
		if (Number(declared) > limit) {
			return { ok: false, status: 413, error: 'request body too large', reason: 'too_large' };
		}
	}
	if (request.body === null) {
		// SvelteKit hands an endpoint NO body when the request has no Content-Type, even when
		// bytes follow, and so never caps them either. Refused UNREAD, so the answer closes the
		// connection and the rest goes with it.
		if (bodyMayBePending(request)) {
			return {
				ok: false,
				status: 415,
				error: 'request body needs a Content-Type',
				reason: 'no_content_type'
			};
		}
		return { ok: true, bytes: new Uint8Array(0) };
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return { ok: false, status: 413, error: 'request body too large', reason: 'too_large' };
			}
			chunks.push(value);
		}
	} catch {
		// The client went away mid-body, or sent more than its Content-Length. Either way the
		// request is unusable, and a stack trace would be noise: this is a client error.
		return { ok: false, status: 400, error: 'request body could not be read', reason: 'unreadable' };
	}
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return { ok: true, bytes };
}
