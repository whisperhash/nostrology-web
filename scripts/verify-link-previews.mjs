// Verify, on a deployed site, what web-based Nostr clients need from us to draw a link card:
// the edge's `(link-preview-cors)` header, and a card worth drawing. Over the wire AND in a
// real browser.
//
//   node scripts/verify-link-previews.mjs                       # https://nostrolo.gy + dev/www
//   node scripts/verify-link-previews.mjs --no-browser          # wire checks only (no Chrome)
//   node scripts/verify-link-previews.mjs --alias=https://dev.nostrolo.gy https://nostrolo.gy
//
// WHY THIS EXISTS. A client that builds the card in the reader's browser (noStrudel, older
// Jumble forks, Nostter's fallback) can read our page only if the response carries
// Access-Control-Allow-Origin, and when it does not, nothing anywhere says so: the browser
// downloads the page, hides it from the client's script, and the note shows a bare link. The
// site shipped without the header until 2026-10-14 and nobody noticed, because the big
// clients fetch server-side.
// deploy/test-caddyfile.sh section 12 proves the Caddyfile against stub upstreams before a
// deploy; this proves the deployed site, upstreams and all.
//
// WIRE (Node's fetch, which enforces no CORS; it only reads the headers):
//   - each page: 200 (ok), text/html, Access-Control-Allow-Origin exactly `*` (fetch joins
//     two header lines into "*, *", so doubling fails too), no
//     Access-Control-Allow-Credentials, and og:title, og:description and an absolute https
//     og:image inside <head>, in the first 8 KB;
//   - a HEAD of a page (Nostter's first request) gets the header too;
//   - each alias host's 308 (permanent redirect) to the apex carries it: browsers apply the
//     CORS check to the redirect, so a card for an old dev.nostrolo.gy link fails there
//     without it;
//   - the card image and the site icon: 200 (ok), image/*, the header, and no
//     Cross-Origin-Resource-Policy (which would stop other sites showing the image at all);
//   - and NOT on the APIs, which keep their own rules: HEAD of /mcp, which the MCP server
//     itself refuses with 405 (method not allowed), and GET of /api/auth/challenge, which the
//     app refuses with 405 (method not allowed) because the endpoint takes POST only. The
//     status proves the service answered, so a missing header there is the exclusion, not an
//     outage. If GET /mcp ever serves a human page with its own header, these /mcp checks
//     change with it, deliberately.
// BROWSER (headless Chrome on https://example.com, a neutral origin):
//   - fetch() of a page returns its og:title;
//   - fetch() of an old dev. link follows the 308 (permanent redirect) to the apex;
//   - a HEAD succeeds;
//   - an <img crossorigin> of the icon loads;
//   - fetch() of /mcp FAILS: the exclusion, seen the way a client sees it.
//
// FIRST-PARTY MARKING:
//   - Every request carries the User-Agent mark `nozzl-verify-link-previews`, as the whole
//     User-Agent on the wire and as a suffix to Chrome's own.
//   - The Origin is example.com, never a real client's: the traffic analyses count those as
//     that client.
//   - The MCP requests use the marked URL (?traffic_type=internal) only, as every
//     first-party request to the endpoint must.
//   - GET and HEAD only; nothing is posted.
//
// Exits 0 only if every check passes, 1 if any fails, 2 on a usage error. The browser part
// needs Google Chrome (CHROME=/path/to/chrome overrides).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exitProcess, launchChrome, stopChrome } from './lib/chrome.mjs';

const args = process.argv.slice(2);
const NO_BROWSER = args.includes('--no-browser');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--no-browser' && !a.startsWith('--alias='));
const BASE = (args.find((a) => !a.startsWith('--')) ?? 'https://nostrolo.gy').replace(/\/+$/, '');
const given = args.filter((a) => a.startsWith('--alias=')).map((a) => a.slice('--alias='.length).replace(/\/+$/, ''));
const ALIASES = given.length || BASE !== 'https://nostrolo.gy' ? given : ['https://dev.nostrolo.gy', 'https://www.nostrolo.gy'];
if (unknown.length || !/^https?:\/\//.test(BASE) || ALIASES.some((a) => !/^https?:\/\//.test(a))) {
  console.error('usage: node scripts/verify-link-previews.mjs [--no-browser] [--alias=<url>]... [<base-url>]');
  process.exit(2);
}

const MARK = 'nozzl-verify-link-previews';
const ORIGIN = 'https://example.com';
// The pages measured when the header went in (2026-10-14); /lightning and
// /zapstore/leaderboards are the heavy ones.
// /git/zaps and /marketplaces/categories are sections' own addresses (since 2026-10-19 and
// 2026-11-04), each with a preview of its own.
const PAGES = ['/', '/git', '/git/zaps', '/marketplaces', '/marketplaces/categories', '/nutzaps', '/data/nutzaps', '/zapstore/leaderboards', '/lightning'];
// The marked URL, and only that. On any nostrolo.gy host it is the apex's: an alias would
// add a redirect hop and teach the wrong host.
const MCP = /(^|\.)nostrolo\.gy$/.test(new URL(BASE).hostname)
  ? 'https://nostrolo.gy/mcp?traffic_type=internal'
  : `${BASE}/mcp?traffic_type=internal`;
