// Client-side fetch + localStorage cache for a Nostr relay's NIP-11 server
// info endpoint. The relay's WS URL doubles as an HTTPS endpoint that
// returns a JSON document when called with `Accept: application/nostr+json`.
// Used by /relays/[...relay] to display relay metadata. Mirrors the shape
// of $lib/utils/mintInfo.ts so the page-level usage is symmetrical.

export type Fees = {
	admission?: Array<{ amount?: number; unit?: string; period?: number }>;
	subscription?: Array<{ amount?: number; unit?: string; period?: number }>;
	publication?: Array<{ amount?: number; unit?: string; kinds?: number[] }>;
};

export type Limitation = {
	max_message_length?: number;
	max_subscriptions?: number;
	max_filters?: number;
	max_limit?: number;
	max_subid_length?: number;
	max_event_tags?: number;
	max_content_length?: number;
	min_pow_difficulty?: number;
	auth_required?: boolean;
	payment_required?: boolean;
	restricted_writes?: boolean;
	created_at_lower_limit?: number;
	created_at_upper_limit?: number;
};

// NIP-11 server info shape. Defensively typed: every field is optional —
// the spec marks most as optional, older relays predate fields, and some
// relays return non-conformant JSON.
export interface RelayNip11Info {
	name?: string;
	description?: string;
	pubkey?: string;
	contact?: string;
	supported_nips?: number[];
	software?: string;
	version?: string;
	limitation?: Limitation;
	fees?: Fees;
	icon?: string;
	posting_policy?: string;
	payments_url?: string;
	tags?: string[];
	language_tags?: string[];
	relay_countries?: string[];
}

export type RelayInfoStatus = 'loading' | 'loaded' | 'unavailable';

// 1 day TTL — relay info changes rarely.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Bumped if the parsed shape changes — old cached entries silently
// invalidate via the key prefix.
const CACHE_KEY_PREFIX = 'relayInfo:v1:';
// Most relays answer in <500ms; 3s is enough for slow ones without making
// the page feel stuck on dead/slow relays.
const FETCH_TIMEOUT_MS = 3000;

function readCache(url: string): RelayNip11Info | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY_PREFIX + url);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { fetchedAt: number; data: RelayNip11Info };
		if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
		return parsed.data;
	} catch {
		return null;
	}
}

function writeCache(url: string, data: RelayNip11Info) {
	try {
		localStorage.setItem(
			CACHE_KEY_PREFIX + url,
			JSON.stringify({ fetchedAt: Date.now(), data })
		);
	} catch {
		// localStorage can be full or disabled; not fatal.
	}
}

// Convert a relay WS URL to the equivalent HTTPS URL used by NIP-11.
// `wss://relay.damus.io` → `https://relay.damus.io`. `ws://` maps to `http://`
// even though no production relay should be using plain ws/http.
function nip11Url(wsUrl: string): string {
	const trimmed = wsUrl.replace(/\/$/, '');
	if (trimmed.startsWith('wss://')) return 'https://' + trimmed.slice(6);
	if (trimmed.startsWith('ws://')) return 'http://' + trimmed.slice(5);
	return trimmed;
}

// Returns the cached or freshly-fetched NIP-11 info for a relay, or null on
// network/CORS/timeout/parse failure. We collapse all error modes here
// because the panel UX is the same regardless of cause.
export async function loadRelayInfo(relayUrl: string): Promise<RelayNip11Info | null> {
	const cached = readCache(relayUrl);
	if (cached) return cached;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(nip11Url(relayUrl), {
			signal: controller.signal,
			headers: { Accept: 'application/nostr+json' }
		});
		if (!res.ok) return null;
		const data = (await res.json()) as RelayNip11Info;
		writeCache(relayUrl, data);
		return data;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// Sorted list of NIP numbers a relay supports. Defensive: filter to numeric
// entries (the spec is integer-only but we've seen string entries in the wild).
export function supportedNips(info: RelayNip11Info | null): number[] {
	if (!info?.supported_nips) return [];
	return info.supported_nips
		.map((n) => (typeof n === 'number' ? n : parseInt(String(n), 10)))
		.filter((n) => !isNaN(n))
		.sort((a, b) => a - b);
}
