// Presentation formatting for /git: numbers, percentages, dates, third-party text and the
// words behind the document's class and bucket keys. Pure and DOM-free so every rule is
// unit-testable.
import { decode as nip19Decode } from 'nostr-tools/nip19';

import { shortNpub } from '$lib/auth/profile';
import type { NgitHostClass, NgitHostKind, NgitLedgerKey, NgitRepoHostingClass } from '$lib/shared/data-types';

/** Thousands-separated integer; '-' for a missing or non-finite value. */
export function n(v: number | null | undefined): string {
	return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : '-';
}

const UNITS: [number, string][] = [
	[1e3, 'k'],
	[1e6, 'M'],
	[1e9, 'B']
];

/**
 * Compact figure for cards, sub-lines and chart axes: 950, 1.2k, 12.3k, 123k, 4.5M. One
 * decimal below 100 of a unit, none above; a value that ROUNDS up to 1000 of a unit is
 * promoted to the next one (999,950 is "1M", never "1000k").
 */
export function compact(v: number | null | undefined): string {
	if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
	const sign = v < 0 ? '-' : '';
	const a = Math.abs(v);
	if (a < 1000) return sign + String(Math.round(a));
	for (let i = 0; i < UNITS.length; i++) {
		const [div, suffix] = UNITS[i];
		const next = UNITS[i + 1];
		if (next && a >= next[0]) continue;
		const x = a / div;
		const s = x < 100 ? x.toFixed(1) : x.toFixed(0);
		if (next && Number(s) >= 1000) return `${sign}1${next[1]}`;
		return sign + s.replace(/\.0$/, '') + suffix;
	}
	return sign + String(a);
}

/** Whole sats from millisats, rounded - the site-wide convention (see postgres.ts). */
export function satsFromMsats(msats: number | null | undefined): number {
	return typeof msats === 'number' && Number.isFinite(msats) ? Math.round(msats / 1000) : 0;
}

/** A 0..1 share as a percentage: 0.3137 -> "31.4%". 'n/a' for a missing share. Values
 * that would print as 0.0% / 100.0% while not being exactly 0 / 1 say "<0.1%" / ">99.9%"
 * so a tiny share never reads as none. */
export function pct(share: number | null | undefined, digits = 1): string {
	if (typeof share !== 'number' || !Number.isFinite(share)) return 'n/a';
	const p = share * 100;
	const floor = 10 ** -digits;
	if (p > 0 && p < floor) return `<${floor.toFixed(digits)}%`;
	if (p < 100 && p > 100 - floor) return `>${(100 - floor).toFixed(digits)}%`;
	return `${p.toFixed(digits)}%`;
}

/** A document date ("YYYY-MM-DD", the only form the contract allows) or '-' when absent. */
export function fmtDay(v: string | null | undefined): string {
	return typeof v === 'string' && v !== '' ? v.slice(0, 10) : '-';
}

/** "2026-06-14" -> "Jun 14, 2026". */
export function dayName(d: string): string {
	const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(t)) return d;
	return new Date(t).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

// --- Third-party text ------------------------------------------------------------------
//
// Names, display names, identifiers, hosts, relays, topics and client tags are written by
// anyone. Svelte escapes them, so none can inject markup, but escaping leaves the Unicode
// control and FORMAT characters in place, and those change how the text around them is
// drawn: a right-to-left override in one author's repository name reverses the next
// author's name in the same cell, and a name of zero-width characters is an invisible
// link. Every such string passes visibleText() before it is shown, and the caller wraps it
// in <bdi> (an isolate), since a legitimately right-to-left name must not reorder the words
// beside it either.

/**
 * Unicode Cc and Cf, the categories the pipeline removes from names too (dataset reference
 * 5.1): the C0 and C1 controls, the bidi embeddings, overrides, isolates and marks
 * (U+061C, U+200E, U+200F, U+202A-202E, U+2066-2069), the zero-width characters (U+200B-200D,
 * U+2060, U+FEFF), the soft hyphen and the tag characters. The site's UNSAFE_NAME_CHARS
 * ($lib/auth/profile) lists part of Cf by hand and misses U+061C (ARABIC LETTER MARK, a bidi
 * control) among others, so the category is used here instead.
 */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
