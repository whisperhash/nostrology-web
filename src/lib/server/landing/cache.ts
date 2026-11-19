// The landing page's data: a few of the surface pages' own data functions, read on a clock
// and kept in this process.
//
// WHY A CACHE. `/` is the site's root, so it takes every crawler, scanner and link-preview
// fetch that reaches the bare hostname. That is why it stayed DB-free until 2026-10-15, its
// figures typed in by hand. The board it shows since then draws each surface's chart and
// figure, so it needs the data - but never one query per request. The contract is now: the
// landing reads the database ONLY through this cache, which reads each source once an hour on
// its own clock and never on a visitor's request (src/routes/+page.server.ts, and the tests
// that pin it in src/routes/landing.test.ts).
//
// HOW IT FAILS. Each source is its own slot: its value, its run of failures, when it is next
// due. A refresh replaces a slot's value only when the source answers; a failure records
// itself and leaves the value alone, so the last good copy keeps being served. Each source is
// read on its own promise, with its own handlers and its own timeout, so one failing or hung
// source cannot blank the others. A failing source retries after a minute, then two, four and
// so on up to the hour, so a long database outage settles at one attempt (and one warning)
// per source per hour.
//
// ONE AT A TIME, ONE CONNECTION. Sources are read one after another, never together: the web's
// pool holds five connections ($lib/db/postgres), and the landing's reads never take more than
// one of them from the pages visitors are waiting on. An hourly pass takes a few seconds.
//
// A TIMEOUT OF ITS OWN, AND NO PILE-UP. The pool waits for a connection forever (by design, see
// its comment), so after `timeoutMs` a read counts as failed and retries on the usual schedule;
// a late answer is dropped. The timeout only stops the cache WAITING: the query keeps its pool
// connection until the database answers or the socket dies. So while any read is unanswered,
// timed out or not, every refresh fails at once (`an earlier read has not answered yet`) instead
// of queueing another query - on a hung database the landing holds one connection, not one more
// each minute until it holds all five and the other pages queue behind them. Found by the
// review of 2026-10-15, on the production build against a database that never answers.
//
// WHAT IT LOGS, AND WHY THE CLOCK. One line per source per refresh: `landing source refreshed`
// with its timing, or `landing source refresh failed` (level `warn`, exactly: log queries match
// the level as a whole word) with the error's message only. There is no staleness warning:
// staleness is read from these lines' timestamps. That is why the clock runs whether or not anyone
// visits: if refreshes followed visits, a quiet night would leave no lines and look exactly like
// a broken cache.
//
// NOTHING HERE MAY REJECT UNHANDLED. Production runs node:22 with no unhandledRejection
// handler, so a stray rejection exits the server and takes the whole site down (it has
// happened: the /relays and /lightning crash fixed on 2026-09-24). Every promise here ends in a
// handler that cannot itself throw.

/** A source: one of the existing data functions in $lib/db/postgres, called with no arguments. */
export type Source = () => Promise<unknown>;
export type Sources = Record<string, Source>;

/** The last good copy of each source that has loaded at least once since the process started. */
export type CachedValues<S extends Sources> = { [K in keyof S]?: Awaited<ReturnType<S[K]>> };

export interface LogLine {
	ts: string;
	level: 'info' | 'warn';
	msg: string;
	[field: string]: unknown;
}

export interface CacheOptions<S extends Sources> {
	/** Called after every successful refresh (the values changed). A throw in it is dropped, by
	 * the refresh's backstop catch. */
	onRefresh?: () => void;
	/** Read in this order on every pass: put what the page shows first, first. */
	sources: S;
	/** How long a good copy lasts before the source is read again. */
	intervalMs?: number;
	/** How often the clock looks for a source that is due. */
	tickMs?: number;
	/** How long one read may take before it counts as failed. */
	timeoutMs?: number;
	/** The wait before retrying a source that has now failed `failures` times in a row. */
	retryMs?: (failures: number) => number;
	now?: () => number;
	log?: (line: LogLine) => void;
}

