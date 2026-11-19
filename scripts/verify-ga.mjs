// Verify GA4 is ACTUALLY measuring a deployed site - not merely wired up.
//
//   node scripts/verify-ga.mjs https://nostrolo.gy/ https://nostrolo.gy/marketplaces
//   node scripts/verify-ga.mjs --tid=G-XXXXXXXXXX <url>...
//   read -rs C; NOZZL_OPERATOR_COOKIES="$C" node scripts/verify-ga.mjs --operator \
//     https://nostrolo.gy/ https://nostrolo.gy/relays; unset C
//
// TWO MODES, because the operator's signed-in session is served pages WITHOUT GA
// (src/hooks.server.ts). A signed-in run would "fail" every check below, and an anonymous
// run cannot see the exclusion. So:
//   default     a fresh, signed-out profile: GA must be measuring (the checks below).
//   --operator  the OPERATOR'S OWN check, because it needs their session: it puts the two
//               cookies of a browser signed in as the operator into the profile, and asserts
//               the OPPOSITE on every page: zero requests to any Google analytics host, no
//               window.gtag / dataLayer, the analytics-off badge rendered with its tooltip
//               and MEASURED as a small bottom-left bubble holding a visible, uncovered
//               yellow dot (BADGE_PROBE, below), and the document response tagged
//               `X-Nozzl-Operator: 1` by the edge. It also clicks an in-app link and
//               requires the SPA navigation to stay silent. Google's hosts are blocked
//               besides, so even a run with stale cookies sends nothing to GA.
//
// THE COOKIES come from NOZZL_OPERATOR_COOKIES: the `Cookie` request header of any page load
// in a browser signed in as the operator (devtools -> Network -> the document -> Request
// Headers), pasted whole. It must hold `__Host-nostrology_session` and `__Host-nozzl_op`; the
// rest is ignored. The session is a bearer credential that lasts 400 days and cannot be revoked
// alone: `read -rs` keeps it out of the terminal and the shell's history, passing it to this one
// command (never `export`) keeps it out of every later command's environment, and this script
// never prints it.
//
// Exits 0 only if every page passes, 1 if any page fails, 2 on a usage error. Needs Google
// Chrome (override the path with CHROME=/path/to/chrome); drives it over CDP with node's
// global WebSocket, so there is no puppeteer dependency to keep current.
//
// WHY THIS EXISTS. Every cheap signal for "is GA working" was GREEN for the 48 days GA4 on
// this site recorded nothing at all: gtag.js loaded, window.gtag was a function, dataLayer
// filled up, the measurement id was in the page, there was no CSP and no console error. See
// src/lib/analytics/ga.ts for the mechanism. The lesson generalizes - check the wire, not
// our own objects - which is what this script does.
//
// WHAT IT ASSERTS, per page:
//   * every dataLayer entry is arguments-like and NONE is a plain array. This is the exact
//     regression it was written for: gtag.js dispatches an entry as a command only when it
//     is arguments-like, so one `[object Array]` means commands are being discarded.
//     (If a third party ever legitimately pushes a plain array, this needs revisiting.)
//   * gtag.js was fetched;
//   * exactly ONE `en=page_view` hit left the browser - not ">= 1", so a double-count
//     regression fails here too. Enhanced Measurement's extra `scroll` / `user_engagement`
//     hits are expected and ignored;
//   * every collect hit carries the EXPECTED `tid`, and none of them failed to complete.
//   * SPA navigation: it clicks an in-app link and requires a SECOND page_view for the new
//     path. That is the only check of the OPERATIONAL DEPENDENCY on GA4 Enhanced
//     Measurement's history hook, which 16 of 17 routes rely on for a visitor who navigates
//     by clicking. Pages with no in-app link to a different path report `spa=n/a`.
//
// WHAT IT CANNOT TELL YOU - read this before quoting it as proof. Google's collector
// returns 204 for ANYTHING: a bogus measurement id, an empty one, even a bare request with
// no parameters at all (measured 2026-08-23). So the HTTP status proves the request left
// the browser and nothing more. Matching `tid` against the id YOU pass in is what makes
// this meaningful, and it still cannot see server-side drops: a deleted property, a
// disabled stream, or GA4's always-on bot filtering discarding a HeadlessChrome hit. Only
// the GA4 UI (Realtime) or the Data API can confirm a hit was STORED.
//
// TRAFFIC IT GENERATES. The default mode fires real page_view hits into the property from
// whatever machine runs it - roughly one per URL, plus one per SPA click - and GA4 has no
// marker to tell them apart, so keep sweeps deliberate. Every request carries a User-Agent
// suffix `nozzl-verify-ga/<mode>`, so the Caddy access log attributes it. The --operator mode
// sends nothing to Google and is tagged `operator=1` in the access log.
//
// GA_DEBUG=1 dumps every parsed event after each SPA click - reach for it before concluding
// a page is broken, because "no event" is far more often a parsing or timing artifact here
// than a real failure.
//
// One Chrome instance is reused across the sweep; each URL gets a FRESH tab so no state
// carries between pages (the profile, and so the operator's cookies, persists for the run).
// The profile, a fresh $TMPDIR/verify-ga-XXXXXX, is deleted however the run ends -
// Ctrl-C included (scripts/lib/chrome.mjs).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';
import { blockGoogle } from './lib/google.mjs';

