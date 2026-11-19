// Verify the landing's board in a real browser - on the deployed site or a local server.
//
//   node scripts/verify-landing-board.mjs https://nostrolo.gy
//   node scripts/verify-landing-board.mjs http://127.0.0.1:5173            # `pnpm dev`, see below
//   node scripts/verify-landing-board.mjs --shots=/tmp/board http://127.0.0.1:5173
//
// WHY THIS EXISTS. jsdom has no layout, so the unit tests stop at the markup: they cannot see an
// end label placed on top of a line or the figure band, a hover readout that never appears, a
// tab that opens a panel of zero height, or the MCP bar pushed below the fold. Only a browser
// sees those, and the board's charts are its whole point.
//
// At each of four viewports (1440 x 790, a laptop's 1280 x 690, a tablet, a phone), in a fresh
// tab, on `/`:
//   1. The board: five tabs, Marketplaces open on load, every panel's data live (data-live; a
//      panel showing its typed fallback means the landing cache has not loaded that source).
//   2. Each tab in turn, clicked as a visitor does: exactly its panel shows, its chart has a
//      size and a drawn line, its figure is the tab's figure, every end label shown sits
//      inside the plot, clear of the other labels and of the figure band, and no line runs
//      under the figure band (from 1000 px the band sits over the chart's top-left corner).
//   3. A hover over the chart's middle shows the readout (a day and a value) and a leave hides it.
//   4. At the two desktop sizes the MCP bar ends above the fold; at every size nothing scrolls
//      sideways.
//   5. The type the operator set on 2026-10-15: The machine surface's line under its heading in
//      the headline sub-line's size, and Git-on-Nostr's "observation began" upright.
// The four viewports run with reduced motion, so the charts hold still while they are measured.
// One more tab, at 1440 x 790 with motion, checks what a visitor with animation sees: once the
// animation library has loaded (has-gsap), the board ends visible and the figure counts up to
// exactly the server's.
// Across the whole run: no page exception, no console error, and no request that reached a
// Google analytics host. --shots writes each state's screenshot.
//
// LOCALLY, run the app with the board's real inputs and no database (a dev-only seam in
// $lib/server/landing; ignored by every build). `pnpm dev`, not `vite dev` alone: it copies GSAP's
// files into static/vendor/ first, and without them the motion check finds no has-gsap:
//   LANDING_FIXTURE=src/lib/landing/fixtures/board-inputs-2026-10-15.json.gz \
//     AUTH_SESSION_SECRET=$(openssl rand -hex 32) \
//     DATABASE_URL=postgresql://u:p@db.invalid:5432/x pnpm dev --port 5173
//
// The browser blocks Google's analytics hosts, so a run on the live site is never counted there
// (scripts/lib/google.mjs), and every request carries the User-Agent suffix
// `nozzl-verify-landing-board`, which is how the access log tells it apart.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error. Needs Google Chrome
// (CHROME=/path/to/chrome overrides).
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';
import { blockGoogle, googleLeaks } from './lib/google.mjs';

const args = process.argv.slice(2);
const SHOTS = args.find((a) => a.startsWith('--shots='))?.slice('--shots='.length);
const BASE = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error('usage: node scripts/verify-landing-board.mjs [--shots=<dir>] <base-url>');
  process.exit(2);
}
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + (process.pid % 500);
const PROFILE = await mkdtemp(join(tmpdir(), 'verify-landing-board-'));
const UA_SUFFIX = 'nozzl-verify-landing-board';
const KEYS = ['zapstore', 'marketplaces', 'git', 'lightning', 'nutzaps'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 790, mobile: false, fold: true },
  { name: 'laptop', width: 1280, height: 690, mobile: false, fold: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true, fold: false },
  { name: 'phone', width: 390, height: 660, mobile: true, fold: false }
];