export interface LandingCache<S extends Sources> {
	/** Start the clock and queue every source at once. Idempotent. */
	start(): void;
	/** Stop the clock. A read already running finishes and is kept. For tests. */
	stop(): void;
	/** The last good copies. Never waits, never touches the database. Starts the clock if
	 * nothing has (the server's init hook normally has, at boot). */
	values(): CachedValues<S>;
	/** Bumped by every successful refresh, so a reader can tell when the values changed. */
	version(): number;
	/** Resolves once every source has answered or failed at least once since the clock
	 * started, or after `maxWaitMs`, whichever is first. Never rejects. */
	settled(maxWaitMs: number): Promise<void>;
}

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
export const DEFAULT_TIMEOUT_MS = 60_000;

/** 1, 2, 4, 8, 16, 32 minutes, then the interval (an hour). */
export function defaultRetryMs(failures: number, intervalMs = HOUR_MS): number {
	return Math.min(MINUTE_MS * 2 ** Math.max(0, failures - 1), intervalMs);
}

/** Longest error message kept in a log line: enough for any database error, short enough that
 * a pathological one cannot flood a line. */
export const ERROR_MESSAGE_MAX = 300;

/**
 * The error's message only. Never the error object: a pg error carries the query and the
 * server's detail, and these lines are read by whoever can read the logs, so nothing but the
 * message goes in. Cannot throw, whatever `err` is.
 */
export function errorMessage(err: unknown): string {
	try {
		// String() inside the try: an Error's message can be anything, null included.
		const text = String(err instanceof Error ? err.message : err);
		return text.length > ERROR_MESSAGE_MAX ? `${text.slice(0, ERROR_MESSAGE_MAX)}...` : text;
	} catch {
		return 'unprintable error';
	}
}

function consoleLog(line: LogLine): void {
	// One JSON object per line: the nozzl convention that Loki's `| json` reads (as
	// hooks.server.ts's page-view line).
	console.log(JSON.stringify(line));
}

interface Slot {
	value?: unknown;
	loaded: boolean;
	settled: boolean;
	failures: number;
	nextAt: number;
	/** Queued or being read: never queued twice. */
	busy: boolean;
}

