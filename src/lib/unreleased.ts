// WHAT IS STILL IN DEVELOPMENT, and who may see it.
//
// ONE THING, TWO WORDS: "still in development" in prose, `unreleased` in code (the slug table's
// flag, `seesUnreleased`, `visibleTable`). They mean the same thing, said here so a grep for
// either finds the other.
//
// A part of the site can be built, deployed and live while only the OPERATOR'S OWN
// logged-in session sees it. The first one is /marketplaces' Recent listings section (the
// operator's call, 2026-10-24: "I want this section only visible to the logged in user
// WhisperHash... To any other visitor, including a logged in one, the new section should
// not ever be visible").
//
// THIS IS NOT /wip. That page lists surfaces that are finished and merely unlinked, and
// its own comment is honest about what that is: "obscurity, not true concealment" - anyone
// with the URL sees them. This is a gate. For everyone else the rows are never read, the
// card is never rendered, and the section's address answers exactly as a word nobody has
// ever used does.
//
// WHAT IT DOES NOT HIDE, said plainly so it is not mistaken for secrecy. Everything the page
// is BUILT from ships to every visitor, because it is one bundle: the slug table's entry (the
// section's name and its preview copy), the section component itself (its heading, its caption
// sentences, its column headings and the three marketplace URL builders), and the slug twice
// over. Only the DATA and the RENDERING are gated - no listing of anyone's reaches another
// visitor's browser, nothing is drawn for them, and the address resolves to no page, no title
// and no link preview. A reader cannot see the section; a developer reading our JavaScript can
// see that one exists and what it would look like.
//
// AND ONE THING MORE A VISITOR CAN NOTICE, which the first version of this comment denied:
// `/marketplaces#recent-listings` is not inert for them. $lib/legacy-hash resolves an old `#`
// link against the WHOLE table, so the hash opens the section's pill and then navigates to the
// address, which 302s (found) to the domain with the generic note - while an unknown hash does
// nothing at all. That tells them the domain knows the word, which is inside the boundary
// above; it is not the SLUG behaving differently, which answers identically either way.
//
// THE OTHER TWO SHAPES THE OPERATOR ASKED ABOUT ("also possibly entire domains while in
// development, or pills") - what each would take, and what is NOT ready:
//   - a PILL IS NOT SUPPORTED, and slugTableProblems REFUSES the flag on one so the trap
//     cannot be set by accident. visibleTable does filter pills, and the server's answer and
//     the sitemap would follow - but every domain page hands the WHOLE table to the browser
//     (its PillBar, $lib/domain-page and the old-link reading in $lib/legacy-hash, pageTitle,
//     the sections a phone's link icon chooses among), so the hidden pill would still be drawn
//     in the pill bar, and where the pills are parts of one page a click on it, or an old
//     `/<domain>#<that pill>` link, would paint its whole panel before the server's answer
//     bounced it. Supporting one means giving the page the reader's VIEW of the table rather
//     than the table - work on every domain page, not a flag. The default pill could never be
//     one in any case: that is the domain's own address.
//   - a DOMAIN: not this file's job. A domain is a route and a nav entry, so it gates wherever it
//     surfaces: EVERY server load of the domain asks `seesUnreleased(locals.session)` - its
//     +page.server.ts answering error(404) for everyone else, and its +layout.server.ts, if it
//     has one, reading nothing for them (SvelteKit serializes every node's data into
//     `/<domain>/__data.json`, so a layout that reads regardless leaks through it); the
//     `unreleased` flag on its $lib/nav entry keeps the nav, the mobile panel, the footer and the
//     error page clean (nav.gating.test asserts all four together); and its path joins
//     HIDDEN_TREES in $lib/seo/sitemap.ts.

import { own, type SlugTable } from '$lib/slug-table';

/**
 * The operator's own pubkey, 64-char lowercase hex - the one form everything downstream
 * uses. `npub1t6m495kynns7xjmgz8yt6krrw4r8tac0mvr3f25f9r35ke72ap3su4qycp`.
 *
 * A pubkey is PUBLIC data: it is what every Nostr event this person signs carries in the
 * clear, so hard-coding it leaks nothing. A fork changes this to its own operator's key.
 */
export const OPERATOR_PUBKEY = '5eb752d2c49ce1e34b6811c8bd5863754675f70fdb0714aa8928e34b67cae863';

