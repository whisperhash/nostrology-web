// scripts/lib/chrome.mjs against a FAKE Chrome: an executable node script that behaves the
// way Chrome does where it matters here. It takes Chrome's flags, creates its profile and a
// per-launch singleton directory in the temp directory that the profile links to, and shuts
// down gracefully on its FIRST SIGTERM only - writing into its profile on the way out - while
// a second SIGTERM kills it outright. Real Chrome is not needed to pin any of this, and CI
// does not have it. The first test is a control: it shows the old kill-then-delete order
// losing the race against this fake, so the tests after it cannot pass vacuously.
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { stopChrome } from './chrome.mjs';

const HELPER = new URL('./chrome.mjs', import.meta.url).href;

// Environment: FAKE_CHROME_MODE, FAKE_CHROME_SHUTDOWN_MS, FAKE_CHROME_NOTE (a JSON file for
// what the test needs to know: its singleton directory, a helper's pid, how it ended), and
// FAKE_CHROME_ROOT (the test runner's pid: when that is gone, so is the fake).
//   graceful          on the first SIGTERM, after SHUTDOWN_MS: write into the profile, exit 0
//   ignores-sigterm   never exits on SIGTERM
//   exits-at-once     exits 0 as soon as it is ready
//   dies-by-signal    SIGKILLs itself as soon as it is ready
//   leaves-a-writer   starts a helper in its group that keeps writing into the profile, and
//                     exits at once on SIGTERM - the helper does not
const FAKE_CHROME = (node) => `#!${node}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = process.env;
const flag = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const profile = flag('user-data-dir');
const note = {};
const save = () => env.FAKE_CHROME_NOTE && fs.writeFileSync(env.FAKE_CHROME_NOTE, JSON.stringify(note));
const root = Number(env.FAKE_CHROME_ROOT);
setInterval(() => { try { process.kill(root, 0); } catch { process.exit(0); } }, 200);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'Local State'), '{}');
const singleton = fs.mkdtempSync(path.join(os.tmpdir(), 'com.google.Chrome.'));
fs.writeFileSync(path.join(singleton, 'SingletonSocket'), '');
note.singleton = singleton;
const mode = env.FAKE_CHROME_MODE || 'graceful';
if (mode === 'graceful') process.once('SIGTERM', () => setTimeout(() => {
  fs.mkdirSync(path.join(profile, 'Default', 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Cache', 'index'), 'x');
  note.ended = 'graceful'; save();
  process.exit(0);
}, Number(env.FAKE_CHROME_SHUTDOWN_MS || 150)));
if (mode === 'ignores-sigterm') process.on('SIGTERM', () => {});
if (mode === 'leaves-a-writer') {
  const writer = spawn(process.execPath, ['-e', \`
    const fs = require('node:fs');
    setInterval(() => { try { process.kill(\${root}, 0); } catch { process.exit(0); } }, 200);
    setInterval(() => { fs.mkdirSync(\${JSON.stringify(profile)} + '/Default', { recursive: true });
      fs.writeFileSync(\${JSON.stringify(profile)} + '/Default/late', 'x'); }, 20);\`], { stdio: 'ignore' });
  note.writer = writer.pid;
  process.on('SIGTERM', () => process.exit(0));
}
save();
// Ready: the last thing it sets up is the link, as Chrome's profile has it.
fs.symlinkSync(path.join(singleton, 'SingletonSocket'), path.join(profile, 'SingletonSocket'));
if (mode === 'exits-at-once') process.exit(0);
if (mode === 'dies-by-signal') process.kill(process.pid, 'SIGKILL');
`;

let fake;
const groups = [];
const dirs = [];

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-mjs-fake-'));
  dirs.push(dir);
  fake = join(dir, 'fake-chrome');
  writeFileSync(fake, FAKE_CHROME(process.execPath));
  chmodSync(fake, 0o755);
});

afterAll(async () => {
  await rm(dirname(fake), { recursive: true, force: true });
});

async function scratchDir() {
  const dir = await mkdtemp(join(tmpdir(), 'chrome-mjs-test-'));
  dirs.push(dir);
  return dir;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, what, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(10);
  }
}

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const readNote = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'note.json'), 'utf8'));
  } catch {
    return {};
  }
};

const fakeEnv = (dir, mode, extra = {}) => ({
  ...process.env,
  FAKE_CHROME_MODE: mode,
  FAKE_CHROME_NOTE: join(dir, 'note.json'),
  FAKE_CHROME_ROOT: String(process.pid),
  ...extra
});