const args = process.argv.slice(2);
const tidArg = args.find((a) => a.startsWith('--tid='));
// Must match the PUBLIC_GA_MEASUREMENT_ID the deployment gives the app.
const EXPECTED_TID = tidArg ? tidArg.slice('--tid='.length) : 'G-KTY9T0HY9G';
const OPERATOR = args.includes('--operator');
const URLS = args.filter((a) => !a.startsWith('--'));
const UA_SUFFIX = `nozzl-verify-ga/${OPERATOR ? 'operator' : 'measured'}`;
// Any request to these hosts from an operator page means the exclusion did not hold.
const GOOGLE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net/;

if (URLS.length === 0) {
  console.error('usage: node scripts/verify-ga.mjs [--operator] [--tid=G-XXXXXXXXXX] <url> [url...]');
  console.error('  refusing to report success with nothing to check.');
  process.exit(2);
}

// The operator's two cookies, from the environment (see the header), read BEFORE Chrome starts
// and then deleted from this process's environment, so the browser it launches never inherits
// them. Only their names are ever printed.
const OPERATOR_COOKIES = ['__Host-nostrology_session', '__Host-nozzl_op'];
const pasted = new Map(
  (OPERATOR ? process.env.NOZZL_OPERATOR_COOKIES || '' : '')
    .replace(/^\s*cookie:\s*/i, '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('='))
    .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])
);
delete process.env.NOZZL_OPERATOR_COOKIES;
if (OPERATOR) {
  const missing = OPERATOR_COOKIES.filter((name) => !pasted.get(name));
  if (missing.length) {
    console.error(`NOZZL_OPERATOR_COOKIES lacks ${missing.join(' and ')}: paste the Cookie header of a page load signed in as the operator`);
    process.exit(2);
  }
}

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + (process.pid % 500);
// A new directory every run: a reused one could still carry the operator's cookies from an
// earlier run and silently turn a measured run into an excluded one.
const PROFILE = await mkdtemp(join(tmpdir(), 'verify-ga-'));
const COLLECT = /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/;