export function createLandingCache<S extends Sources>(options: CacheOptions<S>): LandingCache<S> {
	const sources = options.sources;
	const names = Object.keys(sources) as (keyof S & string)[];
	const intervalMs = options.intervalMs ?? HOUR_MS;
	const tickMs = options.tickMs ?? MINUTE_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const retryMs = options.retryMs ?? ((failures: number) => defaultRetryMs(failures, intervalMs));
	const now = options.now ?? Date.now;
	const log = options.log ?? consoleLog;
	const onRefresh = options.onRefresh;

	const slots = new Map<string, Slot>(
		names.map((name) => [name, { loaded: false, settled: false, failures: 0, nextAt: 0, busy: false }])
	);
	const queue: (keyof S & string)[] = [];
	let draining = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let started = false;
	let versionCount = 0;
	let waiters: (() => void)[] = [];
	/** Reads started and not yet answered, including any the timeout gave up on. */
	let unanswered = 0;

	const allSettled = () => names.every((name) => slots.get(name)!.settled);

	function emit(line: Omit<LogLine, 'ts'>): void {
		try {
			log({ ts: new Date(now()).toISOString(), ...line } as LogLine);
		} catch {
			// A logger that throws must not turn a refresh into an unhandled rejection.
		}
	}

	function wake(): void {
		if (!allSettled()) return;
		const ready = waiters;
		waiters = [];
		for (const resolve of ready) resolve();
	}

	/** Read one source. The promise it returns never rejects. */
	function refresh(name: keyof S & string): Promise<void> {
		const slot = slots.get(name)!;
		const startedAt = now();
		let pending: Promise<unknown>;
		if (unanswered > 0) {
			// The query of a read the timeout gave up on still holds its connection: do not
			// queue another behind it (see "NO PILE-UP" above).
			pending = Promise.reject(new Error('an earlier read has not answered yet'));
		} else {
			try {
				pending = Promise.resolve(sources[name]());
			} catch (err) {
				// A source that throws before it returns a promise is a failure like any other.
				pending = Promise.reject(err);
			}
			unanswered += 1;
			const answered = () => {
				unanswered -= 1;
			};
			// Counts down whenever the read settles, after the timeout too; and handles the
			// rejection, so this branch of the promise can never reject unhandled.
			pending.then(answered, answered);
		}
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const expiry = new Promise<never>((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error(`no answer after ${Math.round(timeoutMs / 1000)} s`)),
				timeoutMs
			);
			(timeout as { unref?: () => void }).unref?.();
		});
		// race() subscribes to both, so a read that rejects after the expiry won is still handled.
		return Promise.race([pending, expiry])
			.then(
				(value) => {
					slot.value = value;
					slot.loaded = true;
					slot.failures = 0;
					slot.nextAt = now() + intervalMs;
					versionCount += 1;
					emit({ level: 'info', msg: 'landing source refreshed', source: name, ms: now() - startedAt });
					onRefresh?.();
				},
				(err: unknown) => {
					slot.failures += 1;
					const wait = retryMs(slot.failures);
					slot.nextAt = now() + wait;
					emit({
						level: 'warn',
						msg: 'landing source refresh failed',
						source: name,
						ms: now() - startedAt,
						failures: slot.failures,
						retry_in_s: Math.round(wait / 1000),
						error: errorMessage(err)
					});
				}
			)
			.catch(() => {
				// Both handlers above are written not to throw; this is the backstop.
			})
			.finally(() => {
				clearTimeout(timeout);
				slot.busy = false;
				slot.settled = true;
				wake();
			});
	}

	async function drain(): Promise<void> {
		draining = true;
		try {
			while (queue.length > 0) await refresh(queue.shift()!);
		} finally {
			draining = false;
		}
	}

	function tick(): void {
		const t = now();
		for (const name of names) {
			const slot = slots.get(name)!;
			// Due within half a tick counts as due now. A source's next time is counted from when
			// its read FINISHED, a little after the tick that queued it, so "an hour later" falls
			// just after the matching tick; without the slack every hour, and every retry, would
			// slip a whole tick.
			if (slot.busy || slot.nextAt > t + tickMs / 2) continue;
			slot.busy = true;
			queue.push(name);
		}
		if (!draining && queue.length > 0) {
			drain().catch(() => {
				// refresh() cannot reject, so neither can this; the backstop keeps it that way.
				draining = false;
			});
		}
	}

	function start(): void {
		if (started) return;
		started = true;
		emit({
			level: 'info',
			msg: 'landing cache started',
			sources: names,
			interval_s: Math.round(intervalMs / 1000)
		});
		tick();
		timer = setInterval(tick, tickMs);
		// The clock must never be what keeps the process alive.
		(timer as { unref?: () => void }).unref?.();
	}

	function stop(): void {
		if (timer) clearInterval(timer);
		timer = null;
		started = false;
	}

	function values(): CachedValues<S> {
		start();
		const out: Record<string, unknown> = {};
		for (const name of names) {
			const slot = slots.get(name)!;
			if (slot.loaded) out[name] = slot.value;
		}
		return out as CachedValues<S>;
	}

	function settled(maxWaitMs: number): Promise<void> {
		start();
		if (allSettled()) return Promise.resolve();
		return new Promise<void>((resolve) => {
			let done = false;
			const wait = setTimeout(() => finish(), maxWaitMs);
			(wait as { unref?: () => void }).unref?.();
			function finish(): void {
				if (done) return;
				done = true;
				clearTimeout(wait);
				resolve();
			}
			waiters.push(finish);
		});
	}

	return { start, stop, values, version: () => versionCount, settled };
}