/** The controls that break a line or tab: a space each, so no two words are glued. */
const BREAK_CONTROLS = /[\t\n\v\f\r\u0085]/g;
/**
 * What still draws nothing once those are gone: whitespace, the other default-ignorable
 * code points (the Hangul fillers, variation selectors, the combining grapheme joiner) and
 * the blank braille pattern U+2800. A string of only these is shown as missing, not blank.
 */
const BLANK = /^[\s\p{Default_Ignorable_Code_Point}\u2800]*$/u;

/**
 * Third-party text the way the page shows it: control and format characters removed, outer
 * whitespace trimmed, and '' when nothing visible is left - so the caller falls back to an
 * identifier rather than rendering an empty cell or an invisible link.
 */
export function visibleText(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const s = raw.replace(BREAK_CONTROLS, ' ').replace(CONTROL_OR_FORMAT, '').trim();
	return BLANK.test(s) ? '' : s;
}

/** Said in place of third-party text that is present but has nothing visible in it. */
export const NO_VISIBLE_TEXT = '(no visible characters)';

/** visibleText(), or NO_VISIBLE_TEXT: for a string with no identifier to fall back on (a
 * host, a relay, a topic, a client tag). */
export function labelText(raw: unknown): string {
	return visibleText(raw) || NO_VISIBLE_TEXT;
}

/** What a repository row is called: its `name`, else its `d` identifier - each through
 * visibleText(), so a name of zero-width characters falls back to the identifier. An empty
 * `d` is legal (dataset reference section 1) and is said as such. */
export function repoLabel(row: { name?: string | null; d?: string | null }): string {
	const name = visibleText(row.name);
	if (name !== '') return name;
	const d = typeof row.d === 'string' ? row.d : '';
	return d === '' ? '(no identifier)' : labelText(d);
}

/** What a person is called: their kind-0 (profile-metadata) display name through
 * visibleText(), else their short npub. */
export function personLabel(name: unknown, pubkey: string): string {
	return visibleText(name) || shortNpub(pubkey);
}

// --- Top-N lists --------------------------------------------------------------------------

/** A noun in the singular and the plural: ['server', 'servers']. */
export type Noun = readonly [one: string, many: string];

/** A count with its noun, singular for 1: "1 branch", "14 branches", "- branches" when null. */
export function counted(v: number | null | undefined, [one, many]: Noun): string {
	return `${n(v)} ${v === 1 ? one : many}`;
}

/**
 * How a top-N list is cut, for its caption, with its noun. `total` is the population the rows
 * were cut from, where the document carries it: "the top 20 of 64 servers" when rows are left
 * out, "all 12 servers" when none are, "the top 25 topics" when the document does not say.
 * Rows tied with the last one shown are left out unmarked (dataset reference 4.5 and 5.1:
 * ties are broken by key), so this states the cut, not a rank.
 */
export function cutOf(shown: number, total: number | null | undefined, [one, many]: Noun): string {
	if (typeof total === 'number' && Number.isFinite(total)) {
		if (shown < total) return `the top ${n(shown)} of ${n(total)} ${many}`;
		return total <= 0 ? `no ${many}` : total === 1 ? `the only ${one}` : `all ${n(total)} ${many}`;
	}
	return shown <= 0 ? `no ${many}` : shown === 1 ? `the top ${one}` : `the top ${n(shown)} ${many}`;
}

/** Beside a sortable top-N table: a header click reorders the rows shown, it does not rank
 * the population again. Empty when the table holds every row, or one row. */
export function sortNote(shown: number, total?: number | null): string {
	if (shown <= 1) return '';
	if (typeof total === 'number' && Number.isFinite(total) && shown >= total) return '';
	return `Sorting reorders these ${n(shown)} only.`;
}

/** "the top 20 of 64 servers" -> "The top 20 of 64 servers", for a caption that opens with
 * the cut. */
