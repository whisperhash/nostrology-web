import { describe, expect, it } from 'vitest';

import { domainsOf, metricCardsOf, type RegistryMetric, type RegistryPayload } from './mcpRegistry';
import { metricCardLabel, metricCardPrice } from '$lib/shared/metricCard';
import {
	NUTZAPS_FREE_METRICS,
	PAID_METRICS,
	REGISTRY
} from '../../routes/(app)/data/registry-fixture';

/**
 * The registry is keyed per (metric, grain); the listing grids are keyed per
 * metric. `app_zaps` is the metric that forces the distinction - it registers
 * `@day` (sparse, one row per day AND app) and `@total` (entities, collapsed) as
 * two entries carrying the same name, the same summary and the same destination
 * URL, so a card per entry rendered it twice on /data and /data/zapstore.
 *
 * These are unit tests over the grouping, not over the live registry: the shapes
 * below mirror what nostrology-data's metric.registry_entries() serializes.
 */
function metric(over: Partial<RegistryMetric> & Pick<RegistryMetric, 'metric' | 'grain'>): RegistryMetric {
	const domain = over.domain ?? 'zapstore';
	return {
		key: `${domain}.${over.metric}@${over.grain}`,
		domain,
		unit: 'apps',
		output: 'dense',
		summary: `summary of ${over.metric}`,
		partition: '',
		caveats: [],
		methodology: '',
		as_of_source: '',
		params: {
			grain: { values: [over.grain], default: over.grain },
			window: { accepted: false, reason: 'snapshot' },
			format: ['csv', 'markdown']
		},
		columns: [],
		...over
	};
}

/** The real pair, as the live registry serves it: @day first, default = day. */
const APP_ZAPS_DAY = metric({
	metric: 'app_zaps',
	grain: 'day',
	unit: 'zaps+msats',
	output: 'sparse',
	summary: 'Per-app Zapstore zap totals.',
	params: {
		grain: { values: ['day', 'total'], default: 'day' },
		window: { accepted: true, from: 'from', to: 'to' },
		format: ['csv', 'markdown']
	}
});
const APP_ZAPS_TOTAL = metric({
	metric: 'app_zaps',
	grain: 'total',
	unit: 'zaps+msats',
	output: 'entities',
	summary: 'Per-app Zapstore zap totals.',
	params: {
		grain: { values: ['day', 'total'], default: 'day' },
		window: { accepted: true, from: 'from', to: 'to' },
		format: ['csv', 'markdown']
	}
});
const ZAP_COUNT = metric({ metric: 'zap_count', grain: 'day', unit: 'zaps', output: 'dense' });

