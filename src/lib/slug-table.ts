// A domain's slug table: every slug that can follow the domain in an address - /git/zaps,
// /git/collaboration - and what each one is.
//
// WHY. A link to a section has to survive change: sections get renamed when what they show
// evolves, move between pills, and disappear. So a link names the section, never its pill,
// and the slug table - one per domain, in $lib/slug-tables - is the one place that says where
// each slug lives today. The server reads it to answer an address ($lib/server/slug-address,
// called from the domain's +page.server.ts); the page, its pill bar, the sections' link icons,
// the sitemap and the tests read the same file.
// The server alone resolves an address: the browser starts from the server's answer, so what
// it shows cannot disagree with the HTML it was sent.
//
// TERMS (agreed with the operator, 2026-10-19). A DOMAIN is a subject area with its own page
// and nav entry (/git). A PILL is one of the switches along the top of a domain page and the
// part of the page it shows, named by its address (/git/hosting is a pill); the first is the
// DEFAULT PILL, shown at the domain's own address. A SECTION is one titled card inside a pill
// (Zaps, What is counted). A SLUG is any word directly under a domain in an address: a pill's,
// a section's or a collection's. A DETAIL PAGE is a page about one particular thing, found by
// its ID, and its ID sits under a COLLECTION, a plural word (/zapstore/apps/<pubkey>/<app>).
//
// THE RULES for /<domain>/<slug> (agreed with the operator, 2026-10-19):
//   - a current pill or section    -> the page on that pill, opened at the section;
//   - a former slug                -> 308 (permanent redirect) to the current slug;
//   - a retired section, recorded  -> the page on its last pill, with a note naming it;
//   - any other slug               -> 302 (found) to /<domain>, with a generic note (`#gone`);
//   - not a slug at all            -> 404 (not found), as before: src/hooks.ts reroutes only
//                                     slugs, so /git/.env or /git/a/b match no route.
// Never a 404 (not found) for a slug: a link shared in a Nostr note lives forever, and a 404
// (not found) would also cost it its preview card.

/** What a slug looks like: lowercase words joined by single hyphens. No dot, so a slug can
 * never be taken for a host or a file - which is also how /relays tells its relay pages
 * (/relays/relay.damus.io) from slugs. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The hash a 302 (found) for an unknown slug carries, so the page can say why the reader is
 * there. The only `#` the site still writes: the page reads it and removes it at once. */
export const GONE_HASH = 'gone';

export interface PillEntry {
	/** The pill's slug: its address is /<domain>/<slug>, or the domain's own for the first. */
	slug: string;
	/** Its name in the pill bar, and in the page title of its address. */
	label: string;
	/** A pill built as a page of its own (/zapstore/leaderboards), not a part of the domain's
	 * page: its address is its own route's, which src/hooks.ts never reroutes. Never the
	 * default pill, whose address is the domain page's. */
	ownRoute?: boolean;
	/** Still in development: only the operator's own session sees it, and for everyone else it
	 * is not a slug at all ($lib/unreleased). NOT SUPPORTED ON A PILL YET - slugTableProblems
	 * refuses it, and says why - so this exists for the day the pages read the reader's view of
	 * the table rather than the table. Never the default pill: that is the domain itself. */
	unreleased?: true;
}

export interface SectionEntry {
	/** The pill the section sits on today. */
	pill: string;
	/** The id of the section's element on the page. */
	elementId: string;
	/** The section's heading, as the page shows it. */
	title: string;
	/** The link preview of the section's own address: what a chat or Nostr app draws for it.
	 * Absent, the address draws the domain's own preview (What is counted's does). */
	preview?: { title: string; description: string };
	/**
	 * Still in development: only the operator's own session sees this section, its rows and
	 * its address. For everyone else $lib/unreleased drops it from the table before any rule
	 * here reads it, so its slug answers as an unknown one - and the page must not render the
	 * card either, which is the half this flag cannot enforce on its own.
	 */
	unreleased?: true;
}

export interface SlugTable {
	/** The domain's own address, e.g. '/git'. */
	path: string;
	/** The pills in page order. The first is the default pill, shown at `path` itself. */
	pills: readonly PillEntry[];
	sections: Readonly<Record<string, SectionEntry>>;
	/** Renamed slugs: old slug -> current slug (a pill or a section). */
	former: Readonly<Record<string, string>>;
	/** Removed sections, recorded so the note can name them: slug -> last pill and title. */
	retired: Readonly<Record<string, { pill: string; title: string }>>;
	/** Collections with a page at their own address (/zapstore/apps), which src/hooks.ts must
	 * never reroute. A collection with no page there (/zapstore/publishers holds only its detail
	 * pages) is not listed: its word is a slug like any other, a 302 (found) to the domain with
	 * the note rather than a 404 (not found). A pill built as a page of its own is marked on the
	 * pill instead (`ownRoute`). */
	ownRoutes: readonly string[];
	/** Words of a shape that a route of its own takes directly under the domain, by the name of
	 * its param matcher in src/params: /zapstore/<pubkey>, an old address kept as a redirect, is
	 * `hex64`. src/hooks.ts never reroutes such a word, and no slug may have the shape. */
	ownShapes?: Readonly<Record<string, (word: string) => boolean>>;
}

