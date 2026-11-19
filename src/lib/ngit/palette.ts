// The /git chart colours: the site's series palette (the /routstr STACK_COLORS family,
// OTHERS_COLOR for the rest), with FIXED meanings on this page. Kept out of the page so the
// assignment is one table that a test pins.
//
// The rule: a hosting class wears its own colour wherever the classes are drawn - the six
// are assigned by class key, never by rank, so a class keeps its colour whatever the
// document's order or counts - which is the Hosting pill's donut. A kind of host wears the
// donut's colour for its kind (HOST_KIND_COLOR) wherever the kinds are drawn: Clone hosts
// below the donut and New repositories per week on Overview, so each kind is one colour on
// the whole page. The headline share of GRASP or hashtree wears no colour, since it spans
// three classes, and all repositories take NEUTRAL_SERIES. Hosting's other single-series bar
// lists take NEUTRAL_SERIES too, except GRASP servers per repository, which is GRASP, and
// Relays per repository beside it, which is RELAYS_PER_REPO_COLOR, blue at the operator's
// choice. A colour is not reserved to its class elsewhere: Overview's push charts keep TEAL,
// BLUE and AMBER, and the pills that draw no hosting class (Repositories, Maintainers,
// Collaboration) use the site palette freely.
import type { NgitHostKind, NgitRepoHostingClass } from '$lib/shared/data-types';

export const PURPLE = '#a78bfa';
export const TEAL = '#2dd4bf';
export const BLUE = '#60a5fa';
export const PINK = '#f472b6';
export const AMBER = '#fbbf24';
export const GREEN = '#34d399';
export const BTC_ORANGE = '#f7931a';
/** slate-500, the site's colour for "the rest" / "other". */
export const OTHERS_COLOR = '#64748b';
/** gray-300, the page's body ink: a series that is no category at all (all repositories),
 * or a single-series bar list on a pill whose other colours are hosting classes. */
export const NEUTRAL_SERIES = '#d1d5db';

/**
 * One colour per hosting class (dataset reference 4.4), in the document's precedence order,
 * which is also the donut's slice order.
 *
 * GRASP + other hosts is blue and Forges only amber since 2026-10-12, the operator's swap (they
 * were amber and blue); a forge is now the amber New repositories per week has drawn it in since
 * 2026-10-08. hashtree is New repositories per week's pink since 2026-10-11, also the operator's
 * choice: it was teal, Delta E 5.2 from the self-hosted green with normal vision.
 *
 * Measured with the dataviz palette validator (validate_palette.js) in this order, on the card
 * surface #1f2937: one ADJACENT pair fails, the GRASP only purple beside the GRASP + other hosts
 * blue, Delta E 0.3 under deuteranopia and 4.6 under protanopia (the floor is 6, the target 8)
 * and 10.2 with normal vision (the floor is 15, which a second cue does not excuse). The class
 * list beside the donut names each class next to its swatch, with its count and share, and a
 * hover on a slice names its class. Every other adjacent pair passes, the worst under
 * colour-vision deficiency the Forges only amber and the Self-hosted green, 10.6 (protanopia),
 * and with normal vision the wrap-around pair of the ring, the slate and the purple, 20.1.
 * Until the swap every adjacent pair passed (worst 10.9 under protanopia, and 20.1 with normal
 * vision, that same wrap-around pair). An earlier assignment (grasp_mixed pink, other_hosts
 * amber) put pink beside hashtree's teal at Delta E 5.0 under deuteranopia on two slices of
 * similar size (web review 4). The lightness-band and chroma checks fail for the whole site
 * palette (Tailwind 400 steps are lighter than the dark band; the slate is below the chroma
 * floor), a site-wide choice this page does not make alone. Re-run the validator before
 * changing a value here, and HOST_KIND_COLOR's below:
 *   node validate_palette.js "#a78bfa,#60a5fa,#f472b6,#fbbf24,#34d399,#64748b" --mode dark --surface "#1f2937"
 */
export const HOSTING_CLASS_COLOR: Readonly<Record<NgitRepoHostingClass, string>> = {
	grasp_only: PURPLE,
	grasp_mixed: BLUE,
	hashtree: PINK,
	forge_only: AMBER,
	other_hosts: GREEN,
	none: OTHERS_COLOR
};