describe('metricCardsOf', () => {
	it('collapses a metric registered at two grains into ONE card', () => {
		const cards = metricCardsOf([APP_ZAPS_DAY, APP_ZAPS_TOTAL]);
		expect(cards).toHaveLength(1);
		expect(cards[0].metric).toBe('app_zaps');
		expect(cards[0].grains).toEqual(['day', 'total']);
	});

	it("keys cards per metric, dropping the registry key's @grain suffix", () => {
		// The {#each} key must be stable and unique per CARD; the registry keys
		// (...@day / ...@total) are neither, since one card now covers both.
		const [card] = metricCardsOf([APP_ZAPS_DAY, APP_ZAPS_TOTAL]);
		expect(card.key).toBe('zapstore.app_zaps');
	});

	it('leads with the DEFAULT grain regardless of registry order', () => {
		// What an omitted `grain` resolves to is what the card should read as - and
		// it is what the per-metric page shows as its primary entry.
		const cards = metricCardsOf([APP_ZAPS_TOTAL, APP_ZAPS_DAY]);
		expect(cards[0].grains).toEqual(['day', 'total']);
		expect(cards[0].output).toBeNull();
	});

	it('takes prose from the default-grain entry, not the first-registered one', () => {
		const total = { ...APP_ZAPS_TOTAL, summary: 'TOTAL prose', unit: 'total-unit' };
		const [card] = metricCardsOf([total, APP_ZAPS_DAY]);
		expect(card.summary).toBe(APP_ZAPS_DAY.summary);
		expect(card.unit).toBe(APP_ZAPS_DAY.unit);
	});

	it('nulls `output` when the grains disagree on the row shape', () => {
		// sparse (@day) vs entities (@total): printing either against a card that
		// covers both would be false.
		const [card] = metricCardsOf([APP_ZAPS_DAY, APP_ZAPS_TOTAL]);
		expect(card.output).toBeNull();
	});

	it('keeps `output` when every grain agrees on it', () => {
		const day = metric({ metric: 'x', grain: 'day', output: 'dense' });
		const total = metric({ metric: 'x', grain: 'total', output: 'dense' });
		const [card] = metricCardsOf([day, total]);
		expect(card.grains).toEqual(['day', 'total']);
		expect(card.output).toBe('dense');
	});

	it('leaves single-grain metrics exactly as they were', () => {
		const [card] = metricCardsOf([ZAP_COUNT]);
		expect(card.grains).toEqual(['day']);
		expect(card.output).toBe('dense');
	});

	it('preserves registry order across cards', () => {
		const cards = metricCardsOf([ZAP_COUNT, APP_ZAPS_DAY, APP_ZAPS_TOTAL]);
		expect(cards.map((c) => c.metric)).toEqual(['zap_count', 'app_zaps']);
	});

	it('does not merge same-named metrics across domains', () => {
		// The card key is domain-qualified because /data/<domain>/<metric> is, and
		// a future Lightning `zap_count` must not swallow the Zapstore one.
		const other = metric({ metric: 'zap_count', grain: 'day', domain: 'lightning' });
		const cards = metricCardsOf([ZAP_COUNT, other]);
		expect(cards.map((c) => c.key)).toEqual(['zapstore.zap_count', 'lightning.zap_count']);
	});

	it('survives a v1 payload with no `params` block', () => {
		// An older MCP container during a rollout serves entries without `params`;
		// with no default to consult, the first registry entry leads.
		const day = { ...APP_ZAPS_DAY, params: undefined };
		const total = { ...APP_ZAPS_TOTAL, params: undefined };
		const [card] = metricCardsOf([total, day]);
		expect(card.grains).toEqual(['total', 'day']);
		expect(card.summary).toBe(APP_ZAPS_TOTAL.summary);
	});

	it('survives a default grain that matches no registered entry', () => {
		const stray = {
			...ZAP_COUNT,
			params: { ...ZAP_COUNT.params!, grain: { values: ['day'], default: 'century' } }
		};
		const [card] = metricCardsOf([stray]);
		expect(card.grains).toEqual(['day']);
	});

	it('returns nothing for an empty registry', () => {
		expect(metricCardsOf([])).toEqual([]);
	});
});

describe('metricCardLabel', () => {
	it('lists every grain, comma-separated, and drops a disagreeing output', () => {
		const [card] = metricCardsOf([APP_ZAPS_DAY, APP_ZAPS_TOTAL]);
		expect(metricCardLabel(card)).toBe('zaps+msats / day, total');
	});

	it('keeps the output clause when there is one to keep', () => {
		expect(metricCardLabel(metricCardsOf([ZAP_COUNT])[0])).toBe('zaps / day - dense');
	});
});

describe('paid entries (the nutzaps domain)', () => {
	const PAID = metric({
		metric: 'active_users',
		grain: 'month',
		domain: 'nutzaps',
		unit: 'users',
		output: 'sparse',
		price_sats: 21,
		tool: 'nostrology_query_nutzaps'
	});

	it('carries price_sats onto the card as priceSats', () => {
		const [card] = metricCardsOf([PAID]);
		expect(card.priceSats).toBe(21);
	});

	it('free entries coalesce to a null price', () => {
		const [card] = metricCardsOf([ZAP_COUNT]);
		expect(card.priceSats).toBeNull();
	});

	it('the card label describes the shape, without the price', () => {
		expect(metricCardLabel(metricCardsOf([PAID])[0])).toBe('users / month - sparse');
		expect(metricCardLabel(metricCardsOf([ZAP_COUNT])[0])).toBe('zaps / day - dense');
	});

	it('the price is published as its own clause, for paid metrics only', () => {
		// Its own string so the template can colour it; still on the card, which is
		// what makes the price crawler-visible without calling anything.
		expect(metricCardPrice(metricCardsOf([PAID])[0])).toBe('21 sats/call (Cashu)');
		expect(metricCardPrice(metricCardsOf([ZAP_COUNT])[0])).toBeNull();
	});
});

