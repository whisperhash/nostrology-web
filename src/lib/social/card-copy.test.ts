import { describe, it, expect } from 'vitest';
import { cardCopy, CARD_DESCRIPTION_MAX } from './card-copy';

describe('cardCopy', () => {
	it('prefers the summary over the long description', () => {
		expect(cardCopy('the one-liner', 'the long text')).toBe('the one-liner');
	});

	it('falls back to the description when there is no summary', () => {
		expect(cardCopy(null, 'the long text')).toBe('the long text');
		expect(cardCopy('', 'the long text')).toBe('the long text');
	});

	it('returns empty when there is nothing to say, so the tag can be omitted', () => {
		expect(cardCopy(null, null)).toBe('');
		expect(cardCopy(undefined, undefined)).toBe('');
	});

	// Release notes and profile text arrive with newlines and runs of spaces; a meta tag is
	// a single line, and a raw newline makes the attribute ragged in some unfurlers.
	it('collapses whitespace', () => {
		expect(cardCopy('a\n\nb   c\t d')).toBe('a b c d');
	});

	it('leaves text at or under the limit untouched', () => {
		const exact = 'x'.repeat(CARD_DESCRIPTION_MAX);
		expect(cardCopy(exact)).toBe(exact);
	});

	// The point of trimming here is that unfurlers hard-cut mid-word. Ours must not.
	it('elides on a word boundary, never mid-word', () => {
		const long = 'word '.repeat(80).trim();
		const out = cardCopy(long);

		expect(out.length).toBeLessThanOrEqual(CARD_DESCRIPTION_MAX + 3);
		expect(out.endsWith('...')).toBe(true);
		expect(out.slice(0, -3)).toBe(out.slice(0, -3).trimEnd());
		expect(out.slice(0, -3).split(' ').every((w) => w === 'word')).toBe(true);
	});

	// The previous fixture here passed with the punctuation strip DELETED, because the word
	// boundary already landed after the last word. This one puts a comma exactly at the cut,
	// so it fails without the strip.
	it('does not leave dangling punctuation before the ellipsis', () => {
		// The comma has to survive the word-boundary trim for the strip to matter, so the cut
		// must land INSIDE the word after it. head + ', ' is 178 chars, so the 180-char cut
		// falls two characters into the following word and the boundary lands on the comma.
		// Without the strip this returns '...aaaaa,...'.
		const head = 'a'.repeat(CARD_DESCRIPTION_MAX - 10);
		const out = cardCopy(`${head}, ${'b'.repeat(10)}`);

		expect(out.endsWith(',...')).toBe(false);
		expect(out).not.toMatch(/[,;:.]\.\.\.$/);
		expect(out).toBe(`${head}...`);
	});

	// Scripts written without spaces have no word boundary to cut on, so they take the raw
	// path - which must still cut on a CODE POINT, never between surrogate halves.
	it('never emits a lone surrogate when cutting text with no spaces', () => {
		const out = cardCopy('y'.repeat(CARD_DESCRIPTION_MAX - 1) + String.fromCodePoint(0x1f600) + 'zzz');
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
		expect(out).not.toContain('\uFFFD');
	});

	it('bounds CJK text, which has no spaces at all', () => {
		const out = cardCopy('\u4e2d'.repeat(300));
		expect(Array.from(out).length).toBeLessThanOrEqual(CARD_DESCRIPTION_MAX + 3);
		expect(out.endsWith('...')).toBe(true);
	});

	// A whitespace-only summary is truthy. Choosing before normalizing let it win and then
	// collapse to '', throwing away a perfectly good description.
	it('does not let a whitespace-only summary suppress the description', () => {
		expect(cardCopy('   ', 'a real description')).toBe('a real description');
		expect(cardCopy('\n\t', 'a real description')).toBe('a real description');
	});

	// A single unbroken token longer than the limit has no word boundary to cut on; it must
	// still be bounded rather than returned whole.
	it('still bounds a single very long token', () => {
		const out = cardCopy('z'.repeat(CARD_DESCRIPTION_MAX * 2));
		expect(out.length).toBeLessThanOrEqual(CARD_DESCRIPTION_MAX + 3);
		expect(out.endsWith('...')).toBe(true);
	});
});
