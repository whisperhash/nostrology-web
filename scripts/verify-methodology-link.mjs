// Verify What is counted's address in a real browser - on the deployed site or a local build.
// One per domain page: `<domain>/methodology` opens the page on the pill that holds its "What
// is counted" section, expanded, just under the nav (CLAUDE.md -> "Every domain page's What is
// counted has an address"; the rules are $lib/methodology and $lib/domain-page).
//
//   node scripts/verify-methodology-link.mjs https://nostrolo.gy
//   node scripts/verify-methodology-link.mjs http://127.0.0.1:3000      # a local `node build`
//   node scripts/verify-methodology-link.mjs --shots=/tmp/meth http://127.0.0.1:3000
//
// WHY THIS EXISTS. The link is a LINK: what it is worth is where the page ends up, and jsdom
// has no layout, so the unit tests can only check that scrollTo was called with a number they
// computed from geometry they invented. They cannot see the section left behind the sticky
// nav, a scroll that the browser's own anchor jump wins back, or a <details> that hydration
// re-closes. The wire check is here for the same reason in reverse: the section must be in the
// SERVER's HTML - closed at the domain's own address, so search engines index the page as it
// reads, and open at its own, so the address works for a visitor with no JavaScript.
//
// Per page (/git, /marketplaces, /routstr) at a desktop and a phone width, in a fresh tab:
//   1. `<domain>/methodology` cold: the Overview panel, the section OPEN, its top clear of the
//      sticky nav (and the nav's own height measured, not assumed), the page scrolled, the
//      address unchanged.
//   2. `<domain>` plain: the section CLOSED and the page at the top - normal navigation is
//      exactly as it was before the address existed.
//   3. An OLD `<domain>#methodology` link followed while the page is open (`location.hash =
//      ...`, a jump within the page): the section opens, the page scrolls to it, and the
//      address becomes `<domain>/methodology` ($lib/legacy-hash).
//   4. From ANOTHER pill's address (/git/hosting, /marketplaces/geography, /routstr/providers),
//      the old link the same way: the page switches to Overview and opens the section there.
//   5. The visitor's own toggle: a click on the summary closes it and leaves the address bar
//      alone (only an address opens the section; a toggle writes none). Then Back returns to
//      the page the old link of step 3 was followed on, at its own address.
//   6. An in-app LINK to `<domain>/methodology` from the other domain page - a SvelteKit
//      client-side navigation, the one path with a scroll of the router's own (scrollIntoView,
//      then reset_focus from a timer) that the page has to land after. Nothing on the site
//      links there yet, so the link is created in the page and clicked.
//   7. The LINK ICON on the section's head (MethodologySection), with a real pointer, the
//      real clipboard read back, and real keys, on a page loaded WITH a query string (which
//      neither the copy nor the icon's href may carry). Desktop: invisible AND untouchable
//      at rest; hovering anywhere on the head - the card's top padding as well as the
//      heading - draws it at the card's far right, level with the heading (closed) and in
//      its top-right corner (open); it survives the pointer crossing onto it; its resolved
//      href and a click both give exactly `<origin><domain>/methodology`, and the click
//      changes nothing else - the section's open state, the address bar, the scroll; the
//      tick outlives the pointer leaving, then the icon goes; Shift+Tab from the summary
//      focuses it, which draws it, and Enter copies. Then a FINGER on that desktop (a touch
//      laptop: `(hover: hover)` still on, so the tap's hover arms the icon under it): a tap
//      where it sits toggles the section and copies nothing, twice.
//      Phone, with touch emulated (and checked to have turned `(hover: hover)` off, or the
//      check would be vacuous): never drawn, and a tap where it sits toggles the section and
//      copies nothing - the invisible-tap-target hazard the hover gate exists to prevent.
// Plus, once per page, a wire check of the server's HTML: at `<domain>` one <details> carrying
// id="methodology", with no `open` attribute, its content present while closed, and the icon a
// plain link to `<domain>/methodology`; at `<domain>/methodology` the same <details> OPEN, the
// page title naming the section and the page naming itself as its canonical address; and, per
// page, at least one check that landed the section EXACTLY under the nav rather than at the
// page's scroll end (a short document can only scroll so far, and that case would pass with
// the page's own scroll deleted).
// Across the whole run: no page exception, no console error, and no request that reached a
// Google analytics host.
//
// PAGES below is hand-kept, and deliberately short: it is the browser half. What stops a NEW
// domain page from skipping the convention altogether is src/routes/methodology-coverage.test.ts,
// which derives its list from the filesystem.
//
// The browser blocks Google's analytics hosts, so a run on the live site is never counted there
// (scripts/lib/google.mjs), and every request carries the User-Agent suffix
// `nozzl-verify-methodology`, which is how the access log tells it apart.
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
  console.error('usage: node scripts/verify-methodology-link.mjs [--shots=<dir>] <base-url>');
  process.exit(2);
}
const ORIGIN = new URL(BASE).origin;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + (process.pid % 500);
const PROFILE = await mkdtemp(join(tmpdir(), 'verify-methodology-'));
const UA_SUFFIX = 'nozzl-verify-methodology';

