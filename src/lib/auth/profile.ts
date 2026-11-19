// Fetching and rendering a Nostr identity: avatar, display name, NIP-05 (DNS identifier)
// handle. kind-0 (profile-metadata).
//
// TWO SOURCES, in order:
//
//  1. Primal's cache over HTTP (~400ms, one POST, returns the FULL SIGNED EVENT).
//  2. A relay pool over WebSocket (~1.3s cold), as the fallback.
//
// Primal is a proprietary, undocumented vendor API and is NOT Nostr-native - tracked as
// whisperhash/nostrology-web#7, to be inverted so relays are primary. It is acceptable
// for v0 for one specific reason: the response carries the full signed kind-0 event, and
// we verify that signature ourselves. Primal can therefore fail to answer, or answer
// with a stale version, but it cannot lie to us about profile content. Do not "optimize"
// the verification away - it is what makes the dependency tolerable.
//
// purplepag.es is DELIBERATELY ABSENT from the relay list despite being the most
// hardcoded profile indexer in the ecosystem: it went down on 2026-08-27 and was
// unreachable from three networks. `indexer.coracle.social` is likewise absent - its own
// NIP-11 (relay information document) advertises supported_nips [65], i.e. it serves kind-10002 (relay-list-metadata)
// only, so asking it for a kind-0 is a request it can never satisfy.

import { verifyEvent, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { npubEncode } from 'nostr-tools/nip19';

/** Live-verified 2026-08-27. See the header for who is deliberately missing. */
export const PROFILE_RELAYS = [
	'wss://relay.primal.net',
	'wss://nos.lol',
	'wss://profiles.nostr1.com',
	'wss://directory.yabu.me'
];

export const PRIMAL_CACHE_URL = 'https://cache2.primal.net/api';

export interface Profile {
	pubkey: string;
	/** display_name -> name, already sanitized. Never empty; falls back to a short npub. */
	name: string;
	/** https: only, or undefined. */
	picture?: string;
	/** NIP-05 (DNS identifier) as claimed in the profile. `_@domain` rendered as `domain`. */
	nip05?: string;
	/** created_at of the event this came from - used to revalidate cheaply. */
	createdAt: number;
}

// --- rendering helpers -------------------------------------------------------------

/**
 * Characters that let a display name escape its box: C0/C1 controls, RTL/LTR overrides
 * (U+202A-202E, U+2066-2069) which can visually reverse surrounding text, and zero-width
 * characters (U+200B-200F, U+2060, U+FEFF) which forge lookalikes.
 */
const UNSAFE_NAME_CHARS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF]/g;

/**
 * Strip characters that let a display name escape its box, and cap its length.
 *
 * Ported from Amethyst's Sanitizer.kt, which is the only real implementation in the
 * ecosystem - and note WHERE it lives there: `moderation/notifications`, i.e. the path
 * where a name escapes the app into the OS shell. A nav is the same class of surface.
 * snort, noStrudel, Coracle, applesauce, welshman and damus all render names as-authored.
 *
 * Embedded URLs are stripped too, so a name cannot read as a clickable link.
 *
 * Homoglyphs are NOT addressed - there is no cheap fix - which is acceptable here because
 * we render the user their OWN name. Think again before reusing this for other people's.
 */
