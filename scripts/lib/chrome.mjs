// Launching and stopping the headless Chrome that scripts/verify-ga.mjs,
// scripts/verify-markets-map.mjs, scripts/verify-link-previews.mjs and
// scripts/render-social-card.mjs drive over CDP, and
// deleting the throwaway profile (--user-data-dir) it runs with - however the script ends:
// normally, by a failed start, by Ctrl-C, SIGTERM or SIGHUP, or by an exception that skips
// the caller's `finally`.
//
// WAIT FOR THE EXIT, THEN DELETE. `ChildProcess.kill()` only SENDS a signal; Chrome then
// spends a moment shutting down and writes into its profile while it does (its disk-cache
// index, network state, TransportSecurity). Both scripts used to delete the profile straight
// after kill(), and Chrome recreated it: measured 2026-09-25 on Chrome 153, once the profile
// had something to write it came back 215-270ms after the kill in 15 of 15 runs, which is how
// leftover profiles piled up in /tmp and $TMPDIR. Deleted only after the exit: 0 of 35.
//
// CHROME GETS ITS OWN PROCESS GROUP, as puppeteer launches it. In ours, a terminal Ctrl-C or
// a `timeout` would signal Chrome directly as well, and our SIGTERM would then be its second
// signal - Chrome shuts down gracefully on the first only - so it would die mid-shutdown; a
// SIGKILL of the browser alone would also leave its helper processes running. Detached, it
// leads a group holding itself and every helper, and only this module signals that group.
//
// CHROME'S OWN LITTER. Chrome 153 on macOS crashes on the way out (SIGSEGV or SIGBUS),
// whether it gets SIGTERM or a CDP Browser.close, so an exit by signal is normal here. What
// the crash leaves that can be traced to this run is removed as well: the temporary directory
// the profile's SingletonSocket link points into. The rest is left alone - a crash dump under
// ~/Library, a clone of the app bundle under /var/folders/.../X/, a url_fetcher directory in
// $TMPDIR - because those paths hold a real user's Chrome data when a person runs these
// scripts. The two --disable-* flags below stop the component downloads that left more.
import { spawn } from 'node:child_process';
import { lstatSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

// THE PID CHECK IS A SAFETY GUARD. A spawn that failed (ENOENT) has no pid and never emits
// 'exit'; its exitCode becomes the negative errno only when its 'error' is emitted, a tick
// after spawn(). In that tick kill() is worse than useless: Node passes libuv's unset pid,
// 0, to kill(2), which signals the CALLER'S WHOLE PROCESS GROUP (verified on Node 20 and 25).
const isRunning = (chrome) =>
  chrome.pid !== undefined && chrome.exitCode === null && chrome.signalCode === null;

// Signal Chrome's whole process group: the browser and every helper it started. The pid must
// be positive - process.kill(-0) would signal THIS script's own group.
function signalGroup(chrome, signal) {
  if (!(chrome.pid > 0)) return;
  try {
    process.kill(-chrome.pid, signal);
  } catch {
    /* the group is gone already */
  }
}

// The temporary directory Chrome created for this launch's SingletonSocket: the profile links
// to <tmpdir>/com.google.Chrome.XXXXXX/SingletonSocket. Only an absolute link into a
// directory named the way Chrome names it, directly under the temp directory, counts - so an
// unexpected link can never make this delete anything else.
function singletonDir(profile) {
  try {
    const link = join(profile, 'SingletonSocket');
    if (!lstatSync(link).isSymbolicLink()) return null;
    const target = readlinkSync(link);
    if (!isAbsolute(target)) return null;
    const dir = dirname(target);
    if (!/^\.?(com\.google\.Chrome|org\.chromium\.Chromium)\.[A-Za-z0-9]{6}$/.test(basename(dir))) return null;
    return realpathSync(dirname(dir)) === realpathSync(tmpdir()) ? dir : null;
  } catch {
    return null;
  }
}

// The profile first: the link that names the singleton directory lives inside it.
function litter(profile) {
  const singleton = singletonDir(profile);
  return singleton ? [profile, singleton] : [profile];
}

function removeSync(profile) {
  for (const dir of litter(profile)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`could not remove ${dir}: ${err.message}`);
    }
  }
}

