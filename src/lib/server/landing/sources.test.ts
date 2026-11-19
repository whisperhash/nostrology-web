// @vitest-environment node
//
// The landing's sources: each reads its surface page's own data function with that page's
// arguments, and the three that read tables the nightly loader empties and refills refuse an
// empty read, so the cache keeps its last good copy (./sources.ts nonEmpty).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
	getMarketplacesSnapshot: vi.fn(),
	getNgitSnapshot: vi.fn(),
	getZapstoreAppsCumulativeDaily: vi.fn(),
	getNutzapsDailySeries: vi.fn(),
	getNutzapMintStats: vi.fn(),
	getLightningProviderStats: vi.fn(),
	getLightningTrendsSatsShare: vi.fn()
}));
vi.mock('$lib/db/postgres', () => db);

import { LANDING_SOURCES, LIGHTNING_TOP_N } from './sources';

const mint = (sats: number) => ({ mint_url: 'https://m', config_count: 1, payment_count: 1, total_amount_sats: sats, has_page: true });
const day = { timestamp: 1, value: 1 };
const payments = (n: number) => ({ timestamp: 1, daily_count: n, cumulative_count: n, daily_sats: n, cumulative_sats: n });
// What the real queries return on an EMPTY table: they pad the trailing year with
// generate_series (zapstore-charts.test.ts pins it), so 366 days of zeros, not no rows.
const year = <T>(row: T) => Array.from({ length: 366 }, () => row);

beforeEach(() => {
	for (const f of Object.values(db)) f.mockReset();
});

describe('the landing sources', () => {
	it("pass each surface page's own arguments, and its answer unchanged", async () => {
		const answer = { any: 'thing' };
		for (const f of Object.values(db)) f.mockResolvedValue(answer);
		expect(await LANDING_SOURCES.marketplaces()).toBe(answer);
		expect(await LANDING_SOURCES.git()).toBe(answer);
		expect(await LANDING_SOURCES.lightningProviders()).toBe(answer);
		expect(await LANDING_SOURCES.lightningShare()).toBe(answer);
		expect(db.getLightningTrendsSatsShare).toHaveBeenCalledWith(LIGHTNING_TOP_N);
		db.getNutzapMintStats.mockResolvedValue([mint(0), mint(5)]);
		await LANDING_SOURCES.nutzapMints();
		expect(db.getNutzapMintStats).toHaveBeenCalledWith('all');
	});

	it('keep what a non-empty read returns', async () => {
		const apps = { total: [day], github: [], native: [] };
		db.getZapstoreAppsCumulativeDaily.mockResolvedValue(apps);
		db.getNutzapsDailySeries.mockResolvedValue([payments(0), payments(2)]);
		db.getNutzapMintStats.mockResolvedValue([mint(0), mint(5)]);
		expect(await LANDING_SOURCES.zapstore()).toBe(apps);
		expect(await LANDING_SOURCES.nutzapsDaily()).toEqual([payments(0), payments(2)]);
		expect(await LANDING_SOURCES.nutzapMints()).toEqual([mint(0), mint(5)]);
	});

	it('refuse an empty read of a table the nightly loader refills, naming why', async () => {
		// (the board's figure and chart read `total`)
		const zero = { timestamp: 1, value: 0 };
		db.getZapstoreAppsCumulativeDaily.mockResolvedValue({ total: year(zero), github: [day], native: [day] });
		db.getNutzapsDailySeries.mockResolvedValue(year(payments(0)));
		await expect(LANDING_SOURCES.zapstore()).rejects.toThrow(/^no apps: an empty read, as between a nightly load's TRUNCATE and its COPY$/);
		await expect(LANDING_SOURCES.nutzapsDaily()).rejects.toThrow(/^no payments: an empty read/);
		// and no rows at all, should a query ever stop padding
		db.getZapstoreAppsCumulativeDaily.mockResolvedValue({ total: [], github: [], native: [] });
		db.getNutzapsDailySeries.mockResolvedValue([]);
		await expect(LANDING_SOURCES.zapstore()).rejects.toThrow(/^no apps/);
		await expect(LANDING_SOURCES.nutzapsDaily()).rejects.toThrow(/^no payments/);
		// the mint list can come back with mints and no sats: the board would count 0 mints
		db.getNutzapMintStats.mockResolvedValue([mint(0), mint(0)]);
		await expect(LANDING_SOURCES.nutzapMints()).rejects.toThrow(/^no mint with sats: an empty read/);
		db.getNutzapMintStats.mockResolvedValue([]);
		await expect(LANDING_SOURCES.nutzapMints()).rejects.toThrow(/^no mint with sats/);
	});
});
