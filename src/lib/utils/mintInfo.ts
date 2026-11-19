// Client-side fetch + localStorage cache for a Cashu mint's NUT-06 /v1/info
// endpoint. Used by /nutzaps/mints/[...mint] to display mint metadata on the
// detail card. Lifted out of the original presentational component so the page
// can do a single fetch and pass the result to multiple render targets (left-
// side bits + right-side technical panel).

export type Contact = { method?: string; info?: string };

// NUT-06 standard mint-info shape. Defensively typed: every field is optional
// since (a) the spec marks most as optional, (b) older mints predate v1 and
// ship slightly different schemas, and (c) some mints return non-conformant
// JSON.
export interface MintV1Info {
	name?: string;
	pubkey?: string;
	version?: string;
	description?: string;
	description_long?: string;
	// NUT-06 v1 uses [{method, info}]; some older mints use string[].
	contact?: Array<Contact | string>;
	motd?: string;
	icon_url?: string;
	nuts?: Record<string, unknown>;
}

export type MintInfoStatus = 'loading' | 'loaded' | 'unavailable';

// 1 day TTL — mint info changes rarely (operator restart / version bump).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Bumped if we change the parsed shape — old cached entries silently
// invalidate via the key prefix.
const CACHE_KEY_PREFIX = 'mintInfo:v1:';
// Mints generally answer in <500ms; 3s is enough headroom for slow ones
// without making the page feel stuck on dead mints.
const FETCH_TIMEOUT_MS = 3000;

function readCache(url: string): MintV1Info | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY_PREFIX + url);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { fetchedAt: number; data: MintV1Info };
		if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
		return parsed.data;
	} catch {
		return null;
	}
}

function writeCache(url: string, data: MintV1Info) {
	try {
		localStorage.setItem(
			CACHE_KEY_PREFIX + url,
			JSON.stringify({ fetchedAt: Date.now(), data })
		);
	} catch {
		// localStorage can be full or disabled; not fatal.
	}
}

// Returns the cached or freshly-fetched info for a mint, or null on
// network/CORS/timeout/parse failure. Network error, CORS rejection, timeout,
// and JSON parse failure all produce the same UX (panel hidden), so we
// collapse them here.
export async function loadMintInfo(mintUrl: string): Promise<MintV1Info | null> {
	const cached = readCache(mintUrl);
	if (cached) return cached;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(`${mintUrl.replace(/\/$/, '')}/v1/info`, {
			signal: controller.signal,
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) return null;
		const data = (await res.json()) as MintV1Info;
		writeCache(mintUrl, data);
		return data;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// Normalize contact entries to {method, info}. NUT-06 v1 uses objects, older
// mints use plain strings — coerce to a uniform shape so callers don't branch.
// Output is sorted by display priority: nostr first, then email, then
// twitter/x, then everything else in original order (Array.sort is stable).
const CONTACT_PRIORITY: Record<string, number> = {
	nostr: 0,
	email: 1,
	twitter: 2,
	x: 2
};
export function normalizeContacts(
	contact: MintV1Info['contact']
): Array<{ method: string; info: string }> {
	return (contact ?? [])
		.map((c) => {
			if (typeof c === 'string') return { method: '', info: c };
			return { method: c.method ?? '', info: c.info ?? '' };
		})
		.filter((c) => c.info.length > 0)
		.sort((a, b) => {
			const aPri = CONTACT_PRIORITY[a.method.toLowerCase()] ?? 99;
			const bPri = CONTACT_PRIORITY[b.method.toLowerCase()] ?? 99;
			return aPri - bPri;
		});
}

// Build a reasonable href for known contact methods. Unknown methods return
// null so callers render plain text.
export function contactHref(method: string, value: string): string | null {
	const m = method.toLowerCase();
	if (m === 'email') return `mailto:${value}`;
	if (m === 'twitter' || m === 'x') return `https://x.com/${value.replace(/^@/, '')}`;
	if (m === 'nostr') return `https://njump.to/${value}`;
	if (value.startsWith('http://') || value.startsWith('https://')) return value;
	return null;
}

// Sorted list of NUT numbers a mint supports. The spec keys `nuts` by NUT
// number (string), value is a per-NUT capability object.
export function supportedNuts(info: MintV1Info | null): number[] {
	if (!info?.nuts) return [];
	return Object.keys(info.nuts)
		.map((k) => parseInt(k, 10))
		.filter((n) => !isNaN(n))
		.sort((a, b) => a - b);
}
