// SSR fetch of the MCP server's metric registry - the /data pages' ONLY data
// source. Deliberately NOT postgres.ts: these pages must stay DB-free so crawler
// traffic (robots.txt allows /data; the Caddy /data handle bypasses the
// bot-UA deny-list) never lands on Aurora at all. The rule was written when the
// cluster scaled to zero and the first such hit also paid a ~15 s resume; it
// has held a 0.5-ACU warm floor since 2026-08-03, which removed the stall, not
// the reason.
//
// The registry is authored ONCE, in nostrology-data's nostrology_mcp/metric.py
// (summary / partition / caveats per metric); the MCP container serves it as
// GET /registry.json and this module fetches it container-to-container over
// nozzl-mcp-net at SSR time. No committed snapshot, no baked fallback copy: if
// the MCP container is down the pages say so explicitly - stale-but-plausible
// registry copy was rejected as worse than an honest outage.

import { env } from '$env/dynamic/private';
import type { RegistryMetricCard, RegistryReferenceCard } from '$lib/shared/metricCard';

export interface RegistryColumn {
	name: string;
	type: string;
	description: string;
	unit?: string | null;
	third_party?: boolean;
}

export interface RegistryParams {
	grain: { values: string[]; default: string; note?: string };
	window:
		| { accepted: true; from: string; to: string }
		| { accepted: false; reason: string };
	// Present only on metrics that accept entity filters: param name -> usage
	// note (the Zapstore leaderboards' publisher_pubkey/app_id, Routstr's
	// provider_pubkey/model, every free nutzaps metric's mint_url). Absent = the
	// metric rejects filters. Rendered generically - a new filter needs no page
	// change.
	entity_filters?: Record<string, string>;
	format: string[];
}

// -- reference records (registry v2) --------------------------------------------

export interface RegistryRecordColumn extends RegistryColumn {
	max_chars?: number | null;
	// True = the column ships only when the call is app-scoped (publisher_pubkey
	// + app_id) - the long-text columns.
	app_scope_only?: boolean;
}

export interface RegistryRecordParams {
	// The record's entity scope, generically: which tool parameter (null = the
	// record takes none), whether it may be omitted, and the usage note. Zapstore
	// records also carry the legacy `publisher_pubkey` block (same content).
	scope?: { param: string | null; required: boolean; note: string };
	/** Legacy v2 block, Zapstore records only - prefer `scope`. */
	publisher_pubkey?: { required: boolean; note: string };
	app_id?: { required: boolean; note: string };
	window:
		| { accepted: true; from: string; to: string }
		| { accepted: false; reason: string };
	format: string[];
	row_cap: number;
}

export interface RegistryRecord {
	key: string;
	domain: string;
	record: string;
	row_unit: string;
	summary: string;
	partition: string;
	caveats: string[];
	methodology: string;
	as_of_source: string;
	snapshot_note?: string | null;
	params: RegistryRecordParams;
	columns: RegistryRecordColumn[];
}

export interface RegistryMetric {
	key: string;
	domain: string;
	metric: string;
	grain: string;
	unit: string;
	output: string;
	summary: string;
	partition: string;
	caveats: string[];
	methodology: string;
	as_of_source: string;
	series_type?: string;
	additive_over_time?: boolean;
	params?: RegistryParams;
	columns: RegistryColumn[];
	/** PAID entries only: price of one call in sats, and the paid
	 * tool that serves the entry (free entries' tool is the payload-level
	 * `tools.metrics`). Absent = free. Per ENTRY, not per domain: the nutzaps
	 * domain mixes free metrics (payment_activity, mint_*) with the one paid
	 * `active_users`. */
	price_sats?: number;
	tool?: string;
}

export interface RegistryPayload {
	v: number;
	server: { name: string; version: string; git_sha: string };
	/** Deprecated v1 key (the metric tool); `tools` is authoritative in v2. */
	tool: string;
	/** v2: both tool names. Optional so a v1 payload (older MCP container
	 * during rollout) still type-checks; fall back to `tool` + the known
	 * reference tool name. */
	tools?: { metrics: string; reference: string; nutzaps?: string };
	metrics: RegistryMetric[];
	/** v2: the reference records served by nostrology_query_reference. */
	reference?: RegistryRecord[];
}

/**
 * Fetch the registry from the MCP container. Returns null when the URL is unset
 * (local dev without the container) or the fetch fails/times out - callers render
 * an explicit "registry unavailable" state, never a stale copy.
 *
 * 3s timeout: this is a bridge-local hop that answers in single-digit ms when
 * healthy; anything slower means the container is down/wedged and the page must
 * not hang an SSR worker on it.
 */
export async function fetchRegistry(): Promise<RegistryPayload | null> {
	const url = env.NOSTROLOGY_MCP_REGISTRY_URL ?? '';
	if (!url) return null;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return null;
		const payload = (await res.json()) as RegistryPayload;
		if (!Array.isArray(payload.metrics)) return null;
		// `reference` is optional (a v1 payload omits it) but must be an ARRAY when
		// present: domainsOf and referenceCardsOf both .map() over it, and a throw
		// inside load() is a 500 on a public page - the one outcome this module's
		// whole design forbids. Absent stays absent; malformed is an unusable
		// registry, which the callers already render honestly.
		if (payload.reference !== undefined && !Array.isArray(payload.reference)) return null;
		return payload;
	} catch {
		return null;
	}
}

/** Group registry entries into one card per metric, preserving registry order.
 * The card type and its label live in $lib/shared/metricCard.ts, because the
 * grids that render them cannot import this module (see that file's header).
 *
 * The primary entry - the default grain's, the one an omitted `grain` resolves
 * to - supplies the card's prose, matching what the per-metric page shows as its
 * primary entry. (`unit` and `summary` are per-metric in practice: entries of one
 * metric differ in shape, not in what they measure. `output` does differ, and is
 * handled below.) */
