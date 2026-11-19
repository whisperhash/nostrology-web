import {
	ACTIVE_USERS_1Y_WINDOW_SECONDS,
	getNutzapsDailySeries,
	getNutzapsUsersMonthly
} from '$lib/db/postgres';
import { answerAddress } from '$lib/server/slug-address';
import { NUTZAPS_SLUGS } from '$lib/slug-tables/nutzaps';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	// /nutzaps/<slug> renders this page too (src/hooks.ts, $lib/slug-table), and its address is
	// answered first: the default pill's own slug and a slug the table does not know are
	// redirected before the database is asked anything. Its other pill is a route of its own.
	const target = answerAddress(NUTZAPS_SLUGS, url, setHeaders);
	// Overview tab loads:
	//   - dailySeries: trailing-365d cross-mint daily series for the Nutzap
	//     Sats and Nutzap Payments charts.
	//   - nutzapsMAU: trailing-365d monthly active nutzap users, kind-9321
	//     (nutzaps), from the existing DAU/WAU/MAU pipeline. The getter's own
	//     default is the widest window it supports (4Y), so pin it to 1Y here
	//     to match this page's "in the past year" copy. An earlier version of
	//     this comment credited that 4Y default to an /active-users page; no
	//     such page exists - see nostrology-web#13.
	// Per-mint data lives on /nutzaps/mints.
	const [dailySeries, nutzapsMAU] = await Promise.all([
		getNutzapsDailySeries(),
		getNutzapsUsersMonthly(ACTIVE_USERS_1Y_WINDOW_SECONDS)
	]);
	return { dailySeries, nutzapsMAU, target };
};