const HEAD_LIMIT = 8192; // bytes

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `  (${detail})` : ''}`);
};

async function get(url, method = 'GET') {
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    headers: { 'user-agent': MARK, origin: ORIGIN },
    signal: AbortSignal.timeout(30000)
  });
  return { res, body: method === 'HEAD' ? '' : await res.text() };
}
const acao = (res) => res.headers.get('access-control-allow-origin');
// The content of the <meta property="..."> tag, and where in the document it starts.
function meta(html, prop) {
  const m = new RegExp(`<meta\\s[^>]*property="${prop}"[^>]*>`).exec(html);
  return m ? { at: m.index, content: /content="([^"]*)"/.exec(m[0])?.[1] ?? '' } : null;
}

// --- WIRE ---------------------------------------------------------------------------------
console.log(`wire: ${BASE} (aliases: ${ALIASES.join(', ') || 'none'})`);
let cardImage = null;
for (const path of PAGES) {
  try {
    const { res, body } = await get(BASE + path);
    const headEnd = body.indexOf('</head>');
    const bytesTo = (at) => Buffer.byteLength(body.slice(0, at));
    const tags = ['og:title', 'og:description', 'og:image'].map((p) => [p, meta(body, p)]);
    const late = tags
      .filter(([, t]) => !t || !t.content || headEnd < 0 || t.at > headEnd || bytesTo(t.at) > HEAD_LIMIT)
      .map(([p]) => p);
    const image = tags[2][1]?.content ?? '';
    check(res.status === 200, `GET ${path}: 200 (ok)`, `status ${res.status}`);
    check(acao(res) === '*', `GET ${path}: Access-Control-Allow-Origin *`, `got ${JSON.stringify(acao(res))}`);
    check(!res.headers.has('access-control-allow-credentials'), `GET ${path}: no Access-Control-Allow-Credentials`);
    check((res.headers.get('content-type') ?? '').startsWith('text/html'), `GET ${path}: text/html`);
    check(late.length === 0, `GET ${path}: og:title, og:description, og:image in <head>, first ${HEAD_LIMIT} bytes`, `missing or late: ${late.join(', ')}`);
    check(/^https:\/\//.test(image), `GET ${path}: og:image absolute https`, image);
    cardImage ??= image || null;
  } catch (e) {
    check(false, `GET ${path}`, e.message);
  }
}
try {
  const { res } = await get(`${BASE}/marketplaces`, 'HEAD');
  check(res.status === 200 && acao(res) === '*', 'HEAD /marketplaces: 200 (ok) with Access-Control-Allow-Origin *', `status ${res.status}, ${JSON.stringify(acao(res))}`);
} catch (e) {
  check(false, 'HEAD /marketplaces', e.message);
}
for (const alias of ALIASES) {
  for (const method of ['GET', 'HEAD']) {
    try {
      const { res } = await get(`${alias}/nutzaps`, method);
      check(res.status === 308 && res.headers.get('location') === `${BASE}/nutzaps`, `${method} ${alias}/nutzaps: 308 (permanent redirect) to the apex`, `status ${res.status}, location ${res.headers.get('location')}`);
      check(acao(res) === '*', `${method} ${alias}/nutzaps: the 308 (permanent redirect) carries Access-Control-Allow-Origin *`, `got ${JSON.stringify(acao(res))}`);
    } catch (e) {
      check(false, `${method} ${alias}/nutzaps`, e.message);
    }
  }
}
for (const url of [cardImage, `${BASE}/apple-touch-icon.png`]) {
  if (!url) { check(false, 'card image', 'no og:image found on any page'); continue; }
  try {
    const { res } = await get(url);
    check(res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/'), `GET ${url}: 200 (ok), an image`, `status ${res.status}, ${res.headers.get('content-type')}`);
    check(acao(res) === '*', `GET ${url}: Access-Control-Allow-Origin *`, `got ${JSON.stringify(acao(res))}`);
    check(!res.headers.has('cross-origin-resource-policy'), `GET ${url}: no Cross-Origin-Resource-Policy`, res.headers.get('cross-origin-resource-policy') ?? '');
  } catch (e) {
    check(false, `GET ${url}`, e.message);
  }
}
// The status is the positive control: an error Caddy generates itself, such as
// 502 (bad gateway) while the service restarts, carries no header either, so "no header"
// alone could pass vacuously. 405 (method not allowed) is the MCP server refusing HEAD,
// and the app refusing GET on /api/auth/challenge, which takes POST only; only then does
// the missing header show the exclusion.
for (const [method, url, status, reason] of [
  ['HEAD', MCP, 405, 'method not allowed'],
  ['GET', `${BASE}/api/auth/challenge`, 405, 'method not allowed']
]) {
  const label = `${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`;
  try {
    const { res } = await get(url, method);
    check(res.status === status, `${label}: ${status} (${reason}) from the service itself`, `status ${res.status}`);
    check(acao(res) === null, `${label}: NO Access-Control-Allow-Origin (an API)`, `got ${JSON.stringify(acao(res))}`);
  } catch (e) {
    check(false, label, e.message);
  }
}

// --- BROWSER --------------------------------------------------------------------------------
// The same reads a browser-side previewer makes, from a page on another origin. Expected:
// every read succeeds except the one of /mcp, which the browser must refuse.
const PROBE = `(async () => {
  const out = {};
  const t = () => AbortSignal.timeout(30000);
  const read = async (key, url, opts = {}) => {
    try {
      const r = await fetch(url, { ...opts, signal: t() });
      const text = opts.method === 'HEAD' ? '' : await r.text();
      const m = /<meta\\s[^>]*property="og:title"[^>]*content="([^"]*)"/.exec(text);
      out[key] = { ok: r.ok, status: r.status, redirected: r.redirected, url: r.url, ogTitle: m ? m[1] : null };
    } catch (e) { out[key] = { error: String(e), name: e.name }; }
  };
  await read('page', ${JSON.stringify(`${BASE}/marketplaces`)});
  await read('alias', ${JSON.stringify(`${ALIASES[0] ?? BASE}/nutzaps`)});
  await read('head', ${JSON.stringify(`${BASE}/data/nutzaps`)}, { method: 'HEAD' });
  await read('mcp', ${JSON.stringify(MCP)});
  out.icon = await new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res({ loaded: true, width: img.naturalWidth });
    img.onerror = () => res({ loaded: false });
    img.src = ${JSON.stringify(`${BASE}/apple-touch-icon.png`)};
  });
  return JSON.stringify(out);
})()`;

if (NO_BROWSER) {
  console.log('browser: skipped (--no-browser)');
} else {
  console.log(`browser: headless Chrome on ${ORIGIN}`);
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const PORT = 9300 + (process.pid % 500);
  const PROFILE = await mkdtemp(join(tmpdir(), 'verify-link-previews-'));
  const chrome = launchChrome({ path: CHROME, port: PORT, profile: PROFILE });
  let ws;
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
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); }, 120000);
      pending.set(i, (msg) => {
        clearTimeout(timer);
        if (msg.error) rej(new Error(`CDP error on ${method}: ${msg.error.message}`));
        else res(msg.result);
      });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const BROWSER_UA = (await send('Browser.getVersion')).userAgent;
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Network.enable', {}, s);
    await send('Network.setUserAgentOverride', { userAgent: `${BROWSER_UA} ${MARK}` }, s);
    await send('Page.navigate', { url: `${ORIGIN}/` }, s);
    let here = '';
    for (let i = 0; i < 40 && here !== ORIGIN; i++) {
      await sleep(250);
      here = (await send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true }, s)).result.value;
    }
    if (here !== ORIGIN) throw new Error(`could not open ${ORIGIN} (at ${here})`);
    const r = await send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true }, s);
    const out = JSON.parse(r.result.value);
    check(out.page?.ok && !!out.page.ogTitle, 'browser fetch() of a page: readable, og:title found', JSON.stringify(out.page));
    if (ALIASES.length) {
      check(out.alias?.ok && out.alias.redirected && out.alias.url === `${BASE}/nutzaps`, 'browser fetch() of an old alias link: follows the 308 (permanent redirect) to the apex', JSON.stringify(out.alias));
    }
    check(out.head?.ok === true, 'browser HEAD of a page: readable', JSON.stringify(out.head));
    check(out.icon?.loaded === true, 'browser <img crossorigin> of the site icon: loads', JSON.stringify(out.icon));
    // A CORS refusal surfaces as a TypeError; a timeout (TimeoutError) proves nothing. The
    // wire check above has already seen the MCP server answer, so this is the exclusion.
    check(out.mcp?.name === 'TypeError', 'browser fetch() of /mcp: REFUSED (the API is excluded)', JSON.stringify(out.mcp));
    await send('Target.closeTarget', { targetId });
  } catch (e) {
    check(false, 'browser checks', e.message);
  } finally {
    try { ws?.close(); } catch { /* closing */ }
    await stopChrome(chrome, PROFILE);
  }
}

console.log(failures === 0 ? 'verify-link-previews: ALL checks passed' : `verify-link-previews: ${failures} check(s) FAILED`);
exitProcess(failures === 0 ? 0 : 1);
