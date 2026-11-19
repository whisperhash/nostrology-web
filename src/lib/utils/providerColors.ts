// Stable per-provider colors for the /lightning trend charts.
//
// Critical property: the same provider must render in the same color across
// BOTH share charts (zap-share %, sats-share %) — even though each chart's
// top-N membership and ranking differ. So colors are keyed on the canonical
// lud16 domain string, NOT on rank within a particular chart.
//
// Strategy:
//   - Hand-pin the well-known providers (those in
//     the provider-signer mapping as of 2026-05-09) to specific
//     palette entries, in rough rank-by-zap-volume order so the most-visible
//     providers get the most-distinct hues.
//   - Unknown providers (a new wallet appears in the mapping, or a long-tail
//     domain that somehow makes top-N) deterministically hash to a palette
//     entry — same domain always gets the same color.
//   - 'other' is reserved as a muted grey so it visually recedes (it's the
//     catch-all bucket; not a real story).
//
// Palette: same 20-color FlatUI-style set used by /nutzaps/mints, minus the
// 'silver'/'concrete'/'pearl' greys (those collide with 'other'). Picked
// for distinct hues that all read on the dark gray-900 background, with the
// orange family excluded (clashes with chart axis ticks) and the purple
// family excluded (reserved for nostr-purple brand chrome).

const PALETTE: readonly string[] = [
	'#3498db', // blue       (rank 0)
	'#e74c3c', // red        (rank 1)
	'#2ecc71', // green      (rank 2)
	'#f1c40f', // yellow     (rank 3)
	'#e84393', // pink       (rank 4)
	'#1abc9c', // turquoise  (rank 5)
	'#fd79a8', // light pink (rank 6)
	'#5dade2', // light blue (rank 7)
	'#16a085', // green sea  (rank 8)
	'#27ae60', // nephritis  (rank 9)
	'#2980b9', // belize hole(rank 10)
	'#c0392b', // pomegranate(rank 11)
	'#00cec9', // cyan       (rank 12)
	'#55efc4', // mint       (rank 13)
	'#74b9ff', // sky blue   (rank 14)
	'#ff7675', // coral red  (rank 15)
	'#00b894', // teal-green (rank 16)
	'#9b59b6', // purple — used SPARINGLY only for hash fallback (low collision odds with brand chrome)
];

const OTHER_COLOR = '#7f8c8d'; // muted grey — explicitly NOT in PALETTE

// Hand-pinned per-domain color assignments, in rank-by-zap-volume order
// across our verified provider-signer mapping. This
// ensures the most-visible providers get the most-distinct palette entries
// instead of accidentally clustering on similar hues via the hash fallback.
//
// Maintenance: if a new provider lands in the mapping, leaving it OUT of this
// table is fine — it'll get a deterministic-hashed color. Only hand-pin
// when (a) the domain is going to consistently appear in top-10 charts and
// (b) the auto-assigned hash collides with an existing top provider.
const PINNED: Readonly<Record<string, string>> = {
	'primal.net':          PALETTE[0],   // blue
	'walletofsatoshi.com': PALETTE[1],   // red
	'getalby.com':         PALETTE[2],   // green
	'coinos.io':           PALETTE[3],   // yellow
	'npub.cash':           PALETTE[4],   // pink
	'strike.me':           PALETTE[5],   // turquoise
	'minibits.cash':       PALETTE[6],   // light pink
	'rizful.com':          PALETTE[7],   // light blue
	'blink.sv':            PALETTE[8],   // green sea
	'zeuspay.com':         PALETTE[9],   // nephritis
	'wallet.yakihonne.com': PALETTE[10], // belize hole
	'fountain.fm':         PALETTE[11],  // pomegranate
	'blitzwalletapp.com':  PALETTE[12],  // cyan
	'sendsats.lol':        PALETTE[13],  // mint
	'satsilo.com':         PALETTE[14],  // sky blue
	'nostrdvm.com':        PALETTE[15],  // coral red
	'zap.stream':          PALETTE[16],  // teal-green
};

// Cheap deterministic string hash (FNV-1a 32-bit). Quality is fine for
// "spread N domain strings across a 17-color palette without bias" — we're
// not doing crypto.
function fnv1a32(s: string): number {
	let hash = 2166136261;
	for (let i = 0; i < s.length; i += 1) {
		hash ^= s.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	// Coerce to unsigned 32-bit before returning.
	return hash >>> 0;
}

export function getProviderColor(domain: string): string {
	if (domain === 'other') return OTHER_COLOR;
	const pinned = PINNED[domain];
	if (pinned !== undefined) return pinned;
	// Fallback: hash the (lowercased) domain to a palette index. Same domain
	// always gets the same color across reloads, sessions, and charts.
	const idx = fnv1a32(domain.toLowerCase()) % PALETTE.length;
	return PALETTE[idx];
}

// Exposed for tests + for any caller that wants to render a swatch / legend.
export const _providerColorPalette = PALETTE;
export const _providerColorOther = OTHER_COLOR;
