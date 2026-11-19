import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import MetricPage from './[domain]/[metric]/+page.svelte';
import { ENDPOINT } from './registry-fixture';
import type { RegistryRecord, RegistryRecordParams } from '$lib/server/mcpRegistry';

vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

/**
 * The reference-record branch of the per-metric page, over the FOUR scope shapes
 * the registry can serve (2026-08-29): the legacy v2 payload (only
 * `publisher_pubkey`, from an MCP container that predates the Routstr domain),
 * the current Zapstore payload (`scope` + the legacy block), a Routstr record
 * scoped by `provider_pubkey`, and a Routstr record that takes no scope at all.
 * Before this test nothing rendered `{#if r}` - the old page dereferenced
 * `params.publisher_pubkey.required` and 500ed on every Routstr record page.
 */
function record(over: Partial<RegistryRecord> & { params: RegistryRecordParams }): RegistryRecord {
	return {
		key: 'zapstore.app_catalog',
		domain: 'zapstore',
		record: 'app_catalog',
		row_unit: 'one row per app',
		summary: 'summary',
		partition: '',
		caveats: [],
		methodology: '',
		as_of_source: '',
		snapshot_note: 'current',
		columns: [],
		...over
	};
}

const WINDOWLESS = { accepted: false as const, reason: 'no time axis' };
const BASE = { window: WINDOWLESS, format: ['csv', 'markdown'], row_cap: 1000 };

function pageData(r: RegistryRecord) {
	return {
		session: null, analyticsOff: false,
		kind: 'record' as const,
		metric: null,
		record: r,
		grainEntries: [],
		tool: 'nostrology_query_reference',
		priceSats: null,
		endpoint: ENDPOINT
	};
}

const paramRows = (container: HTMLElement) =>
	[...container.querySelectorAll('tbody tr')].map((tr) =>
		[...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim())
	);

describe('record page scope rendering', () => {
	it('legacy payload (publisher_pubkey only, no scope block) still renders and requires the key', () => {
		const r = record({
			params: { ...BASE, publisher_pubkey: { required: true, note: 'a publisher key' } }
		});
		const { container } = render(MetricPage, { props: { data: pageData(r) } });
		const rows = paramRows(container);
		expect(rows[0]?.[0]).toBe('publisher_pubkey');
		expect(rows[0]?.[1]).toContain('required');
		expect(container.querySelector('pre code')?.textContent).toContain('"publisher_pubkey"');
	});

	it('current Zapstore payload reads the scope block', () => {
		const r = record({
			params: {
				...BASE,
				scope: { param: 'publisher_pubkey', required: false, note: 'omit for all publishers' },
				publisher_pubkey: { required: false, note: 'omit for all publishers' }
			}
		});
		const { container } = render(MetricPage, { props: { data: pageData(r) } });
		const rows = paramRows(container);
		expect(rows[0]?.[0]).toBe('publisher_pubkey');
		expect(rows[0]?.[1]).toContain('optional');
		expect(container.querySelector('pre code')?.textContent).not.toContain('publisher_pubkey');
	});

	it('a Routstr record scoped by provider_pubkey names that parameter', () => {
		const r = record({
			key: 'routstr.provider_profile',
			domain: 'routstr',
			record: 'provider_profile',
			params: {
				...BASE,
				scope: { param: 'provider_pubkey', required: false, note: 'omit for all providers' }
			}
		});
		const { container } = render(MetricPage, { props: { data: pageData(r) } });
		const rows = paramRows(container);
		expect(rows[0]?.[0]).toBe('provider_pubkey');
		expect(rows[0]?.[1]).toBe('optional - omit for all providers');
		expect(container.querySelector('pre code')?.textContent).toContain('"domain": "routstr"');
	});

	it('a Routstr record with no scope says so instead of throwing', () => {
		const r = record({
			key: 'routstr.exclusions',
			domain: 'routstr',
			record: 'exclusions',
			params: { ...BASE, scope: { param: null, required: false, note: 'this record takes no entity scope' } }
		});
		const { container } = render(MetricPage, { props: { data: pageData(r) } });
		const rows = paramRows(container);
		expect(rows[0]?.[0]).toBe('(no entity scope)');
		expect(rows[0]?.[1]).toContain('takes no entity scope');
		expect(container.querySelector('pre code')?.textContent).not.toContain('pubkey');
	});
});
