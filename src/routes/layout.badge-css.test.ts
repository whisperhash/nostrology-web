// The iPhone Safari nudge (src/lib/analytics/badge.ts) exists only if Tailwind GENERATES
// the portrait rule from the class string in +layout.svelte and emits it AFTER bottom-3:
// the two selectors have the same specificity, so the later one wins in portrait. jsdom
// computes no CSS and has no orientation, so this checks the CSS Tailwind actually
// produces - a class built dynamically (`bottom-${n}`), a narrowed content glob or a
// variant reorder would fail here while every DOM test stays green.

import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config.js';

async function generatedRules(): Promise<{ selector: string; media: string; bottom: string }[]> {
	// From the project root (vitest's cwd): under the svelteTesting plugin import.meta.url is
	// not a file: URL. A wrong path fails loudly - Tailwind then generates no .bottom-3 at all.
	const layout = resolve(process.cwd(), 'src/routes/+layout.svelte');
	const result = await postcss([tailwindcss({ ...config, content: [layout] })]).process('@tailwind utilities;', {
		from: undefined
	});
	const rules: { selector: string; media: string; bottom: string }[] = [];
	result.root.walkRules((rule: Rule) => {
		const parent = rule.parent;
		const media = parent && parent.type === 'atrule' && 'params' in parent ? String(parent.params) : '';
		let bottom = '';
		rule.walkDecls('bottom', (d) => {
			bottom = d.value;
		});
		rules.push({ selector: rule.selector, media, bottom });
	});
	return rules;
}

describe('analytics-off badge CSS', () => {
	it('emits the portrait nudge after bottom-3, so it wins in portrait', async () => {
		const rules = await generatedRules();
		const base = rules.findIndex((r) => r.selector === '.bottom-3' && r.media === '');
		const nudge = rules.findIndex((r) => r.selector === '.portrait\\:bottom-0');
		expect(base).toBeGreaterThan(-1);
		expect(nudge).toBeGreaterThan(base);
		expect(rules[nudge].media).toBe('(orientation: portrait)');
		// 12px -> 0: onto the top edge of the band Safari reserves above its pill, and no
		// lower. Safari clips a fixed element there; at -4px it cut the bubble's lowest 4px
		// off (see badge.ts).
		expect(rules[base].bottom).toBe('0.75rem');
		expect(rules[nudge].bottom).toBe('0px');
	});
});