// Start the fake the way launchChrome starts Chrome - detached, leading its own group - and
// wait until it is ready.
async function startFake(mode, extra) {
  const dir = await scratchDir();
  const profile = join(dir, 'profile');
  const chrome = spawn(fake, [`--user-data-dir=${profile}`, 'about:blank'], {
    stdio: 'ignore',
    detached: true,
    env: fakeEnv(dir, mode, extra)
  });
  groups.push(chrome.pid);
  await until(() => isLink(join(profile, 'SingletonSocket')) || chrome.exitCode !== null || chrome.signalCode !== null, 'the fake Chrome');
  return { chrome, profile, dir };
}

const exitOf = (proc) =>
  proc.exitCode !== null || proc.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => proc.once('exit', resolve));

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  // Whatever a failing test left running: each fake leads its own group, helpers included.
  for (const pid of groups.splice(0)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone - the passing case */
    }
  }
  for (const dir of dirs.splice(1)) {
    const { singleton } = readNote(dir);
    chmodSync(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
    if (singleton) await rm(singleton, { recursive: true, force: true });
  }
});

describe('stopChrome', () => {
  it('control: the old kill-then-delete order leaves the profile behind', async () => {
    const { chrome, profile } = await startFake('graceful');
    chrome.kill();
    await rm(profile, { recursive: true, force: true });
    await exitOf(chrome);
    expect(existsSync(profile)).toBe(true);
  });

  it('deletes the profile only after Chrome has exited, with one SIGTERM, singleton directory included', async () => {
    const { chrome, profile, dir } = await startFake('graceful');
    const { singleton } = readNote(dir);
    expect(existsSync(singleton)).toBe(true);
    await stopChrome(chrome, profile);
    expect(chrome.exitCode).toBe(0);
    expect(readNote(dir).ended).toBe('graceful');
    expect(existsSync(profile)).toBe(false);
    expect(existsSync(singleton)).toBe(false);
  });

  it("SIGKILLs the group of a Chrome that ignores SIGTERM for longer than graceMs", async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { chrome, profile } = await startFake('ignores-sigterm');
    const started = Date.now();
    await stopChrome(chrome, profile, { graceMs: 200 });
    expect(chrome.signalCode).toBe('SIGKILL');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(existsSync(profile)).toBe(false);
    // The SIGKILL came in time: no "did not exit after SIGKILL".
    expect(warn).not.toHaveBeenCalled();
  });

  it('kills a helper that outlives the browser before it deletes the profile', async () => {
    const { chrome, profile, dir } = await startFake('leaves-a-writer');
    const { writer } = readNote(dir);
    await until(() => existsSync(join(profile, 'Default', 'late')), 'the helper to write');
    await stopChrome(chrome, profile);
    await until(() => gone(writer), 'the helper to die');
    await pause(100); // the helper wrote every 20ms while it lived
    expect(existsSync(profile)).toBe(false);
  });

  it('returns at once for a Chrome that has already exited', async () => {
    const { chrome, profile } = await startFake('exits-at-once');
    await exitOf(chrome);
    const started = Date.now();
    await stopChrome(chrome, profile);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(existsSync(profile)).toBe(false);
  });

  // Every Chrome 153 exit on macOS is by a signal, so this is the common case there.
  it('returns at once, and quietly, for a Chrome that a signal already killed', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { chrome, profile } = await startFake('dies-by-signal');
    await exitOf(chrome);
    expect(chrome.signalCode).toBe('SIGKILL');
    const started = Date.now();
    await stopChrome(chrome, profile);
    expect(Date.now() - started).toBeLessThan(250);
    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(profile)).toBe(false);
  });

  // Called in the same tick as spawn(), before the failed spawn has emitted 'error': the one
  // moment its exitCode does not yet say it is gone, and the moment a kill() would signal
  // pid 0, the caller's whole process group. Run in a DETACHED child, its own group, so that
  // a regression kills that child and fails here, instead of killing this test run.
  it('returns at once for a Chrome that never started, without signalling its own group', async () => {
    const dir = await scratchDir();
    const script = join(dir, 'never-started.mjs');
    writeFileSync(
      script,
      `
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { stopChrome } from ${JSON.stringify(HELPER)};
const profile = process.argv[2];
mkdirSync(profile);
const chrome = spawn(profile + '/no-such-chrome', [], { stdio: 'ignore' });
chrome.on('error', () => {});
const started = Date.now();
await stopChrome(chrome, profile);
process.stdout.write(String(Date.now() - started));
`
    );
    const profile = join(dir, 'profile');
    const child = spawn(process.execPath, [script, profile], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    groups.push(child.pid);
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    const [code, signal] = await new Promise((resolve) => child.once('exit', (c, s) => resolve([c, s])));
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(Number(out)).toBeLessThan(1000);
    expect(existsSync(profile)).toBe(false);
  });

  it('sends one SIGTERM however often it is called, since Chrome shuts down well only once', async () => {
    const { chrome, profile, dir } = await startFake('graceful');
    const first = stopChrome(chrome, profile);
    await pause(50);
    const second = stopChrome(chrome, profile);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    // A second SIGTERM would have killed the fake before it could note a graceful end.
    expect(readNote(dir).ended).toBe('graceful');
    expect(chrome.exitCode).toBe(0);
  });

  it('by default waits out a slow shutdown instead of killing it', async () => {
    const { chrome, profile, dir } = await startFake('graceful', { FAKE_CHROME_SHUTDOWN_MS: '800' });
    await stopChrome(chrome, profile);
    expect(chrome.exitCode).toBe(0);
    expect(readNote(dir).ended).toBe('graceful');
  });

  // Root may delete anything, so the failure cannot be staged as root (e.g. in a container).
  it.skipIf(process.getuid?.() === 0)('warns, and does not throw, when the profile cannot be deleted', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parent = await scratchDir();
    const profile = join(parent, 'profile');
    mkdirSync(profile);
    writeFileSync(join(profile, 'Local State'), '{}');
    chmodSync(parent, 0o500);
    const chrome = spawn(join(parent, 'no-such-chrome'), [], { stdio: 'ignore' });
    await new Promise((resolve) => chrome.once('error', resolve));
    await expect(stopChrome(chrome, profile)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`could not remove ${profile}`));
  });

  it.each([
    ['is not named the way Chrome names it', (dir) => join(tmpdir(), `not-chrome-${relative(tmpdir(), dir).slice(-6)}`)],
    ['is named like Chrome\'s but not directly in the temp directory', (dir) => join(dir, 'com.google.Chrome.AbCdEf')]
  ])('leaves a SingletonSocket target alone when it %s', async (_what, where) => {
    const dir = await scratchDir();
    const target = where(dir);
    mkdirSync(target);
    if (!target.startsWith(dir)) dirs.push(target);
    writeFileSync(join(target, 'SingletonSocket'), '');
    const profile = join(dir, 'profile');
    mkdirSync(profile);
    symlinkSync(join(target, 'SingletonSocket'), join(profile, 'SingletonSocket'));
    const chrome = spawn(join(dir, 'no-such-chrome'), [], { stdio: 'ignore' });
    await new Promise((resolve) => chrome.once('error', resolve));
    await stopChrome(chrome, profile);
    expect(existsSync(profile)).toBe(false);
    expect(existsSync(join(target, 'SingletonSocket'))).toBe(true);
  });
});

