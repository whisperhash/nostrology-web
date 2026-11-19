// @vitest-environment node
// The login endpoints over a REAL socket, through the same conversion adapter-node uses
// (`getRequest` / `setResponse` from @sveltejs/kit/node).
//
// What only a socket can show: that a chunked body with no declared length is stopped at the
// cap instead of buffered, that `Connection: close` actually closes the connection when a body
// is left unread, that the Set-Cookie header survives the conversion, and that SvelteKit's
// habit of handing an endpoint NO body when there is no Content-Type cannot leave bytes behind
// on a kept-alive connection. The full SvelteKit pipeline on the built server is
// scripts/verify-login.mjs's job.

import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { AUTH_BODY_LIMIT_BYTES } from './body';
import { NONCE_TTL_MS, REPLAY_WINDOW_MS } from './config';
import { handleChallenge, handleLogin, handleLogout, type AuthDeps } from './handlers';
import { SpentNonces } from './nonce';

const ORIGIN = 'https://nostrolo.gy';
const deps: AuthDeps = {
	env: { ORIGIN, AUTH_SESSION_SECRET: 'socket-test-secret-at-least-32-chars-long' },
	spent: new SpentNonces(NONCE_TTL_MS, REPLAY_WINDOW_MS),
	log: () => {}
};

let server: http.Server;
let port: number;

beforeAll(async () => {
	server = http.createServer(async (req, res) => {
		// adapter-node's own default limit, so its Content-Length check is in play as in prod.
		const request = await getRequest({ request: req, base: ORIGIN, bodySizeLimit: 512 * 1024 });
		const path = new URL(request.url).pathname;
		const handler =
			path === '/api/auth/challenge'
				? handleChallenge
				: path === '/api/auth/login'
					? handleLogin
					: handleLogout;
		await setResponse(res, await handler(request, deps));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

interface Reply {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
	/** Whether this request went out on a socket an earlier request had used. */
	reused: boolean;
}

/**
 * One request through `agent`, a KEEP-ALIVE agent with one socket, so whether the next request
 * reuses the socket is decided by the SERVER: a client that asked to close (agent: false sends
 * `Connection: close`) would close it whatever the handler did, and prove nothing.
 */
function send(
	agent: http.Agent,
	path: string,
	headers: Record<string, string>,
	body?: string | Buffer
): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers, agent }, (res) => {
			let text = '';
			res.setEncoding('utf8');
			res.on('data', (c) => (text += c));
			res.on('end', () =>
				// A tick for the server's close to reach the agent before the next request.
				setTimeout(
					() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, reused: req.reusedSocket }),
					50
				)
			);
		});
		req.on('error', reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

const keepAlive = () => new http.Agent({ keepAlive: true, maxSockets: 1 });

/** A good challenge request, to see whether it reuses the socket the previous one left. */
const followUp = (agent: http.Agent) => {
	const c = json({ pubkey: 'c'.repeat(64) });
	return send(agent, '/api/auth/challenge', c.headers, c.body);
};

function json(body: unknown): { headers: Record<string, string>; body: string } {
	const text = JSON.stringify(body);
	return {
		headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) },
		body: text
	};
}