/** What an address means, as the server answers it. */
export type Resolution =
	| { kind: 'page'; pill: string; section?: string }
	| { kind: 'retired'; pill: string; title: string }
	| { kind: 'redirect'; status: 302 | 308; location: string };

/** The answer a page is rendered with: anything but a redirect. */
export type Target = Exclude<Resolution, { kind: 'redirect' }>;

/** The default pill's slug: the first pill's. */
export function defaultPill(t: SlugTable): string {
	return t.pills[0].slug;
}

/** Whether `slug` is one of the table's pills. */
export function isPill(t: SlugTable, slug: string): boolean {
	return t.pills.some((p) => p.slug === slug);
}

/** `record[key]`, own keys only. A plain lookup also finds what every object inherits:
 * /git/constructor found Object's constructor as a "section" and answered 500 (internal
 * server error) until 2026-10-19 - `constructor` is slug-shaped. Not `Object.hasOwn`, which
 * Safari before 15.4 lacks (Vite's default build target is older), and this runs in the page. */
export function own<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
	return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** Whether a word under the domain belongs to a route of its own rather than to the domain's
 * page: a collection, a pill built as a page of its own, or a word of an own route's shape.
 * src/hooks.ts leaves these to the router. */
export function routedElsewhere(t: SlugTable, word: string): boolean {
	return (
		t.ownRoutes.includes(word) ||
		t.pills.some((p) => p.ownRoute && p.slug === word) ||
		Object.values(t.ownShapes ?? {}).some((matches) => matches(word))
	);
}

/** The slug an address carries after the domain's own path; undefined for the bare path. */
export function slugIn(pathname: string, path: string): string | undefined {
	if (!pathname.startsWith(path + '/')) return undefined;
	return pathname.slice(path.length + 1).replace(/\/$/, '') || undefined;
}

/** A redirect's target with the request's query kept (`?utm_source=...`), ahead of any `#`,
 * as SvelteKit's own trailing-slash 308 (permanent redirect) and the edge's alias hosts keep it. */
export function keepQuery(location: string, search: string): string {
	if (!search) return location;
	const hash = location.indexOf('#');
	return hash < 0 ? location + search : location.slice(0, hash) + search + location.slice(hash);
}

/** The address of a slug on this domain; the default pill's is the domain's own. */
export function addressOf(t: SlugTable, slug: string): string {
	return slug === defaultPill(t) ? t.path : `${t.path}/${slug}`;
}

/** Every address under the domain that shows its page - each pill but the default one (whose
 * address is the domain's own), then each section - in the table's order. The sitemap lists
 * them ($lib/seo/sitemap), so a pill or a section added to a table is listed with no other
 * change. Former and retired slugs are not pages of their own, so they are not here. */
export function slugAddresses(t: SlugTable): string[] {
	return [...t.pills.slice(1).map((p) => p.slug), ...Object.keys(t.sections)].map((slug) => addressOf(t, slug));
}

/** The page title for what an address names: the domain's own title, then the section's or
 * the pill's name - "Nostrology - Git on Nostr - Hosting" - so a browser tab and a search
 * result tell the pills apart (the operator's call, 2026-10-19). The default pill keeps the
 * domain's title alone. Only the title: what a chat app's preview shows is the page's own
 * business (SocialMeta's socialTitle). */
export function pageTitle(t: SlugTable, base: string, target: Target | undefined): string {
	if (target?.kind === 'page' && target.section) {
		const section = own(t.sections, target.section);
		if (section) return `${base} - ${section.title}`;
	}
	const pill = target ? t.pills.find((p) => p.slug === target.pill) : undefined;
	return pill && pill.slug !== defaultPill(t) ? `${base} - ${pill.label}` : base;
}

/** What `/<domain>/<slug>` means - the rules in the header, in their order. */
export function resolveSlug(t: SlugTable, slug: string | undefined): Resolution {
	const first = defaultPill(t);
	if (slug === undefined) return { kind: 'page', pill: first };
	// The default pill has one address, the domain's own.
	if (slug === first) return { kind: 'redirect', status: 308, location: t.path };
	if (isPill(t, slug)) return { kind: 'page', pill: slug };
	const section = own(t.sections, slug);
	if (section) return { kind: 'page', pill: section.pill, section: slug };
	const current = own(t.former, slug);
	if (current !== undefined) return { kind: 'redirect', status: 308, location: addressOf(t, current) };
	const retired = own(t.retired, slug);
	if (retired) return { kind: 'retired', pill: retired.pill, title: retired.title };
	return { kind: 'redirect', status: 302, location: `${t.path}#${GONE_HASH}` };
}