describe('launchChrome', () => {
  // A script that launches the fake through launchChrome, reports `ready <pid>` once it is up,
  // then idles until signalled - or, by scenario, throws inside a callback, or stops Chrome and
  // exits through exitProcess() as the real scripts do.
  const SCRIPT = `
import { lstatSync } from 'node:fs';
import { exitProcess, launchChrome, stopChrome } from ${JSON.stringify(HELPER)};
const [chromePath, profile, scenario] = process.argv.slice(2);
const chrome = launchChrome({ path: chromePath, port: 0, profile });
const ready = () => { try { return lstatSync(profile + '/SingletonSocket').isSymbolicLink(); } catch { return false; } };
const poll = setInterval(async () => {
  if (!ready()) return;
  clearInterval(poll);
  process.stdout.write('ready ' + chrome.pid + '\\n');
  if (scenario === 'throw') setTimeout(() => { throw new Error('thrown in a callback'); }, 10);
  if (scenario === 'stop-then-exit') {
    process.stdout.write('stopping\\n');
    await stopChrome(chrome, profile);
    exitProcess(0);
  }
}, 10);
setInterval(() => {}, 1000);
`;

  async function runScript({ scenario = 'idle', env = {}, chromePath = fake } = {}) {
    const dir = await scratchDir();
    const script = join(dir, 'script.mjs');
    writeFileSync(script, SCRIPT);
    const profile = join(dir, 'profile');
    const child = spawn(process.execPath, [script, chromePath, profile, scenario], {
      detached: true, // its own group, like a job in a terminal
      stdio: ['ignore', 'pipe', 'pipe'],
      env: fakeEnv(dir, 'graceful', env)
    });
    groups.push(child.pid);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    const waitFor = (line) => until(() => out.includes(line) || child.exitCode !== null || child.signalCode !== null, line);
    return { child, dir, profile, exited, waitFor, output: () => ({ out, err }) };
  }

  const chromePidOf = (out) => Number(/ready (\d+)/.exec(out)[1]);

  it.each([
    ['SIGTERM to the script alone', (child) => process.kill(child.pid, 'SIGTERM'), 'SIGTERM'],
    ['SIGHUP to the script alone', (child) => process.kill(child.pid, 'SIGHUP'), 'SIGHUP'],
    // A terminal Ctrl-C signals the whole foreground group. Chrome, in its own group, does not
    // get it, so it hears exactly one signal: ours.
    ['a Ctrl-C to the whole group', (child) => process.kill(-child.pid, 'SIGINT'), 'SIGINT'],
    // `npm run` and `pnpm run` forward the Ctrl-C to their child as well.
    ['the same Ctrl-C twice, 1ms apart', (child) => {
      process.kill(-child.pid, 'SIGINT');
      setTimeout(() => process.kill(child.pid, 'SIGINT'), 1);
    }, 'SIGINT']
  ])('on %s: stops Chrome gracefully, deletes its profile, then dies by the signal', async (_what, send, signal) => {
    const run = await runScript();
    await run.waitFor('ready');
    const { singleton } = readNote(run.dir);
    groups.push(chromePidOf(run.output().out));
    send(run.child);
    expect(await run.exited).toEqual({ code: null, signal });
    expect(readNote(run.dir).ended).toBe('graceful');
    expect(existsSync(run.profile)).toBe(false);
    expect(existsSync(singleton)).toBe(false);
  });

  it('dies by a signal that arrives while the script is already stopping Chrome', async () => {
    const run = await runScript({ scenario: 'stop-then-exit', env: { FAKE_CHROME_SHUTDOWN_MS: '300' } });
    await run.waitFor('stopping');
    groups.push(chromePidOf(run.output().out));
    process.kill(-run.child.pid, 'SIGINT');
    expect(await run.exited).toEqual({ code: null, signal: 'SIGINT' });
    expect(readNote(run.dir).ended).toBe('graceful');
    expect(existsSync(run.profile)).toBe(false);
  });

  it('kills Chrome and deletes its profile when an exception escapes an event callback', async () => {
    const run = await runScript({ scenario: 'throw' });
    await run.waitFor('ready');
    const chromePid = chromePidOf(run.output().out);
    groups.push(chromePid);
    expect((await run.exited).code).toBe(1);
    expect(run.output().err).toContain('thrown in a callback');
    await until(() => gone(chromePid), 'Chrome to die');
    expect(existsSync(run.profile)).toBe(false);
  });

  it('says why a start failed, deletes the profile and exits 2', async () => {
    const dir = await scratchDir();
    const run = await runScript({ chromePath: join(dir, 'no-such-chrome') });
    mkdirSync(run.profile, { recursive: true });
    expect(await run.exited).toEqual({ code: 2, signal: null });
    expect(run.output().err).toContain('could not start Chrome at');
    expect(existsSync(run.profile)).toBe(false);
  });
});