/** The GRASP purple, for GRASP alone: GRASP servers per repository, the GRASP server lists on
 * Maintainers, and GRASP's bars in New repositories per week and Clone hosts. Not the
 * headline share, which is GRASP or hashtree since 2026-10-10 and wears no colour. */
export const GRASP_COLOR = HOSTING_CLASS_COLOR.grasp_only;

/**
 * The kinds of host (reference 7, by_host; Clone hosts reads each host's class as one,
 * HOST_CLASS_KIND in $lib/ngit/format), each in the donut's colour for its kind: GRASP the
 * GRASP only purple, hashtree the pink, Self-hosted the green, a forge the Forges only amber and
 * the kind that is not public the slate. The blue of GRASP + other hosts is no kind of host.
 * Keyed in HOST_KIND_ORDER, the order the page draws the kinds in.
 *
 * One colour per kind on the whole page since 2026-10-12: New repositories per week and Clone
 * hosts, and the donut's class of each kind. Until then New repositories per week had its own
 * set, with a forge amber where the donut and Clone hosts had the Forges only blue, which is
 * Delta E 0.3 from the GRASP purple under deuteranopia.
 *
 * Both charts draw the kinds side by side - five bars a week, and a list ranked by repositories
 * where any two kinds can be neighbours - so the set is measured over every pair (--pairs all)
 * on #1f2937, with New repositories per week's line (NEUTRAL_SERIES; BTC_ORANGE was 10.5 from
 * the amber). With normal vision every pair passes, the worst the purple and the pink at 15.9.
 * Under colour-vision deficiency the worst is the pink and the green, 6.6 under deuteranopia,
 * inside the 6-8 band that is legal only with a second cue, and in HOST_KIND_ORDER (the
 * operator's, 2026-10-12) the two are neighbours in each week's group. Every other pair meets
 * the target of 8, the next worst the green and the line's ink at 9.1 under protanopia, then
 * the pink and the slate at 9.8. The second cues: in New repositories per week each kind keeps
 * its slot in the week's group, in the key's order (StackedBars `grouped` empties a hidden
 * series rather than re-flowing the others), and the tooltip names each bar's kind; a Clone
 * hosts bar names its kind in its hover title and its screen-reader text. On a touch screen a
 * Clone hosts bar's colour is the only cue to its kind, except a hashtree bar whose label starts
 * "htree://" (cloneHostLabel); the operator accepted that gap for the pink and the green ("it's
 * fine", 2026-10-11). Re-run before changing a value:
 *   node validate_palette.js "#a78bfa,#f472b6,#34d399,#fbbf24,#64748b,#d1d5db" --mode dark --surface "#1f2937" --pairs all
 */
export const HOST_KIND_COLOR: Readonly<Record<NgitHostKind, string>> = {
	grasp: GRASP_COLOR,
	hashtree: HOSTING_CLASS_COLOR.hashtree,
	self_hosted: HOSTING_CLASS_COLOR.other_hosts,
	forge: HOSTING_CLASS_COLOR.forge_only,
	none: HOSTING_CLASS_COLOR.none
};

/** A kind of host's colour; one the page does not know yet takes the neutral "other" slate. */
export function hostKindColor(k: string): string {
	return Object.prototype.hasOwnProperty.call(HOST_KIND_COLOR, k) ? HOST_KIND_COLOR[k as NgitHostKind] : OTHERS_COLOR;
}

/**
 * Relays per repository, on the Hosting pill beside GRASP servers per repository: blue, the
 * donut's Forges only colour when the operator chose it on 2026-10-08 ("the same color for bars
 * as is currently used for Forges only"; it had been pink for one day). It stayed blue when the
 * operator swapped Forges only to amber on 2026-10-12, a request that named Clone hosts as its
 * only other change; blue is GRASP + other hosts' colour since. Measured with the dataviz
 * validator on #1f2937, blue beside the GRASP purple bars of the list next to it is Delta E 0.3
 * under deuteranopia and 10.2 with normal vision (the floor is 15): the two lists are told apart
 * by their titles and bucket labels, not by colour.
 */
export const RELAYS_PER_REPO_COLOR = BLUE;

/** A class's colour; a class the page does not know yet (an additive key) takes the
 * neutral "other" slate rather than a colour that means something else. */
export function hostingColor(k: string): string {
	return Object.prototype.hasOwnProperty.call(HOSTING_CLASS_COLOR, k)
		? HOSTING_CLASS_COLOR[k as NgitRepoHostingClass]
		: OTHERS_COLOR;
}
