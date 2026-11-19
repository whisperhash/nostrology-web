// The site's top-level navigation, in one place.
//
// Order leads with Zapstore, matching the landing page's own ordering of the
// domains (its board's roster, $lib/landing/board DOMAINS). Before the chrome was
// unified the two navs disagreed - the layout led with Relays - so crossing from the
// landing to any content page silently reordered the menu. Git-on-Nostr joined on
// 2026-10-15, with the redesigned landing, right after Marketplaces; Lightning and
// Nutzaps swapped places then (the operator's decision of 2026-10-14).
//
// /relays is DELIBERATELY absent. The relay domain is buried, not retired: its
// acquisition, processing and page are all untouched and it is still reachable
// at /relays and listed on /wip. Only the top-level entry is gone.
//
// `accent` marks the items that are NOT data domains: /data is the machine surface (the
// MCP endpoint + metric catalog), not another slice of Nostr data like the five before it.
// On desktop accent items are pulled out of the link row and pinned to the right edge in
// the accent colour - separation by position rather than by a divider glyph. The mobile
// menu uses a rule instead, since a stacked list has no "far side". The identity control
// (Log in, or the avatar) sits between the link row and the accent items - see
// SiteNav.svelte.
//
// `unreleased` keeps a destination that is still in development off every surface that
// renders this list, for everyone but the operator ($lib/unreleased). No item carries it
// today; it is how the next domain is built in place on the live site.

export interface NavItem {
	href: string;
	label: string;
	accent?: boolean;
	title?: string;
	/**
	 * Still in development: rendered only for a viewer who sees unreleased surfaces, which is
	 * the operator's own logged-in session and nobody else (`seesUnreleased`,
	 * $lib/unreleased).
	 *
	 * Hiding the item is not the protection. The domain's own +page.server.ts answers 404
	 * (not found) for everyone else; this only keeps the entrance off the nav, its mobile
	 * panel, the footer and the error page, which nav.gating.test.ts asserts all together.
	 */
	unreleased?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
	{ href: '/zapstore', label: 'Zapstore' },
	{ href: '/marketplaces', label: 'Marketplaces' },
	{ href: '/git', label: 'Git-on-Nostr' },
	{ href: '/lightning', label: 'Lightning' },
	{ href: '/nutzaps', label: 'Nutzaps' },
	{
		href: '/data',
		label: 'MCP',
		accent: true,
		title: 'Machine surface: MCP endpoint + metric catalog for AI agents'
	}
];

/**
 * The items to render, given who is looking.
 *
 * Everyone but the operator gets the list without the unreleased items. Keep this the ONLY
 * place that decides - a second copy in the mobile menu is exactly how the nav drifted out
 * of sync before it was unified.
 */
export function visibleNavItems(
	seesUnreleased: boolean,
	items: readonly NavItem[] = NAV_ITEMS
): NavItem[] {
	return items.filter((item) => !item.unreleased || seesUnreleased);
}