/** What this module needs of a session: `locals.session`, or null when nobody is logged in. */
export type Viewer = { pubkey?: string | null } | null | undefined;

/**
 * Whether this session is the operator's. It decides everything the operator gets that nobody
 * else does: the sections still in development (seesUnreleased, below), a page served without
 * Google Analytics (hooks.server.ts), and the session that lasts 400 days and carries the
 * access log's `operator` tag ($lib/server/auth/handlers).
 *
 * The pubkey comes from the session cookie's HMAC (hooks.server.ts -> verifySessionCookie),
 * so it is the one identity on a request that a client cannot assert: no header, no query
 * parameter and no unverified cookie reaches it. An absent or unverifiable cookie is a null
 * session, which is false here.
 *
 * Lowercased before comparing, which no request can need: the cookie's own verifier refuses a
 * pubkey that is not /^[0-9a-f]{64}$/ ($lib/server/auth/cookie), so `locals.session.pubkey` is always
 * lowercase already. It is kept because this function is also called with pubkeys from
 * elsewhere (the login endpoint, the browser after a login, tests), and because the failure it
 * prevents - refusing the operator over a case they cannot see - is the worse of the two. It
 * cannot weaken the gate: the comparison is still against one 32-byte identity that only the
 * HMAC key can put on a request.
 */
export function isOperator(session: Viewer): boolean {
	const pubkey = session?.pubkey;
	return typeof pubkey === 'string' && pubkey.toLowerCase() === OPERATOR_PUBKEY;
}

/** Whether this session may see what is still in development: the operator's alone. */
export function seesUnreleased(session: Viewer): boolean {
	return isOperator(session);
}

/**
 * Whether this reader gets the section `slug` of this domain - ITS DATA as much as its address.
 *
 * THE FLAG IS THE ONLY SWITCH, and that is the point of this function: everyone sees a section
 * unless the slug table marks it still in development, and then only the operator. So releasing
 * one is a single edit - delete `unreleased: true` - rather than two edits in two files that
 * nothing couples, which is how a section ends up with a live address, a live title, a live
 * link preview and a sitemap entry while its rows are still hidden from everybody.
 *
 * A domain's +layout.server.ts asks this before reading anything the section needs, so a
 * visitor's request costs no query and their document carries no row. The page's +page.server.ts
 * asks `visibleTable` instead, because an address is answered from the whole table at once.
 *
 * An unknown slug is not a hidden one: a caller asking about a section this table does not have
 * gets true, because the answer to "may they see it" for something that does not exist cannot
 * be "no, it is secret".
 */
export function seesSection(t: SlugTable, slug: string, session: Viewer): boolean {
	return own(t.sections, slug)?.unreleased !== true || seesUnreleased(session);
}

/**
 * A domain's slug table as this reader may see it. For anyone who may not see what is still
 * in development, an unreleased pill or section is NOT A SLUG AT ALL - so every rule in
 * $lib/slug-table answers for it exactly as it does for a word nobody has ever used: a 302
 * (found) to the domain with the generic note, no page title of its own, no link preview, and
 * no entry in the sitemap. One filter, applied where the table is read, rather than a
 * condition inside each of those rules.
 *
 * It filters on the `unreleased` flag, and on nothing else: a table with no flag anywhere comes
 * back as the identical object (every domain but one, today), so a caller that passes `sees`
 * through on every request is not paying for a copy per request.
 *
 * A `former` slug that points at a hidden one goes too: it would otherwise 308 (permanent
 * redirect) to an address that answers a 302 (found) to the domain, which tells a reader that
 * something is there. slugTableProblems forbids the other broken case - an unreleased default
 * pill, which is the domain's own address.
 */
export function visibleTable(t: SlugTable, sees: boolean): SlugTable {
	if (sees) return t;
	const hidden = (slug: string): boolean =>
		own(t.sections, slug)?.unreleased === true ||
		t.pills.some((p) => p.slug === slug && p.unreleased === true);
	if (!t.pills.some((p) => p.unreleased) && !Object.values(t.sections).some((s) => s.unreleased))
		return t;
	return {
		...t,
		pills: t.pills.filter((p) => !p.unreleased),
		sections: Object.fromEntries(Object.entries(t.sections).filter(([, s]) => !s.unreleased)),
		former: Object.fromEntries(Object.entries(t.former).filter(([, to]) => !hidden(to)))
	};
}
