import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { METHODOLOGY } from '$lib/methodology';
import { SLUG_TABLES } from '$lib/slug-tables';

const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)));
const SRC = resolve(ROUTES, '..');

function svelteFiles(dir: string, only?: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return svelteFiles(p, only);
		return e.name.endsWith('.svelte') && (!only || e.name === only) ? [p] : [];
	});
}
const pageFiles = (dir: string) => svelteFiles(dir, '+page.svelte');

/**
 * COVERAGE GUARD for What is counted's address (CLAUDE.md -> "Every domain page's What is
 * counted has an address"). Every domain page with the section owes /<domain>/methodology:
 * the section is `<MethodologySection bind:open href>` - the collapsed `<details>` and the
 * link icon that copies the address, in one component so no page builds either by hand -
 * and its slug is in the domain's slug table, on the pill that holds it, so the server
 * answers the address and $lib/domain-page opens it.
 *
 * Derived from the filesystem rather than a hand-kept list, in the shape of
 * social-meta-coverage.test.ts and for the same reason: the failure mode being guarded is a
 * NEW domain surface, and a hand-kept list would not know about it. A page is held to the
 * convention when it renders a "What is counted" section, which is what the link exists to
 * reach - by hand, or through the component (whose heading the page source no longer spells).
 *
 * EXCEPTIONS are named here, with their reason, so that skipping the convention is a
 * decision someone wrote down rather than something nobody noticed.
 */
const EXCEPT: Record<string, string> = {
	// (/routstr was one until 2026-10-18, when the operator had it join while still hidden
	// from the nav and the sitemap.)
	// The /data registry pages are the machine surface's documentation: no pills, nothing
	// collapsed, and "What is counted" is one of several always-open sections of a page
	// that IS the methodology. Nothing to expand, so nothing to link to.
	'(app)/data/[domain]/[metric]/+page.svelte': 'a documentation page, nothing collapsed'
};

describe('methodology link coverage', () => {
	const pages = pageFiles(ROUTES)
		.map((p) => relative(ROUTES, p))
		.filter((rel) => {
			const src = readFileSync(join(ROUTES, rel), 'utf8');
			return src.includes('What is counted') || src.includes('<MethodologySection');
		});

	it('finds the pages that carry a What is counted section', () => {
		// A floor, not a census - its job is to fail loudly if the scan ever stops matching
		// (a rename, a reworded heading) rather than silently asserting nothing.
		expect(pages.length).toBeGreaterThanOrEqual(4);
		expect(pages).toContain('(app)/git/+page.svelte');
		expect(pages).toContain('(app)/marketplaces/+page.svelte');
		expect(pages).toContain('(app)/routstr/+page.svelte');
		// every exception is a page that exists and still has the section
		for (const rel of Object.keys(EXCEPT)) expect(pages, rel).toContain(rel);
	});

	it('renders the section only from a page itself, so the scan above sees every use of it', () => {
		// Both the scan and the checks below read +page.svelte files. A page that moved its
		// section into a component of its own (/git's slot alone is ~130 lines) would contain
		// neither "What is counted" nor <MethodologySection>, and so would never be checked -
		// hash handling included (review, 2026-10-18). Extract the section's
		// CONTENT if it grows, and keep the <MethodologySection> tag in the page.
		const users = svelteFiles(SRC)
			.filter((p) => !p.endsWith('MethodologySection.svelte'))
			.filter((p) => readFileSync(p, 'utf8').includes('<MethodologySection'))
			.map((p) => relative(SRC, p));
		expect(users.length).toBeGreaterThanOrEqual(3);
		for (const rel of users) expect(rel, rel).toMatch(/^routes\/.*\+page\.svelte$/);
	});

	it.each(pages.filter((rel) => !EXCEPT[rel]))('%s gives What is counted its address', (rel) => {
		const src = readFileSync(join(ROUTES, rel), 'utf8');
		// the domain the page serves, and its slug table: What is counted has its slug there
		const domain = rel.split('/').filter((seg) => !seg.startsWith('('))[0];
		const table = SLUG_TABLES[domain];
		expect(table, `${domain} has a slug table`).toBeDefined();
		const section = table.sections[METHODOLOGY];
		expect(section, `${domain}'s table names What is counted`).toBeDefined();
		// the section itself, through the one component: collapsible, carrying the copy-link
		// icon to its own address, bound so the address can open it
		expect(src).toContain("import MethodologySection from '$lib/components/MethodologySection.svelte'");
		expect(src).toMatch(/<MethodologySection\b[^>]*\bbind:open=\{\$methodologyOpen\}[^>]*\bhref=\{addressOf\(\w+_SLUGS, METHODOLOGY\)\}/s);
		// on the pill the table says: the section sits inside that pill's panel
		const panel = src.indexOf(`{#if $tab === '${section.pill}'}`);
		const next = src.indexOf('{#if $tab ===', panel + 1);
		const at = src.indexOf('<MethodologySection');
		expect(panel, 'the pill holding it').toBeGreaterThan(-1);
		expect(at > panel && (next < 0 || at < next), `What is counted sits in ${section.pill}'s panel`).toBe(true);
		// the page runs on the shared logic, which is what opens the section at its address
		expect(src).toMatch(/domainPage\(\w+_SLUGS, \(\) => data\.target\)/);
		// and never a second section built by hand beside it, which would carry no icon (and two
		// elements with id="methodology"), nor a hand-rolled read of the hash: old #methodology
		// links are $lib/legacy-hash's
		expect(src).not.toMatch(/\bid=\{METHODOLOGY_ID\}|\bid="methodology"/);
		expect(src).not.toMatch(/location\.hash/);
	});
});
