// Keeping a verify script's browser out of Google Analytics.
//
// A script is never the operator: only the operator's signed-in session is served pages without
// Google Analytics (src/hooks.server.ts), and a script cannot sign in as them. So the pages a
// script loads on the live site carry gtag.js like any visitor's, and a run would be counted.
// Instead the script's browser blocks Google's analytics hosts (blockGoogle), and the script
// checks that no request to them got through (googleLeaks). The access log tells a script's
// requests apart by its `nozzl-verify-*` User-Agent.

/** Google's analytics hosts. */
export const GOOGLE = /google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net/;

/** The same hosts, as patterns for CDP's Network.setBlockedURLs. */
export const GOOGLE_BLOCKED_URLS = ['*google-analytics.com*', '*googletagmanager.com*', '*analytics.google.com*', '*doubleclick.net*'];

/**
 * Block Google's analytics hosts in one CDP session. Enables the Network domain first, which
 * setBlockedURLs needs; enabling it twice is harmless.
 */
export async function blockGoogle(send, sessionId) {
  await send('Network.enable', {}, sessionId);
  await send('Network.setBlockedURLs', { urls: GOOGLE_BLOCKED_URLS }, sessionId);
}

/**
 * The URLs of requests to a Google analytics host that were NOT blocked, from one session's CDP
 * events. A blocked request is still reported (requestWillBeSent), then fails with a
 * `blockedReason`; only one that did not fail that way reached Google. Read it once the page's
 * network has settled, or a request still in flight counts as a leak.
 */
export function googleLeaks(events) {
  const blocked = new Set(
    events.filter((e) => e.method === 'Network.loadingFailed' && e.params.blockedReason).map((e) => e.params.requestId)
  );
  return events
    .filter((e) => e.method === 'Network.requestWillBeSent' && GOOGLE.test(e.params.request.url) && !blocked.has(e.params.requestId))
    .map((e) => e.params.request.url);
}

/** A Log domain entry that only reports a Google request the script blocked itself. */
export function isBlockedGoogleLog(entry) {
  return GOOGLE.test(entry?.url ?? '');
}
