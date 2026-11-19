// Copy for a link-preview card, trimmed to what unfurlers actually display.
//
// Preview fetchers truncate somewhere around 160-200 characters and several hard-cut
// mid-word, so a long description arrives as a ragged fragment. Trim on a word boundary
// ourselves and mark the elision, rather than letting each client invent its own.

/** Characters kept before eliding. Comfortably inside every unfurler's window. */
export const CARD_DESCRIPTION_MAX = 180;

/** Collapse whitespace and trim; '' when there is nothing left. */
function normalize(value?: string | null): string {
	return (value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Build a card description from an entity's short summary and its long-form text.
 * Prefers the summary (it is authored as a one-liner); falls back to the head of the
 * description. Returns '' when there is nothing to say, which callers pass straight
 * through - SocialMeta omits the tag entirely rather than emitting an empty one.
 */
export function cardCopy(summary?: string | null, description?: string | null): string {
	// Normalize BOTH candidates before choosing. A whitespace-only summary is truthy, so
	// picking first and normalizing after would let '   ' win and return '' - discarding a
	// perfectly good description. `summary` is the one field in getZapstoreAppDetail with
	// no emptiness guard in the data layer, so this is reachable, not theoretical.
	const text = normalize(summary) || normalize(description);
	if (text.length <= CARD_DESCRIPTION_MAX) return text;

	// Measure and cut by CODE POINT, not UTF-16 unit. A .slice() at a fixed index can land
	// between a surrogate pair and emit a lone surrogate, which serializes as U+FFFD -
	// visible mojibake in the card. Not exotic: the word-boundary branch below does not
	// exist for scripts written without spaces (Chinese, Japanese), so every over-length
	// CJK description takes the raw-cut path.
	const chars = Array.from(text);
	if (chars.length <= CARD_DESCRIPTION_MAX) return text;
	const cut = chars.slice(0, CARD_DESCRIPTION_MAX).join('');

	const lastSpace = cut.lastIndexOf(' ');
	const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
	return `${kept.replace(/[,;:.\s]+$/, '')}...`;
}
