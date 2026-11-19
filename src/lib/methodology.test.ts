import { describe, expect, it } from 'vitest';

import { METHODOLOGY, METHODOLOGY_ID, METHODOLOGY_TITLE, methodologySection } from './methodology';
import { addressOf, resolveSlug } from './slug-table';
import { SLUG_TABLES } from './slug-tables';

// What is counted's address on every domain that has it: /<domain>/methodology. Where each
// page draws the section is held in src/routes/methodology-coverage.test.ts; what the address
// does on the page, in each page's own tests.

describe('the section', () => {
	it('is the same section on every domain: one slug, one element id, one heading', () => {
		expect(METHODOLOGY).toBe('methodology');
		expect(methodologySection('overview')).toEqual({ pill: 'overview', elementId: METHODOLOGY_ID, title: METHODOLOGY_TITLE });
		expect(METHODOLOGY_TITLE).toBe('What is counted');
	});

	it('draws the domain preview: it has none of its own', () => {
		expect(methodologySection('growth').preview).toBeUndefined();
	});

	it('keeps the word the old #methodology links used, so they still name it', () => {
		expect(METHODOLOGY_ID).toBe(METHODOLOGY);
	});
});

describe('every slug table that has it', () => {
	const withIt = Object.entries(SLUG_TABLES).filter(([, t]) => METHODOLOGY in t.sections);

	it('is every domain with the section today', () => {
		expect(withIt.map(([d]) => d).sort()).toEqual(['git', 'marketplaces', 'routstr']);
	});

	it.each(withIt)('%s answers /<domain>/methodology with its pill and the section', (_, t) => {
		const section = t.sections[METHODOLOGY];
		expect(section).toEqual(methodologySection(section.pill));
		expect(addressOf(t, METHODOLOGY)).toBe(`${t.path}/methodology`);
		expect(resolveSlug(t, METHODOLOGY)).toEqual({ kind: 'page', pill: section.pill, section: METHODOLOGY });
	});
});