/** The pill an address shows: the one the server's answer names, and the default pill at an
 * address it redirects. For a pill bar drawn outside the domain's page, where each pill is a
 * page of its own (the shell layout of /zapstore and /nutzaps), which has no answer of the
 * server's to read: /zapstore/leaderboards shows Leaderboards, and a section's address the
 * pill the section sits on, never no pill at all. */
export function pillAt(t: SlugTable, pathname: string): string {
	const r = resolveSlug(t, slugIn(pathname, t.path));
	return r.kind === 'redirect' ? defaultPill(t) : r.pill;
}

/** Everything wrong with a slug table, as sentences; empty when it is sound. The slug table
 * test runs it over every domain, so a typo fails a test rather than a link. */
export function slugTableProblems(t: SlugTable): string[] {
	const problems: string[] = [];
	const kinds = new Map<string, string>();
	const claim = (slug: string, kind: string) => {
		if (!SLUG.test(slug)) problems.push(`${kind} "${slug}" is not a slug (lowercase words joined by hyphens)`);
		const had = kinds.get(slug);
		if (had) problems.push(`"${slug}" is both a ${had} and a ${kind}`);
		else kinds.set(slug, kind);
	};
	// a section's address renders the domain's page (src/hooks.ts), so a section sits on a pill
	// of that page: on a pill that is a page of its own the wrong page would answer
	const pageOfItsOwn = (slug: string) => t.pills.some((p) => p.slug === slug && p.ownRoute);
	if (t.pills.length === 0) problems.push('no pills: the first pill is the default one');
	else if (t.pills[0].ownRoute) problems.push(`the default pill "${t.pills[0].slug}" is the domain page itself, never a route of its own`);
	// the default pill's address IS the domain's, so hiding it would hide the domain - which is
	// a gate on the domain's own route, not a flag in here ($lib/unreleased's header)
	else if (t.pills[0].unreleased) problems.push(`the default pill "${t.pills[0].slug}" is the domain's own address, so it cannot be unreleased`);
	for (const p of t.pills) {
		claim(p.slug, 'pill');
		if (!p.label.trim()) problems.push(`pill "${p.slug}" has no label`);
		// NOT YET SUPPORTED, and refused here rather than left as a trap: the server's answer
		// and the sitemap would follow the flag, but every domain page draws its pill bar - and
		// resolves an old `#` link - from the WHOLE table in the browser, so a hidden pill would
		// still be drawn and its panel would paint before the server's answer bounced it.
		// $lib/unreleased's header says what supporting one would take.
		if (p.unreleased) problems.push(`pill "${p.slug}" cannot be unreleased yet: the pill bar reads the whole table in the browser`);
	}
	for (const [slug, s] of Object.entries(t.sections)) {
		claim(slug, 'section');
		if (!isPill(t, s.pill)) problems.push(`section "${slug}" sits on "${s.pill}", which is not a pill`);
		else if (pageOfItsOwn(s.pill)) problems.push(`section "${slug}" sits on "${s.pill}", a page of its own`);
	}
	for (const slug of Object.keys(t.former)) claim(slug, 'former slug');
	for (const [slug, r] of Object.entries(t.retired)) {
		claim(slug, 'retired section');
		if (!isPill(t, r.pill)) problems.push(`retired "${slug}" names "${r.pill}", which is not a pill`);
		else if (pageOfItsOwn(r.pill)) problems.push(`retired "${slug}" names "${r.pill}", a page of its own`);
	}
	for (const slug of t.ownRoutes) claim(slug, 'route of its own');
	// a slug of an own route's shape would be taken by that route, and never reach the page
	for (const [slug] of kinds)
		for (const [name, matches] of Object.entries(t.ownShapes ?? {}))
			if (matches(slug)) problems.push(`"${slug}" has the shape of the ${name} route`);
	// `#gone` marks the redirect for an unknown slug: a slug of that name would make the note's
	// hash read as an old link to it ($lib/legacy-hash)
	if (kinds.has(GONE_HASH)) problems.push(`"${GONE_HASH}" is reserved: it marks the redirect for an unknown slug`);
	for (const [old, current] of Object.entries(t.former)) {
		if (!isPill(t, current) && !own(t.sections, current))
			problems.push(`former slug "${old}" points at "${current}", which is neither a pill nor a section`);
	}
	return problems;
}
