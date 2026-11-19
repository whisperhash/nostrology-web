import { render, screen, waitFor } from '@testing-library/svelte';
import { readable, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Host from './failed-query.host.svelte';
import LightningPage from './lightning/+page.svelte';
import RelaysPage from './relays/+page.svelte';

// The browser half of failed-query.ssr.test.ts. In the browser a failed streamed query must
// read as "unavailable" - in the table's count line and in every chart card - where it used
// to leave the table and charts blank; it must not escape as an unhandled rejection (Svelte
// rethrows from any {#await} that has no {:catch}); and a later load must replace that
// state, charts included, the way SvelteKit delivers one (see failed-query.host.svelte).
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

// Marked handled, as SvelteKit does for every streamed promise, so that anything the
// detector below catches is the page's own.
function failedQuery(): Promise<never> {
	const query = Promise.reject(new Error('connect ECONNREFUSED (test)'));
	query.catch(() => {});
	return query;
}

function slowQuery<T>() {
	let reject!: (err: Error) => void;
	const promise = new Promise<T>((_, rej) => (reject = rej));
	promise.catch(() => {});
	return { promise, reject };
}

const neverSettles = () => new Promise<never>(() => {});

// What the root layout's load adds to every page's data.
const LAYOUT_DATA = { analyticsOff: false, session: null };

const PAGES = [
	{
		name: '/relays',
		Page: RelaysPage,
		failed: () => ({
			...LAYOUT_DATA,
			relays: failedQuery(),
			perUserDistribution: failedQuery(),
			tierUserCounts: failedQuery()
		}),
		good: () => ({
			...LAYOUT_DATA,
			relays: Promise.resolve([
				{ relay_url: 'wss://a.relay.test', user_count: 5000, read_count: 4000, write_count: 3000, both_count: 2500 }
			]),
			perUserDistribution: Promise.resolve([{ bucket: '1', sort_key: 1, user_count: 10 }]),
			tierUserCounts: Promise.resolve([{ tier_label: '1k+', sort_key: 1000, users_in_tier: 1, total_users: 10 }])
		}),
		// Only the table's query, and that one controlled by the test.
		tableOnly: (table: Promise<never>) => ({
			...LAYOUT_DATA,
			relays: table,
			perUserDistribution: neverSettles(),
			tierUserCounts: neverSettles()
		}),
		failLine: 'Relay data unavailable - reload the page to try again.',
		// The two histograms, the stacked bars and the scatter.
		charts: 4,
		okLine: '1 relay with 1k+ users.',
		row: 'a.relay.test',
		log: '[relays] could not load the relay table'
	},
	{
		name: '/lightning',
		Page: LightningPage,
		failed: () => ({
			...LAYOUT_DATA,
			providers: failedQuery(),
			trendsZapShare: failedQuery(),
			trendsSatsShare: failedQuery(),
			trendsSatsAbsolute: failedQuery(),
			trendsZapsAbsolute: failedQuery()
		}),
		good: () => ({
			...LAYOUT_DATA,
			providers: Promise.resolve([{ domain: 'wallet.test', user_count: 500 }]),
			trendsZapShare: Promise.resolve([]),
			trendsSatsShare: Promise.resolve([]),
			trendsSatsAbsolute: Promise.resolve([]),
			trendsZapsAbsolute: Promise.resolve([])
		}),
		tableOnly: (table: Promise<never>) => ({
			...LAYOUT_DATA,
			providers: table,
			trendsZapShare: neverSettles(),
			trendsSatsShare: neverSettles(),
			trendsSatsAbsolute: neverSettles(),
			trendsZapsAbsolute: neverSettles()
		}),
		failLine: 'Provider data unavailable - reload the page to try again.',
		// Sats-share and zap-share.
		charts: 2,
		okLine: '1 provider with 100+ users.',
		row: 'wallet.test',
		log: '[lightning] could not load the provider table'
	}
];

let unhandled: unknown[] = [];
const record = (reason: unknown) => {
	unhandled.push(reason);
};
let consoleError: ReturnType<typeof vi.spyOn>;

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	unhandled = [];
	process.on('unhandledRejection', record);
	consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	// The pages persist their threshold; start every test from the default.
	window.localStorage.clear();
});

// For EVERY test, not only the failure ones: while a listener of ours is attached, vitest
// 2 stops reporting unhandled rejections itself (it returns early when `unhandledRejection`
// has more than one listener), so this check is the only one there is.
afterEach(async () => {
	await settled();
	try {
		expect(unhandled).toEqual([]);
	} finally {
		process.off('unhandledRejection', record);
		vi.restoreAllMocks();
	}
});

describe.each(PAGES)('$name in the browser', (page) => {
	it('says the data is unavailable when every query failed', async () => {
		render(Host, { props: { Page: page.Page, store: writable(page.failed()) } });
		await waitFor(() => {
			expect(screen.getByText(page.failLine)).toBeTruthy();
			expect(screen.getAllByText('Chart data unavailable.')).toHaveLength(page.charts);
		});
		expect(consoleError).toHaveBeenCalledWith(page.log, expect.any(Error));
	});

	it('shows the table, and no failure, when the queries succeed', async () => {
		render(Host, { props: { Page: page.Page, store: writable(page.good()) } });
		await waitFor(() => expect(screen.getByText(page.okLine)).toBeTruthy());
		expect(screen.getByText(page.row)).toBeTruthy();
		expect(screen.queryByText(/unavailable/)).toBeNull();
		// Not a bare not.toHaveBeenCalled(): the charts mount here, and jsdom reports its
		// missing canvas through console.error too.
		expect(consoleError).not.toHaveBeenCalledWith(page.log, expect.anything());
	});

	// The next two deliver the new data already settled, as a load re-run on login or
	// logout can arrive: the case the {#key} blocks on /relays exist for.
	it('replaces the failure, charts included, when a good load follows', async () => {
		const store = writable<unknown>(page.failed());
		render(Host, { props: { Page: page.Page, store } });
		await waitFor(() => expect(screen.getByText(page.failLine)).toBeTruthy());
		store.set(page.good());
		await waitFor(() => {
			expect(screen.getByText(page.okLine)).toBeTruthy();
			expect(screen.queryAllByText('Chart data unavailable.')).toHaveLength(0);
		});
		expect(screen.queryByText(page.failLine)).toBeNull();
	});

	it('replaces good data, charts and rows included, when a failed load follows', async () => {
		const store = writable<unknown>(page.good());
		render(Host, { props: { Page: page.Page, store } });
		await waitFor(() => expect(screen.getByText(page.okLine)).toBeTruthy());
		store.set(page.failed());
		await waitFor(() => {
			expect(screen.getByText(page.failLine)).toBeTruthy();
			expect(screen.getAllByText('Chart data unavailable.')).toHaveLength(page.charts);
		});
		expect(screen.queryByText(page.row)).toBeNull();
	});

	it('ignores a failure from a load that newer data has replaced', async () => {
		const stale = slowQuery<never>();
		const store = writable<unknown>(page.tableOnly(stale.promise));
		render(Host, { props: { Page: page.Page, store } });
		store.set(page.good());
		await waitFor(() => expect(screen.getByText(page.okLine)).toBeTruthy());
		stale.reject(new Error('connect ETIMEDOUT (test)'));
		await settled();
		expect(screen.getByText(page.okLine)).toBeTruthy();
		expect(screen.queryByText(page.failLine)).toBeNull();
		expect(consoleError).not.toHaveBeenCalledWith(page.log, expect.anything());
	});
});
