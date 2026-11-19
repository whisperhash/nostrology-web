import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, '../..');

const FORBIDDEN_IMPORT_PATTERNS = [
	/\$env\/dynamic\/private/,
	/\$lib\/db\/postgres/
];

function collectSvelteFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectSvelteFiles(fullPath));
			continue;
		}
		if (entry.isFile() && extname(entry.name) === '.svelte') {
			files.push(fullPath);
		}
	}

	return files;
}

describe('client/server module boundaries', () => {
	it('keeps server-only modules out of .svelte files', () => {
		const violations = collectSvelteFiles(SRC_ROOT)
			.map((filePath) => {
				const source = readFileSync(filePath, 'utf8');
				const matches = FORBIDDEN_IMPORT_PATTERNS.filter((pattern) => pattern.test(source)).map(
					(pattern) => pattern.source
				);
				return matches.length > 0
					? `${relative(SRC_ROOT, filePath)} imports server-only module(s): ${matches.join(', ')}`
					: null;
			})
			.filter((value): value is string => value !== null);

		expect(violations).toEqual([]);
	});
});
