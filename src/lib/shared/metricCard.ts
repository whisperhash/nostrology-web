// The /data listing grids' view type. Lives in $lib/shared, not beside the rest
// of the registry types in $lib/server/mcpRegistry.ts, because BOTH sides need
// it: the loaders build the cards (server) and the two grids label them
// (.svelte). A .svelte file importing $lib/server/mcpRegistry would fail
// SvelteKit's illegal-import check at build time - that module reads
// $env/dynamic/private - and is separately caught by
// client-server-boundaries.test.ts.

/** One CARD on a listing grid: one METRIC, not one registry entry.
 *
 * The registry is keyed per (metric, grain) - `app_zaps` registers `@day` and
 * `@total` as separate entries because their columns and row shapes differ. The
 * listing grids are keyed per metric, because both entries carry the same name,
 * the same summary, and the same destination URL: rendering one card each put
 * two visually identical `app_zaps` cards side by side. The per-metric page is
 * where grains are spoken about individually (see the [metric] loader's
 * grainEntries); the grids name the metric once.
 *
 * Built by metricCardsOf() in $lib/server/mcpRegistry.ts. */
export interface RegistryMetricCard {
	/** `<domain>.<metric>` - the grouping identity and the {#each} key. NOT a
	 * registry `key` (those carry the `@grain` suffix this deliberately drops). */
	key: string;
	domain: string;
	metric: string;
	unit: string;
	/** Every registered grain, default first. */
	grains: string[];
	/** The row shape, or null when the grains disagree on it - `app_zaps` is
	 * `sparse` at `@day` and `entities` at `@total`, and printing either one
	 * against a card that covers both would be false. The per-metric page states
	 * it per grain; the card just stays quiet. */
	output: string | null;
	summary: string;
	/** Price of one call in sats for PAID metrics (nutzaps
	 * `active_users`, paid in Cashu ecash via nostrology_query_nutzaps); null =
	 * free. Per metric, not per domain: the rest of the nutzaps domain is free
	 * on nostrology_query_metric (since 2026-09-30), so one domain's grid can
	 * hold priced and unpriced cards side by side. On the card so the price is
	 * published where agents and crawlers discover the catalog - without
	 * calling anything. */
	priceSats: number | null;
}

/** The card's right-hand label: `<unit> / <grains> - <output>`, with the output
 * clause dropped when the grains disagree on it (see RegistryMetricCard.output).
 * One authored format for both grids, so they cannot drift apart.
 *
 * The price is NOT part of this string - see metricCardPrice. */
export function metricCardLabel(card: RegistryMetricCard): string {
	const head = `${card.unit} / ${card.grains.join(', ')}`;
	return card.output ? `${head} - ${card.output}` : head;
}

/** The price clause for a paid metric, or null when the metric is free.
 *
 * Split out of the label rather than appended to it so the templates can give it
 * the palette's gold - the same colour the landing page marks its paid tool with,
 * so "this one costs something" looks the same wherever it appears. The /data page
 * is where the price is PUBLISHED (crawler-visible, DB-free), so it belongs on the
 * card and not only in the tool description; splitting the string changes how it is
 * rendered, never whether it is there. */
export function metricCardPrice(card: RegistryMetricCard): string | null {
	return card.priceSats != null ? `${card.priceSats} sats/call (Cashu)` : null;
}

/** One CARD on the reference-data grid. The narrowed counterpart of
 * RegistryMetricCard, and it exists for the same reason plus one more: a
 * RegistryRecord carries `methodology`, `caveats`, `params` and a full
 * `columns[]` with per-column prose, none of which the grid reads. Shipping the
 * whole record put all of that in the SSR payload of a page served on every
 * crawler hit, uncompressed (there is no `encode` directive in the Caddyfile).
 *
 * Built by referenceCardsOf() in $lib/server/mcpRegistry.ts. */
export interface RegistryReferenceCard {
	/** The registry `key` - reference records are one per record, so unlike the
	 * metric cards there is no grouping and nothing to strip. */
	key: string;
	domain: string;
	record: string;
	summary: string;
	/** Present = a current-state snapshot; absent/null = an event listing. The
	 * grid prints one label or the other off this. */
	snapshotNote: string | null;
}