export function safeName(raw: string, max = 32): string {
	const cleaned = raw
		.replace(UNSAFE_NAME_CHARS, '')
		.replace(/https?:\/\/\S+/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (cleaned.length === 0) return '';
	return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

/**
 * Allowlist https: for the avatar URL.
 *
 * No surveyed client validates the scheme, and `new URL()` happily accepts `data:` - which
 * embeds attacker-controlled bytes of unbounded size straight into the DOM. The rendered
 * box is also size-capped in CSS, since we cannot bound the download client-side.
 */
export function safePictureUrl(raw: unknown): string | undefined {
	if (typeof raw !== 'string' || raw === '') return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** npub1abcd...wxyz - the applesauce/damus shape (9 + 4), the most legible of the five in use. */
export function shortNpub(pubkey: string): string {
	try {
		const npub = npubEncode(pubkey);
		return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
	} catch {
		return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
	}
}

/** NIP-05 (DNS identifier): "_@domain" is the root identifier and displays as just the domain. */
export function displayHandle(nip05: unknown): string | undefined {
	if (typeof nip05 !== 'string' || nip05 === '') return undefined;
	const trimmed = nip05.trim();
	if (!trimmed.includes('@')) return undefined;
	const shown = trimmed.startsWith('_@') ? trimmed.slice(2) : trimmed;
	// A handle is third-party-authored text on the same surface as the name, so it gets
	// the same treatment. A slightly longer cap: a domain can legitimately be long, and
	// the layout truncates too.
	return safeName(shown, 48) || undefined;
}

// --- parsing -----------------------------------------------------------------------

/**
 * NIP-01 (protocol basics) replaceable-event resolution: newest created_at wins; on a TIE, the lowest event
 * id wins.
 *
 * We reduce ourselves rather than using SimplePool.get(), which both MUTATES the caller's
 * filter (it sets limit = 1 in place) and sorts only by created_at, leaving equal
 * timestamps resolved by arrival order. Relays legitimately hold different versions, so
 * the tie-break is not theoretical.
 */
export function pickLatest(events: Event[]): Event | null {
	return events.reduce<Event | null>((best, event) => {
		if (best === null) return event;
		if (event.created_at > best.created_at) return event;
		if (event.created_at === best.created_at && event.id < best.id) return event;
		return best;
	}, null);
}

/**
 * Parse a kind-0 (profile-metadata) event into a Profile.
 *
 * TOLERANT by design. Clients in the wild publish structurally wrong values - `"nip05":{}`
 * and birthdays as strings are both documented in Amethyst's parser, which wraps every
 * field in a tolerant serializer for exactly this reason - and one bad field must never
 * discard the whole profile. NDK by contrast throws on unparseable content.
 *
 * Name chain: display_name -> name -> short npub. NIP-24 (extra metadata fields) defines
 * display_name as "an alternative, bigger name with richer characters than name", and
 * `displayName` (camelCase) as deprecated-but-found-in-the-wild. NIP-05 (DNS identifier) is never a name
 * fallback - no surveyed client does that.
 */
export function parseProfile(event: Event | null): Profile | null {
	if (event === null) return null;
	let content: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(event.content);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			content = parsed as Record<string, unknown>;
		}
	} catch {
		// A malformed kind-0 is treated exactly like a missing one: we still know the
		// pubkey, so the user gets their short npub rather than an error.
	}
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

	const rawName = str(content.display_name) ?? str(content.displayName) ?? str(content.name) ?? '';
	const name = safeName(rawName) || shortNpub(event.pubkey);

	return {
		pubkey: event.pubkey,
		name,
		// `image` is a deprecated alias for `picture` that NIP-24 (extra metadata fields) does not list but the
		// ecosystem honours.
		picture: safePictureUrl(str(content.picture) ?? str(content.image)),
		nip05: displayHandle(content.nip05),
		createdAt: event.created_at
	};
}

/** A pubkey with no profile yet is normal, not an error - render the short npub. */
export function placeholderProfile(pubkey: string): Profile {
	return { pubkey, name: shortNpub(pubkey), createdAt: 0 };
}

// --- fetching ----------------------------------------------------------------------

function isKind0For(value: unknown, pubkey: string): value is Event {
	if (value === null || typeof value !== 'object') return false;
	const e = value as Partial<Event>;
	return e.kind === 0 && typeof e.content === 'string' && e.pubkey === pubkey;
}

/**
 * Primal's cache over HTTP. Returns the signed kind-0 event, or null.
 *
 * The signature is verified before the event is trusted - that is what keeps this vendor
 * dependency to "availability and freshness" rather than "integrity".
 */
export async function fetchFromPrimal(pubkey: string, timeoutMs = 3000): Promise<Event | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(PRIMAL_CACHE_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(['user_infos', { pubkeys: [pubkey] }]),
			signal: controller.signal
		});
		if (!res.ok) return null;
		const payload: unknown = await res.json();
		if (!Array.isArray(payload)) return null;
		// The response also carries Primal's own pseudo-kinds (10000119 media variants,
		// 10000158 nip05 verification, ...). We take only the real kind-0 and re-derive
		// everything else ourselves, so a change in their private schema cannot mislead us.
		const events = payload.filter((e): e is Event => isKind0For(e, pubkey) && verifyEvent(e));
		return pickLatest(events);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Relay-pool fallback.
 *
 * `maxWait` is not optional in spirit: EOSE resolves only when EVERY relay has answered,
 * so one unreachable relay otherwise pins the whole request to the pool's default timeout
 * (measured 3014ms vs 233ms). Always bound it.
 */
export async function fetchFromRelays(
	pubkey: string,
	relays: string[] = PROFILE_RELAYS,
	maxWait = 2500
): Promise<Event | null> {
	const pool = new SimplePool();
	try {
		const events = await pool.querySync(relays, { kinds: [0], authors: [pubkey] }, { maxWait });
		return pickLatest(events.filter((e) => isKind0For(e, pubkey) && verifyEvent(e)));
	} catch {
		return null;
	} finally {
		try {
			pool.close(relays);
			pool.destroy();
		} catch {
			/* best effort */
		}
	}
}

/**
 * Fetch a profile: Primal first, relays second, placeholder last.
 *
 * NEVER throws - the nav must render something for a logged-in user no matter what the
 * network does.
 */
export async function fetchProfile(pubkey: string): Promise<Profile> {
	const viaPrimal = await fetchFromPrimal(pubkey);
	const event = viaPrimal ?? (await fetchFromRelays(pubkey));
	return parseProfile(event) ?? placeholderProfile(pubkey);
}