// A new script copied from an old one would bring the old kill-then-delete order back.
describe('every script that launches Chrome', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'lib' && dir === root ? [] : walk(path);
      return /\.(mjs|js|cjs|ts)$/.test(entry.name) ? [path] : [];
    });
  const launchers = walk(root)
    .map((path) => ({ name: relative(root, path), source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /Google Chrome|process\.env\.CHROME/.test(source));

  it('finds the seven known ones', () => {
    expect(launchers.map(({ name }) => name).sort()).toEqual([
      'render-social-card.mjs',
      'verify-ga.mjs',
      'verify-landing-board.mjs',
      'verify-link-previews.mjs',
      'verify-markets-map.mjs',
      'verify-methodology-link.mjs',
      'verify-section-link.mjs'
    ]);
  });

  it.each(launchers.map(({ name, source }) => [name, source]))('%s launches and stops it through scripts/lib/chrome.mjs', (_name, source) => {
    expect(source).toMatch(/import \{ exitProcess, launchChrome, stopChrome \} from '\.\/lib\/chrome\.mjs';/);
    expect(source).toMatch(/launchChrome\(\{/);
    expect(source).toMatch(/await stopChrome\(chrome, /);
    expect(source).toMatch(/exitProcess\(/);
    expect(source).not.toMatch(/--user-data-dir|spawn\(|\.kill\(|process\.exit\([^2]/);
  });
});