export function metricCardsOf(metrics: RegistryMetric[]): RegistryMetricCard[] {
	const groups = new Map<string, RegistryMetric[]>();
	for (const m of metrics) {
		const key = `${m.domain}.${m.metric}`;
		const group = groups.get(key);
		if (group) group.push(m);
		else groups.set(key, [m]);
	}
	return [...groups].map(([key, entries]) => {
		// Every hop is optional: `params` is absent from a v1 payload (an older MCP
		// container mid-rollout), and a default naming no registered grain is
		// equally survivable. Either way the first registry entry leads, which is
		// the order the registry authored. Nothing here may THROW - /data's whole
		// design premise is that a bad registry renders an honest outage banner,
		// never a 500 (see fetchRegistry).
		const defaultGrain = entries[0].params?.grain?.default;
		const primary = entries.find((m) => m.grain === defaultGrain) ?? entries[0];
		const outputs = new Set(entries.map((m) => m.output));
		return {
			key,
			domain: primary.domain,
			metric: primary.metric,
			unit: primary.unit,
			grains: [primary.grain, ...entries.filter((m) => m !== primary).map((m) => m.grain)],
			output: outputs.size === 1 ? primary.output : null,
			summary: primary.summary,
			// Paid entries price per CALL, so grains cannot disagree; read it
			// off the primary and coalesce to null (absent = free).
			priceSats: primary.price_sats ?? null
		};
	});
}

/** Narrow the reference records to what the listing grid renders. The metric
 * side has grouping to do (see metricCardsOf); this side has only narrowing -
 * but the payload it drops is the larger of the two, because a record carries
 * per-column prose the grid never shows. */
export function referenceCardsOf(records: RegistryRecord[]): RegistryReferenceCard[] {
	return records.map((r) => ({
		key: r.key,
		domain: r.domain,
		record: r.record,
		summary: r.summary,
		snapshotNote: r.snapshot_note ?? null
	}));
}

/** The /data catalog's presentation order, front to back. Not alphabetical:
 * `nutzaps` sorts first, and opening there would put zapstore - the bulk of the
 * catalog and what the site is about - behind a click. Domains follow in the
 * order they joined the free metrics tool: Routstr (2026-08-29), then Nutzaps
 * (2026-09-30), which has been a MIXED domain since then - the free payment and
 * mint metrics on nostrology_query_metric, plus the one paid metric
 * (network-wide `active_users`, on nostrology_query_nutzaps). Paid-ness is per
 * registry entry, never per domain. Presentation order is a product decision,
 * so it is stated here rather than emerging from a sort(); the first entry is
 * also the domain the index opens on. Domains not listed here follow
 * alphabetically. */
export const DOMAIN_ORDER = ['zapstore', 'routstr', 'nutzaps'] as const;

/** Domains in stable presentation order: DOMAIN_ORDER first (those present),
 * the rest alphabetical. The UI groups by domain so Lightning / Relays metrics
 * slot in the moment the registry serves them - no page change needed. Unioned
 * over metrics AND reference records: a domain whose first resident is a
 * reference record must not be an orphan page invisible on the /data index. */
export function domainsOf(payload: RegistryPayload): string[] {
	const present = [
		...new Set([
			...payload.metrics.map((m) => m.domain),
			...(payload.reference ?? []).map((r) => r.domain)
		])
	].sort();
	// Absent from the registry (a stripped deployment, a fixture) = skipped, never
	// invented.
	const led = DOMAIN_ORDER.filter((d) => present.includes(d));
	return [...led, ...present.filter((d) => !led.includes(d as (typeof DOMAIN_ORDER)[number]))];
}

/** The catalog payload shared by BOTH addresses of the catalog page - `/data`
 * (lead domain selected) and `/data/<domain>` (that domain selected). One
 * builder rather than two loaders assembling the same object: the two routes
 * render the same component, so a shape that drifts between them is a runtime
 * error on one address and not the other.
 *
 * Every domain's cards ship regardless of the selection, because the template
 * filters. That is a parity decision, not a rendering one - narrowing here would
 * render identically, but it would make the payload depend on the address and
 * give the two loaders two shapes to keep in step.
 */
export function catalogPayload(
	registry: RegistryPayload | null,
	endpoint: string,
	selectedDomain: string | null
) {
	return {
		// Narrowed on BOTH sides to what the grids actually render - the raw
		// registry entries carry methodology, caveats and per-column prose that no
		// reader on this page consumes, and this is a crawler-facing page whose SSR
		// data is served uncompressed on every hit. Null when the registry is
		// unreachable; that falsiness selects the "unavailable" branch.
		// Deliberately WITHOUT the registry's `server` block (name/version/
		// git_sha): this payload is serialized into the SSR HTML of a public,
		// crawler-facing page, so forwarding it publishes the running build even
		// with nothing rendering it. The deployed version is establishable from
		// the operator side (build_info, the `nozzl starting` line, the deploy
		// run) and does not need a public surface. Do not re-add it.
		registry: registry && {
			tool: registry.tool,
			tools: registry.tools
		},
		endpoint,
		domains: registry ? domainsOf(registry) : [],
		selectedDomain,
		// One card per METRIC, not per registry entry - grouped HERE rather than in
		// the template because the helper is server-only.
		metricCards: registry ? metricCardsOf(registry.metrics) : [],
		referenceCards: registry ? referenceCardsOf(registry.reference ?? []) : []
	};
}
