// Verify the /marketplaces bubble maps in a real browser: OpenFreeMap basemap drawn, bubbles
// drawn, map code loaded only when a map tab opens - on a deployed site or a local build.
//
//   node scripts/verify-markets-map.mjs https://nostrolo.gy
//   node scripts/verify-markets-map.mjs http://127.0.0.1:3000            # a local `node build`
//   node scripts/verify-markets-map.mjs --shots=/tmp/maps http://127.0.0.1:3000
//
// WHY THIS EXISTS. The maps' failure modes are invisible to every cheaper check. CARTO's
// keyless tiles turned into "API KEY REQUIRED" placeholders served with HTTP 200, so no error
// was ever logged (2026-10-13). MapLibre 6 needs its worker at a URL that only the production
// bundle produces (src/lib/markets/map-libs.ts): get that wrong and the map mounts, draws its
// bubbles, and never draws a tile - again with no error from the page. And jsdom can run none
// of it, so the unit tests stop at a stand-in. Only a browser on the built app sees the truth.
//
// For each of desktop (1440 px) and phone (390 px) width, in a fresh tab:
//   1. Open /marketplaces (the Overview tab) and let it settle. No map code may load: no
//      request to OpenFreeMap and no worker.
//   2. Click Geography, as a visitor does. Wait for its map box to report data-basemap
//      ="ready" (MapLibre went idle with style, tiles and labels drawn) and check: bubbles
//      drawn, a MapLibre canvas, the box's height, OpenFreeMap's attribution, the style, at
//      least one vector tile, the glyphs and the worker all answered 2xx (the worker as
//      JavaScript), and the JavaScript fetched only after the click (the lazy map chunk).
//   3. Click Shipping and check its map the same way.
// Across the whole run: no request to CARTO, none that reached a Google analytics host, no
// page exception, no console error. --shots writes each state's screenshot.
//
// The browser blocks Google's analytics hosts, so a run on the live site is never counted
// there (scripts/lib/google.mjs), and every request carries the User-Agent suffix
// `nozzl-verify-markets-map`, which is how the access log tells it apart. The page itself
// fetches from tiles.openfreemap.org, as every visitor's does.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error. Needs Google
// Chrome (CHROME=/path/to/chrome overrides); runs it headless with SwiftShader for WebGL2.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';
import { blockGoogle, googleLeaks, isBlockedGoogleLog } from './lib/google.mjs';

const args = process.argv.slice(2);
const SHOTS = args.find((a) => a.startsWith('--shots='))?.slice('--shots='.length);
const BASE = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error('usage: node scripts/verify-markets-map.mjs [--shots=<dir>] <base-url>');
  process.exit(2);
}
const ORIGIN = new URL(BASE).origin;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + (process.pid % 500);
const PROFILE = await mkdtemp(join(tmpdir(), 'verify-markets-map-'));
const UA_SUFFIX = 'nozzl-verify-markets-map';

const OFM = 'tiles.openfreemap.org';
const CARTO = /cartocdn\.com|carto\.com/;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000, mobile: false, heights: { geography: 520, shipping: 480 } },
  { name: 'phone', width: 390, height: 844, mobile: true, heights: { geography: 300, shipping: 300 } }
];

if (SHOTS) await mkdir(SHOTS, { recursive: true });
// SwiftShader gives headless Chrome the WebGL2 that MapLibre 6 requires.
const chrome = launchChrome({ path: CHROME, port: PORT, profile: PROFILE, args: ['--enable-unsafe-swiftshader'] });