describe('domainsOf (presentation order)', () => {
	const payload = (domains: string[]) =>
		({
			v: 2,
			server: { name: 'x', version: '0', git_sha: 'a' },
			tool: 't',
			metrics: domains.map((domain, i) => ({ ...REGISTRY.metrics[0]!, key: `${domain}.m${i}@day`, domain })),
			reference: []
		}) as RegistryPayload;

	it('leads with zapstore, routstr, nutzaps, then the rest alphabetically', () => {
		// nutzaps joined DOMAIN_ORDER with its free metrics (2026-09-30). `lightning`
		// sorts before it, so this input tells the stated order from a plain sort.
		expect(
			domainsOf(payload(['nutzaps', 'routstr', 'zapstore', 'lightning', 'marketplaces']))
		).toEqual(['zapstore', 'routstr', 'nutzaps', 'lightning', 'marketplaces']);
	});

	it('never invents a led domain the registry does not serve', () => {
		expect(domainsOf(payload(['nutzaps', 'zapstore']))).toEqual(['zapstore', 'nutzaps']);
		expect(domainsOf(payload(['routstr']))).toEqual(['routstr']);
		// A led domain still leads when the ones ahead of it are absent.
		expect(domainsOf(payload(['lightning', 'nutzaps']))).toEqual(['nutzaps', 'lightning']);
	});

	it('unions reference-only domains in', () => {
		const p = payload(['zapstore']);
		p.reference = [{ ...(REGISTRY.reference?.[0] ?? {}), key: 'routstr.r', domain: 'routstr' } as never];
		expect(domainsOf(p)).toEqual(['zapstore', 'routstr']);
	});
});

describe('a MIXED domain (nutzaps since 2026-09-30: free metrics beside the paid one)', () => {
	// Production order (the fixture is generated from the real registry): sorted by
	// key, so the paid active_users trio comes first, as day, month, week - never
	// default-first.
	const MIXED = [...PAID_METRICS, ...NUTZAPS_FREE_METRICS];
	const byMetric = (cards: ReturnType<typeof metricCardsOf>) =>
		Object.fromEntries(cards.map((c) => [c.metric, c]));

	it('groups to one card per metric, free and paid alike, in registry order', () => {
		expect(metricCardsOf(MIXED).map((c) => c.key)).toEqual([
			'nutzaps.active_users',
			'nutzaps.mint_active_users',
			'nutzaps.mint_activity',
			'nutzaps.mint_leaderboard',
			'nutzaps.payment_activity'
		]);
	});

	it('prices the paid metric only - the domain does not make a metric paid', () => {
		const cards = byMetric(metricCardsOf(MIXED));
		expect(cards.active_users.priceSats).toBe(21);
		for (const free of ['mint_active_users', 'mint_activity', 'mint_leaderboard', 'payment_activity']) {
			expect(cards[free].priceSats).toBeNull();
			expect(metricCardPrice(cards[free])).toBeNull();
		}
		expect(metricCardPrice(cards.active_users)).toBe('21 sats/call (Cashu)');
	});

	it('keeps the price on its own metric however the entries interleave', () => {
		// Grouping is keyed per domain.metric; paid entries arriving BETWEEN two
		// grains of a free metric must neither price the free card nor split it.
		const [payDay, payTotal] = NUTZAPS_FREE_METRICS.filter((m) => m.metric === 'payment_activity');
		const cards = byMetric(
			metricCardsOf([payDay, PAID_METRICS[0], PAID_METRICS[1], payTotal, PAID_METRICS[2]])
		);
		expect(Object.keys(cards)).toEqual(['payment_activity', 'active_users']);
		expect(cards.payment_activity.grains).toEqual(['day', 'total']);
		expect(cards.payment_activity.priceSats).toBeNull();
		expect(cards.active_users.priceSats).toBe(21);
	});

	it('leads each free card with its own default grain', () => {
		const cards = byMetric(metricCardsOf(MIXED));
		expect(cards.payment_activity.grains).toEqual(['day', 'total']);
		expect(cards.mint_leaderboard.grains).toEqual(['total']);
		expect(cards.mint_activity.grains).toEqual(['day']);
		// sparse @day vs entities @total: the output clause drops, as for app_zaps.
		expect(metricCardLabel(cards.payment_activity)).toBe('payments+sats / day, total');
	});

	it('lists day, week and month on BOTH active-user cards, the price on the paid one only', () => {
		// Per-mint day and week buckets were withdrawn on the 2026-09-30 review (summed
		// over mints they gave away the paid DAU/WAU) and made free by the operator the
		// same evening. The free per-mint card and the paid network-wide card now list
		// the same three grains, each default (month) first; only the paid one is priced.
		const cards = byMetric(metricCardsOf(MIXED));
		expect(cards.mint_active_users.grains).toEqual(['month', 'day', 'week']);
		expect(metricCardLabel(cards.mint_active_users)).toBe('users / month, day, week - sparse');
		expect(cards.mint_active_users.priceSats).toBeNull();
		expect(cards.active_users.grains).toEqual(['month', 'day', 'week']);
		for (const free of NUTZAPS_FREE_METRICS.filter((m) => m.metric === 'mint_active_users')) {
			expect(free.params?.grain).toMatchObject({ values: ['day', 'week', 'month'], default: 'month' });
		}
	});
});
