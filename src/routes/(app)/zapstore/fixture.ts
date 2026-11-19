// The /zapstore overview's data for its page tests: a few days of every series, enough for each
// chart to mount, with the address answered as the overview's own. Held to the loader's own type,
// so a renamed or added series fails the type check here rather than passing unseen.
import type { PageServerData } from './(shell)/$types';

const DAY = 86_400;
const START = Date.UTC(2026, 10, 1) / 1000;
const days = (...values: number[]) => values.map((value, i) => ({ timestamp: START + i * DAY, value }));

export const OVERVIEW = {
	total: days(10, 11, 12),
	native: days(4, 4, 5),
	github: days(6, 7, 7),
	nativeShare: { daily: days(40, 36.4, 41.7) },
	releasesDaily: { native: days(3, 5, 2), newNative: days(1, 0, 1), github: days(9, 4, 6) },
	aggZaps: { daily: days(2, 0, 3), cumulative: days(100, 100, 250) },
	target: { kind: 'page', pill: 'overview' }
} satisfies PageServerData;

/** App Releases' key in the order it is drawn: the bars, then the 30-day lines, Total first. */
export const APP_RELEASES_KEY = [
	'Nostr-native',
	'New Nostr-native',
	'Republished from GitHub / F-Droid',
	'Total - 30d avg',
	'Nostr-native - 30d avg',
	'New Nostr-native - 30d avg',
	'Republished from GitHub / F-Droid - 30d avg'
];
