// Browser-safe "Relay users" threshold options for /relays. Extracted from the
// route component so the memory-safety floor below is unit-testable rather than
// a convention someone can quietly undo.
//
// ─── Why the list starts at 100+ ──────────────────────────────────────────────
// LeaderboardTable is NOT virtualized: every relay that passes the filter
// becomes a real <tr> inside a 600px scroller, so the DOM cost scales with the
// corpus (34,136 relays as of 2026-07-25), not with what's on screen. Measured
// in headless Chrome at an iPhone viewport (390x844, DPR 3) against dev:
//
//   tier    rows      DOM nodes   JS heap (peak -> settled)
//   1+      34,136    375,633     747 MB -> 725 MB
//   10+      7,356     81,053     >=900 MB -> 171 MB
//   100+     1,871     20,718     113 MB -> 57 MB
//   1000+      182      2,139      53 MB -> 27 MB
//
// The 1+ and 10+ tiers reliably got the iOS Safari WebContent process killed for
// memory. Because the selection is persisted (see restoreRelayMinUsers), every
// Safari auto-reload re-applied the lethal tier and crashed again, which is what
// surfaces to the user as "A problem repeatedly occurred". Desktop absorbed
// 725 MB without complaint, so this only ever reproduced on phones.
//
// DO NOT re-add a tier below 100 without first bounding what the table
// materializes (virtualization, or a cap on rendered rows). relayThresholds.test.ts
// enforces the floor.
export const RELAY_MIN_USERS_FLOOR = 100;

export interface RelayMinUsersThreshold {
	value: string;
	label: string;
}

export const RELAY_MIN_USERS_THRESHOLDS: RelayMinUsersThreshold[] = [
	{ value: '100', label: '100+' },
	{ value: '1000', label: '1k+' },
	{ value: '10000', label: '10k+' },
	{ value: '100000', label: '100k+' }
];

export const DEFAULT_RELAY_MIN_USERS = 1000;

/**
 * Resolve a persisted `relays:minUsers` value to a threshold we're willing to
 * render. Anything not in RELAY_MIN_USERS_THRESHOLDS falls back to the default —
 * which is also what un-wedges a browser that stored a now-removed lethal tier
 * (e.g. "1") before that tier was dropped.
 */
export function restoreRelayMinUsers(saved: string | null): number {
	if (saved === null) return DEFAULT_RELAY_MIN_USERS;
	const n = Number(saved);
	if (!Number.isFinite(n)) return DEFAULT_RELAY_MIN_USERS;
	if (!RELAY_MIN_USERS_THRESHOLDS.some((t) => t.value === String(n))) {
		return DEFAULT_RELAY_MIN_USERS;
	}
	return n;
}
