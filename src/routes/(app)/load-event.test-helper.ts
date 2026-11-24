import { isRedirect } from '@sveltejs/kit';
import { vi } from 'vitest';

import { OPERATOR_PUBKEY } from '$lib/unreleased';

// A domain page's server load, run the way SvelteKit runs it: for domain-loads.test.ts (each
// domain's loads and their rules) and domain-loads.gating.test.ts (the same loads with a section
// still in development).

/** Any server load: each takes its own event shape, and these tests build the parts it reads. */
export type Load = (event: never) => unknown;

/** The operator's session: the one reader who is sent every part of a page, a section still in
 *  development included ($lib/unreleased). A load runs as the operator unless a test names
 *  another reader. */
export const OPERATOR = { pubkey: OPERATOR_PUBKEY };

/** A load event at `path`, recording every read of the address and whether SvelteKit would
 * have tracked it: a read is untracked only inside `untrack`. Any property counts (SvelteKit
 * tracks pathname, search, searchParams, href, toString, toJSON...), not a chosen few. */
export function eventAt(path: string, session: { pubkey: string } | null = OPERATOR) {
	const real = new URL('https://site.test' + path);
	const reads: { key: string; tracked: boolean }[] = [];
	let untracked = 0;
	const url = new Proxy(real, {
		get(target, key) {
			if (typeof key === 'string') reads.push({ key, tracked: untracked === 0 });
			const v = Reflect.get(target, key, target);
			return typeof v === 'function' ? v.bind(target) : v;
		}
	});
	const untrack = <T>(fn: () => T): T => {
		untracked += 1;
		try {
			return fn();
		} finally {
			untracked -= 1;
		}
	};
	const setHeaders = vi.fn();
	return { event: { url, untrack, setHeaders, locals: { session } } as never, reads, setHeaders };
}

export type Run = ReturnType<typeof eventAt> & { data?: unknown; redirect?: { status: number; location: string } };

/** Runs `load` at `path` for `session` (the operator's when left out): its data, or the redirect
 *  it threw, beside the event's record of what was read and which headers were set. */
export async function run(load: Load, path: string, session?: { pubkey: string } | null): Promise<Run> {
	const e = session === undefined ? eventAt(path) : eventAt(path, session);
	try {
		return { data: await load(e.event), ...e };
	} catch (err) {
		if (isRedirect(err)) return { redirect: { status: err.status, location: err.location }, ...e };
		throw err;
	}
}