describe('over a real socket', () => {
	it('logs in, and the Set-Cookie header survives the conversion', async () => {
		const agent = keepAlive();
		try {
			const sk = generateSecretKey();
			const c = json({ pubkey: getPublicKey(sk) });
			const ch = await send(agent, '/api/auth/challenge', c.headers, c.body);
			expect(ch.status).toBe(200);
			const { nonce } = JSON.parse(ch.body) as { nonce: string };

			const body = JSON.stringify({ nonce });
			const event = finalizeEvent(
				{
					kind: 27235,
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['u', `${ORIGIN}/api/auth/login`],
						['method', 'POST'],
						['payload', createHash('sha256').update(body).digest('hex')]
					],
					content: ''
				},
				sk
			);
			const res = await send(
				agent,
				'/api/auth/login',
				{
					'content-type': 'application/json',
					'content-length': String(Buffer.byteLength(body)),
					authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
				},
				body
			);
			expect(res.status).toBe(200);
			expect(String(res.headers['set-cookie'])).toMatch(/^__Host-nostrology_session=s2\./);
			// The body was read, so the connection is kept: the login reused the challenge's socket.
			expect(res.headers.connection).not.toBe('close');
			expect(res.reused).toBe(true);
		} finally {
			agent.destroy();
		}
	});

	it('refuses an over-cap declared length with a 413 (content too large), and the next request gets a new connection', async () => {
		// 300 KB: under adapter-node's 512 KB default, so only our own cap refuses it - and the
		// size that, left unread on a kept-alive connection, held up the next request.
		const agent = keepAlive();
		try {
			const big = Buffer.alloc(300 * 1024, 120);
			const res = await send(
				agent,
				'/api/auth/login',
				{ 'content-type': 'application/json', 'content-length': String(big.length) },
				big
			);
			expect(res.status).toBe(413);
			expect(res.headers.connection).toBe('close');
			expect((await followUp(agent)).reused).toBe(false);
		} finally {
			agent.destroy();
		}
	});

	it('refuses a body with no Content-Type UNREAD: 415 (unsupported media type), and a new connection follows', async () => {
		// SvelteKit's getRequest hands the endpoint a NULL body when there is no Content-Type,
		// though bytes follow: unless the answer closes, they stay on a kept-alive connection.
		const agent = keepAlive();
		try {
			const res = await send(agent, '/api/auth/login', { 'content-length': '20' }, 'x'.repeat(20));
			expect(res.status).toBe(415);
			expect(res.headers.connection).toBe('close');
			expect((await followUp(agent)).reused).toBe(false);
		} finally {
			agent.destroy();
		}
	});

	it('closes when a foreign Origin is refused before its body is read', async () => {
		const agent = keepAlive();
		try {
			const c = json({ pubkey: 'a'.repeat(64) });
			const res = await send(agent, '/api/auth/challenge', { ...c.headers, origin: 'https://evil.example' }, c.body);
			expect(res.status).toBe(403);
			expect(res.headers.connection).toBe('close');
			expect((await followUp(agent)).reused).toBe(false);
		} finally {
			agent.destroy();
		}
	});

	it('keeps the connection after a refusal that READ its body', async () => {
		// The other side of the rule: a body that was read leaves nothing behind.
		const agent = keepAlive();
		try {
			const bad = json({ pubkey: 'not-hex' });
			const first = await send(agent, '/api/auth/challenge', bad.headers, bad.body);
			expect(first.status).toBe(400);
			expect(first.headers.connection).not.toBe('close');
			const started = Date.now();
			const second = await followUp(agent);
			expect(second.status).toBe(200);
			expect(second.reused).toBe(true);
			expect(Date.now() - started).toBeLessThan(1000);
		} finally {
			agent.destroy();
		}
	});

	it.each([
		['with a Content-Type', { 'content-type': 'application/json' }],
		['with no Content-Type', {}]
	])('stops a chunked body %s at once: the client never gets a 200 (ok)', async (_l, typeHeader) => {
		const started = Date.now();
		const outcome = await new Promise<string>((resolve) => {
			const req = http.request(
				{
					host: '127.0.0.1',
					port,
					path: '/api/auth/login',
					method: 'POST',
					headers: { ...typeHeader, 'transfer-encoding': 'chunked' },
					agent: false
				},
				(res) => {
					res.resume();
					res.on('end', () => resolve(`status ${res.statusCode}`));
				}
			);
			req.on('error', (e: NodeJS.ErrnoException) => resolve(`reset ${e.code}`));
			// Up to 16 MiB in 1 KB chunks, as fast as the socket takes them.
			const chunk = Buffer.alloc(1024, 120);
			let sent = 0;
			const pump = () => {
				while (sent < 16 * 1024) {
					sent += 1;
					if (!req.write(chunk)) {
						req.once('drain', pump);
						return;
					}
				}
				req.end();
			};
			pump();
		});
		expect(outcome).not.toBe('status 200');
		expect(['status 413', 'status 415'].includes(outcome) || outcome.startsWith('reset')).toBe(true);
		// Refused early: not after the whole 16 MiB went through.
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it('has a cap small enough that a login never comes near it', () => {
		// A challenge body is about 80 bytes and a login body about 120.
		expect(AUTH_BODY_LIMIT_BYTES).toBe(4096);
	});
});
