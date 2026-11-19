// @vitest-environment node
// The login endpoints' body reader. The case that matters most is the one adapter-node does
// not cover: a body with NO declared length, which its BODY_SIZE_LIMIT never sees.

import { describe, expect, it, vi } from 'vitest';
import { AUTH_BODY_LIMIT_BYTES, bodyMayBePending, readCappedBody } from './body';

function streamOf(chunks: Uint8Array[], onCancel?: () => void, failAfter?: number): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream({
		pull(controller) {
			if (failAfter !== undefined && i === failAfter) {
				controller.error(new Error('client went away'));
				return;
			}
			if (i < chunks.length) controller.enqueue(chunks[i++]);
			else controller.close();
		},
		cancel() {
			onCancel?.();
		}
	});
}

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
	return new Request('https://nostrolo.gy/api/auth/login', {
		method: 'POST',
		headers,
		body,
		// @ts-expect-error - Node's fetch needs this for a streamed body.
		duplex: 'half'
	});
}

describe('readCappedBody', () => {
	it('reads a small body whole', async () => {
		const result = await readCappedBody(post('{"nonce":"n"}', { 'content-type': 'application/json' }));
		expect(result.ok && new TextDecoder().decode(result.bytes)).toBe('{"nonce":"n"}');
	});

	it('reads a body of exactly the cap', async () => {
		const result = await readCappedBody(post('x'.repeat(AUTH_BODY_LIMIT_BYTES)));
		expect(result.ok && result.bytes.byteLength).toBe(AUTH_BODY_LIMIT_BYTES);
	});

	it('refuses a declared length over the cap WITHOUT reading a byte', async () => {
		// highWaterMark 0, so the stream itself pulls nothing until a reader asks.
		const pulled = vi.fn();
		const body = new ReadableStream({ pull: pulled }, { highWaterMark: 0 });
		const request = post(body, { 'content-length': String(AUTH_BODY_LIMIT_BYTES + 1) });
		const result = await readCappedBody(request);
		expect(result).toMatchObject({ ok: false, status: 413, reason: 'too_large' });
		expect(pulled).not.toHaveBeenCalled();
		expect(request.bodyUsed).toBe(false);
	});

	it('stops a body with NO declared length at the cap, and abandons the rest', async () => {
		// The adapter-node gap: with no Content-Length its limit is never compared, and
		// arrayBuffer() would buffer all of it. 2 KB chunks, so the third crosses 4 KB.
		const cancelled = vi.fn();
		const chunk = new Uint8Array(2048);
		const chunks = Array.from({ length: 1000 }, () => chunk); // 2 MB on offer
		const result = await readCappedBody(post(streamOf(chunks, cancelled)));
		expect(result).toMatchObject({ ok: false, status: 413, reason: 'too_large' });
		expect(cancelled).toHaveBeenCalled();
	});

	it('answers 400 (bad request), not a throw, when the body cannot be read', async () => {
		const result = await readCappedBody(post(streamOf([new Uint8Array(10)], undefined, 1)));
		expect(result).toMatchObject({ ok: false, status: 400, reason: 'unreadable' });
	});

	it('answers 400 (bad request) for a Content-Length that is not a number', async () => {
		// Node's own parser refuses one before it reaches us; this is the second line.
		const fake = { headers: new Headers({ 'content-length': 'abc' }), body: null } as unknown as Request;
		expect(await readCappedBody(fake)).toMatchObject({ ok: false, status: 400, reason: 'bad_length' });
	});

	it('accepts a declared length of exactly the cap', async () => {
		const body = 'x'.repeat(AUTH_BODY_LIMIT_BYTES);
		const result = await readCappedBody(post(body, { 'content-length': String(AUTH_BODY_LIMIT_BYTES) }));
		expect(result.ok && result.bytes.byteLength).toBe(AUTH_BODY_LIMIT_BYTES);
	});

	it('refuses, unread, a body SvelteKit did not hand over: no Content-Type, but bytes follow', async () => {
		// SvelteKit gives an endpoint a null body when the request has no Content-Type. Read as
		// empty, the bytes would stay on a kept-alive connection, uncapped.
		const pending: Record<string, string>[] = [{ 'content-length': '20' }, { 'transfer-encoding': 'chunked' }];
		for (const headers of pending) {
			const fake = { headers: new Headers(headers), body: null } as unknown as Request;
			expect(await readCappedBody(fake)).toMatchObject({ ok: false, status: 415, reason: 'no_content_type' });
		}
	});

	it('reads an absent body as empty', async () => {
		const result = await readCappedBody(post(null));
		expect(result.ok && result.bytes.byteLength).toBe(0);
	});
});

describe('bodyMayBePending', () => {
	const fake = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as Request;

	it('is true for a declared non-zero length or a chunked body', () => {
		expect(bodyMayBePending(fake({ 'content-length': '12' }))).toBe(true);
		expect(bodyMayBePending(fake({ 'transfer-encoding': 'chunked' }))).toBe(true);
	});

	it('is false for no body at all', () => {
		expect(bodyMayBePending(fake({}))).toBe(false);
		expect(bodyMayBePending(fake({ 'content-length': '0' }))).toBe(false);
	});
});
