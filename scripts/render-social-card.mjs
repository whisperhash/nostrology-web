// Render static/social-card.png from scripts/social-card.html.
//
//   node scripts/render-social-card.mjs            # write static/social-card.png
//   node scripts/render-social-card.mjs --check    # render to a temp file, diff, exit 1 if stale
//
// WHY A SCRIPT, when the source is one screenshot away. The card's MCP endpoint is
// BAKED IN as pixels - the one copy of that URL on the whole site that `grep` cannot see.
// It survived the 2026-09-22 host move (dev.nostrolo.gy -> nostrolo.gy) precisely because
// regenerating it was a manual step in a comment, and every automated check was blind to
// it. src/lib/seo/social-card.test.ts now fails when the source's URL drifts from
// PUBLIC_MCP_ENDPOINT's default; this is the other half - the fix that test tells you to
// make, as one command, so the honest path is also the easy one.
//
// Chrome's own `--screenshot` flag is NOT used: on Chrome 141 it dies with "Trying to load
// the allocator multiple times" before writing anything (and exits 0 on some builds, which
// would silently leave the stale PNG in place). This drives CDP instead, the same way
// scripts/verify-ga.mjs does, with node's global WebSocket and no puppeteer dependency.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE = join(ROOT, 'scripts/social-card.html');
const TARGET = join(ROOT, 'static/social-card.png');
/** The size every platform crops its card from; also the source's own body size. */
const WIDTH = 1200;
const HEIGHT = 630;

const check = process.argv.includes('--check');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9800 + (process.pid % 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = await mkdtemp(join(tmpdir(), 'render-social-card-'));
const chrome = launchChrome({
  path: CHROME,
  port: PORT,
  profile,
  args: [
    // Deterministic pixels: no scrollbar, scale 1 (launchChrome already disables the GPU,
    // so there are no GPU rasterization differences either).
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    // The source loads ../static/nostr-logo.png over file://, which Chrome treats as
    // a cross-origin read from a file:// document unless this is allowed.
    '--allow-file-access-from-files',
  ],
});

let ws;
let failed = false;
try {
  let wsUrl;
  for (let i = 0; i < 80; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    if (wsUrl) break;
    await sleep(250);
  }
  if (!wsUrl) throw new Error(`Chrome never exposed CDP on port ${PORT}`);

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP websocket failed'));
  });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        rej(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(i, (msg) => {
        clearTimeout(timer);
        if (msg.error) rej(new Error(`CDP error on ${method}: ${msg.error.message}`));
        else res(msg);
      });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { result: target } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const session = attached.sessionId;

  // Pin the viewport to the card's exact size rather than trusting --window-size, which
  // headless applies to the OS window and not reliably to the layout viewport.
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await send('Page.enable', {}, session);
  await send('Page.navigate', { url: `file://${SOURCE}` }, session);

  // Wait for the load event, not a fixed sleep: the logo is a real file read, and a
  // screenshot taken before it decodes silently produces a card with a missing image.
  const loaded = await (async () => {
    for (let waited = 0; waited < 20000; waited += 100) {
      if (events.some((e) => e.method === 'Page.loadEventFired')) return true;
      await sleep(100);
    }
    return false;
  })();
  if (!loaded) throw new Error('page never fired load');
  // Fonts are the other async resource, and the one that changes layout. The card uses
  // only system faces, so this resolves immediately - but it is the difference between
  // "immediately" and "whenever the screenshot happened to land".
  await send(
    'Runtime.evaluate',
    { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true },
    session,
  );

  const { result: shot } = await send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    session,
  );
  const png = Buffer.from(shot.data, 'base64');
  if (png.length === 0) throw new Error('screenshot came back empty');

  if (check) {
    const current = await readFile(TARGET).catch(() => null);
    if (current && current.equals(png)) {
      console.log(`OK   static/social-card.png matches ${WIDTH}x${HEIGHT} render of the source`);
    } else {
      // Byte equality is strict: a Chrome upgrade can change anti-aliasing and fail this
      // without the card being wrong. That is why --check is a tool you run, not a test
      // that gates CI; the committed test checks the URL, which is what actually rots.
      console.error('STALE static/social-card.png differs from a fresh render of the source');
      console.error('       run: node scripts/render-social-card.mjs');
      failed = true;
    }
  } else {
    await writeFile(TARGET, png);
    console.log(`wrote static/social-card.png (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
  }
} catch (err) {
  console.error(`render-social-card failed: ${err.message}`);
  failed = true;
} finally {
  try {
    ws?.close();
  } catch {
    /* already gone */
  }
  // Waits for Chrome to exit before deleting the profile (see scripts/lib/chrome.mjs).
  await stopChrome(chrome, profile);
}
exitProcess(failed ? 1 : 0);
