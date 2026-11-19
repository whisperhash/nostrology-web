// The shape of .github/workflows/gate.yml, the test gate every code-bringing deploy waits for, because
// nothing else checks it until a deploy needs it. A mistake here does not fail a test: it lets the
// tests run where they could read a credential, or skips every database test and stays green, or
// leaves the deploy nothing to post.
//
// It holds what the file must do rather than what it says today. A new pin or a shorter limit passes;
// a floating tag, a longer limit or a check that can no longer fail does not. Only the commands the
// gate rests on, the ceiling and the floor are held word for word.
//
// This reads the file as lines rather than with a YAML parser, which this repo has no other use
// for. The file's shape is ours and simple: jobs at two spaces, steps at six, keys at eight. The
// steps that can be run here are run for real.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(fileURLToPath(new URL('../.github/workflows/gate.yml', import.meta.url)), 'utf8');
const LINES = WORKFLOW.split('\n');
const uncommented = (lines) => lines.filter((line) => !/^\s*#/.test(line));
/** Everything above `jobs:`, comments out. */
const TOP = uncommented(LINES.slice(0, LINES.indexOf('jobs:')));

/**
 * Each job's lines, comments out, so a comment naming a permission is not that permission. A job's
 * name is whatever GitHub allows, so one named with a digit or an underscore is a job of its own here,
 * not lines filed under the job before it.
 */
const JOBS = (() => {
	const out = {};
	let name = null;
	for (const line of LINES.slice(LINES.indexOf('jobs:') + 1)) {
		const job = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
		if (job) {
			name = job[1];
			out[name] = [];
		} else if (/^ {2}\S/.test(line) && !/^ {2}#/.test(line)) throw new Error(`a job line this cannot read: ${line}`);
		else if (name && !/^\s*#/.test(line)) out[name].push(line);
	}
	return out;
})();

/** A job's steps, each as its own text. */
function stepsOf(job) {
	const out = [];
	for (const line of JOBS[job].slice(JOBS[job].indexOf('    steps:') + 1)) {
		if (/^ {6}- /.test(line)) out.push([line]);
		else if (out.length) out.at(-1).push(line);
	}
	return out.map((lines) => lines.join('\n'));
}

const TEST_STEPS = stepsOf('test');
const idOf = (step) => /^ {8}id: (\S+)$/m.exec(step)?.[1];
const testStep = (id) => {
	const found = TEST_STEPS.filter((step) => idOf(step) === id);
	expect(found, `exactly one step with id ${id}`).toHaveLength(1);
	return found[0];
};

/** What a step runs: the one line, or the block under `run: |` with its indent taken off. */
function runOf(step) {
	const lines = step.split('\n');
	const at = lines.findIndex((line) => /^ {8}run: /.test(line));
	const head = lines[at].replace(/^ {8}run: /, '');
	if (head !== '|') return head;
	return lines
		.slice(at + 1)
		.map((line) => line.slice(10))
		.join('\n');
}

const job = (name) => JOBS[name].join('\n');
/** A job's `permissions:`, as `key: value` strings, or the shorthand as it stands. */
const permissionsOf = (name) => {
	const lines = JOBS[name];
	const at = lines.findIndex((line) => /^ {4}permissions:/.test(line));
	if (at < 0 || lines[at] === '    permissions: {}') return [];
	if (lines[at] !== '    permissions:') return [lines[at].trim()];
	const out = [];
	for (const line of lines.slice(at + 1)) {
		if (!/^ {6}\S/.test(line)) break;
		out.push(line.trim());
	}
	return out;
};
/** The job's own limit, in minutes, or Infinity with none: GitHub's default is 6 hours. */
const limitOf = (name) => Number(/^ {4}timeout-minutes: (\d+)$/m.exec(job(name))?.[1] ?? Infinity);

describe('what it holds and who can start it', () => {
	it('has the one job test, so a new one is read here before it runs', () => {
		expect(Object.keys(JOBS)).toEqual(['test']);
	});

	it('gives the job no name of its own: the deploy refuses a gate whose one job is not named test', () => {
		expect(job('test')).not.toMatch(/^ {4}name:/m);
	});

	it('runs only when dispatched, never for a push or a pull request: a deploy dispatches it and waits for that run', () => {
		const on = TOP.slice(TOP.indexOf('on:') + 1);
		const triggers = on.slice(0, on.findIndex((line) => /^\S/.test(line))).filter((line) => /^ {2}\S/.test(line));
		expect(triggers).toEqual(['  workflow_dispatch:']);
	});

	it('runs on Ubuntu 24.04, which has Docker, and counts on nothing an earlier job left', () => {
		expect(job('test')).toMatch(/^ {4}runs-on: ubuntu-24\.04$/m);
		// No path under /cache: each job starts on a fresh machine, so nothing may count on a directory
		// an earlier job made.
		expect(job('test')).not.toMatch(/(?<![\w.-])\/cache\b/);
	});

	it("keeps pnpm's store between runs, under a key of the lockfile pnpm install reads", () => {
		expect(testStep('setup-node')).toMatch(/^ {10}cache: pnpm$/m);
		expect(testStep('setup-node')).not.toMatch(/cache-dependency-path:/);
	});

	it('takes the verb of the waiting deploy as an optional string, and shows it nowhere', () => {
		const block = TOP.slice(TOP.indexOf('on:'), TOP.indexOf('permissions: {}')).join('\n');
		expect(block).toContain('      action:\n');
		expect(block).toContain('        type: string\n        required: false\n        default: ""');
		// A constant title: the run list of a public repository names no deploy verb.
		expect(TOP).toContain('run-name: Test gate');
		expect(job('test')).not.toMatch(/inputs\./);
	});

	it('grants nothing by default, and the job only a read of the code', () => {
		expect(TOP).toContain('permissions: {}');
		expect(permissionsOf('test')).toEqual(['contents: read']);
	});

	it('names no secret and asks for no token, in any spelling: a package with sudo could read it from the runner', () => {
		for (const text of [TOP.join('\n'), job('test')]) {
			expect(text).not.toMatch(/\bsecrets\b/);
			expect(text).not.toMatch(/id-token|write-all/);
		}
	});

	it('gives the job these expressions and no other, so a new one is read here before it runs', () => {
		expect([...new Set(job('test').match(/\$\{\{[^}]*\}\}/g))].sort()).toEqual(['${{ always() }}', '${{ toJSON(steps) }}']);
	});

	it('pins every action by commit', () => {
		const uses = LINES.filter((line) => /^\s*(- )?uses: /.test(line));
		expect(uses.length).toBeGreaterThanOrEqual(3);
		for (const line of uses) expect(line).toMatch(/uses: \S+@[0-9a-f]{40}( |$)/);
	});

	it('leaves no token in .git/config for the tests to read', () => {
		expect(TEST_STEPS[0]).toMatch(/uses: actions\/checkout@/);
		expect(TEST_STEPS[0]).toMatch(/persist-credentials: false/);
	});

	it('splices no expression into a shell script, where text from a test could run', () => {
		for (const step of TEST_STEPS) if (/^ {8}run: /m.test(step)) expect(runOf(step)).not.toContain('${{');
	});
});

describe('the gate', () => {
	const CHECKS = [
		'checkout',
		'docker',
		'setup-pnpm',
		'setup-node',
		'node-major',
		'pnpm-version',
		'install',
		'scratch-postgres',
		'vitest',
		'skip-ceiling',
		'db-files',
		'check',
		'caddy'
	];

	it('runs every check, in this order, and any of them failing turns it red', () => {
		expect(TEST_STEPS.map(idOf).filter(Boolean)).toEqual([...CHECKS, 'summary']);
		for (const id of CHECKS) expect(testStep(id), id).not.toMatch(/^ {8}(if|continue-on-error):/m);
		// On the job itself, it would count a red job as passed and let the deploy run.
		expect(job('test')).not.toMatch(/^ {4}(if|continue-on-error):/m);
	});

	it('runs what the gate rests on word for word, so nothing can narrow it or swallow its exit', () => {
		expect(runOf(testStep('install'))).toBe('pnpm install --frozen-lockfile');
		expect(runOf(testStep('vitest'))).toBe(
			'pnpm exec vitest run --reporter=default --reporter=github-actions --reporter=junit --outputFile.junit="$RUNNER_TEMP/vitest.xml"'
		);
		expect(runOf(testStep('skip-ceiling'))).toBe('python3 scripts/check_skip_ceiling.py "$RUNNER_TEMP/vitest.xml:7:2040"');
		expect(runOf(testStep('check'))).toBe('pnpm run check');
		expect(runOf(testStep('caddy'))).toBe('./deploy/test-caddyfile.sh');
	});

	it('reads the node major from this file, which is where it is stated', () => {
		expect(runOf(testStep('node-major'))).toContain("grep -oE '^ *node-version: *[0-9]+' .github/workflows/gate.yml");
		expect(LINES.filter((line) => /^ *node-version: *\d+/.test(line))).toHaveLength(1);
	});

	it("uses a database of production's major version, pinned by digest, that sorts as production does", () => {
		const postgres = runOf(testStep('scratch-postgres'));
		expect(postgres).toMatch(/postgres:16-alpine@sha256:[0-9a-f]{64} /);
		expect(postgres.match(/POSTGRES_INITDB_ARGS/g)).toHaveLength(1);
		expect(postgres).toContain("-e POSTGRES_INITDB_ARGS='--locale-provider=icu --icu-locale=en-US-u-ka-shifted'");
		// The order itself, asked of the database: true in production, false on bytes and on plain en-US.
		expect(postgres).toContain(
			`sorts=$(docker exec test-pg psql -U postgres -Atc "SELECT 'a' < 'B' AND 'https://minta.io' < 'https://mint.coinos.io'")`
		);
		expect(postgres).toContain('if [ "$sorts" != t ]; then');
	});

	it("stops Postgres whatever the tests did, before the job's memory peak", () => {
		// pnpm run check is the job's memory peak, and it comes after this.
		const at = TEST_STEPS.findIndex((step) => /name: Stop Postgres/.test(step));
		expect(idOf(TEST_STEPS[at - 1])).toBe('vitest');
		expect(TEST_STEPS[at]).toMatch(/if: \$\{\{ always\(\) \}\}/);
		expect(runOf(TEST_STEPS[at])).toContain('docker rm -fv test-pg');
	});

	it('stops a hung job within minutes, not at the default of six hours', () => {
		expect(limitOf('test')).toBeLessThanOrEqual(15);
	});

	it('names any step it can fail in', () => {
		// toJSON(steps) holds only steps with an id, so a step without one could fail unnamed. Stopping
		// Postgres cannot fail.
		const unnamed = TEST_STEPS.filter((step) => !idOf(step)).map((step) => /name: (.+)/.exec(step)?.[1]);
		expect(unnamed).toEqual(['Stop Postgres']);
	});

	describe('counts the test files in src/lib/db', () => {
		const dirs = [];
		afterEach(() => {
			for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		});

		function count(report) {
			const dir = mkdtempSync(join(tmpdir(), 'gate-files-'));
			dirs.push(dir);
			if (report !== null) writeFileSync(join(dir, 'vitest.xml'), report);
			// As GitHub runs a step: bash -e, so a command that fails stops it.
			return spawnSync('bash', ['-e', '-c', runOf(testStep('db-files'))], {
				encoding: 'utf8',
				env: { PATH: process.env.PATH, RUNNER_TEMP: dir }
			});
		}
		const onDisk = () =>
			readdirSync(fileURLToPath(new URL('../src/lib/db', import.meta.url)), { recursive: true }).filter((file) =>
				/\.test\.[a-z]+$/.test(file)
			).length;
		const suites = (n) => '<testsuite name="src/lib/db/x.test.ts" tests="1">\n'.repeat(n);

		it('and the number moves with a new file there', () => {
			expect(onDisk()).toBeGreaterThan(0);
			expect(count(suites(onDisk())).status, 'the number in the db-files step').toBe(0);
		});

		it('and fails when one is missing, or none, or there is no report', () => {
			for (const report of [suites(onDisk() - 1), '<testsuite name="other.test.ts" tests="1">\n', null]) {
				const done = count(report);
				expect(done.status).toBe(1);
				expect(done.stdout).toContain('::error::');
			}
		});
	});
});

describe('what it hands the deploy', () => {
	const dirs = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it('runs its summary whatever happened, and the summary cannot turn a green gate red', () => {
		const summary = testStep('summary');
		expect(summary).toMatch(/if: \$\{\{ always\(\) \}\}/);
		expect(summary).toMatch(/continue-on-error: true/);
		expect(summary).toContain('STEPS: ${{ toJSON(steps) }}');
		expect(TEST_STEPS.at(-1)).toBe(summary);
	});

	/** The summary step, run for real on a report: what it printed. */
	function summarize(report) {
		const dir = mkdtempSync(join(tmpdir(), 'gate-summary-'));
		dirs.push(dir);
		writeFileSync(join(dir, 'vitest.xml'), report);
		const done = spawnSync('bash', ['-e', '-c', runOf(testStep('summary'))], {
			cwd: fileURLToPath(new URL('..', import.meta.url)),
			encoding: 'utf8',
			env: { PATH: process.env.PATH, RUNNER_TEMP: dir, STEPS: '{"vitest": {"outcome": "failure"}}' }
		});
		return done.stdout;
	}

	it('ends with the one line the deploy reads, the base64 of what it printed above it', () => {
		const out = summarize(
			'<testsuites><testsuite name="a" tests="3" failures="1" errors="0" skipped="1">' +
				'<testcase classname="a" name="x"><failure/></testcase></testsuite></testsuites>'
		);
		const lines = out.trimEnd().split('\n');
		const last = /^GATE_SUMMARY_B64=([A-Za-z0-9+/]+=*)$/.exec(lines.at(-1));
		expect(last, out).not.toBeNull();
		const text = Buffer.from(last[1], 'base64').toString('utf8');
		expect(text).toContain('vitest: 1 passed, 1 skipped, 1 failed');
		expect(text).toContain('Failed steps: vitest');
		expect(`${lines.slice(0, -1).join('\n')}\n`).toBe(text);
	});

	it('still prints the line when there is no report, since a red gate matters most', () => {
		const out = summarize('not a report');
		expect(out.trimEnd().split('\n').at(-1)).toMatch(/^GATE_SUMMARY_B64=[A-Za-z0-9+/]+=*$/);
	});
});
