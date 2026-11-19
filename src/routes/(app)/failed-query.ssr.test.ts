// @vitest-environment node
//
// A failed streamed query on /relays or /lightning must never reach Node as an unhandled
// rejection. Until 2026-09-24 it would have: each page ran `$: void rebuild(data.<query>,
// ...)` during the SERVER render too, `rebuild` had no catch, and Node's default for an
// unhandled rejection is to exit - so one failed query on one full page load would take
// the whole adapter-node server, and every page of the site with it, down until the
// container restarted. Reproduced in the production image with an unresolvable
// DATABASE_URL; never seen in production.
//
// This renders each page the way SvelteKit does on the server (svelte/server on the
// server compile - hence the node environment, and the "ssr" project in
// vitest.workspace.ts) with every streamed query rejected, then waits for the rejections
// to settle and asserts none was left unhandled. The rejected promises are marked handled
// first, because SvelteKit's serializer does that to every streamed promise (it chains a
// .catch into handleError) - so anything caught here is the page's own. It failed on the
// pre-fix pages, with one rejection recorded per page.
//
// Each test also checks that the page's table rebuild never ran here. It is browser work
// (a server render is synchronous, so the table has gone out empty before any query can
// resolve), and run on the server its catch would log every failure a second time, after
// SvelteKit's own `[500] GET /relays` line. The render logs nothing else, so any
// console.error at all fails the test: that pins the `if (browser)` gate on its own, which
// the no-unhandled-rejection check cannot - it passes on the gate or the catch alone.
import { render } from 'svelte/server';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LightningPage from './lightning/+page.svelte';
import RelaysPage from './relays/+page.svelte';

// Every page renders <SocialMeta>, which reads $page; a page rendered on its own has no
// router, so the store is supplied here - same pattern as the other page tests.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

function failedQuery(): Promise<never> {
	const query = Promise.reject(new Error('connect ECONNREFUSED (test)'));
	query.catch(() => {});
	return query;
}

// What the root layout's load adds to every page's data.
const LAYOUT_DATA = { analyticsOff: false, session: null };

let unhandled: unknown[] = [];
const record = (reason: unknown) => {
	unhandled.push(reason);
};
let consoleError: ReturnType<typeof vi.spyOn>;

// Node reports an unhandled rejection once the microtask queue has drained, so after one
// macrotask every rejection above has been either handled or reported.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	unhandled = [];
	process.on('unhandledRejection', record);
	consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Checked after every test: while a listener of ours is attached, vitest 2 stops
// reporting unhandled rejections itself (it returns early when `unhandledRejection` has
// more than one listener), so this check is the only one there is.
afterEach(async () => {
	await settled();
	try {
		expect(unhandled).toEqual([]);
	} finally {
		process.off('unhandledRejection', record);
		vi.restoreAllMocks();
	}
});

// svelte/server's render() is LAZY: the page renders when `.body` (or `.head`) is first
// read. The `const { body } =` below is what runs it - a bare `render(...)` renders
// nothing, and passed on the pre-fix pages.
describe('a failed query during the server render', () => {
	it('leaves no unhandled rejection on /relays, and no rebuild', async () => {
		const { body } = render(RelaysPage, {
			props: {
				data: {
					...LAYOUT_DATA,
					relays: failedQuery(),
					perUserDistribution: failedQuery(),
					tierUserCounts: failedQuery()
				}
			}
		});
		expect(body).toContain('Relays');
		await settled();
		expect(unhandled).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('leaves no unhandled rejection on /lightning, and no rebuild', async () => {
		const { body } = render(LightningPage, {
			props: {
				data: {
					...LAYOUT_DATA,
					providers: failedQuery(),
					trendsZapShare: failedQuery(),
					trendsSatsShare: failedQuery(),
					trendsSatsAbsolute: failedQuery(),
					trendsZapsAbsolute: failedQuery()
				}
			}
		});
		expect(body).toContain('Lightning');
		await settled();
		expect(unhandled).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();
	});
});
