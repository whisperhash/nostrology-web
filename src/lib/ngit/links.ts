// Outbound links for /git rows, kept out of the page so they can be unit-tested.
//
// The document ships HEX pubkeys (the substrate's key); the ecosystem's viewers address
// people and repositories by npub, so the page encodes client-side with nostr-tools
// (ngit-design.md section 10). A malformed pubkey yields NO link rather than a broken
// one: the pipeline validates pubkeys, but third-party data never reaches an href on
// trust, and nip19 would throw on bad hex anyway.
import { npubEncode } from 'nostr-tools/nip19';

const HEX64 = /^[0-9a-f]{64}$/i;

/** The npub of a 64-hex pubkey, or null for anything else. */
export function npubOf(pubkey: unknown): string | null {
	if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) return null;
	try {
		return npubEncode(pubkey.toLowerCase());
	} catch {
		return null;
	}
}

/**
 * The repository's page on gitworkshop.dev, the ecosystem's web viewer:
 * `https://gitworkshop.dev/<npub>/<encodeURIComponent(d)>`. The `d` identifier is
 * third-party text (spaces, slashes and `?` all occur), so it is always percent-encoded -
 * an unencoded `/` would silently address a different path. An EMPTY `d` is a legal
 * identifier (dataset reference section 1), and the author's own page is the only honest
 * target for it.
 */
export function gitworkshopUrl(pubkey: unknown, d: unknown): string | null {
	const npub = npubOf(pubkey);
	if (!npub) return null;
	const id = typeof d === 'string' ? d : '';
	return id === ''
		? `https://gitworkshop.dev/${npub}`
		: `https://gitworkshop.dev/${npub}/${encodeURIComponent(id)}`;
}

/**
 * The repository's page on git.iris.to (Iris Git), hashtree's own viewer:
 * `https://git.iris.to/#/<npub>/<encodeURIComponent(d)>`. Iris's router splits the path on
 * `/` and decodes each segment, the second being the tree name, so the identifier is
 * percent-encoded whole, as for gitworkshop.dev: a `/` in it stays `%2F`, one tree name. For an
 * identifier without a `/` this is the address hashtree's git remote helper writes as the
 * announcement's `web` tag (the helper keeps a `/` literal, which Iris reads as a path inside
 * the tree). An EMPTY `d` links the author's page.
 */
export function irisGitUrl(pubkey: unknown, d: unknown): string | null {
	const npub = npubOf(pubkey);
	if (!npub) return null;
	const id = typeof d === 'string' ? d : '';
	return id === ''
		? `https://git.iris.to/#/${npub}`
		: `https://git.iris.to/#/${npub}/${encodeURIComponent(id)}`;
}

/**
 * Where a repository row links. A repository whose hosting class (dataset reference 4.4)
 * is `hashtree` - on hashtree and no GRASP server - opens on git.iris.to: gitworkshop.dev
 * reads code over HTTP(S) only, and for a repository whose clone URLs are all `htree://`
 * shows a "cannot access" card pointing there. Every other class opens on gitworkshop.dev,
 * as does a row without a class (leaderboard rows gained theirs on 2026-10-09).
 */
export function repoUrl(pubkey: unknown, d: unknown, cls?: unknown): string | null {
	return cls === 'hashtree' ? irisGitUrl(pubkey, d) : gitworkshopUrl(pubkey, d);
}

/** The maintainer's profile on njump.me. */
export function njumpUrl(pubkey: unknown): string | null {
	const npub = npubOf(pubkey);
	return npub ? `https://njump.me/${npub}` : null;
}