// THE ANALYTICS-OFF BADGE (--operator mode), MEASURED in the real browser. Since 2026-09-24
// it is a yellow dot in a small bubble, bottom-left, with no visible words. It is judged by
// geometry and colour, never by text: its words are sr-only, and they are in textContent AND
// innerText, so no text check can tell hidden words from visible ones. The unit test
// (src/routes/layout.analytics.test.ts) runs in jsdom, which computes no CSS, so a dot that
// renders 0x0 or transparent, or words made visible again, pass it; this is the check that
// catches them.
const BADGE_PROBE = `(() => {
  const b = document.querySelector('[data-testid="analytics-off-badge"]');
  if (!b) return null;
  const br = b.getBoundingClientRect();
  const d = b.querySelector('[data-testid="analytics-off-dot"]');
  let dot = null;
  if (d) {
    const dr = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    dot = { w: dr.width, h: dr.height, bg: cs.backgroundColor, visibility: cs.visibility,
      opacity: +cs.opacity,
      onTop: b.contains(document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2)) };
  }
  return { title: b.getAttribute('title') || '', w: br.width, h: br.height, left: br.left,
    bottomGap: innerHeight - br.bottom, opacity: +getComputedStyle(b).opacity, dot };
})()`;
const badgeProblems = (b) => {
  if (!b) return ['no analytics-off badge'];
  const px = (w, h) => `${Math.round(w)}x${Math.round(h)}px`;
  const out = [];
  if (!b.title.includes('Operator browser')) out.push(`badge tooltip is not the operator's: ${b.title}`);
  if (b.w > 32 || b.h > 32) out.push(`badge is ${px(b.w, b.h)}, want <= 32x32 (visible words?)`);
  // Inside the viewport too: a badge pushed partly off-screen fails. This canNOT see the
  // iPhone Safari portrait nudge (src/lib/analytics/badge.ts): headless Chrome's default
  // viewport is landscape (756x469) and its UA carries the suffix above, which the nudge's
  // anchored UA match rejects. The nudge is pinned by src/routes/layout.badge-css.test.ts.
  if (b.left < 0 || b.left > 24 || b.bottomGap < 0 || b.bottomGap > 24) {
    out.push(`badge is not in the bottom-left corner (left ${Math.round(b.left)}px, bottom gap ${Math.round(b.bottomGap)}px)`);
  }
  if (b.opacity < 0.5) out.push(`badge opacity is ${b.opacity}`);
  if (!b.dot) return [...out, 'analytics-off badge has no dot'];
  if (b.dot.w < 6 || b.dot.h < 6) out.push(`dot is ${px(b.dot.w, b.dot.h)}, want >= 6x6`);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(b.dot.bg);
  const [r, g, bl, a] = m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 0];
  if (!(r > 200 && g > 150 && bl < 100 && a >= 0.5)) out.push(`dot colour ${b.dot.bg} is not yellow`);
  if (b.dot.visibility !== 'visible' || b.dot.opacity < 0.5) {
    out.push(`dot is hidden (visibility ${b.dot.visibility}, opacity ${b.dot.opacity})`);
  }
  if (!b.dot.onTop) out.push('something outside the badge is on top of the dot (covered?)');
  return out;
};

// Neither Ctrl-C nor a `timeout` may leave Chrome running, or its profile (with the operator's
// cookies in it) behind: see scripts/lib/chrome.mjs.
const chrome = launchChrome({ path: CHROME, port: PORT, profile: PROFILE });

