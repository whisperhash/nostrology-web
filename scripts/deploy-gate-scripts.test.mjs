// check_skip_ceiling.py and gate_summary.py, the two scripts the deploy workflow's test job runs on
// vitest's report. They are Python because nostrology-data's gate built and proved them there, and
// they run on the system Python. Tested from the outside, as the workflow runs them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const dirs = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), 'gate-scripts-'));
	dirs.push(dir);
	return dir;
};

/** A report in the shape vitest 2's junit reporter writes: suites under a root that carries no skip count. */
function report({ tests = 10, skipped = 0, failed = [], suites = 1 } = {}) {
	const dir = tempDir();
	const path = join(dir, 'vitest.xml');
	const each = (n) => Math.floor(n / suites);
	const body = Array.from({ length: suites }, (_, i) => {
		const cases = i === 0 ? failed.map((name) => `<testcase classname="a.test.ts" name="${name}"><failure message="no"/></testcase>`) : [];
		return `<testsuite name="f${i}.test.ts" timestamp="2026-11-05T00:00:00Z" hostname="ci" tests="${each(tests)}" failures="${i === 0 ? failed.length : 0}" errors="0" skipped="${each(skipped)}" time="1">${cases.join('')}</testsuite>`;
	}).join('');
	writeFileSync(path, `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${tests}" failures="${failed.length}" errors="0" time="1">${body}</testsuites>`);
	return path;
}

describe('check_skip_ceiling.py', () => {
	const check = (...args) => spawnSync('python3', [script('check_skip_ceiling.py'), ...args], { encoding: 'utf8' });

	it('passes at the ceiling and says what it found', () => {
		const done = check(`${report({ tests: 10, skipped: 7 })}:7`);
		expect(done.status, done.stdout).toBe(0);
		expect(done.stdout).toContain('10 tests, 7 skipped, ceiling 7');
	});

	it('fails one above it, which is the database going away', () => {
		const path = report({ tests: 10, skipped: 8 });
		const done = check(`${path}:7`);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain(`::error::${path}: 8 of 10 tests skipped, above the ceiling of 7`);
	});

	it('says when the ceiling can come down', () => {
		const done = check(`${report({ tests: 10, skipped: 3 })}:7`);
		expect(done.status).toBe(0);
		expect(done.stdout).toContain('the ceiling can come down to 3');
	});

	it('adds up every suite in the report', () => {
		expect(check(`${report({ tests: 10, skipped: 8, suites: 2 })}:7`).status).toBe(1);
		expect(check(`${report({ tests: 10, skipped: 8, suites: 2 })}:8`).status).toBe(0);
	});

	it('counts a missing report as a suite that did not run', () => {
		const done = check(`${join(tempDir(), 'nothing.xml')}:7`);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain('no usable test report');
	});

	it.each([
		['not XML', 'this is not xml'],
		['no suite', '<testsuites/>'],
		['no counts', '<testsuites><testsuite/></testsuites>']
	])('counts an unusable report as a suite that did not run: %s', (_, content) => {
		const path = join(tempDir(), 'bad.xml');
		writeFileSync(path, content);
		const done = check(`${path}:7`);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain('no usable test report');
	});

	it('fails a suite that ran nothing', () => {
		const done = check(`${report({ tests: 0 })}:7`);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain('ran no tests');
	});

	it('passes at the floor and fails below it, counting only tests that ran', () => {
		expect(check(`${report({ tests: 100, skipped: 7 })}:7:93`).status).toBe(0);
		const done = check(`${report({ tests: 100, skipped: 7 })}:7:94`);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain('only 93 of 100 tests ran, below the floor of 94');
	});

	it.each(['no-colon', 'x:-1', 'x:1:-1', ':7'])('refuses a malformed argument: %s', (spec) => {
		const done = check(spec);
		expect(done.status).toBe(1);
		expect(done.stdout).toContain('is not REPORT:CEILING[:FLOOR]');
	});

	it('is a usage error with no argument', () => {
		expect(check().status).toBe(2);
	});
});

describe('gate_summary.py', () => {
	function summary(args, env = {}) {
		const output = join(tempDir(), 'github-output');
		const done = spawnSync('python3', [script('gate_summary.py'), ...args], {
			encoding: 'utf8',
			env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env }
		});
		return { done, output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
	}

	it('gives the counts', () => {
		const { done } = summary([`vitest=${report({ tests: 20, skipped: 7 })}`]);
		expect(done.status).toBe(0);
		expect(done.stdout.trim()).toBe('vitest: 13 passed, 7 skipped');
	});

	it('names the failed tests and the failed steps', () => {
		const steps = JSON.stringify({ vitest: { outcome: 'failure' }, install: { outcome: 'success' }, check: { outcome: 'skipped' } });
		const { done } = summary([`vitest=${report({ tests: 10, failed: ['one', 'two'] })}`], { STEPS: steps });
		expect(done.stdout.split('\n')).toEqual([
			'vitest: 8 passed, 0 skipped, 2 failed',
			'Failed steps: vitest',
			'Failed tests:',
			'a.test.ts::one',
			'a.test.ts::two',
			''
		]);
	});

	it('names a step stopped at the time limit', () => {
		const { done } = summary([`vitest=${report()}`], { STEPS: JSON.stringify({ check: { outcome: 'cancelled' } }) });
		expect(done.stdout).toContain('Failed steps: check');
	});

	it('says so when the report is unusable, and never fails the step', () => {
		const { done } = summary([`vitest=${join(tempDir(), 'nothing.xml')}`]);
		expect(done.status).toBe(0);
		expect(done.stdout).toContain('vitest: no usable report (FileNotFoundError)');
	});

	it.each(['not json', '[1, 2]', '{"a": 1}'])('takes unreadable steps in its stride: %s', (steps) => {
		const { done } = summary([`vitest=${report()}`], { STEPS: steps });
		expect(done.status).toBe(0);
		expect(done.stdout).not.toContain('Failed steps');
	});

	it('caps the names and says how many more', () => {
		const failed = Array.from({ length: 13 }, (_, i) => `t${i}`);
		const { done } = summary([`vitest=${report({ tests: 20, failed })}`]);
		expect(done.stdout).toContain('a.test.ts::t9');
		expect(done.stdout).not.toContain('a.test.ts::t10');
		expect(done.stdout).toContain('and 3 more in the run');
	});

	it('bounds the whole text, since a post has a limit of its own', () => {
		const { done } = summary([`${'L'.repeat(3000)}=${report()}`]);
		const text = done.stdout.trimEnd();
		expect(text).toHaveLength(1800);
		expect(text.endsWith('...')).toBe(true);
	});

	it('writes output a test name cannot break out of', () => {
		// A test's name is not ours to trust. It cannot end the block early, because the delimiter
		// is random, so it cannot set another output either.
		const { output } = summary([`vitest=${report({ tests: 2, failed: ['x&#10;EOF&#10;other=1'] })}`]);
		const [first, ...rest] = output.trimEnd().split('\n');
		const delimiter = /^text<<(gate_summary_[0-9a-f]{32})$/.exec(first)?.[1];
		expect(delimiter).toBeTruthy();
		expect(rest.at(-1)).toBe(delimiter);
		expect(rest.slice(0, -1).join('\n')).not.toContain(delimiter);
	});

	it('is a usage error with no argument', () => {
		expect(summary([]).done.status).toBe(2);
	});
});