// Whether `promise` settles within `ms`.
async function settlesWithin(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, false);
  });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function stop(chrome, profile, graceMs) {
  if (isRunning(chrome)) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    // The browser process alone, and once: its first signal is its graceful shutdown.
    chrome.kill('SIGTERM');
    if (!(await settlesWithin(exited, graceMs))) {
      signalGroup(chrome, 'SIGKILL');
      if (!(await settlesWithin(exited, graceMs))) {
        console.error(`Chrome (pid ${chrome.pid}) did not exit after SIGKILL; removing its profile anyway`);
      }
    }
  }
  // Any helper that outlived the browser goes too, so nothing writes into the profile while
  // it is deleted.
  signalGroup(chrome, 'SIGKILL');
  for (const dir of litter(profile)) {
    try {
      // Retried in case something is still writing into a directory (ENOTEMPTY).
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (err) {
      console.error(`could not remove ${dir}: ${err.message}`);
    }
  }
}

const stops = new WeakMap();

/**
 * Stop `chrome` (from launchChrome) and then delete `profile`: SIGTERM, and SIGKILL to its
 * whole group if it is still running after `graceMs`. Every call for the same Chrome returns
 * the SAME promise, so a signal handler and a `finally` racing each other send one SIGTERM
 * between them. Never throws - a cleanup failure must not replace the script's own result -
 * but says so on stderr.
 */
export function stopChrome(chrome, profile, { graceMs = 5000 } = {}) {
  if (!stops.has(chrome)) stops.set(chrome, stop(chrome, profile, graceMs));
  return stops.get(chrome);
}

// The first stopping signal this process received, and when.
let received = null;
// `npm run` and `pnpm run` pass a terminal Ctrl-C on to their child on top of the one the
// terminal sends the whole group, so one keypress arrives twice, about 1ms apart.
const REPEAT_MS = 1000;

// Die by `signal` rather than exit(128 + n): a shell running this in a loop only stops the
// loop for a child the signal killed.
function dieBy(signal) {
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  // Only if the signal is ignored at the OS level (an inherited SIG_IGN).
  setTimeout(() => process.exit(128 + constants.signals[signal]), 1000);
}

function stopOnSignals(chrome, profile) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (!received) {
        received = { signal, at: Date.now() };
        void stopChrome(chrome, profile).finally(() => dieBy(signal));
      } else if (Date.now() - received.at >= REPEAT_MS) {
        // A deliberate second signal: stop waiting for Chrome.
        signalGroup(chrome, 'SIGKILL');
        removeSync(profile);
        dieBy(received.signal);
      }
    });
  }
}

/**
 * Start headless Chrome on `port` with `profile` as its user-data directory, plus `args`.
 * A start that fails prints why and exits 2, the profile deleted. From here on SIGINT,
 * SIGTERM and SIGHUP stop Chrome and delete the profile before this process dies by that
 * signal, and a synchronous backstop on 'exit' kills Chrome's group and deletes the profile
 * if the caller's own stopChrome() never ran (an exception thrown in an event callback exits
 * without running any `finally`).
 */
export function launchChrome({ path, port, profile, args = [] }) {
  const chrome = spawn(
    path,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--disable-gpu',
      '--disable-component-update',
      '--disable-background-networking',
      ...args,
      'about:blank'
    ],
    { stdio: 'ignore', detached: true }
  );
  chrome.on('error', (err) => {
    console.error(`could not start Chrome at ${path}: ${err.message}`);
    console.error('install Google Chrome, or set CHROME=/path/to/chrome');
    process.exit(2); // the 'exit' backstop below deletes the profile
  });
  process.once('exit', () => {
    if (isRunning(chrome)) signalGroup(chrome, 'SIGKILL');
    removeSync(profile);
  });
  stopOnSignals(chrome, profile);
  return chrome;
}

/**
 * Exit with `code` - unless a stopping signal arrived during the run, in which case die by
 * it, as the signal handler would have. For the script's last line, after stopChrome().
 */
export function exitProcess(code) {
  if (received) dieBy(received.signal);
  else process.exit(code);
}