let ws;
let allGood = true;
try {
  let wsUrl;
  for (let i = 0; i < 80; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { /* not up yet */ }
    if (wsUrl) break;
    await sleep(250);
  }
  if (!wsUrl) throw new Error(`Chrome never exposed CDP on port ${PORT}`);

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket failed')); });

  let id = 0;
  const pending = new Map();
  let sink = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) sink.push(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(i, (msg) => {
      clearTimeout(timer);
      if (msg.error) rej(new Error(`CDP error on ${method}: ${msg.error.message}`));
      else res(msg);
    });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  // Poll rather than sleep a fixed interval: GA4 does not send on a predictable schedule,
  // and a fixed wait is either slow or flaky. Returns true if `pred` held before the bound.
  const waitFor = async (pred, ms = 15000) => {
    for (let waited = 0; waited < ms; waited += 250) {
      if (pred()) return true;
      await sleep(250);
    }
    return pred();
  };

  const openTab = async () => {
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Network.enable', {}, sessionId);
    await send('Network.setUserAgentOverride', { userAgent: `${BROWSER_UA} ${UA_SUFFIX}` }, sessionId);
    // A blocked request is still reported, so checkExcluded below still sees any attempt.
    if (OPERATOR) await blockGoogle(send, sessionId);
    return { targetId, sessionId };
  };
  const BROWSER_UA = (await send('Browser.getVersion')).result.userAgent;

  if (OPERATOR) {
    // Checks one loaded page in the operator's profile. `navSince` = sink index of this
    // page's own navigation, so requests from an earlier page are never blamed on it.
    const checkExcluded = async (tab, label, navSince) => {
      const problems = [];
      // GA would have injected gtag.js within a second or two of hydration; give it ample
      // time so a slow hydration cannot make a leaking page look silent.
      await sleep(6000);
      const google = sink.slice(navSince).filter((e) => e.method === 'Network.requestWillBeSent'
        && GOOGLE.test(e.params.request.url)).map((e) => e.params.request.url.slice(0, 90));
      if (google.length) problems.push(`${google.length} request(s) to Google: ${google.join(' ')}`);
      const { result } = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          gtag: typeof window.gtag, dataLayer: typeof window.dataLayer,
          badge: ${BADGE_PROBE}
        })`,
        returnByValue: true,
      }, tab.sessionId);
      const st = JSON.parse(result.result?.value || '{}');
      if (st.gtag !== 'undefined') problems.push(`window.gtag is ${st.gtag}`);
      if (st.dataLayer !== 'undefined') problems.push(`window.dataLayer is ${st.dataLayer}`);
      problems.push(...badgeProblems(st.badge));
      return problems;
    };
    // The LAST document response since this navigation, whatever its final URL: a redirect
    // (a trailing slash) must not make the check report a false BAD.
    const docTagged = (since) => {
      const doc = sink.slice(since).filter((e) => e.method === 'Network.responseReceived'
        && e.params.type === 'Document').pop();
      if (!doc) return 'no document response seen';
      const h = Object.fromEntries(Object.entries(doc.params.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
      return h['x-nozzl-operator'] === '1' ? '' : 'document response not tagged X-Nozzl-Operator: 1';
    };

    const origin = new URL(URLS[0]).origin;
    console.log(`operator mode: every page must load NO analytics (UA suffix ${UA_SUFFIX})\n`);
    console.log('     PAGE                                          RESULT');

    // The operator's cookies, set once: the profile persists for the run, every tab shares it.
    {
      const tab = await openTab();
      for (const name of OPERATOR_COOKIES) {
        const { result } = await send('Network.setCookie', {
          name, value: pasted.get(name), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Lax'
        }, tab.sessionId);
        if (!result.success) throw new Error(`could not set ${name} in the profile`);
      }
      await send('Target.closeTarget', { targetId: tab.targetId });
    }

    for (const url of URLS) {
      const tab = await openTab();
      const since = sink.length;
      await send('Page.navigate', { url }, tab.sessionId);
      const problems = await checkExcluded(tab, url, since);
      const untagged = docTagged(since);
      if (untagged) problems.push(untagged);

      // SPA navigation must stay silent too (no hydration-time re-init of GA).
      const mark = sink.length;
      const { result: clicked } = await send('Runtime.evaluate', {
        expression: `(() => {
          const here = location.pathname;
          const a = [...document.querySelectorAll('a[href]')].find((x) => {
            try { const u = new URL(x.href, location.href);
              return u.origin === location.origin && u.pathname !== here && !x.target; } catch { return false; }
          });
          if (!a) return '';
          a.click();
          return new URL(a.href, location.href).pathname;
        })()`,
        returnByValue: true,
      }, tab.sessionId);
      const target = clicked.result?.value || '';
      let spa = 'n/a';
      if (target) {
        const after = await checkExcluded(tab, target, mark);
        spa = after.length ? 'BAD' : 'ok';
        after.forEach((p) => problems.push(`after SPA nav to ${target}: ${p}`));
      }
      const ok = problems.length === 0;
      if (!ok) allGood = false;
      console.log(`${ok ? 'OK  ' : 'BAD '} ${url.padEnd(45)} ${ok ? 'excluded' : ''}  spa=${spa}`);
      problems.forEach((p) => console.log(`       -> ${p}`));
      await send('Target.closeTarget', { targetId: tab.targetId });
    }
    console.log(allGood ? '\nALL PAGES EXCLUDED' : '\nSOME PAGES LEAKED OR FAILED');
  }

  // Every GA4 EVENT sent since `from`, as {en, dl, tid, requestId}.
  //
  // One collect request is not one event. gtag.js batches: it POSTs with the shared params
  // (tid, and the first event's dl) in the QUERY STRING and the remaining events as
  // newline-separated parameter blocks in the BODY. A query-string-only parser therefore
  // sees `en=(none)` and the WRONG dl for a batch, which reads as "the event never fired".
  // That cost a real debugging round on 2026-08-23: the SPA page_view for /wip was being
  // sent all along, batched, and the checker called it a failure. Parse both.
  const hitsSince = (from) => sink.slice(from)
    .filter((e) => e.method === 'Network.requestWillBeSent' && COLLECT.test(e.params.request.url))
    .flatMap((e) => {
      const u = new URL(e.params.request.url);
      const tid = u.searchParams.get('tid') || '';
      const queryDl = u.searchParams.get('dl') || '';
      const out = [];
      if (u.searchParams.get('en')) {
        out.push({ en: u.searchParams.get('en'), dl: queryDl, tid, requestId: e.params.requestId });
      }
      for (const line of (e.params.request.postData || '').split('\n')) {
        if (!line.trim()) continue;
        const b = new URLSearchParams(line);
        if (b.get('en')) out.push({ en: b.get('en'), dl: b.get('dl') || queryDl, tid, requestId: e.params.requestId });
      }
      // A collect request that yielded no parseable event still needs to be visible to the
      // tid/response assertions, so surface it rather than dropping it.
      if (out.length === 0) out.push({ en: '(none)', dl: queryDl, tid, requestId: e.params.requestId });
      return out;
    });

  if (!OPERATOR) {
  console.log(`expecting tid=${EXPECTED_TID}\n`);
  console.log('     PAGE                                          DATALAYER        gtag.js  page_view  tid  status  spa');

  for (const url of URLS) {
    sink = [];
    const tab = await openTab();
    await send('Page.navigate', { url }, tab.sessionId);
    await waitFor(() => hitsSince(0).some((h) => h.en === 'page_view'));
    // Settle briefly so a SECOND, erroneous page_view would also be captured - otherwise
    // the "exactly 1" assertion would pass by returning the moment the first one lands.
    await sleep(2500);

    const problems = [];
    const initialHits = hitsSince(0);
    const gtagjs = sink.filter((e) => e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('googletagmanager.com')).length;

    const { result } = await send('Runtime.evaluate', {
      expression: 'JSON.stringify((window.dataLayer||[]).map(x=>Object.prototype.toString.call(x)))',
      returnByValue: true,
    }, tab.sessionId);
    const kinds = JSON.parse(result.result?.value || '[]');
    const argsN = kinds.filter((k) => k === '[object Arguments]').length;
    const arraysN = kinds.filter((k) => k === '[object Array]').length;
    if (argsN < 2) problems.push(`only ${argsN} arguments-like dataLayer entries (want >= 2)`);
    if (arraysN > 0) problems.push(`${arraysN} plain-array dataLayer entries - commands are being discarded`);
    if (gtagjs < 1) problems.push('gtag.js was never fetched');

    const pageViews = initialHits.filter((h) => h.en === 'page_view');
    if (pageViews.length !== 1) problems.push(`${pageViews.length} page_view hits (want exactly 1)`);
    const wrongTid = initialHits.filter((h) => h.tid !== EXPECTED_TID);
    if (wrongTid.length) problems.push(`hit(s) sent to tid=${[...new Set(wrongTid.map((h) => h.tid))].join(',')}, expected ${EXPECTED_TID}`);

    const hitIds = new Set(initialHits.map((h) => h.requestId));
    const answered = new Set(sink.filter((e) => e.method === 'Network.responseReceived' && hitIds.has(e.params.requestId)).map((e) => e.params.requestId));
    // A `loadingFailed` only means something if the request was never answered. GA4 sends
    // via fetch(keepalive)/sendBeacon and nothing reads the response body, so Chrome reports
    // net::ERR_ABORTED for the SAME requestId that also got a 204. Verified live 2026-08-23;
    // treating any loadingFailed as fatal makes every page a false BAD.
    const failed = sink.filter((e) => e.method === 'Network.loadingFailed'
      && hitIds.has(e.params.requestId) && !answered.has(e.params.requestId));
    if (failed.length) problems.push(`${failed.length} collect request(s) never completed: ${failed.map((e) => e.params.errorText).join(',')}`);
    const statuses = sink.filter((e) => e.method === 'Network.responseReceived' && hitIds.has(e.params.requestId)).map((e) => e.params.response.status);
    if (statuses.length === 0) problems.push('no collect response was received');
    if (statuses.some((s) => s >= 400)) problems.push(`collect status ${statuses.filter((s) => s >= 400).join(',')}`);

    // SPA navigation - the only check of the Enhanced Measurement history hook.
    const mark = sink.length;
    const { result: clicked } = await send('Runtime.evaluate', {
      expression: `(() => {
        const here = location.pathname;
        const a = [...document.querySelectorAll('a[href]')].find((x) => {
          try { const u = new URL(x.href, location.href);
            return u.origin === location.origin && u.pathname !== here && !x.target; } catch { return false; }
        });
        if (!a) return '';
        a.click();
        return new URL(a.href, location.href).pathname;
      })()`,
      returnByValue: true,
    }, tab.sessionId);
    const target = clicked.result?.value || '';
    let spa = 'n/a';
    if (target) {
      const matches = () => hitsSince(mark).filter((h) => h.en === 'page_view' && h.dl.endsWith(target));
      // Generous bound: the history-change page_view is not sent on a predictable schedule
      // and has been observed well past 15s. This is a deliberate verification run, so wait.
      await waitFor(() => matches().length > 0, 30000);
      await sleep(2500); // settle, so a duplicate would be caught too
      const after = matches();
      if (process.env.GA_DEBUG) {
        console.log(`       [debug] target=${target} hits after click:`,
          JSON.stringify(hitsSince(mark).map((h) => ({ en: h.en, dl: h.dl }))));
      }
      spa = after.length === 1 ? 'ok' : `BAD(${after.length})`;
      if (after.length !== 1) problems.push(`SPA nav to ${target} produced ${after.length} page_view hits (want exactly 1)`
        + (after.length === 0 ? ' - check Enhanced Measurement history tracking is still on for this stream' : ' - a duplicate suggests a manual page_view was added alongside it'));
    }

    const ok = problems.length === 0;
    if (!ok) allGood = false;
    console.log(`${ok ? 'OK  ' : 'BAD '} ${url.padEnd(45)} args=${argsN} arrays=${arraysN}   ${String(gtagjs).padEnd(7)}  ${String(pageViews.length).padEnd(9)}  ${wrongTid.length ? 'BAD' : 'ok '}  ${statuses.join(',') || '-'}   ${spa}`);
    problems.forEach((p) => console.log(`       -> ${p}`));
    await send('Target.closeTarget', { targetId: tab.targetId });
  }

  console.log(allGood ? '\nALL PAGES OK' : '\nSOME PAGES FAILED');
  }
} catch (err) {
  console.error(`\nverify-ga failed: ${err.message}`);
  allGood = false;
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  // Waits for Chrome to exit before deleting the profile: deleting it right after kill()
  // raced Chrome's shutdown writes, which is what left /tmp/verify-ga-<pid> directories.
  await stopChrome(chrome, PROFILE);
}
exitProcess(allGood ? 0 : 1);