export function upperFirst(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The word for a document key, falling back to the key itself for anything the page
 * does not know yet (an additive class lands in the document before it lands here). */
export function labelFor(map: Readonly<Record<string, string>>, key: string): string {
	return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
}

/** Repository hosting classes (dataset reference 4.4), in the document's precedence. A
 * repository is in the first class that fits, so the two GRASP classes hold every repository
 * with a GRASP server, and the hashtree and self-hosted labels say "no GRASP": bare, they
 * read as every repository with such a URL, and hashtree's slice beside a GRASP + other
 * hosts definition naming hashtree read as a double count (it is not: on 2026-10-08, 5 of
 * the 365 GRASP + other hosts repositories had an htree:// URL, none of them in the 299). */
export const HOSTING_CLASS_LABEL: Readonly<Record<NgitRepoHostingClass, string>> = {
	grasp_only: 'GRASP only',
	grasp_mixed: 'GRASP + other hosts',
	hashtree: 'hashtree, no GRASP',
	forge_only: 'Forges only',
	other_hosts: 'Self-hosted, no GRASP',
	none: 'No public host'
};

/** One-line definitions shown beside the hosting donut, in the document's precedence order: a
 * repository is in the first that fits. Each also excludes the classes above it, so they hold
 * read one by one, which the intro relies on since it stopped saying "the first that fits"
 * (2026-10-11). So none may fit a repository vacuously - "every public clone URL is on a GRASP
 * server", GRASP only's until 2026-10-10, held for one with no public clone URL too. */
export const HOSTING_CLASS_DEF: Readonly<Record<NgitRepoHostingClass, string>> = {
	grasp_only: 'only GRASP servers (one or several)',
	grasp_mixed: 'a GRASP server plus a public clone URL of another kind - a forge, a self-hosted server or hashtree - such as a GitHub mirror; counted here, not again below',
	hashtree: 'an htree:// clone URL and no GRASP server',
	forge_only: 'only forges: GitHub, GitLab, Codeberg, sourcehut and the like',
	other_hosts: 'a self-hosted git server, no GRASP, no hashtree',
	none: 'no public clone URL (private, loopback or non-network values only, or none)'
};

/** The order the page draws the kinds of host in: GRASP, hashtree, Self-hosted, Forge, then the
 * kind that is not public - New repositories per week's bars and their key, and Clone hosts'
 * key (the operator's order, 2026-10-12). Not the document's: by_host (dataset reference 7)
 * and host_kinds (4.4) list grasp, hashtree, forge, self_hosted, which the Hosting column keeps. */
export const HOST_KIND_ORDER: readonly NgitHostKind[] = ['grasp', 'hashtree', 'self_hosted', 'forge', 'none'];

/** Each kind of host once, in HOST_KIND_ORDER; a kind the page does not know yet (an additive
 * key) after them, in the order given. */
export function hostKindsInOrder(kinds: readonly string[]): string[] {
	const order: readonly string[] = HOST_KIND_ORDER;
	const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
	return [...new Set(kinds)].sort((a, b) => rank(a) - rank(b));
}

/** The kinds of public host of New repositories per week (reference 7, by_host), in the
 * operator's words. A repository counts under each kind it is on, so these are not the
 * exclusive classes above: "hashtree" here holds every repository with an htree:// URL, the
 * five with a GRASP server too included (2026-10-08). */
export const HOST_KIND_LABEL: Readonly<Record<NgitHostKind, string>> = {
	grasp: 'GRASP',
	hashtree: 'hashtree',
	self_hosted: 'Self-hosted',
	forge: 'Forges',
	none: 'No public host'
};

/** A clone host's kind of host, from its class (reference 4.2), for Clone hosts' bar colours
 * and their key: each public class is its own kind, and the two that are not public, private
 * and non_network, are one, none, which wears the donut's No public host slate. */
export const HOST_CLASS_KIND: Readonly<Record<NgitHostClass, NgitHostKind>> = {
	hashtree: 'hashtree',
	private: 'none',
	grasp: 'grasp',
	forge: 'forge',
	non_network: 'none',
	self_hosted: 'self_hosted'
};

/** A host class's kind; a class the page does not know yet (an additive key) is its own kind,
 * which labelFor then words as the key itself and hostKindColor paints the slate. */
export function hostClassKind(cls: string): string {
	return Object.prototype.hasOwnProperty.call(HOST_CLASS_KIND, cls) ? HOST_CLASS_KIND[cls as NgitHostClass] : cls;
}

/** A clone host as Clone hosts names it: its cleaned text, except a hashtree host whose host
 * is a valid npub. An htree:// URL's authority is its owner's npub, not a server, and the whole
 * npub is 63 characters, two or three lines in the label's column. So it reads "htree://" and
 * the short npub, "htree://npub1xdhn...eycm" - the operator's choice of 2026-10-11: "Seeing
 * pyramid.fiatjaf.com and git.jb55.com in the list makes me lean towards
 * htree://npub1xdhn...eycm in this case". Any other host, hashtree-class or not, reads as its
 * cleaned text: the pipeline classes a host by the first class over all its URLs, hashtree
 * first, so a domain could be hashtree-class and must not gain an htree:// it never had.
 * cloneHostTitle() is the label's hover title, with the whole npub. */
export function cloneHostLabel(h: { host: string; cls: string }): string {
	const host = labelText(h.host);
	const short = hostClassKind(h.cls) === 'hashtree' ? npubShort(host) : null;
	return short === null ? host : `htree://${short}`;
}

/** The hover title of a clone host's label: the host's cleaned text, or for a hashtree npub
 * "htree://" and the whole npub. */
export function cloneHostTitle(h: { host: string; cls: string }): string {
	const host = labelText(h.host);
	return hostClassKind(h.cls) === 'hashtree' && npubShort(host) !== null ? `htree://${host}` : host;
}

/** The short form (npub1abcd...wxyz) of a valid npub of a 32-byte key, else null. nostr-tools'
 * decode checks the checksum but not the length: "npub106246s" decodes, to no bytes at all. */
function npubShort(s: string): string | null {
	try {
		const d = nip19Decode(s);
		return d.type === 'npub' && /^[0-9a-f]{64}$/.test(d.data) ? shortNpub(d.data) : null;
	} catch {
		return null;
	}
}

/** The kinds of host as Clone hosts' key and bars word them, in HOST_KIND_ORDER. Each bar is
 * one host, so the words are singular, and GRASP is "GRASP", not "GRASP server" (the operator's
 * words, 2026-10-11); the kind that is not public reads "Not public", since the donut's No
 * public host is a repository with no public clone URL. The repository tables' Hosting cells
 * use the same words (repoHostingLabel). */
export const CLONE_HOST_KIND_LABEL: Readonly<Record<NgitHostKind, string>> = {
	grasp: 'GRASP',
	hashtree: 'hashtree',
	self_hosted: 'Self-hosted',
	forge: 'Forge',
	none: 'Not public'
};

/** A repository's Hosting cell in the repository tables: the kinds of public host it is on, in
 * Clone hosts' words and the document's order (grasp, hashtree, forge, self_hosted),
 * comma-separated - "GRASP, Forge" where its class says only "GRASP + other hosts" (the
 * operator's choice, 2026-10-11). A repository with no public host reads as its class, No public
 * host, since Clone hosts' "Not public" names a host. A row without host_kinds (a document
 * written before the pipeline carried them) reads as its class too. An unknown kind is worded as
 * the key itself, cleaned like any other text the document carries. */
export function repoHostingLabel(r: { cls: string; host_kinds?: readonly string[] }): string {
	const kinds = r.host_kinds ?? [];
	if (kinds.length === 0 || (kinds.length === 1 && kinds[0] === 'none')) return labelFor(HOSTING_CLASS_LABEL, r.cls);
	return kinds.map((k) => labelText(labelFor(CLONE_HOST_KIND_LABEL, k))).join(', ');
}

/** Exclusion-ledger units, singular and plural, so a row reads "1 pushes" never. */
const UNIT_SINGULAR: Readonly<Record<string, string>> = {
	announcements: 'announcement',
	'state coordinates': 'state coordinate',
	pushes: 'push',
	comments: 'comment'
};

export function unitFor(unit: string, v: number): string {
	return v === 1 ? labelFor(UNIT_SINGULAR, unit) : unit;
}

/** The ledger's keys in words (dataset reference 2.2, 3 and 6.1). The announcement rules
 * keep their code in front, so a reader can find the rule in the reference. */
export const LEDGER_LABEL: Readonly<Record<NgitLedgerKey, string>> = {
	N0: 'N0 Malformed identifier',
	N1: 'N1 Agent-profile squatters',
	N2: 'N2 Test harness',
	N3: 'N3 Template copies',
	N4: 'N4 Date-named snapshots',
	N5: 'N5 Automated republish loop',
	N6: 'N6 Deleted by its author',
	N7: 'N7 Well-known private key',
	N8a: 'N8a Private clone hosts only',
	N8b: 'N8b No public clone URL and no state',
	N9: 'N9 Stateless personal forks',
	N10: "N10 Catalog of other people's projects",
	state_republish_loop: 'State republish loops',
	orphan_states: 'Orphan states',
	daily_cap: 'Pushes above the daily cap',
	ephemeral: 'Ephemeral comments',
	imported: 'Imported comments',
	mirrored: 'Mirrored comments'
};
