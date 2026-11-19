// @vitest-environment node
//
// The landing cache's rules, one at a time, on fake timers (which fake Date too, so the cache's
// clock and its log timestamps move with them). Every test also checks that nothing rejected
// unhandled: production has no unhandledRejection handler, so one would exit the server.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createLandingCache,
	defaultRetryMs,
	errorMessage,
	ERROR_MESSAGE_MAX,
	HOUR_MS,
	MINUTE_MS,
	type LogLine,
	type Sources
} from './cache';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Run every timer due within `ms`, and the promise work each one starts. */
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const flush = () => vi.advanceTimersByTimeAsync(0);

let lines: LogLine[];
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
	vi.useFakeTimers({ now: Date.parse('2026-10-15T08:00:00Z') });
	lines = [];
	unhandled = [];
	process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
	// vitest stops watching for unhandled rejections while a test adds its own listener, so this
	// file asserts on its own after every test: settle a real macrotask, then look.
	vi.useRealTimers();
	try {
		await new Promise((r) => setTimeout(r, 0));
		expect(unhandled).toEqual([]);
	} finally {
		process.off('unhandledRejection', onUnhandled);
	}
});

function cacheOf<S extends Sources>(sources: S, extra: Partial<Parameters<typeof createLandingCache>[0]> = {}) {
	return createLandingCache({ sources, log: (line) => lines.push(line), ...extra });
}

const refreshed = () => lines.filter((l) => l.msg === 'landing source refreshed').map((l) => l.source);
const failedLines = () => lines.filter((l) => l.msg === 'landing source refresh failed');

describe('reading', () => {
	it('reads every source at start, in order, one at a time', async () => {
		const a = deferred<number>();
		const b = deferred<number>();
		const calls: string[] = [];
		const cache = cacheOf({
			a: () => (calls.push('a'), a.promise),
			b: () => (calls.push('b'), b.promise)
		});
		cache.start();
		expect(calls).toEqual(['a']);
		await flush();
		// b waits for a: the landing never holds more than one of the pool's connections.
		expect(calls).toEqual(['a']);
		a.resolve(1);
		await flush();
		expect(calls).toEqual(['a', 'b']);
		b.resolve(2);
		await flush();
		expect(cache.values()).toEqual({ a: 1, b: 2 });
		cache.stop();
	});

	it('never has two reads in flight, whatever the clock does', async () => {
		let inFlight = 0;
		let most = 0;
		const slow = () => {
			inFlight += 1;
			most = Math.max(most, inFlight);
			return new Promise<number>((resolve) => setTimeout(() => (inFlight -= 1, resolve(1)), 90_000));
		};
		const cache = cacheOf({ a: slow, b: slow, c: slow }, { timeoutMs: 120_000 });
		cache.start();
		await advance(3 * HOUR_MS);
		expect(most).toBe(1);
		cache.stop();
	});

	it('logs the start, then one line per refresh, with its timing', async () => {
		const cache = cacheOf({
			a: () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 250))
		});
		cache.start();
		await advance(250);
		expect(lines).toEqual([
			{ ts: '2026-10-15T08:00:00.000Z', level: 'info', msg: 'landing cache started', sources: ['a'], interval_s: 3600 },
			{ ts: '2026-10-15T08:00:00.250Z', level: 'info', msg: 'landing source refreshed', source: 'a', ms: 250 }
		]);
		cache.stop();
	});

	it('starts the clock when the values are first asked for, if nothing else has', async () => {
		const source = vi.fn(async () => 7);
		const cache = cacheOf({ a: source });
		expect(cache.values()).toEqual({});
		expect(source).toHaveBeenCalledTimes(1);
		await flush();
		expect(cache.values()).toEqual({ a: 7 });
		cache.start(); // idempotent: no second read
		expect(source).toHaveBeenCalledTimes(1);
		cache.stop();
	});

	it('reads a good source again after an hour, never before, visitors or not', async () => {
		const source = vi.fn(async () => 1);
		const cache = cacheOf({ a: source });
		cache.start();
		await flush();
		for (let i = 0; i < 100; i++) cache.values(); // visits do not read
		await advance(59 * MINUTE_MS);
		expect(source).toHaveBeenCalledTimes(1);
		await advance(MINUTE_MS);
		expect(source).toHaveBeenCalledTimes(2);
		// And on: a quiet day still gets its 24 lines per source.
		await advance(23 * HOUR_MS);
		expect(source).toHaveBeenCalledTimes(25);
		expect(refreshed()).toHaveLength(25);
		cache.stop();
	});

	it('keeps to the hour, and to the minute of a retry, when a read takes a few seconds', async () => {
		// Fake reads take no time, so "an hour after it finished" would land exactly on a tick;
		// real ones take some, and must not slip to the tick after.
		let ok = true;
		const calls: number[] = [];
		const start = Date.now();
		const cache = cacheOf({
			a: () =>
				new Promise<number>((resolve, reject) =>
					setTimeout(() => {
						calls.push(Math.round((Date.now() - start) / 1000));
						if (ok) resolve(1);
						else reject(new Error('down'));
					}, 5_000)
				)
		});
		cache.start();
		await advance(HOUR_MS + 10_000);
		expect(calls).toEqual([5, 3605]); // read at 0 and at the 60th minute, each taking 5 s
		ok = false;
		await advance(HOUR_MS + MINUTE_MS);
		// fails at 7205 s; the retry a minute later reads at 7260 s and ends at 7265 s
		expect(calls).toEqual([5, 3605, 7205, 7265]);
		cache.stop();
	});

	it('bumps the version on every successful refresh, and only then', async () => {
		let fail = false;
		const cache = cacheOf({
			a: async () => {
				if (fail) throw new Error('down');
				return 1;
			}
		});
		expect(cache.version()).toBe(0);
		cache.start();
		await flush();
		expect(cache.version()).toBe(1);
		fail = true;
		await advance(HOUR_MS);
		expect(failedLines()).toHaveLength(1);
		expect(cache.version()).toBe(1);
		fail = false;
		await advance(MINUTE_MS);
		expect(cache.version()).toBe(2);
		cache.stop();
	});

	it('stops reading when stopped', async () => {
		const source = vi.fn(async () => 1);
		const cache = cacheOf({ a: source });
		cache.start();
		await flush();
		cache.stop();
		await advance(5 * HOUR_MS);
		expect(source).toHaveBeenCalledTimes(1);
	});
});