// Every domain page carrying the section, with one other pill to arrive from, a string its
// closed content must hold on the wire, and its page title.
const PAGES = [
  { path: '/git', otherTab: 'hosting', content: 'The exclusion ledger', title: 'Nostrology - Git on Nostr' },
  { path: '/marketplaces', otherTab: 'geography', content: 'Live listings', title: 'Nostrology - Nostr Marketplaces' },
  // hidden from the nav and the sitemap, but on the convention since 2026-10-18
  { path: '/routstr', otherTab: 'providers', content: 'Providers in the aggregates', title: 'Nostrology - Routstr' }
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true }
];

let failures = 0;
const ok = (m) => console.log(`ok   ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`FAIL ${m}`);
};
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// 0. THE WIRE: the section is in the server's HTML - closed at the domain's own address, with its
// content and the icon's plain link, and open at its own address, which names itself.
const fetchPage = (path) =>
  fetch(`${BASE}${path}`, {
    headers: { 'user-agent': `Mozilla/5.0 ${UA_SUFFIX}` },
    redirect: 'manual'
  });
for (const p of PAGES) {
  try {
    const res = await fetchPage(p.path);
    const body = await res.text();
    const tags = [...body.matchAll(/<details[^>]*>/g)].map((m) => m[0]);
    const anchored = tags.filter((t) => t.includes('id="methodology"'));
    const icons = [...body.matchAll(/<a[^>]*data-methodology-link[^>]*>/g)].map((m) => m[0]);
    if (res.status !== 200) fail(`wire ${p.path}: answered ${res.status}`);
    else if (anchored.length !== 1) fail(`wire ${p.path}: ${anchored.length} <details id="methodology"> in the server HTML`);
    else if (/\sopen\b/.test(anchored[0])) fail(`wire ${p.path}: the section is OPEN in the server HTML: ${anchored[0]}`);
    else if (!body.includes(p.content)) fail(`wire ${p.path}: closed, its content ("${p.content}") is not in the server HTML`);
    else if (icons.length !== 1 || !icons[0].includes(`href="${p.path}/methodology"`)) {
      fail(`wire ${p.path}: the link icon is not one <a href="${p.path}/methodology">: ${JSON.stringify(icons)}`);
    } else ok(`wire ${p.path}: one closed <details id="methodology">, its content served with it, and the icon's plain link to ${p.path}/methodology`);
    const own = `${p.path}/methodology`;
    const res2 = await fetchPage(own);
    const body2 = await res2.text();
    const opened = [...body2.matchAll(/<details[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('id="methodology"'));
    const title = /<title>([^<]*)<\/title>/.exec(body2)?.[1];
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(body2)?.[1];
    if (res2.status !== 200) fail(`wire ${own}: answered ${res2.status} (want 200 (ok))`);
    else if (opened.length !== 1 || !/\sopen(=""|\s|>)/.test(opened[0])) fail(`wire ${own}: the section is not sent open: ${JSON.stringify(opened)}`);
    else if (title !== `${p.title} - What is counted`) fail(`wire ${own}: page title "${title}"`);
    else if (canonical !== `${ORIGIN}${own}`) fail(`wire ${own}: canonical ${canonical}`);
    else ok(`wire ${own}: 200 (ok), the section sent open, titled "${title}", naming itself`);
  } catch (err) {
    fail(`wire ${p.path}: ${err}`);
  }
}

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

  // What the page shows, measured: the open state, the section's top against the sticky
  // nav's bottom, the pill that is open, and how far the page can still scroll (a section
  // the document is too short to lift to the top is at the scroll end, not misplaced).
  const STATE = `(() => {
    const el = document.getElementById('methodology');
    const nav = document.querySelector('nav.nav');
    const panel = document.querySelector('[id^="panel-"]');
    const de = document.documentElement;
    return {
      found: !!el,
      open: el ? el.open : null,
      top: el ? Math.round(el.getBoundingClientRect().top) : null,
      navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
      panel: panel ? panel.id : null,
      scrollY: Math.round(window.scrollY),
      maxScroll: Math.max(0, Math.round(de.scrollHeight - de.clientHeight)),
      over: de.scrollWidth - de.clientWidth,
      hash: location.hash,
      path: location.pathname
    };
  })()`;

  for (const p of PAGES) {
    // How many of this page's checks landed the section EXACTLY under the nav rather than at
    // the page's scroll end. The scroll-end case is honest geometry - a document too short to
    // lift the section higher - but it would also pass with the page's own scroll deleted, so
    // a page that never lands a strict one has not been verified at all.
    let strict = 0;
    for (const vp of VIEWPORTS) {
      const tag = `${p.path} ${vp.name}`;
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
      // Nothing here animates, and reduced motion also rules out a smooth scroll stealing the
      // measurement mid-flight.
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);

      const ev = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      const shot = async (name) => {
        if (!SHOTS) return;
        const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
        await writeFile(join(SHOTS, `${p.path.slice(1)}-${vp.name}-${name}.png`), Buffer.from(data, 'base64'));
      };
      const go = async (url) => {
        // about:blank FIRST. A URL that differs from the one before it only in its fragment is
        // a SAME-DOCUMENT navigation: no load event (so the wait below would run to its
        // timeout) and no fresh page, so a check meant to be cold would read the state the
        // previous step left behind.
        await send('Page.navigate', { url: 'about:blank' }, s);
        await sleep(150);
        const from = events.length;
        await send('Page.navigate', { url }, s);
        for (let i = 0; i < 60; i++) {
          await sleep(250);
          if (events.slice(from).some((e) => e.sessionId === s && e.method === 'Page.loadEventFired')) break;
        }
        // Not a fixed sleep: on the live site over a slow link hydration can take longer than
        // any constant worth hard-coding, and a check that ran early would read a page that
        // had not hydrated and fail for the wrong reason.
        return settle();
      };
      /**
       * Wait for the page to stop moving: hydration done (the section answers the address) and
       * two identical scroll readings, or the deadline. Returns the last state either way, so
       * the caller's own assertion is what decides - this never turns a failure into a pass.
       */
      const settle = async (ms = 9000) => {
        const until = Date.now() + ms;
        let last = await ev(STATE);
        let same = 0;
        while (Date.now() < until) {
          await sleep(200);
          const now = await ev(STATE);
          same = now.scrollY === last.scrollY && now.open === last.open ? same + 1 : 0;
          last = now;
          if (same >= 2) break;
        }
        return last;
      };
      /** The section is open and sits just under the nav - or the page is scrolled as far as it goes. */
      const atEnd = (m) => m.scrollY >= m.maxScroll - 2;
      const revealed = (m) =>
        m.found &&
        m.open === true &&
        m.panel === 'panel-overview' &&
        m.top >= m.navBottom - 2 &&
        (m.top <= m.navBottom + 24 || atEnd(m));
      const say = (step, m, good) =>
        good
          ? ok(
              `${tag} ${step}: open on ${m.panel}, top ${m.top} under a ${m.navBottom} px nav, scrolled ${m.scrollY}` +
                (m.top > m.navBottom + 24 ? ' (the page end: the document cannot lift it further)' : '')
            )
          : fail(`${tag} ${step}: ${JSON.stringify(m)}`);

      const own = `${p.path}/methodology`;
      /** The address bar reads What is counted's own address, with nothing after it. */
      const atOwn = (m) => m.path === own && m.hash === '';
      // 1. The address, cold.
      const cold = await go(`${BASE}${own}`);
      say('cold', cold, revealed(cold) && cold.scrollY > 0 && atOwn(cold));
      strict += revealed(cold) && !atEnd(cold) ? 1 : 0;
      cold.over <= 0 ? null : fail(`${tag} cold: the page scrolls sideways by ${cold.over} px`);
      await shot('cold');

      // 2. The domain's own address: collapsed, at the top.
      const plain = await go(`${BASE}${p.path}`);
      plain.found && plain.open === false && plain.scrollY === 0
        ? ok(`${tag} plain: the section is collapsed and the page is at the top`)
        : fail(`${tag} plain: ${JSON.stringify(plain)}`);
      await shot('plain');

      // 3. An old #methodology link followed while the page is open: a jump within the page.
      //    The page moves to the address it meant (the router fetches the answer first).
      await ev(`location.hash = 'methodology'`);
      for (let i = 0; i < 75 && !(await ev(`location.pathname === '${own}'`)); i++) await sleep(200);
      const warm = await settle();
      say('old link, in-page', warm, revealed(warm) && warm.scrollY > 0 && atOwn(warm));
      strict += revealed(warm) && !atEnd(warm) ? 1 : 0;

      // 5. (before 4, which navigates away) The visitor's own toggle: it must not touch the
      //    address bar, so an address stays the only thing that opens the section.
      await ev(`document.querySelector('#methodology > summary').click()`);
      const toggled = await settle(2000);
      toggled.open === false && atOwn(toggled)
        ? ok(`${tag} toggle: a click closes it and leaves the address bar at ${toggled.path}${toggled.hash}`)
        : fail(`${tag} toggle: ${JSON.stringify(toggled)}`);
      //    And Back, from the address the old link moved to, returns to the page it was
      //    followed on, at its own address - the move replaced the `#` entry the browser pushed
      //    (a move of the router's own left Back stuck there; fresh-context review, 2026-10-19).
      await ev('history.back()');
      for (let i = 0; i < 75 && (await ev('location.pathname + location.hash')) !== p.path; i++) await sleep(200);
      const back = await settle();
      back.path === p.path && back.hash === '' && back.open === false && back.found
        ? ok(`${tag} old link, in-page: Back returns to ${p.path}, the section closed as it was`)
        : fail(`${tag} old link, in-page, then Back: ${JSON.stringify(back)}`);

      // 4. The old link from another pill's address.
      const other = await go(`${BASE}${p.path}/${p.otherTab}`);
      other.panel === `panel-${p.otherTab}` && other.found === false
        ? ok(`${tag} ${p.otherTab}: the section is not even rendered on another pill`)
        : fail(`${tag} ${p.otherTab}: ${JSON.stringify(other)}`);
      await ev(`location.hash = 'methodology'`);
      for (let i = 0; i < 75 && !(await ev(`location.pathname === '${own}'`)); i++) await sleep(200);
      const crossed = await settle();
      say(`${p.otherTab} -> old link`, crossed, revealed(crossed) && atOwn(crossed));
      strict += revealed(crossed) && !atEnd(crossed) ? 1 : 0;
      await shot('crossed');

      // 6. A SvelteKit navigation to the address - a link on the site, not a fresh document.
      //    It is the one path with a scroll of the router's own (scrollIntoView, then
      //    reset_focus from a timer), which the page has to land after. Nothing links there
      //    yet, so the link is made here; a real one would behave the same, and the day the
      //    landing grows one this step is already covering it.
      const otherPage = PAGES.find((q) => q.path !== p.path).path;
      await go(`${BASE}${otherPage}`);
      await ev(`(() => {
        const a = document.createElement('a');
        a.href = '${own}';
        a.id = 'verify-methodology-link';
        a.textContent = 'methodology';
        document.body.appendChild(a);
        a.click();
      })()`);
      // WAIT FOR THE URL FIRST. The router fetches the new page's data over the network, and
      // until it answers the OLD page is still on screen and perfectly still - so settling on
      // "nothing moved" would measure the page we came from. Against the live site that read
      // as three failures (2026-10-17); on localhost the fetch was fast enough to hide it. The
      // deadline is generous: a slow answer must not read as a broken link.
      let landed = false;
      for (let i = 0; i < 75 && !landed; i++) {
        await sleep(200);
        landed = await ev(`location.pathname === '${own}'`);
      }
      const routed = landed ? await settle() : await ev(STATE);
      say(`${otherPage} -> ${own} (in-app link)`, routed, landed && revealed(routed));
      if (!landed) fail(`${tag}: the in-app link never landed on ${own}`);
      strict += revealed(routed) && !atEnd(routed) ? 1 : 0;
      await shot('routed');

      // 7. The link icon - see the header. A fresh, plain load each time: closed, at the top.
      const want = `${ORIGIN}${own}`;
      const SENTINEL = 'verify-methodology-sentinel';
      await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
      // a background tab has no focus, and the clipboard API refuses an unfocused document
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
      if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
      /** The icon, the section and its head, measured; `hit` is whether (x, y) lands on the icon. */
      const icon = (x = -1, y = -1) =>
        ev(`(() => {
          const a = document.querySelector('a[data-methodology-link]');
          const d = document.getElementById('methodology');
          const sm = d && d.querySelector(':scope > summary');
          const r = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2) };
          };
          const cs = a && getComputedStyle(a);
          const at = ${x} >= 0 ? document.elementFromPoint(${x}, ${y}) : null;
          return {
            found: !!a, opacity: cs && cs.opacity, pe: cs && cs.pointerEvents,
            link: r(a), details: r(d), summary: r(sm), heading: r(sm && sm.querySelector('h2')),
            open: d ? d.open : null, hash: location.hash, scrollY: Math.round(scrollY),
            hover: matchMedia('(hover: hover)').matches, focused: document.activeElement === a,
            hit: !!(at && at.closest('a[data-methodology-link]')), href: a && a.href
          };
        })()`);
      const mouse = (type, x, y) =>
        send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, s);
      const click = async (x, y) => {
        await mouse('mouseMoved', x, y);
        await mouse('mousePressed', x, y);
        await mouse('mouseReleased', x, y);
      };
      const key = async (k, code, vk, modifiers = 0, text) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) }, s);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }, s);
      };
      const seed = () => ev(`navigator.clipboard.writeText('${SENTINEL}')`);
      const clip = () => ev(`navigator.clipboard.readText()`);
      /** At the card's far right, inside its padding, level with the heading and clear of it.
       * The heading's own box, not the summary's: the summary is the whole head, padding
       * included, and loses its bottom padding when open, so its centre is not the text's. */
      const placed = (m) =>
        m.link && m.link.r < m.details.r && m.details.r - m.link.r <= 24 && Math.abs(m.link.cy - m.heading.cy) <= 3 && m.link.l > m.heading.r;
      const where = (m) => `${m.details.r - m.link.r} px in from the right, ${m.link.t - m.details.t} px down, centre ${m.link.cy - m.heading.cy} px off the heading's`;
      const away = { x: 2, y: vp.height - 2 };
      // a tap as a finger makes it; on the desktop viewport no touch emulation is on, so the
      // primary pointer still hovers - a touch laptop
      const tap = async (x, y) => {
        await send('Input.synthesizeTapGesture', { x, y, duration: 50, tapCount: 1, gestureSourceType: 'touch' }, s);
        await sleep(400);
      };
      await go(`${BASE}${p.path}?utm_source=verify-methodology`);
      await ev(`document.getElementById('methodology').scrollIntoView({ block: 'center' })`);
      await sleep(250);
      if (!vp.mobile) {
        await mouse('mouseMoved', away.x, away.y);
        await sleep(250);
        const rest = await icon();
        rest.found && rest.open === false && rest.opacity === '0' && rest.pe === 'none' && rest.href === want
          ? ok(`${tag} icon: at rest it is not drawn and takes no pointer; its href is ${rest.href}`)
          : fail(`${tag} icon at rest (want href ${want}): ${JSON.stringify(rest)}`);
        // the card's top padding, at its left: part of the head, nowhere near the heading's text
        await mouse('mouseMoved', rest.details.l + 40, rest.details.t + 6);
        await sleep(250);
        const pad = await icon();
        pad.opacity === '1' && pad.pe === 'auto'
          ? ok(`${tag} icon: hovering the closed card's padding, above the heading, draws it too`)
          : fail(`${tag} icon on hover of the card's padding: ${JSON.stringify(pad)}`);
        await mouse('mouseMoved', away.x, away.y);
        await sleep(250);
        // the head, at its left: the heading, nowhere near the icon
        await mouse('mouseMoved', rest.summary.l + 8, rest.summary.cy);
        await sleep(250);
        const hov = await icon();
        hov.opacity === '1' && hov.pe === 'auto' && placed(hov)
          ? ok(`${tag} icon: hovering the closed head draws it at the far right (${where(hov)})`)
          : fail(`${tag} icon on hover, closed: ${JSON.stringify(hov)}`);
        await shot('icon-hover-closed');
        // onto the icon: it is the summary's sibling, so the summary loses :hover there
        await mouse('mouseMoved', hov.link.cx, hov.link.cy);
        await sleep(250);
        const on = await icon(hov.link.cx, hov.link.cy);
        on.opacity === '1' && on.hit
          ? ok(`${tag} icon: it stays drawn, and is what the pointer hits, once the pointer is on it`)
          : fail(`${tag} icon under the pointer: ${JSON.stringify(on)}`);
        await seed();
        await mouse('mousePressed', hov.link.cx, hov.link.cy);
        await mouse('mouseReleased', hov.link.cx, hov.link.cy);
        await sleep(300);
        const copied = await icon();
        const got = await clip();
        got === want && copied.open === false && copied.hash === '' && copied.scrollY === rest.scrollY
          ? ok(`${tag} icon: a click copied ${got}, and the section, the address bar and the scroll did not move`)
          : fail(`${tag} icon click, closed: clipboard ${JSON.stringify(got)}, want ${want}; ${JSON.stringify(copied)}`);
        await mouse('mouseMoved', away.x, away.y);
        await sleep(300);
        const lingering = await icon();
        await sleep(2200);
        const gone = await icon();
        lingering.opacity === '1' && gone.opacity === '0' && gone.pe === 'none'
          ? ok(`${tag} icon: the tick outlives the pointer leaving, then the icon goes`)
          : fail(`${tag} icon after the copy: lingering ${JSON.stringify(lingering)}, then ${JSON.stringify(gone)}`);
        // OPEN, by a real click on the heading; the pointer stays on the head
        await click(rest.summary.l + 8, rest.summary.cy);
        await sleep(300);
        const opened = await icon();
        opened.open === true && opened.hash === '' && opened.opacity === '1' && placed(opened) && opened.link.t - opened.details.t <= 24
          ? ok(`${tag} icon: hovering the open section's head draws it in the top-right corner (${where(opened)})`)
          : fail(`${tag} icon on hover, open: ${JSON.stringify(opened)}`);
        await shot('icon-hover-open');
        await seed();
        await click(opened.link.cx, opened.link.cy);
        await sleep(300);
        const copiedOpen = await icon();
        const gotOpen = await clip();
        gotOpen === want && copiedOpen.open === true && copiedOpen.hash === '' && copiedOpen.scrollY === opened.scrollY
          ? ok(`${tag} icon: a click on the open section copied it too, and left it open`)
          : fail(`${tag} icon click, open: clipboard ${JSON.stringify(gotOpen)}; ${JSON.stringify(copiedOpen)}`);
        // THE KEYBOARD: Shift+Tab from the summary is the icon (it is just before it), focus
        // draws it, and Enter copies. After the tick has gone, so focus is all that draws it.
        await mouse('mouseMoved', away.x, away.y);
        await sleep(2300);
        await ev(`document.querySelector('#methodology > summary').focus()`);
        await key('Tab', 'Tab', 9, 8);
        await sleep(250);
        const focused = await icon();
        await seed();
        await key('Enter', 'Enter', 13, 0, '\r');
        await sleep(300);
        const gotKey = await clip();
        const afterKey = await icon();
        focused.focused && focused.opacity === '1' && gotKey === want && afterKey.open === true && afterKey.hash === ''
          ? ok(`${tag} icon: Shift+Tab from the summary focuses it and draws it, and Enter copies`)
          : fail(`${tag} icon by keyboard: focused ${JSON.stringify(focused)}, clipboard ${JSON.stringify(gotKey)}, then ${JSON.stringify(afterKey)}`);
        // A FINGER on this desktop, the pointer parked elsewhere: the tap's hover arms the
        // icon under it, so the click lands on the icon - which must toggle, not copy.
        await ev(`document.activeElement && document.activeElement.blur()`);
        await mouse('mouseMoved', away.x, away.y);
        await sleep(2300);
        const before = await icon();
        await seed();
        await tap(before.link.cx, before.link.cy);
        const t1 = await icon();
        await tap(before.link.cx, before.link.cy);
        const t2 = await icon();
        const gotTaps = await clip();
        before.open === true && t1.open === false && t2.open === true && gotTaps === SENTINEL && t2.hash === '' && !t2.focused
          ? ok(`${tag} icon: with hover on, a finger's tap where it sits toggles the section (closed, then open again) and copies nothing`)
          : fail(`${tag} icon, finger on a hover desktop: clipboard ${JSON.stringify(gotTaps)}; before ${JSON.stringify(before)}; then ${JSON.stringify(t1)}; then ${JSON.stringify(t2)}`);
      } else {
        const rest = await icon();
        if (rest.hover) fail(`${tag} icon: touch emulation left (hover: hover) on, so the touch check below proves nothing`);
        rest.found && rest.open === false && rest.opacity === '0' && rest.pe === 'none'
          ? ok(`${tag} icon: with touch (no hover) it is not drawn and takes no pointer`)
          : fail(`${tag} icon at rest, touch: ${JSON.stringify(rest)}`);
        // a tap exactly where it sits is a tap on the head: it toggles, it never copies
        await seed();
        await tap(rest.link.cx, rest.link.cy);
        const tapped = await icon(rest.link.cx, rest.link.cy);
        const gotTap = await clip();
        tapped.open === true && gotTap === SENTINEL && tapped.opacity === '0' && tapped.pe === 'none' && !tapped.hit && tapped.hash === ''
          ? ok(`${tag} icon: a tap where it sits opens the section, copies nothing, and leaves it undrawn`)
          : fail(`${tag} icon tap, touch: clipboard ${JSON.stringify(gotTap)}; ${JSON.stringify(tapped)}`);
        // and the tap's sticky hover has not armed it: a second tap there closes the section
        await tap(rest.link.cx, rest.link.cy);
        const again = await icon();
        again.open === false && (await clip()) === SENTINEL && again.opacity === '0'
          ? ok(`${tag} icon: a second tap there closes it again - the first did not arm the icon`)
          : fail(`${tag} icon second tap, touch: ${JSON.stringify(again)}`);
      }
      await shot('icon');

      // Errors and analytics, for this tab's whole life.
      const mine = events.slice(since).filter((e) => e.sessionId === s);
      const thrown =
        mine.filter((e) => e.method === 'Runtime.exceptionThrown').length -
        mine.filter((e) => e.method === 'Runtime.exceptionRevoked').length;
      const consoleErrors = mine
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '));
      thrown <= 0 && consoleErrors.length === 0
        ? ok(`${tag}: no page exception, no console error`)
        : fail(`${tag}: ${thrown} exception(s); console: ${consoleErrors.join(' | ').slice(0, 300)}`);
      const ga = googleLeaks(mine).length;
      ga === 0 ? ok(`${tag}: nothing reached Google analytics`) : fail(`${tag}: ${ga} request(s) reached Google analytics`);
      await send('Target.closeTarget', { targetId });
    }
    strict > 0
      ? ok(`${p.path}: ${strict} check(s) put the section exactly under the nav, so the page's own scroll is verified`)
      : fail(`${p.path}: every check passed only at the page's scroll end - the page's own scroll is unverified here`);
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
