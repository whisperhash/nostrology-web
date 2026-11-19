// Profile parsing, sanitization and NIP-01 (protocol basics) replaceable resolution.
//
// The sanitization cases are the ones that matter: a display name is third-party text
// rendered in our chrome, and essentially no Nostr client sanitizes it (snort, noStrudel,
// Coracle, applesauce, welshman and damus all render names as authored). Amethyst is the
// exception, and only in its push-notification path.

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import {
	displayHandle,
	parseProfile,
	pickLatest,
	placeholderProfile,
	safeName,
	safePictureUrl,
	shortNpub
} from './profile';

const SK = generateSecretKey();
const PK = getPublicKey(SK);

function kind0(content: unknown, createdAt = 1_800_000_000): Event {
	return finalizeEvent(
		{ kind: 0, created_at: createdAt, tags: [], content: typeof content === 'string' ? content : JSON.stringify(content) },
		SK
	);
}

describe('safeName', () => {
	it('passes ordinary names through', () => {
		expect(safeName('Alice Example')).toBe('Alice Example');
	});

	it('strips a right-to-left override', () => {
		// U+202E visually reverses the text that follows it - the classic filename spoof,
		// and just as effective in a nav.
		expect(safeName('alice\u202Eexe.gnp')).toBe('aliceexe.gnp');
	});

	it('strips zero-width characters used to forge lookalikes', () => {
		expect(safeName('ali\u200Bce')).toBe('alice');
		expect(safeName('\uFEFFalice')).toBe('alice');
	});

	it('strips control characters', () => {
		expect(safeName('ali\u0000ce')).toBe('alice');
	});

	it('removes an embedded URL so a name cannot read as a link', () => {
		expect(safeName('Alice https://evil.example/login')).toBe('Alice');
	});

	it('collapses whitespace runs', () => {
		expect(safeName('Alice    B')).toBe('Alice B');
	});

	it('caps the length so a long name cannot break the layout', () => {
		const long = 'A'.repeat(200);
		const out = safeName(long);
		expect(out.length).toBe(32);
		expect(out.endsWith('...')).toBe(true);
	});

	it('truncates mid-word rather than on a word boundary', () => {
		// welshman's ellipsize() truncates on word boundaries with a grace band, which
		// means a 200-char single-word name is not truncated at all. A nav cannot afford
		// a truncator with an escape hatch.
		expect(safeName('supercalifragilisticexpialidociousandthensome').length).toBe(32);
	});

	it('returns empty for a name that was entirely unsafe', () => {
		expect(safeName('\u200B\u202E')).toBe('');
	});
});