let failures = 0;
const ok = (m) => console.log(`ok   ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`FAIL ${m}`);
};
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const chrome = launchChrome({ path: CHROME, port: PORT, profile: PROFILE });
let ws;
try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  if (!wsUrl) throw new Error('Chrome did not start');
  ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else events.push(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  for (const vp of VIEWPORTS) {
    const tag = vp.name;
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    const since = events.length;
    await send('Page.enable', {}, s);
    await send('Runtime.enable', {}, s);
    await send('Network.enable', {}, s);
    const { userAgent } = await send('Browser.getVersion');
    await send('Network.setUserAgentOverride', { userAgent: `${userAgent} ${UA_SUFFIX}` }, s);
    await blockGoogle(send, s);
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }, s);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    await send('Page.navigate', { url: `${BASE}/` }, s);
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (events.slice(since).some((e) => e.sessionId === s && e.method === 'Page.loadEventFired')) break;
    }
    await sleep(800);
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const shot = async (name) => {
      if (!SHOTS) return;
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
      await writeFile(join(SHOTS, `${tag}-${name}.png`), Buffer.from(data, 'base64'));
    };

    // The document response.
    const doc = events.slice(since).find((e) => e.sessionId === s && e.method === 'Network.responseReceived' && e.params.type === 'Document');
    if (!doc || doc.params.response.status !== 200) fail(`${tag}: / answered ${doc?.params.response.status}`);

    // 1. The board.
    const board = await ev(`(() => {
      const tabs = [...document.querySelectorAll('.board-tabs [role="tab"]')];
      const panels = [...document.querySelectorAll('.board-panel')];
      return {
        tabs: tabs.map((t) => t.dataset.key),
        selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.key),
        shown: panels.filter((p) => !p.hidden).map((p) => p.dataset.key),
        live: panels.map((p) => p.dataset.key + '=' + p.dataset.live),
        // the reveal gate: with reduced motion nothing animates, so the hero must simply show
        hidden: [...document.querySelectorAll('.hero .rv')].filter((el) => getComputedStyle(el).opacity !== '1').map((el) => el.className.split(' ')[0])
      };
    })()`);
    board.hidden.length === 0 ? ok(`${tag}: the board and the hero show (opacity 1)`) : fail(`${tag}: hidden by the reveal gate: ${board.hidden}`);
    JSON.stringify(board.tabs) === JSON.stringify(KEYS) ? ok(`${tag}: five tabs in the nav's order`) : fail(`${tag}: tabs ${board.tabs}`);
    board.selected.join() === 'marketplaces' && board.shown.join() === 'marketplaces'
      ? ok(`${tag}: Marketplaces open on load`)
      : fail(`${tag}: open on load ${JSON.stringify(board)}`);
    board.live.every((x) => x.endsWith('=true')) ? ok(`${tag}: every panel's data is live`) : fail(`${tag}: not live: ${board.live.filter((x) => !x.endsWith('=true'))}`);
    await shot('load');

    // 2. Each tab in turn.
    for (const key of KEYS) {
      await ev(`document.querySelector('.board-tabs [data-key="${key}"]').click()`);
      await sleep(250);
      const p = await ev(`(() => {
        const shown = [...document.querySelectorAll('.board-panel')].filter((x) => !x.hidden);
        const panel = shown[0];
        const plot = panel && panel.querySelector('.hc .plot');
        const pr = plot ? plot.getBoundingClientRect() : null;
        const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.hidden && r.width > 0 && r.height > 0; };
        const labels = plot ? [...plot.querySelectorAll('.hend')].filter(vis).map((el) => el.getBoundingClientRect()) : [];
        const avoid = panel ? [...panel.querySelectorAll('[data-hc-avoid]')].filter(vis).map((el) => el.getBoundingClientRect()) : [];
        const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const problems = [];
        labels.forEach((a, i) => {
          if (a.top < pr.top - 1 || a.bottom > pr.bottom + 1 || a.right > pr.right + 1) problems.push('label ' + i + ' outside the plot');
          labels.slice(i + 1).forEach((b, j) => { if (hit(a, b)) problems.push('labels ' + i + ' and ' + (i + j + 1) + ' overlap'); });
          avoid.forEach((b) => { if (hit(a, b)) problems.push('label ' + i + ' over the band'); });
        });
        // Every line, sampled along its length in screen space, against the band's text and link.
        let under = 0;
        if (plot) for (const path of plot.querySelectorAll('path.hl')) {
          const m = path.getScreenCTM();
          const len = path.getTotalLength();
          for (let d = 0; m && d <= len; d += 4) {
            const q = path.getPointAtLength(d);
            const pt = new DOMPoint(q.x, q.y).matrixTransform(m);
            if (avoid.some((b) => pt.x > b.left && pt.x < b.right && pt.y > b.top && pt.y < b.bottom)) under += 1;
          }
        }
        const tabN = document.querySelector('.board-tabs [data-key="${key}"] .bt-n').firstChild.textContent.trim();
        return {
          shown: shown.map((x) => x.dataset.key),
          w: pr ? Math.round(pr.width) : 0,
          h: pr ? Math.round(pr.height) : 0,
          line: plot ? Math.round(plot.querySelector('path.hl:not(.faded)')?.getTotalLength?.() ?? 0) : 0,
          figure: panel ? panel.querySelector('.bo-n').textContent.trim() : '',
          tabN,
          lines: plot ? plot.querySelectorAll('path.hl:not(.faded)').length : 0,
          labels: labels.length,
          under,
          problems
        };
      })()`);
      const tagK = `${tag} ${key}`;
      p.shown.join() === key ? null : fail(`${tagK}: panels shown ${p.shown}`);
      p.w > 200 && p.h > 100 && p.line > 0 ? null : fail(`${tagK}: chart ${p.w} x ${p.h}, line ${p.line}`);
      p.figure === p.tabN ? null : fail(`${tagK}: figure ${p.figure} vs tab ${p.tabN}`);
      // A one-line chart always has room for its value; where lines crowd (Lightning's five on a
      // phone) a label with no clear spot is hidden, and the caption row names the series.
      const labelsOk = (p.labels > 0 || p.lines > 1) && p.problems.length === 0;
      labelsOk ? null : fail(`${tagK}: end labels ${p.labels} of ${p.lines} line(s): ${p.problems.join('; ')}`);
      p.under === 0 ? null : fail(`${tagK}: ${p.under} point(s) of the lines run under the figure band`);
      if (p.shown.join() === key && p.w > 200 && p.figure === p.tabN && labelsOk && p.under === 0) {
        ok(`${tagK}: shows its own chart (${p.w} x ${p.h}), figure ${p.figure}, ${p.labels} of ${p.lines} end label(s), all clear, no line under the band`);
      }
      await shot(key);

      // 3. The hover readout, over the chart's middle.
      const box = await ev(`(() => { const r = [...document.querySelectorAll('.board-panel')].find((x) => !x.hidden).querySelector('.hc .plot').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.7 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' }, s);
      await sleep(150);
      const tip = await ev(`(() => { const t = [...document.querySelectorAll('.board-panel')].find((x) => !x.hidden).querySelector('.htip'); return t ? t.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, pointerType: 'mouse' }, s);
      await sleep(150);
      const gone = await ev(`document.querySelectorAll('.htip').length === 0`);
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(tip ?? '') && /\d/.test((tip ?? '').slice(12)) && gone
        ? ok(`${tagK}: hover reads "${(tip ?? '').slice(0, 70)}", gone on leave`)
        : fail(`${tagK}: hover ${JSON.stringify(tip)}, gone after leave: ${gone}`);
    }

    // 4. The fold and the sideways scroll.
    await ev(`document.querySelector('.board-tabs [data-key="marketplaces"]').click()`);
    await sleep(200);
    const page = await ev(`({ bar: Math.round(document.querySelector('.mcpbar').getBoundingClientRect().bottom), over: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    if (vp.fold) page.bar <= vp.height ? ok(`${tag}: MCP bar ends at ${page.bar} of ${vp.height}, above the fold`) : fail(`${tag}: MCP bar ends at ${page.bar}, below the fold (${vp.height})`);
    page.over <= 0 ? ok(`${tag}: nothing scrolls sideways`) : fail(`${tag}: page scrolls sideways by ${page.over} px`);

    // 5. The type.
    const type = await ev(`(() => {
      const fs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : null; };
      const wall = document.querySelector('.board-panel[data-key="git"] .hwall span');
      return { sub: fs('.hero .sub'), lead: fs('#connect .lead'), wall: wall ? getComputedStyle(wall).fontStyle : null };
    })()`);
    type.sub && type.lead === type.sub
      ? ok(`${tag}: The machine surface's line is the headline sub-line's size (${type.lead})`)
      : fail(`${tag}: The machine surface's line is ${type.lead}, the headline sub-line ${type.sub}`);
    type.wall === 'normal' ? ok(`${tag}: "observation began" is upright`) : fail(`${tag}: "observation began" is ${type.wall}`);

    // Errors and analytics, for this tab's whole life.
    const mine = events.slice(since).filter((e) => e.sessionId === s);
    const thrown = mine.filter((e) => e.method === 'Runtime.exceptionThrown').length - mine.filter((e) => e.method === 'Runtime.exceptionRevoked').length;
    const consoleErrors = mine.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error').map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '));
    thrown <= 0 && consoleErrors.length === 0 ? ok(`${tag}: no page exception, no console error`) : fail(`${tag}: ${thrown} exception(s); console: ${consoleErrors.join(' | ').slice(0, 300)}`);
    const ga = googleLeaks(mine).length;
    ga === 0 ? ok(`${tag}: nothing reached Google analytics`) : fail(`${tag}: ${ga} request(s) reached Google analytics`);
    await send('Target.closeTarget', { targetId });
  }

  // 6. With motion: the reveal gate hides the board until the animation shows it.
  {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    const since = events.length;
    await send('Page.enable', {}, s);
    await send('Runtime.enable', {}, s);
    const { userAgent } = await send('Browser.getVersion');
    await send('Network.setUserAgentOverride', { userAgent: `${userAgent} ${UA_SUFFIX}` }, s);
    await blockGoogle(send, s);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false }, s);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await send('Page.navigate', { url: `${BASE}/` }, s);
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (events.slice(since).some((e) => e.sessionId === s && e.method === 'Page.loadEventFired')) break;
    }
    // The animation's end, not a moment of it: up to 12 s (a dev server hydrates slowly).
    let m;
    for (let i = 0; i < 48; i++) {
      await sleep(250);
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const panel = [...document.querySelectorAll('.board-panel')].find((x) => !x.hidden);
          return {
            gsap: document.documentElement.classList.contains('has-gsap'),
            board: getComputedStyle(document.querySelector('.board')).opacity,
            figure: panel.querySelector('.bo-n').textContent.trim(),
            tab: document.querySelector('.board-tabs [data-key="' + panel.dataset.key + '"] .bt-n').firstChild.textContent.trim()
          };
        })()`,
        returnByValue: true
      }, s);
      m = r.result.value;
      if (m.gsap && m.board === '1' && m.figure === m.tab) break;
    }
    m.gsap && m.board === '1' && m.figure === m.tab
      ? ok(`motion: the animation ran and left the board visible, the figure counted up to ${m.figure}`)
      : fail(`motion: ${JSON.stringify(m)}`);
    await send('Target.closeTarget', { targetId });
  }
} catch (err) {
  fail(String(err?.stack ?? err));
} finally {
  try {
    ws?.close();
  } catch {
    // closing
  }
  await stopChrome(chrome, PROFILE);
}
console.log(failures ? `${failures} check(s) FAILED` : 'every check passed');
exitProcess(failures ? 1 : 0);