let ws;
let allGood = true;
try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error(`Chrome never exposed CDP on port ${PORT}`);
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket failed')); });

  let id = 0;
  const pending = new Map();
  const sink = [];
  // MapLibre fetches its vector tiles inside its web workers, which are targets of their own:
  // each page session auto-attaches to the workers it starts (paused until watched), and a
  // worker's session counts as its page's. `family` maps every such session to its page's.
  const family = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (!msg.method) return;
    if (msg.method === 'Target.attachedToTarget' && family.has(msg.sessionId)) {
      const child = msg.params.sessionId;
      family.set(child, family.get(msg.sessionId));
      for (const method of ['Network.enable', 'Runtime.enable']) send(method, {}, child).catch(() => {});
      send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
    }
    sink.push(msg.sessionId && family.has(msg.sessionId) ? { ...msg, sessionId: family.get(msg.sessionId) } : msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(i, (msg) => {
      clearTimeout(timer);
      if (msg.error) rej(new Error(`CDP error on ${method}: ${msg.error.message}`));
      else res(msg.result);
    });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const BROWSER_UA = (await send('Browser.getVersion')).userAgent;

  for (const vp of VIEWPORTS) {
    const problems = [];
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    family.set(s, s);
    await Promise.all(['Network.enable', 'Page.enable', 'Runtime.enable', 'Log.enable'].map((m) => send(m, {}, s)));
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s);
    await send('Network.setUserAgentOverride', { userAgent: `${BROWSER_UA} ${UA_SUFFIX}` }, s);
    // Never counted in Google Analytics, wherever it points: see scripts/lib/google.mjs.
    await blockGoogle(send, s);
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }, s);
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const mine = (from = 0) => sink.slice(from).filter((e) => e.sessionId === s);
    // Network quiet for `quietMs`, bounded at `maxMs`.
    const settle = async (from, quietMs = 1500, maxMs = 30000) => {
      let seen = -1;
      let quietSince = Date.now();
      for (const start = Date.now(); Date.now() - start < maxMs; await sleep(200)) {
        const net = mine(from).filter((e) => e.method.startsWith('Network.'));
        if (net.length !== seen) { seen = net.length; quietSince = Date.now(); }
        const open = new Set();
        for (const e of net) {
          if (e.method === 'Network.requestWillBeSent') open.add(e.params.requestId);
          if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') open.delete(e.params.requestId);
        }
        if (!open.size && Date.now() - quietSince > quietMs) return;
      }
    };
    const requests = (from, to = Infinity) => {
      const evs = mine(from).slice(0, to === Infinity ? undefined : to - from);
      const responses = new Map(evs.filter((e) => e.method === 'Network.responseReceived').map((e) => [e.params.requestId, e.params.response]));
      return evs.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => ({
        url: e.params.request.url, type: e.params.type, response: responses.get(e.params.requestId)
      }));
    };
    const shot = async (label) => {
      if (!SHOTS) return;
      // Grow the viewport to the page first: Chrome's captureBeyondViewport resizes it
      // mid-capture instead, which clears MapLibre's WebGL canvas.
      const h = await evaluate('document.documentElement.scrollHeight');
      await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: h, deviceScaleFactor: 1, mobile: vp.mobile }, s);
      await sleep(2500);
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
      await writeFile(join(SHOTS, `${vp.name}-${label}.png`), Buffer.from(data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }, s);
    };

    // 1. Overview: no map code.
    const start = sink.length;
    await send('Page.navigate', { url: `${BASE}/marketplaces` }, s);
    for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector('#tab-geography')`).catch(() => false)); i++) await sleep(200);
    await settle(start);
    const doc = mine(start).find((e) => e.method === 'Network.responseReceived' && e.params.type === 'Document');
    if (!doc || doc.params.response.status !== 200) problems.push(`document: ${doc ? doc.params.response.status : 'no response'}`);
    const overview = requests(start);
    if (overview.some((r) => r.url.includes(OFM))) problems.push('overview: requested OpenFreeMap before any map tab was opened');
    if (overview.some((r) => /\/workers\//.test(r.url))) problems.push('overview: loaded the map worker before any map tab was opened');
    const overviewScripts = new Set(overview.filter((r) => r.type === 'Script').map((r) => r.url));

    // 2 and 3: each map tab, opened by a click.
    const results = {};
    for (const tab of ['geography', 'shipping']) {
      const from = sink.length;
      await evaluate(`document.querySelector('#tab-${tab}').click()`);
      let status = null;
      for (let i = 0; i < 300; i++) {
        status = await evaluate(`document.querySelector('#panel-${tab} [data-basemap]')?.dataset.basemap ?? null`).catch(() => null);
        if (status === 'ready' || status === 'failed' || status === 'unavailable') break;
        await sleep(200);
      }
      await settle(from);
      const dom = await evaluate(`(() => {
        const el = document.querySelector('#panel-${tab} .markets-map');
        return el && {
          height: Math.round(el.getBoundingClientRect().height),
          bubbles: el.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive').length,
          glCanvas: !!el.querySelector('.leaflet-gl-layer canvas'),
          attribution: el.querySelector('.leaflet-control-attribution')?.textContent ?? ''
        };
      })()`);
      const reqs = requests(from);
      const ok = (r) => r.response && r.response.status >= 200 && r.response.status < 300;
      const style = reqs.filter((r) => r.url.startsWith(`https://${OFM}/styles/`));
      const tiles = reqs.filter((r) => r.url.startsWith(`https://${OFM}/planet`) && /\/\d+\/\d+\/\d+\.pbf/.test(r.url));
      const glyphs = reqs.filter((r) => r.url.startsWith(`https://${OFM}/fonts/`));
      const worker = requests(start).filter((r) => /\/workers\/maplibre-gl-worker[^/]*\.js$/.test(r.url));
      const lazy = requests(start).filter((r) => r.type === 'Script' && !overviewScripts.has(r.url) && r.url.startsWith(ORIGIN));

      const p = [];
      if (status !== 'ready') p.push(`data-basemap is ${status}, not ready`);
      if (!dom) p.push('no map box');
      else {
        if (!dom.bubbles) p.push('no bubbles drawn');
        if (!dom.glCanvas) p.push('no MapLibre canvas');
        if (dom.height !== vp.heights[tab]) p.push(`box is ${dom.height}px tall, expected ${vp.heights[tab]}`);
        for (const credit of ['OpenFreeMap', 'OpenMapTiles', 'OpenStreetMap']) {
          if (!dom.attribution.includes(credit)) p.push(`attribution lacks ${credit}: "${dom.attribution}"`);
        }
      }
      // A tab opened second may reuse what the first already fetched (style, glyphs,
      // worker, chunk); only the first must show them on the wire.
      if (tab === 'geography') {
        if (!style.length || !style.every(ok)) p.push(`style: ${style.map((r) => r.response?.status ?? 'no answer').join(',') || 'never requested'}`);
        if (!glyphs.length || !glyphs.every(ok)) p.push(`glyphs: ${glyphs.map((r) => r.response?.status ?? 'no answer').join(',') || 'never requested'}`);
        if (!lazy.length) p.push('no JavaScript loaded on opening the tab: the map code was not lazy');
      }
      if (!tiles.length && tab === 'geography') p.push('no vector tile requested');
      if (tiles.some((r) => r.response && !ok(r))) p.push(`tiles answered ${[...new Set(tiles.filter((r) => r.response && !ok(r)).map((r) => r.response.status))]}`);
      // MapLibre starts a small pool of workers from the one URL: one request or several.
      if (!worker.length || !worker.every((r) => ok(r) && /javascript/.test(r.response.mimeType))) {
        p.push(`worker: ${worker.map((r) => `${r.response?.status} ${r.response?.mimeType}`).join(',') || 'never requested'}`);
      }
      results[tab] = { status, ...dom, tiles: tiles.length, lazyScripts: lazy.length };
      problems.push(...p.map((x) => `${tab}: ${x}`));
      await shot(tab);
    }

    // Across the run.
    const all = requests(start);
    if (all.some((r) => CARTO.test(r.url))) problems.push(`requested CARTO: ${all.filter((r) => CARTO.test(r.url)).map((r) => r.url)[0]}`);
    const leaks = googleLeaks(mine(start));
    if (leaks.length) problems.push(`reached a Google analytics host: ${leaks[0]}`);
    // A rejection that the page handles a moment later is reported thrown, then revoked
    // ("Handler added to rejected promise"); only the ones never revoked count.
    const revoked = new Set(mine(start).filter((e) => e.method === 'Runtime.exceptionRevoked').map((e) => e.params.exceptionId));
    for (const e of mine(start)) {
      if (e.method === 'Runtime.exceptionThrown' && !revoked.has(e.params.exceptionDetails.exceptionId)) problems.push('exception: ' + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).split('\n')[0]);
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') problems.push('console.error: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !isBlockedGoogleLog(e.params.entry)) problems.push(`log: ${e.params.entry.text} ${e.params.entry.url ?? ''}`.slice(0, 240));
    }
    await send('Target.closeTarget', { targetId });

    const good = problems.length === 0;
    allGood &&= good;
    console.log(`${good ? 'OK  ' : 'BAD '} ${vp.name.padEnd(8)} ${JSON.stringify(results)}`);
    for (const p of problems) console.log(`       ${p}`);
  }
} catch (err) {
  console.error(`verify-markets-map FAILED: ${err.message}`);
  allGood = false;
} finally {
  try { ws?.close(); } catch { /* closing */ }
  await stopChrome(chrome, PROFILE);
}
exitProcess(allGood ? 0 : 1);