describe('safePictureUrl', () => {
	it('accepts https', () => {
		expect(safePictureUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
	});

	it.each([
		['data:', 'data:image/png;base64,AAAA'],
		['http:', 'http://example.com/a.png'],
		['javascript:', 'javascript:alert(1)'],
		['blob:', 'blob:https://example.com/x'],
		['garbage', 'not a url'],
		['empty', ''],
		['non-string', 42]
	])('rejects %s', (_label, value) => {
		// No surveyed client checks the scheme, and `new URL()` happily accepts data: -
		// which embeds attacker-controlled bytes of unbounded size into the DOM.
		expect(safePictureUrl(value as unknown)).toBeUndefined();
	});
});

describe('shortNpub', () => {
	it('renders the applesauce/damus shape', () => {
		const short = shortNpub(PK);
		const npub = npubEncode(PK);
		expect(short.startsWith(npub.slice(0, 9))).toBe(true);
		expect(short.endsWith(npub.slice(-4))).toBe(true);
	});

	it('degrades to hex rather than throwing on a bad pubkey', () => {
		expect(shortNpub('nonsense')).toContain('...');
	});
});

describe('displayHandle', () => {
	it('renders _@domain as just the domain, per NIP-05 (DNS identifier)', () => {
		expect(displayHandle('_@nostrolo.gy')).toBe('nostrolo.gy');
	});

	it('keeps a normal identifier intact', () => {
		expect(displayHandle('alice@nostrolo.gy')).toBe('alice@nostrolo.gy');
	});

	it.each([['no @', 'nostrolo.gy'], ['empty', ''], ['object', {}], ['null', null]])(
		'returns undefined for %s',
		(_l, value) => {
			// Clients publish `"nip05":{}` in the wild - documented in Amethyst's parser.
			expect(displayHandle(value as unknown)).toBeUndefined();
		}
	);

	it('sanitizes the handle like a name', () => {
		expect(displayHandle('a\u202Elice@x.com')).toBe('alice@x.com');
	});
});

describe('pickLatest', () => {
	const base = (created: number, id: string): Event =>
		({ id, created_at: created, kind: 0, pubkey: PK, tags: [], content: '{}', sig: '' }) as Event;

	it('takes the newest created_at', () => {
		expect(pickLatest([base(1, 'b'), base(2, 'a')])?.created_at).toBe(2);
	});

	it('breaks a created_at TIE on the lowest id, per NIP-01 (protocol basics)', () => {
		// Relays legitimately hold different versions of a replaceable event, so this is
		// not theoretical. nostr-tools' pool.get() sorts only by created_at and resolves
		// ties by arrival order - which is why we reduce ourselves.
		expect(pickLatest([base(5, 'ffff'), base(5, 'aaaa')])?.id).toBe('aaaa');
		expect(pickLatest([base(5, 'aaaa'), base(5, 'ffff')])?.id).toBe('aaaa');
	});

	it('returns null for an empty set', () => {
		expect(pickLatest([])).toBeNull();
	});
});

describe('parseProfile', () => {
	it('prefers display_name over name', () => {
		expect(parseProfile(kind0({ name: 'alice', display_name: 'Alice Example' }))?.name).toBe(
			'Alice Example'
		);
	});

	it('honours the deprecated camelCase displayName', () => {
		// NIP-24 (extra metadata fields) lists `displayName` as deprecated but "found in the wild"; applesauce and
		// noStrudel both still read it.
		expect(parseProfile(kind0({ name: 'alice', displayName: 'Alice E' }))?.name).toBe('Alice E');
	});

	it('falls back to name', () => {
		expect(parseProfile(kind0({ name: 'alice' }))?.name).toBe('alice');
	});

	it('falls back to a short npub when there is no name at all', () => {
		expect(parseProfile(kind0({ about: 'hi' }))?.name).toBe(shortNpub(PK));
	});

	it('never uses nip05 as a name fallback', () => {
		// No surveyed client does this - the handle is always a separate element.
		expect(parseProfile(kind0({ nip05: 'alice@x.com' }))?.name).toBe(shortNpub(PK));
	});

	it('reads the deprecated image alias for picture', () => {
		expect(parseProfile(kind0({ image: 'https://x.com/a.png' }))?.picture).toBe(
			'https://x.com/a.png'
		);
	});

	it('drops an unsafe picture but keeps the rest of the profile', () => {
		const profile = parseProfile(kind0({ name: 'alice', picture: 'data:image/png;base64,AA' }));
		expect(profile?.picture).toBeUndefined();
		expect(profile?.name).toBe('alice');
	});

	it('survives a structurally wrong field instead of discarding the profile', () => {
		// The Amethyst rule: "one bad field must not discard the whole profile". NDK
		// throws here.
		const profile = parseProfile(kind0({ name: 'alice', nip05: {}, picture: 42 }));
		expect(profile?.name).toBe('alice');
		expect(profile?.nip05).toBeUndefined();
		expect(profile?.picture).toBeUndefined();
	});

	it('survives content that is not JSON at all', () => {
		expect(parseProfile(kind0('this is not json'))?.name).toBe(shortNpub(PK));
	});

	it('survives content that is a JSON array', () => {
		expect(parseProfile(kind0('[1,2,3]'))?.name).toBe(shortNpub(PK));
	});

	it('sanitizes the name it renders', () => {
		expect(parseProfile(kind0({ display_name: 'Ali\u202Ece' }))?.name).toBe('Alice');
	});

	it('returns null for a null event', () => {
		expect(parseProfile(null)).toBeNull();
	});

	it('carries created_at through for cheap revalidation', () => {
		expect(parseProfile(kind0({ name: 'a' }, 12345))?.createdAt).toBe(12345);
	});
});

describe('placeholderProfile', () => {
	it('is a valid renderable profile for a key with no kind-0 yet', () => {
		// A brand-new key legitimately has no profile - that is not an error state.
		const profile = placeholderProfile(PK);
		expect(profile.name).toBe(shortNpub(PK));
		expect(profile.picture).toBeUndefined();
	});
});