describe('failing', () => {
	it('keeps the last good copy when a refresh fails', async () => {
		let answer: () => Promise<number> = async () => 1;
		const cache = cacheOf({ a: () => answer() });
		cache.start();
		await flush();
		expect(cache.values()).toEqual({ a: 1 });
		answer = async () => {
			throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
		};
		await advance(HOUR_MS);
		expect(cache.values()).toEqual({ a: 1 });
		expect(failedLines()).toEqual([
			{
				ts: '2026-10-15T09:00:00.000Z',
				level: 'warn',
				msg: 'landing source refresh failed',
				source: 'a',
				ms: 0,
				failures: 1,
				retry_in_s: 60,
				error: 'connect ECONNREFUSED 10.0.0.1:5432'
			}
		]);
		cache.stop();
	});

	it('fails one source alone: the others load and keep their own hour', async () => {
		const good = vi.fn(async () => 'fine');
		const cache = cacheOf({
			bad: async () => {
				throw new Error('relation "x" does not exist');
			},
			good
		});
		cache.start();
		await flush();
		expect(cache.values()).toEqual({ good: 'fine' });
		// bad retries six times in its first hour; good is read once an hour regardless.
		await advance(HOUR_MS);
		expect(good).toHaveBeenCalledTimes(2);
		expect(failedLines().every((l) => l.source === 'bad')).toBe(true);
		expect(refreshed()).toEqual(['good', 'good']);
		cache.stop();
	});

	it('retries after 1, 2, 4, 8, 16, 32 minutes, then hourly; a success resets it', async () => {
		let up = false;
		const calls: number[] = [];
		const start = Date.now();
		const cache = cacheOf({
			a: async () => {
				calls.push((Date.now() - start) / MINUTE_MS);
				if (!up) throw new Error('down');
				return 1;
			}
		});
		cache.start();
		await advance(183 * MINUTE_MS);
		expect(calls).toEqual([0, 1, 3, 7, 15, 31, 63, 123, 183]);
		expect(failedLines().map((l) => l.retry_in_s)).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
		expect(failedLines().map((l) => l.failures)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		up = true;
		await advance(60 * MINUTE_MS); // the next attempt, at 243, succeeds
		expect(cache.values()).toEqual({ a: 1 });
		up = false;
		await advance(60 * MINUTE_MS); // at 303 it fails again: back to a one-minute retry
		expect(failedLines().at(-1)).toMatchObject({ failures: 1, retry_in_s: 60 });
		cache.stop();
	});

	it('gives up on a read that never answers, and queues no query behind it until it does', async () => {
		// The timeout stops the cache waiting, not the query: it keeps its pool connection. So
		// nothing else is read while it is out - on a hung database the landing holds one
		// connection, not one more every minute (the review of 2026-10-15).
		const hung = deferred<number>();
		const b = vi.fn(async () => 2);
		const cache = cacheOf({ a: () => hung.promise, b });
		cache.start();
		await advance(59_999);
		expect(failedLines()).toEqual([]);
		await advance(1);
		expect(failedLines()).toEqual([
			expect.objectContaining({ source: 'a', error: 'no answer after 60 s', failures: 1 }),
			expect.objectContaining({ source: 'b', error: 'an earlier read has not answered yet', failures: 1 })
		]);
		// The retries keep failing at once while it is still out: still no query.
		await advance(3 * MINUTE_MS);
		expect(b).not.toHaveBeenCalled();
		expect(failedLines().length).toBeGreaterThan(2);
		// It answers at last: its connection is free, and its late answer is dropped...
		hung.resolve(1);
		await flush();
		expect(cache.values()).toEqual({});
		// ...and the next retries read again.
		await advance(5 * MINUTE_MS);
		expect(b).toHaveBeenCalledTimes(1);
		expect(cache.values()).toEqual({ a: 1, b: 2 });
		cache.stop();
	});

	it('frees its slot when a read fails, whether at once or late', async () => {
		// A read that rejects is answered: the next read is not blocked by it.
		let calls = 0;
		const cache = cacheOf({
			a: async () => {
				calls += 1;
				throw new Error('down');
			},
			b: async () => 2
		});
		cache.start();
		await flush();
		expect(cache.values()).toEqual({ b: 2 });
		expect(failedLines().map((l) => l.error)).toEqual(['down']);
		await advance(MINUTE_MS);
		expect(calls).toBe(2);
		cache.stop();
	});

	it('handles a read that rejects after it was given up on', async () => {
		const hung = deferred<number>();
		const cache = cacheOf({ a: () => hung.promise });
		cache.start();
		await advance(60_000);
		hung.reject(new Error('too late'));
		await flush();
		// afterEach asserts no unhandled rejection; and the late error is not logged.
		expect(failedLines().map((l) => l.error)).toEqual(['no answer after 60 s']);
		cache.stop();
	});

	it('treats a source that throws before returning a promise as a failure', async () => {
		const cache = cacheOf({
			a: () => {
				throw new TypeError('getter is not a function');
			}
		});
		cache.start();
		await flush();
		expect(failedLines()).toEqual([expect.objectContaining({ error: 'getter is not a function' })]);
		cache.stop();
	});

	it('keeps reading the rest of the queue when a handler throws', async () => {
		// refresh() promises never to reject. If it did (here: a retry option that throws), the
		// pass would stop and the sources after it would wait for the next tick, a minute on.
		const b = vi.fn(async () => 2);
		const cache = cacheOf(
			{
				a: async () => {
					throw new Error('down');
				},
				b
			},
			{
				retryMs: () => {
					throw new Error('bad retry option');
				}
			}
		);
		cache.start();
		await flush();
		expect(b).toHaveBeenCalledTimes(1);
		expect(cache.values()).toEqual({ b: 2 });
		cache.stop();
	});

	it('calls onRefresh after each successful refresh, and survives one that throws', async () => {
		let refreshes = 0;
		let fail = false;
		const cache = cacheOf(
			{
				a: async () => {
					if (fail) throw new Error('down');
					return 1;
				},
				b: async () => 2
			},
			{
				onRefresh: () => {
					refreshes += 1;
					throw new Error('a hook that throws');
				}
			}
		);
		cache.start();
		await flush();
		expect(refreshes).toBe(2);
		expect(cache.values()).toEqual({ a: 1, b: 2 });
		fail = true;
		await advance(HOUR_MS);
		expect(refreshes).toBe(3); // b again; a failed, so no call for it
		cache.stop();
	});

	it('survives a logger that throws', async () => {
		const cache = createLandingCache({
			sources: { a: async () => 1 },
			log: () => {
				throw new Error('stdout closed');
			}
		});
		cache.start();
		await flush();
		expect(cache.values()).toEqual({ a: 1 });
		cache.stop();
	});

	it('logs the error message only, never the error object', async () => {
		const pgError = Object.assign(new Error('permission denied for table ngit_snapshot'), {
			query: 'SELECT data FROM ngit_snapshot',
			detail: 'role nostrology_web',
			stack: 'at Pool.query (secret/path.js:1:1)'
		});
		const cache = cacheOf({
			a: async () => {
				throw pgError;
			}
		});
		cache.start();
		await flush();
		const line = JSON.stringify(failedLines()[0]);
		expect(failedLines()[0].error).toBe('permission denied for table ngit_snapshot');
		expect(line).not.toContain('SELECT');
		expect(line).not.toContain('nostrology_web');
		expect(line).not.toContain('secret/path');
		cache.stop();
	});
});

describe('settled', () => {
	it('resolves once every source has answered or failed', async () => {
		const cache = cacheOf({
			a: async () => 1,
			b: async () => {
				throw new Error('down');
			}
		});
		let done = false;
		void cache.settled(10_000).then(() => (done = true));
		await flush();
		expect(done).toBe(true);
		cache.stop();
	});

	it('resolves after the wait when a source hangs, and never rejects', async () => {
		const cache = cacheOf({ a: () => new Promise<number>(() => {}) });
		let done = false;
		void cache.settled(2_000).then(() => (done = true));
		await advance(1_999);
		expect(done).toBe(false);
		await advance(1);
		expect(done).toBe(true);
		cache.stop();
	});

	it('resolves at once when everything has settled before', async () => {
		const cache = cacheOf({ a: async () => 1 });
		cache.start();
		await flush();
		await expect(cache.settled(0)).resolves.toBeUndefined();
		cache.stop();
	});
});

describe('errorMessage', () => {
	it('takes an Error by its message and anything else as text', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
		expect(errorMessage('plain')).toBe('plain');
		expect(errorMessage(42)).toBe('42');
		expect(errorMessage(undefined)).toBe('undefined');
	});

	it('never throws, whatever it is given', () => {
		const hostile = {
			toString() {
				throw new Error('no');
			}
		};
		expect(errorMessage(hostile)).toBe('unprintable error');
		expect(errorMessage(Object.create(null))).toBe('unprintable error');
		// an Error whose message is not a string (the review of 2026-10-15)
		expect(errorMessage(Object.assign(new Error('x'), { message: null }))).toBe('null');
		expect(errorMessage(Object.assign(new Error('x'), { message: hostile }))).toBe('unprintable error');
	});

	it('caps a long message', () => {
		const long = 'x'.repeat(ERROR_MESSAGE_MAX + 50);
		expect(errorMessage(new Error(long))).toBe(`${'x'.repeat(ERROR_MESSAGE_MAX)}...`);
	});
});

describe('defaultRetryMs', () => {
	it('doubles from a minute and stops at the interval', () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((f) => defaultRetryMs(f) / MINUTE_MS)).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
		expect(defaultRetryMs(5, 10 * MINUTE_MS)).toBe(10 * MINUTE_MS);
	});
});
