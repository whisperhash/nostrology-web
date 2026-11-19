#!/usr/bin/env bash
# Behavioural test for deploy/Caddyfile - asserts the edge routing rules that the
# comments in that file CLAIM, so the claims can't silently rot.
#
# Everything here is invisible to `caddy validate`, which proves the file PARSES, not
# that it ROUTES:
#
#   hosts             nostrolo.gy is the content host; dev.nostrolo.gy and www.nostrolo.gy
#                     are aliases that answer every request with a literal 308 to the same
#                     path and query on the apex, carrying `Cache-Control: no-store` (a
#                     301 would turn an MCP client's POST into a GET; a cacheable 308 would
#                     pin the alias names in browsers). Section 8.
#
#   (junk-filter)     404s scanner probes at the edge on every vhost. Its regex is
#                     unanchored on the `/wp-*` branch, so it necessarily overlaps the
#                     `[...relay]` / `[...mint]` catch-all namespaces - this proves junk
#                     is refused while real routes and 64-hex blob keys are not.
#
#   (operator-marker) tags the operator's own requests: those carrying the
#                     `__Host-nozzl_op` cookie whose value is exactly OPERATOR_MARKER, the
#                     secret the app's login sets it to. The tag MUST reach the access log
#                     as a top-level `log_append` scalar, because Caddy redacts the Cookie
#                     REQUEST header in access logs by default - a cookie-only scheme
#                     would log nothing at all. Section 6 is what stops a future edit from
#                     silently regressing to that, proves no other cookie or value tags a
#                     request, and runs the real matcher with OPERATOR_MARKER unset and
#                     empty, where it must match nothing. Section 7: the retired
#                     enrolment link is an ordinary page that sets nothing.
#
#   loggers, HSTS     each host writes to the logger its comments name (the traffic
#                     analyses depend on it) and sends the HSTS value decided for it.
#
#   (log-filter)      what every log line keeps out: the client's address, in its own
#                     fields, in each header that can carry one and inside an error's
#                     text; the ETag headers; and two credential headers - on the site
#                     loggers AND on `log default`, which takes
#                     Caddy's error, proxy, TLS and admin lines and its lines for host names
#                     no site claims. Rules key on CANONICAL header names and a rule keyed
#                     any other way is ignored without an error, so every header goes out
#                     spelled another way and is read back out of the log. Section 13 also
#                     checks that the operator marker's value reaches no line, which
#                     Caddy's own redaction of the Cookie header sees to.
#
#   (link-preview-cors) `Access-Control-Allow-Origin: *` on GET/HEAD of pages, assets,
#                     robots.txt and the alias 308s, so web clients that build link cards
#                     in the browser can read them - and on nothing else: not the APIs
#                     (/mcp, /api), not other methods, not the blob store. Never
#                     two values, and never credentials or exposed headers; an upstream's
#                     own value is kept, which only a real proxy hop can show (the one
#                     test-only reverse_proxy the transform appends). Section 12.
#
# Method: transform the REAL Caddyfile (TLS off, hostnames -> .localtest, reverse_proxy
# -> stub `respond`) so structure, directive order and matchers are byte-identical to
# production, then drive it with curl. Every substitution is asserted to have happened
# exactly once, and the junk matcher line is asserted identical to the real one, so this
# can never drift into testing a different file.
#
# The alias redirect TARGET (`https://nostrolo.gy{uri}`) is deliberately left
# untransformed: the tests read it from the Location header, and never follow it
# automatically.
#
# Usage:  ./deploy/test-caddyfile.sh            # exits non-zero on any failure
#         PORT=9001 ./deploy/test-caddyfile.sh
#
# Requires: docker. Fail-loud per repo convention (set -Eeuo pipefail + ERR trap).
set -Eeuo pipefail
trap 'echo "test-caddyfile.sh: aborted at line ${LINENO} (cmd: ${BASH_COMMAND})" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE="${HERE}/Caddyfile"
# The image has ONE source: deploy/caddy-image, beside this script, which the deployment
# reads too, so the harness can never run its assertions against a different Caddy than
# the one deployed. It was a literal with a "keep in lockstep" comment until the
# 2.11.4 -> 2.11.7 bump, which had to find and edit both - a comment is not a mechanism.
IMAGE="$(grep -v -E '^[[:space:]]*(#|$)' "${HERE}/caddy-image" | tr -d '[:blank:]' || true)"
if [ "$(printf '%s\n' "$IMAGE" | grep -c .)" != 1 ] \
   || ! grep -qxE 'caddy:[0-9A-Za-z._-]+(@sha256:[0-9a-f]{64})?' <<<"$IMAGE"; then
  echo "${HERE}/caddy-image must hold one caddy image, such as caddy:2.11.7-alpine; it holds: ${IMAGE:-nothing}" >&2
  exit 1
fi
PORT="${PORT:-8099}"
# Section 13's one TLS listener.
TLS_PORT="${TLS_PORT:-$((PORT + 1))}"
NAME="caddyfile-test-$$"
# Temp dir lives BESIDE the Caddyfile on purpose: Docker Desktop on macOS only shares
# a configured set of paths, and /tmp (and mktemp's /var/folders) are typically NOT
# among them - a bind mount from there fails with a file-sharing error.
TMPDIR_="${HERE}/.caddyfile-test.$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMPDIR_"; }
trap cleanup EXIT

command -v docker >/dev/null || { echo "docker required" >&2; exit 1; }
mkdir -p "$TMPDIR_"

python3 - "$CADDYFILE" "$TMPDIR_/Caddyfile" <<'PY'
import re
import sys
src = open(sys.argv[1]).read()
out = src

def sub(old, new, lines=False):
    """Replace `old` EXACTLY ONCE, or fail. `lines=True` matches a whole line, which is
    required for the site addresses: "nostrolo.gy {" is also a substring of
    "blossom.nostrolo.gy {" and of the alias line, so a plain replace() would rewrite
    the wrong block and every assertion below would test something else."""
    global out
    if lines:
        hits = [i for i, l in enumerate(out.split("\n")) if l == old]
        assert len(hits) == 1, "expected exactly one line %r, found %d" % (old, len(hits))
        ls = out.split("\n")
        ls[hits[0]] = new
        out = "\n".join(ls)
    else:
        n = out.count(old)
        assert n == 1, "expected exactly one %r, found %d -- transform out of date" % (old[:60], n)
        out = out.replace(old, new)

# Every stub is padded past Caddy's `encode` min_length of 512. Without this the
# compression assertions are VACUOUS: a short response is served uncompressed wherever
# `encode` sits, so "MCP is never encoded" would pass even with encode at the site level
# - which is exactly the mistake those assertions exist to catch (verified by mutation).
PAD = "x" * 900
sub("acme_ca {$CADDY_ACME_CA}", "auto_https off\n\thttp_port 8080")
sub("nostrolo.gy {", "http://apex.localtest {", lines=True)
sub("dev.nostrolo.gy, www.nostrolo.gy {", "http://dev.localtest, http://www.localtest {", lines=True)
sub("blossom.nostrolo.gy {", "http://blossom.localtest {", lines=True)
# The app stub sets an ETag, as the real app does on every page, so section 13 can show the
# browser still gets one while the log does not.
n = out.count("reverse_proxy nostrology-web:3000")
assert n >= 1, "no app reverse_proxy found -- transform out of date"
out = out.replace("reverse_proxy nostrology-web:3000",
                  'header Etag "\\"app-stub-etag\\""\n\t\t'
                  'respond "APP-BACKEND '
                  + PAD + '" 200')
sub("reverse_proxy nostrology-mcp:8080 {\n\t\t\tflush_interval -1\n\t\t}",
    'respond "MCP-BACKEND uri=[{http.request.uri}]' + PAD + '" 200')
# The blob stub ECHOES the upstream URI and sets the response headers S3 really sets,
# so section 11 can assert (a) that `rewrite` normalises the path and drops the query
# BEFORE anything is signed, and (b) that the site `header` block deletes the backend
# giveaways. Deliberately unpadded: blossom is not in the compression assertions, and
# a padded body would start being compressed and change what those measure.
sub("reverse_proxy nectar-sigv4:8080",
    'header Server "AmazonS3"\n\t\theader X-Amz-Request-Id "STUBREQID"\n'
    '\t\trespond "BLOB-BACKEND uri=[{http.request.uri}]" 200')
# Guards: nothing production-shaped may survive the transform in a DIRECTIVE line
# (comments may mention anything)...
code = "\n".join(l for l in out.split("\n") if not l.lstrip().startswith("#"))
for leftover in ("reverse_proxy", "acme_ca", "nostrolo.gy {", "nostrolo.gy, "):
    assert leftover not in code, "untransformed %r left in the test config" % leftover
# ...the redirect target is the one thing deliberately kept...
assert out.count("redir https://nostrolo.gy{uri} 308") == 1, "alias redirect line changed"
# ...and the matcher under test is byte-identical to production.
a = [l for l in src.splitlines() if "@junk path_regexp" in l]
b = [l for l in out.splitlines() if "@junk path_regexp" in l]
assert a and a == b, "junk matcher differs between real and test config -- transform bug"
assert out.count("import junk-filter") == 3, "expected junk-filter imported by 3 site blocks"
assert out.count("import operator-marker") == 1, "expected operator-marker imported by the apex block alone"
# Directive lines only: the Caddyfile's comments name the import too.
assert code.count("import log-filter") == 4, "expected log-filter imported by the 3 site logs and log default"
# Every `log` must run through the filter. A second logger for a site, or a new site's, with
# plain `format json` or no `format` at all, logs unfiltered - and section 13 only sees the
# loggers its probes happen to reach.
fmt = [l.strip() for l in code.split("\n") if l.strip().startswith("format ")]
assert fmt and all(l == "format filter {" for l in fmt), "every log must use format filter: %r" % fmt
logs = [l.strip() for l in code.split("\n") if re.match(r"\s*log(\s|\{|$)", l)]
assert len(logs) == len(fmt) == code.count("import log-filter"), \
    "every log needs format filter with import log-filter: %r" % logs
# The one rule section 13 cannot drive: certmagic's `remote`, logged only while an ACME
# challenge is being served.
snippet = src[src.index("(log-filter) {"):]
snippet = snippet[:snippet.index("\n}\n")]
assert "\n\tremote delete\n" in snippet, "(log-filter) lost its top-level remote rule"
assert out.count("import link-preview-cors") == 2, "expected link-preview-cors imported by the apex and alias blocks"
# Section 12's proxy-hop probe, appended AFTER the guards above: it is test-only, and it
# deliberately holds a real reverse_proxy. Every app stub above is a `respond`, so without
# a real hop the harness cannot see reverse_proxy ADD an upstream's own
# Access-Control-Allow-Origin to the one the snippet set - two values, which browsers
# reject. The site imports the REAL snippet; its upstream is a second listener in the same
# container that sends its own header on /own and none anywhere else.
out += """
http://upstream-acao.localtest {
\timport link-preview-cors
\treverse_proxy 127.0.0.1:8081
}

http://:8081 {
\thandle /own {
\t\theader Access-Control-Allow-Origin "https://upstream.example"
\t\trespond "UPSTREAM-OWN" 200
\t}
\thandle {
\t\trespond "UPSTREAM-PLAIN" 200
\t}
}
"""
# Section 6's fail-closed probes: the REAL matcher line, byte for byte but for the variable it
# reads, which is UNSET in the container for one block and set but EMPTY for the other.
m = [l for l in src.splitlines() if l.strip().startswith("@op_marked ")]
assert len(m) == 1 and "{$OPERATOR_MARKER}" in m[0], "operator-marker matcher not found -- transform out of date"
for host, var in (("marker-unset", "OPERATOR_MARKER_UNSET_FOR_TEST"), ("marker-empty", "OPERATOR_MARKER_EMPTY_FOR_TEST")):
    out += "\nhttp://%s.localtest {\n%s\n\theader @op_marked X-Nozzl-Operator \"1\"\n\trespond \"%s\" 200\n}\n" % (
        host, m[0].replace("{$OPERATOR_MARKER}", "{$%s}" % var), host)
# Section 13's error line: a 502 (bad gateway) from an upstream that refuses. Test-only,
# like the probe above; nothing listens on port 9 in the container.
out += """
http://dead-upstream.localtest {
\treverse_proxy 127.0.0.1:9
}
"""
# Section 13's other test-only blocks. client-addr.localtest answers with the address Caddy
# sees for this script, which must then appear nowhere in the log. abort-probe.localtest
# proxies a large file from a second listener, so a client can hang up mid-response.
# tls-probe.localtest is the one TLS listener, for the TLS logger's line about an ALPN probe.
out += """
http://client-addr.localtest {
\trespond "{http.request.remote.host}" 200
}

http://abort-probe.localtest {
\treverse_proxy 127.0.0.1:8082
}

http://:8082 {
\troot * /tmp/log-filter-big
\tfile_server
}

https://tls-probe.localtest:8443 {
\ttls internal
\trespond "TLS-OK" 200
}
"""
open(sys.argv[2], "w").write(out)
PY

# The operator marker the matcher compares against: random per run, 64 hex characters like the
# deployment's. OPERATOR_MARKER_EMPTY_FOR_TEST is set but empty on purpose (section 6).
MARKER=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
docker run -d --name "$NAME" -p "${PORT}:8080" -p "${TLS_PORT}:8443" \
  -e OPERATOR_MARKER="$MARKER" -e OPERATOR_MARKER_EMPTY_FOR_TEST= \
  -v "$TMPDIR_/Caddyfile:/etc/caddy/Caddyfile:ro" "$IMAGE" >/dev/null

for _ in $(seq 1 25); do
  curl -fsS -o /dev/null -H 'Host: apex.localtest' "http://127.0.0.1:${PORT}/relays" 2>/dev/null && break
  sleep 0.4
done

APEX=apex.localtest
PASS=0; FAIL=0
# chk <host> <path> <want-status> [method]
chk() {
  local host="$1" path="$2" want="$3" method="${4:-GET}" got
  if [ "$method" = HEAD ]; then
    got=$(curl -s -o /dev/null -I -w '%{http_code}' -H "Host: $host" "http://127.0.0.1:${PORT}${path}")
  else
    got=$(curl -s -o /dev/null -X "$method" -w '%{http_code}' -H "Host: $host" "http://127.0.0.1:${PORT}${path}")
  fi
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); printf '  FAIL %-4s %-18s %-46s got %s want %s\n' "$method" "$host" "$path" "$got" "$want"
  fi
}

# --- 1. Scanner junk is refused at the edge on EVERY vhost -------------------------
# Includes the path-prefixed wlwmanifest variants observed live on blossom 2026-07-25,
# which the previous content-block-only `path` list did not match. On the alias hosts
# this also proves junk wins over the redirect: it only does because the `redir` is
# wrapped in `handle` (a bare redir sorts AHEAD of handle in Caddy's directive order).
for host in "$APEX" dev.localtest www.localtest blossom.localtest; do
  for p in /ads.txt /app-ads.txt /sellers.json /xmlrpc.php /wp-login.php \
           /wp-admin /wp-admin/index.php /wp-includes/wlwmanifest.xml \
           /blog/wp-includes/wlwmanifest.xml /wordpress/wp-includes/wlwmanifest.xml \
           /2018/wp-includes/wlwmanifest.xml /shop/wp-includes/wlwmanifest.xml \
           /wp-content/plugins/hellopress/wp_filemanager.php /XMLRPC.PHP; do
    chk "$host" "$p" 404
  done
done

# --- 2. Real app routes still reach the backend ------------------------------------
# NB the reverse_proxy is a stub `respond 200`, so 200 here means "Caddy handed this
# path to the app", NOT "the app served a page". That is the property worth guarding:
# (junk-filter) is matched BEFORE the catch-all proxy and gets widened over time, so a
# new pattern could start swallowing a real route. (@badbots was the other such matcher
# until it was deleted on 2026-09-22; see section 5d.)
# It also means the legacy /zapstore/<pubkey> shapes below CANNOT be asserted as 308 -
# the redirect is the app's, and the stub never issues it. Their 308 is pinned in
# src/routes/(app)/zapstore/legacy-redirects.test.ts instead.
ZS_PK=7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19
for p in / /relays /nutzaps /zapstore /lightning /nutzaps/mints \
         /nutzaps/mints/mint.lnwasanee.com /relays/relay.damus.io \
         /zapstore/apps /zapstore/leaderboards \
         "/zapstore/publishers/${ZS_PK}" \
         "/zapstore/apps/${ZS_PK}/com.greenart7c3.nostrsigner" \
         "/zapstore/${ZS_PK}" "/zapstore/${ZS_PK}/com.greenart7c3.nostrsigner" \
         /__data.json /nutzaps/__data.json /_app/immutable/chunks/BdEtWlSi.js \
         /favicon.ico /apple-touch-icon.png; do
  chk "$APEX" "$p" 200
done

# --- 3. Blossom blob keys are never caught by the filter ---------------------------
# 64-hex keys cannot contain "wp-" or end in ".php", but assert it rather than argue it.
BLOB=b52a892cf2711eb102bb75e3961efdb3a64ffd39e427190771795a7837bf740a
chk blossom.localtest "/${BLOB}.parquet" 200
chk blossom.localtest "/${BLOB}"         200
chk blossom.localtest "/${BLOB}.parquet" 200 HEAD

# --- 4. False-positive guards -------------------------------------------------------
# `/wp-adminish` is a REGRESSION TEST: the old `path /wp-admin*` prefix glob matched it;
# the `(/|$)` boundary in the new regex must not.
for p in /wp-contents /wordpress /wp /sellers.json.bak /ads.txt.old \
         /relays/wp-adminish /wp-adminish; do
  chk "$APEX" "$p" 200
done

# --- 5. Pre-existing behaviour preserved --------------------------------------------
chk "$APEX"           /robots.txt 200          # edge-answered on the content host, never proxied
chk blossom.localtest /somekey    405 POST     # read-only store rejects writes

# --- 5b. MCP endpoint + registry pages (2026-07-30) ---------------------------------
# The load-bearing ordering claim that remains: junk-filter wins over the /mcp handle,
# so a scanner probing /mcp/xmlrpc.php still 404s at the edge. The ordering this section
# originally existed for - /mcp and /data ahead of @badbots, because real MCP clients and
# AI crawlers identify as exactly the UAs that list denied - is moot since that deny-list
# was deleted on 2026-09-22 (section 5d asserts no UA is refused now).

# chku <host> <path> <want-status> <user-agent>
chku() {
  local host="$1" path="$2" want="$3" ua="$4" got
  got=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $host" -A "$ua" "http://127.0.0.1:${PORT}${path}")
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL UA=%-18s %-30s got %s want %s\n' "$ua" "$path" "$got" "$want"; fi
}
# body <host> <path> <want-body-substring>  - which stub answered (i.e. which handle won)
body() {
  local host="$1" path="$2" want="$3" got
  got=$(curl -s -H "Host: $host" "http://127.0.0.1:${PORT}${path}")
  if grep -qF -- "$want" <<<"$got"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %-30s body %-14s want %s\n' "$path" "$got" "$want"; fi
}

# /mcp routes to the MCP backend (exact + subpaths), POST included (JSON-RPC is POST).
body "$APEX" /mcp            MCP-BACKEND
body "$APEX" /mcp/anything   MCP-BACKEND
chk  "$APEX" /mcp 200 POST
# /mcp/ must be SERVED, never redirected. Left to the backend, Starlette answers it with
# a 307 to an absolute http:// URL (uvicorn does not trust the bridge's X-Forwarded-Proto),
# and a 307 keeps the method and the body - which for one tool is a bearer Cashu token.
# So the trailing slash is stripped at the edge, and these pin that it stays stripped.
body "$APEX" /mcp/           MCP-BACKEND
chk  "$APEX" /mcp/ 200
chk  "$APEX" /mcp/ 200 POST
# The backend must RECEIVE the slashless path - that is the actual fix, and the only part
# of it this harness can observe.
body "$APEX" /mcp/                        "uri=[/mcp]"
body "$APEX" /mcp                         "uri=[/mcp]"
# ...and the query must survive the rewrite, or the traffic marking is stripped off every
# first-party call that happens to carry the trailing slash.
body "$APEX" "/mcp/?traffic_type=internal" "uri=[/mcp?traffic_type=internal]"
body "$APEX" "/mcp?traffic_type=internal"  "uri=[/mcp?traffic_type=internal]"
# Boundary: /mcp is a path match, not a prefix glob - /mcpfoo is NOT the endpoint.
body "$APEX" /mcpfoo         APP-BACKEND
# /data reaches the app through the catch-all (its own handle existed only to sit
# in front of @badbots, and went with it).
body "$APEX" /data                                 APP-BACKEND
body "$APEX" /data/zapstore/native_release_count   APP-BACKEND

# /api/auth/* (login) reaches the app through the catch-all, POST included, with no handle
# of its own (the endpoints cap their bodies themselves).
body "$APEX" /api/auth/login      APP-BACKEND
chk  "$APEX" /api/auth/login 200 POST
chk  "$APEX" /api/auth/challenge 200 POST

# NO User-Agent is refused any more. The @badbots deny-list was removed on 2026-09-22
# (its reason - a paused Aurora cluster - ended on 2026-08-03), and these are the exact
# agents the site now wants: AI crawlers, SEO crawlers, and the HTTP-library UAs that
# real MCP clients send. A 403 for any of them is a regression, on EVERY surface, not
# just the two handles that used to bypass the list.
for ua in GPTBot/1.0 ClaudeBot/1.0 MJ12bot/v1.4 "AhrefsBot/7.0" python-requests/2.32; do
  chku "$APEX" /        200 "$ua"
  chku "$APEX" /relays  200 "$ua"
  chku "$APEX" /data    200 "$ua"
done
for ua in python-requests/2.32 python-httpx aiohttp/3.9 Go-http-client/2.0; do
  chku "$APEX" /mcp     200 "$ua"
done

# junk-filter still beats every handle (source order: junk imports first) - the one
# thing that IS still refused, and it is refused by path, not by who is asking.
chk "$APEX" /mcp/xmlrpc.php     404
chk "$APEX" /data/wp-includes/wlwmanifest.xml 404
chku "$APEX" /wp-login.php 404 "GPTBot/1.0"

# robots.txt: the site is open, and the file names none of the hidden pages. Asserted by
# EXACT LINE (-x): a substring test would pass "Disallow: /" against "Disallow: /mcp$"
# and stay green whatever the rule set became.
ROBOTS=$(curl -s -H "Host: $APEX" "http://127.0.0.1:${PORT}/robots.txt")
for needle in "User-agent: *" "Disallow: /mcp\$" "Disallow: /mcp/" "Disallow: /api/" "Sitemap: https://nostrolo.gy/sitemap.xml"; do
  if grep -qxF -- "$needle" <<<"$ROBOTS"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); echo "  FAIL robots.txt must contain the line '$needle'"; fi
done
# The blanket disallow must be GONE, and no hidden path may be named: robots.txt is
# public, so a Disallow line publishes the path it is trying to hide.
for forbidden in "Disallow: /" "Allow: /data" "Disallow: /wip" "Disallow: /relays" "Disallow: /zapstore/apps" "Disallow: /routstr"; do
  if grep -qxF -- "$forbidden" <<<"$ROBOTS"; then
    FAIL=$((FAIL+1)); echo "  FAIL robots.txt must NOT contain the line '$forbidden'"
  else PASS=$((PASS+1)); fi
done
if [ "$(printf '%s\n' "$ROBOTS" | grep -c .)" = 5 ]; then PASS=$((PASS+1));
else FAIL=$((FAIL+1)); echo "  FAIL robots.txt must be exactly those 5 non-blank lines, got: $ROBOTS"; fi

# --- 5c. Compression, and what must NOT be compressed --------------------------------
# `encode` lives inside the catch-all handle, not at the site level, so it reaches the
# SvelteKit app and nothing else. The exclusion is the point: /mcp is an SSE stream, and an
# encoder in front of it buffers it into a single lump - exactly what `flush_interval -1`
# exists to prevent on that handle.
#
# The app stub is padded to ~900 bytes in the transform because Caddy's encode has a
# min_length of 512 and would otherwise serve the stub uncompressed, making every
# assertion here vacuously green.
# ce <label> <host> <path> <accept-encoding> <want-content-encoding ('' = none)>
ce() {
  local label="$1" host="$2" path="$3" ae="$4" want="$5" got
  got=$(curl -s -o /dev/null -D - -H "Host: $host" ${ae:+-H "Accept-Encoding: $ae"} \
        "http://127.0.0.1:${PORT}${path}" | tr -d '\r' \
        | awk 'tolower($1)=="content-encoding:"{print $2}')
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %-44s Content-Encoding=[%s] want [%s]\n' "$label" "$got" "$want"; fi
}
ce "app page gzip"            "$APEX" /relays  gzip          gzip
ce "app page zstd preferred"  "$APEX" /relays  "zstd, gzip"  zstd
ce "app page, no AE header"   "$APEX" /relays  ""            ""
ce "app page, AE: identity"   "$APEX" /relays  identity      ""
# The SSE surface must stay uncompressed no matter what the client asks for.
ce "MCP is never encoded"     "$APEX" /mcp             "zstd, gzip" ""
# The alias hosts only redirect; an empty 308 body has nothing to compress.
ce "alias 308 is not encoded" dev.localtest /relays    "zstd, gzip" ""

# --- 6. Operator marker -------------------------------------------------------------
# The whole point is that the marker lands in the ACCESS LOG. Caddy redacts the Cookie
# REQUEST header by default, so the tag must be derived at the edge instead - these
# assertions are what stop a future edit from silently reverting to a cookie-only scheme
# that logs nothing. The app sets the cookie (its login response); this harness sends it.
OP="__Host-nozzl_op=${MARKER}"

# hdr <host> <path> <header-name> <expect-present:0|1> [cookie]
hdr() {
  local host="$1" path="$2" name="$3" want="$4" cookie="${5:-}" out got
  if [ -n "$cookie" ]; then
    out=$(curl -s -D- -o /dev/null -H "Host: $host" -H "Cookie: $cookie" "http://127.0.0.1:${PORT}${path}")
  else
    out=$(curl -s -D- -o /dev/null -H "Host: $host" "http://127.0.0.1:${PORT}${path}")
  fi
  if grep -qi "^${name}:" <<<"$out"; then got=1; else got=0; fi
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); printf '  FAIL %-18s %-40s %s present=%s want=%s\n' "$host" "$path" "$name" "$got" "$want"
  fi
}
# want <label> <needle> <haystack>  - substring assertion
want() {
  if grep -qiF -- "$2" <<<"$3"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %s: expected to contain %s\n' "$1" "$2"; fi
}
# hval <label> <host> <path> <header-name> <want-exact-value> [method]
# Exact value of ONE response header (case-insensitive name, CR stripped). Exact on
# purpose: `max-age=31536000` must not pass for `max-age=315360000`.
hval() {
  local label="$1" host="$2" path="$3" name="$4" want="$5" method="${6:-GET}" got
  got=$(curl -s -D- -o /dev/null -X "$method" -H "Host: $host" "http://127.0.0.1:${PORT}${path}" \
        | tr -d '\r' | grep -i "^${name}:" | head -1 | sed 's/^[^:]*: //' || true)
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %s: %s is [%s], want [%s]\n' "$label" "$name" "$got" "$want"; fi
}

# The marker tags every request to the content host: pages, static assets, SvelteKit's
# data requests, and what the edge answers itself.
hdr "$APEX" "/relays"                              X-Nozzl-Operator 1 "$OP"
hdr "$APEX" "/_app/immutable/chunks/BdEtWlSi.js"   X-Nozzl-Operator 1 "$OP"
hdr "$APEX" "/nutzaps/__data.json"                 X-Nozzl-Operator 1 "$OP"
hdr "$APEX" "/robots.txt"                          X-Nozzl-Operator 1 "$OP"
# ...alongside other cookies, in any position.
hdr "$APEX" "/relays" X-Nozzl-Operator 1 "_ga=GA1.1.1.1; ${OP}"
hdr "$APEX" "/relays" X-Nozzl-Operator 1 "${OP}; _ga=GA1.1.1.1"
# Everyone else is untagged: no cookie, other cookies, and the session cookie on its own -
# whose pubkey is in clear, so a rule keyed on it could be met by anyone.
hdr "$APEX" "/relays" X-Nozzl-Operator 0
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "_ga=GA1.1.123.456; other=x"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "__Host-nostrology_session=s2.$(printf 'a%.0s' $(seq 64)).4000000000000.mac"
# NOTHING BUT THE EXACT SECRET: a wrong, longer, shorter or empty value; the right value
# under another name; the retired cookie; a name that merely contains the real one.
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "__Host-nozzl_op=$(printf '0%.0s' $(seq 64))"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "__Host-nozzl_op=${MARKER}0"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "__Host-nozzl_op=${MARKER%?}"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "__Host-nozzl_op="
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "nozzl_op=${MARKER}"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "nozzl_op=1"
hdr "$APEX" "/relays" X-Nozzl-Operator 0 "x__Host-nozzl_op=${MARKER}"
# This host only: the cookie is host-only, so the blob store and the aliases never get it,
# and the snippet is not imported there.
hdr blossom.localtest "/${BLOB}.parquet"  X-Nozzl-Operator 0 "$OP"
hdr dev.localtest     "/"                 X-Nozzl-Operator 0 "$OP"
hdr www.localtest     "/"                 X-Nozzl-Operator 0 "$OP"
# Caddy sets no cookie, tagged or not: the login and logout responses own the marker.
hdr "$APEX" "/relays" Set-Cookie 0 "$OP"
hdr "$APEX" "/relays" Set-Cookie 0

# FAIL CLOSED. The real matcher, with OPERATOR_MARKER unset and with it set but empty: an
# empty marker cookie, or none, must tag nothing. Without the size guard both would.
for host in marker-unset.localtest marker-empty.localtest; do
  hdr "$host" "/" X-Nozzl-Operator 0 "__Host-nozzl_op="
  hdr "$host" "/" X-Nozzl-Operator 0
  hdr "$host" "/" X-Nozzl-Operator 0 "$OP"
done
# ...and the probes answered at all, so the zeros above are not a dead listener.
chk marker-unset.localtest / 200
chk marker-empty.localtest / 200

# The marker must not disturb the junk filter, and junk from the operator is still refused.
chk "$APEX" /xmlrpc.php 404
hdr "$APEX" "/xmlrpc.php"           X-Nozzl-Operator 1 "$OP"

# THE ACTUAL DELIVERABLE: the tag must reach the ACCESS LOG as a top-level scalar, which
# is what makes `| json | operator="1"` work in Loki. Asserting the wire header alone
# would pass even if log_append were deleted.
LOG=$(docker logs "$NAME" 2>&1 | grep '"msg":"handled request"' | grep '"operator"' | tail -1)
want "log_append operator field" '"operator":"1"' "$LOG"
python3 - "$LOG" <<'PY'
import json, sys
line = sys.argv[1]
try:
    j = json.loads(line)
except Exception:
    print("  FAIL access-log line is not valid JSON"); sys.exit(1)
assert j.get("operator") == "1", "operator must be a TOP-LEVEL string, got %r" % j.get("operator")
# Guard the array trap that broke the first draft's documented LogQL.
rh = j.get("resp_headers", {}).get("X-Nozzl-Operator")
assert isinstance(rh, list), "resp_headers values are arrays -- Loki's | json skips them"
PY
[ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
# Untagged requests must NOT carry the field at all (not "" or null).
curl -s -o /dev/null -H "Host: $APEX" "http://127.0.0.1:${PORT}/lightning" ; sleep 1
UNTAGGED=$(docker logs "$NAME" 2>&1 | grep '"uri":"/lightning"' | tail -1)
if grep -q '"operator"' <<<"$UNTAGGED"; then
  FAIL=$((FAIL+1)); echo "  FAIL untagged request must not carry an operator field"
else PASS=$((PASS+1)); fi
# EARLY (`<operator`), so a proxied response that aborts mid-body still carries the field:
# the late form adds it on the way back out, and exactly those lines lose it. No harness
# here can abort a response mid-body, so the form itself is pinned.
if grep -qE '^[[:space:]]*log_append @op_marked <operator 1$' "$CADDYFILE"; then PASS=$((PASS+1))
else FAIL=$((FAIL+1)); echo "  FAIL the operator field must be appended early (log_append @op_marked <operator 1)"; fi

# --- 7. The retired enrolment link (retired 2026-11-15) ---------------------------------
# `/?nozzl_op=<token>` used to set an operator cookie here. Signing in is the only way now, so
# the old link, with any value, is an ordinary page: proxied to the app, with no cookie set.
chk  "$APEX" "/?nozzl_op=0123456789abcdef0123456789abcdef" 200
body "$APEX" "/?nozzl_op=0123456789abcdef0123456789abcdef" APP-BACKEND
hdr  "$APEX" "/?nozzl_op=0123456789abcdef0123456789abcdef" Set-Cookie 0
hdr  "$APEX" "/?nozzl_op=0123456789abcdef0123456789abcdef" X-Nozzl-Operator 0

# --- 8. Alias hosts: a literal 308 to the same path and query on the apex -----------
# Every request, every method: the MCP endpoint is POST, and JSON-RPC clients configured
# with the old URL must keep working. A 301 (Caddy's `permanent`) would pass a GET-only
# test and break every one of them, so the STATUS is asserted per method, not assumed.
for host in dev.localtest www.localtest; do
  for m in GET HEAD POST DELETE; do
    chk "$host" /mcp 308 "$m"
  done
  chk "$host" /           308
  chk "$host" /robots.txt 308          # a crawler follows it to the apex's robots.txt
  chk "$host" /data       308
  hval "$host keeps path and query"  "$host" "/zapstore/apps/${ZS_PK}/x?utm_source=nostr&a=1" Location \
       "https://nostrolo.gy/zapstore/apps/${ZS_PK}/x?utm_source=nostr&a=1"
  hval "$host keeps the MCP marking" "$host" "/mcp?traffic_type=internal" Location \
       "https://nostrolo.gy/mcp?traffic_type=internal" POST
  hval "$host root"                  "$host" "/" Location "https://nostrolo.gy/"
  # A browser must not cache the redirect: it keeps dev.nostrolo.gy re-pointable and a
  # rollback effective on the next request (RFC 9110 15.4.9: a 308 is heuristically
  # cacheable unless explicit cache controls say otherwise).
  hval "$host redirect is not cacheable" "$host" "/relays" Cache-Control "no-store"
  hval "$host redirect is not cacheable (POST)" "$host" "/mcp" Cache-Control "no-store" POST
  # The redirect never reaches a backend.
  if curl -s -X POST -H "Host: $host" "http://127.0.0.1:${PORT}/mcp" | grep -qF BACKEND; then
    FAIL=$((FAIL+1)); echo "  FAIL $host: an alias request reached a backend"; else PASS=$((PASS+1)); fi
done
# Only the aliases carry no-store: the content host's pages are not affected by it.
hval "apex pages carry no alias no-store" "$APEX" "/relays" Cache-Control ""

# --- 9. HSTS per host -----------------------------------------------------------------
# One year on the content host, no includeSubDomains (a subdomain is served by another host)
# and no preload; one day on the alias names and blossom, so nothing pins them for long.
hval "apex HSTS"        "$APEX"           "/relays"          Strict-Transport-Security "max-age=31536000"
hval "apex HSTS on MCP" "$APEX"           "/mcp"             Strict-Transport-Security "max-age=31536000"
hval "dev HSTS"         dev.localtest     "/relays"          Strict-Transport-Security "max-age=86400"
hval "www HSTS"         www.localtest     "/"                Strict-Transport-Security "max-age=86400"
hval "blossom HSTS"     blossom.localtest "/${BLOB}.parquet" Strict-Transport-Security "max-age=86400"

# The two content-type/framing headers are set by EVERY site block, with no exceptions to
# remember - including the alias blocks, whose bodies are an empty 308 and a junk 404.
# blossom included: the claim in the Caddyfile is that EVERY site block sets both, and
# a loop that skips a host cannot catch the block that forgets them (blossom did).
for host in "$APEX" dev.localtest www.localtest blossom.localtest; do
  hval "$host nosniff"     "$host" "/relays"       X-Content-Type-Options "nosniff"
  hval "$host frame DENY"  "$host" "/relays"       X-Frame-Options        "DENY"
  # A real junk path, not /.env: /.env is NOT in the junk regex, so it used to 308 on the
  # aliases and the assertion passed while testing something other than its label.
  hval "$host nosniff (junk 404)" "$host" "/wp-login.php" X-Content-Type-Options "nosniff"
done

# --- 10. Each host writes to the logger its role names ----------------------------------
# Traffic analyses count served requests from access_site and read access_alias as hops;
# a host landing in the wrong logger would double-count or vanish without an error.
curl -s -o /dev/null -H "Host: $APEX"           "http://127.0.0.1:${PORT}/logger-probe-apex"
curl -s -o /dev/null -H "Host: dev.localtest"     "http://127.0.0.1:${PORT}/logger-probe-dev"
curl -s -o /dev/null -H "Host: www.localtest"     "http://127.0.0.1:${PORT}/logger-probe-www"
curl -s -o /dev/null -H "Host: blossom.localtest" "http://127.0.0.1:${PORT}/logger-probe-blossom"
sleep 1
logger_is() { local probe="$1" want="$2" got
  got=$(docker logs "$NAME" 2>&1 | grep "\"uri\":\"/logger-probe-${probe}\"" | tail -1 \
        | python3 -c 'import json,sys; print(json.loads(sys.stdin.read() or "{}").get("logger",""))')
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL logger for %s is [%s], want [%s]\n' "$probe" "$got" "$want"; fi
}
logger_is apex    http.log.access.access_site
logger_is dev     http.log.access.access_alias
logger_is www     http.log.access.access_alias
logger_is blossom http.log.access.access_blossom
# The retired names must never come back (a reused name would silently merge eras).
if grep -qE 'log (access_web|access_redirect)\b' "$CADDYFILE"; then
  FAIL=$((FAIL+1)); echo "  FAIL a retired logger name (access_web / access_redirect) is in use"
else PASS=$((PASS+1)); fi

# --- 11. Only a blob-shaped path is ever signed (2026-09-23) --------------------------
# The blossom vhost proxies to a sidecar that SigV4-signs with the box INSTANCE ROLE, so
# every byte that reaches it is signed with a live credential. Two leaks came out of that
# before this was an allowlist, and both are pinned here:
#
#   - `GET /` was signed and returned S3's ListBucketResult: every key, size and mtime.
#   - An escaped path that the sidecar canonicalised differently from Caddy produced a
#     SignatureDoesNotMatch body echoing the canonical request, INCLUDING the role's live
#     x-amz-security-token. `/%41` - literally `/A` - was enough.
#
# The first fix attempt was a DENY matcher (`path /` -> 404) and review proved it
# insufficient; the notes in the Caddyfile explain why. What is asserted here is the
# property, not the shape: NOTHING but a 64-hex path reaches the backend, and what does
# reach it is normalised.

# raw_chk <request-line> <want-status>  - curl ALWAYS sends origin-form, so it cannot
# express a pathless request line - and a pathless line is precisely the bypass that
# defeated the deny matcher (Go parses `GET <absolute-uri>` with no path as URL.Path ==
# "", which no `path` matcher matches, then URL.RequestURI() restores "/" upstream). So
# this drops to a raw socket. bash 3.2's /dev/tcp is enough; no new dependency. The
# request carries `Connection: close`, so the read terminates.
raw_chk() {
  local line="$1" want="$2" resp status
  exec 3<>/dev/tcp/127.0.0.1/"${PORT}"
  printf '%s\r\nHost: blossom.localtest\r\nConnection: close\r\n\r\n' "$line" >&3
  resp=$(cat <&3)
  exec 3<&-
  status=$(printf '%s' "$resp" | head -1 | tr -d '\r' | awk '{print $2}')
  if [ "$status" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL raw %-46s got %s want %s\n' "$line" "$status" "$want"; fi
  if grep -qF -- BLOB-BACKEND <<<"$resp"; then
    FAIL=$((FAIL+1)); printf '  FAIL raw %-46s REACHED THE SIGNER\n' "$line"
  else PASS=$((PASS+1)); fi
}
raw_chk 'GET http://blossom.localtest HTTP/1.1'  404
raw_chk 'HEAD http://blossom.localtest HTTP/1.1' 404

# no_body <host> <path> <forbidden-substring>  - which stub did NOT answer.
# NEVER use this alone: an empty body passes it for the wrong reason (Caddy answers an
# unmatched Host with an empty 200). Every call below is paired with a `chk ... 404` on
# the same path in the same loop, and THAT is the positive control.
no_body() {
  local host="$1" path="$2" forbidden="$3" got
  got=$(curl -s -H "Host: $host" "http://127.0.0.1:${PORT}${path}")
  if grep -qF -- "$forbidden" <<<"$got"; then
    FAIL=$((FAIL+1)); printf '  FAIL %-46s body must NOT contain %s\n' "$path" "$forbidden"
  else PASS=$((PASS+1)); fi
}

# Nothing that is not a blob reaches the signer. In order: the root and every S3 listing
# query (they all ride path `/`, since a `path` matcher tests the path alone); the
# normalisation family, which Caddy cleans to `/` BEFORE matching while reverse_proxy
# would have forwarded the raw URI; the escaped near-misses that produced the STS-token
# body; the Blossom endpoints we do not implement; and wrong-length / wrong-case hashes.
for p in / "/?prefix=" "/?list-type=2" "/?delimiter=/" "/?max-keys=1" "/?versions" "/?uploads" \
         // /// "/." "/foo/.." "/%2e" "/%2f" "/%2e%2e" \
         "/%41" "/;" "/;x" "/a+b" "/%00" "/a%2Fb" \
         /list /list/somepubkey /upload /mirror /media /report /favicon.ico \
         "/${BLOB%??}" "/${BLOB}ab" "/$(printf '%s' "$BLOB" | tr 'a-f' 'A-F')"; do
  chk     blossom.localtest "$p" 404
  no_body blossom.localtest "$p" BLOB-BACKEND
done
chk blossom.localtest / 404 HEAD

# Writes are still refused with 405 everywhere, blob path included: the allowlist changed
# what is READ, not the read-only invariant. @blob is scoped to GET HEAD, so a write on a
# real blob falls past it to the catch-all rather than being claimed by the 404.
for m in POST PUT DELETE PATCH; do
  chk blossom.localtest /                  405 "$m"
  chk blossom.localtest "/${BLOB}.parquet" 405 "$m"
done

# A real blob is still served, GET and HEAD, with and without an extension.
chk blossom.localtest "/${BLOB}"         200
chk blossom.localtest "/${BLOB}.parquet" 200
chk blossom.localtest "/${BLOB}.parquet" 200 HEAD

# ...and what reaches the signer is the MATCHED path, nothing else. Two properties:
#   1. The QUERY is dropped, so an S3 subresource cannot be smuggled onto a real blob -
#      `/<blob>.parquet?acl` returned an AccessDenied body carrying the role ARN.
#   2. The ESCAPING is normalised, so the signer can never see a different string from
#      the one the matcher tested. That divergence is what produced the
#      SignatureDoesNotMatch body containing the live x-amz-security-token.
body blossom.localtest "/${BLOB}.parquet"     "uri=[/${BLOB}.parquet]"
body blossom.localtest "/${BLOB}.parquet?acl" "uri=[/${BLOB}.parquet]"
body blossom.localtest "/%62${BLOB#?}"        "uri=[/${BLOB}]"

# The backend is not advertised. The stub sets the headers S3 really sets; the site
# header block must delete them. (`-X-Amz-*` is a wildcard deletion, so one rule covers
# x-amz-request-id, x-amz-id-2, x-amz-server-side-encryption and x-amz-bucket-arn.)
absent() {
  local path="$1" field="$2" got
  got=$(curl -s -o /dev/null -D - -H "Host: blossom.localtest" \
        "http://127.0.0.1:${PORT}${path}" | grep -ci "^${field}:" || true)
  if [ "$got" = "0" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %-46s must not carry %s\n' "$path" "$field"; fi
}
absent "/${BLOB}.parquet" Server
absent "/${BLOB}.parquet" X-Amz-Request-Id

# No over-reach onto the CONTENT host, which is a different site block entirely.
chk "$APEX" / 200

# --- 12. Link-preview CORS (2026-10-14) ---------------------------------------------------
# Web clients that build a link card IN THE BROWSER (noStrudel, older Jumble forks, Nostter's
# fallback) can read a page only if it carries Access-Control-Allow-Origin, and an image
# loaded with `crossorigin` needs it too. Exact value `*`, on GET and HEAD of pages, assets
# and robots.txt, and on the alias 308s - the browser applies the CORS check to a redirect too.
for path in / /marketplaces /data/nutzaps "/zapstore/apps/${ZS_PK}/x?utm_source=nostr" \
            /social-card.png /apple-touch-icon.png /robots.txt; do
  hval "apex CORS GET $path" "$APEX" "$path" Access-Control-Allow-Origin "*"
done
# HEAD through `curl -I`: hval's `-X HEAD` would wait for a body that never comes.
acao_head() { local host="$1" path="$2" want="$3" got
  got=$(curl -s -I -H "Host: $host" "http://127.0.0.1:${PORT}${path}" | tr -d '\r' \
        | grep -i '^access-control-allow-origin:' | head -1 | sed 's/^[^:]*: //' || true)
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL HEAD %s%s: Access-Control-Allow-Origin is [%s], want [%s]\n' "$host" "$path" "$got" "$want"; fi
}
acao_head "$APEX" /marketplaces "*"     # Nostter's first request is a HEAD
for host in dev.localtest www.localtest; do
  hval "$host CORS on the 308"      "$host" "/nutzaps" Access-Control-Allow-Origin "*"
  acao_head "$host" /nutzaps "*"
  hval "$host no CORS on GET /mcp"  "$host" "/mcp"     Access-Control-Allow-Origin ""
  hval "$host no CORS on POST /mcp" "$host" "/mcp"     Access-Control-Allow-Origin "" POST
done
# ...and nowhere else. The APIs keep their own rules (the MCP endpoint is a JSON-RPC API,
# /api is the app's own, login included), other methods are not reads, and the blob store
# is a separate site block.
for path in /mcp /mcp/ "/mcp?traffic_type=internal" /api /api/nutzaps/x /api/auth/login; do
  hval "apex no CORS GET $path" "$APEX" "$path" Access-Control-Allow-Origin ""
done
hval "apex no CORS POST /mcp"             "$APEX" /mcp            Access-Control-Allow-Origin "" POST
hval "apex no CORS POST /api/auth/login"  "$APEX" /api/auth/login Access-Control-Allow-Origin "" POST
hval "apex no CORS POST /"            "$APEX" /            Access-Control-Allow-Origin "" POST
for m in PUT PATCH DELETE OPTIONS; do
  hval "apex no CORS $m /"            "$APEX" /            Access-Control-Allow-Origin "" "$m"
done
hval "blossom untouched"              blossom.localtest "/${BLOB}.parquet" Access-Control-Allow-Origin ""
# The exclusions are those exact paths and their subtrees, nothing wider: look-alike paths
# are ordinary pages and get the header. (If /mcp ever serves a page of its
# own with its own CORS header, the /mcp assertions above change with it, deliberately, and
# so do the /mcp checks in scripts/verify-link-previews.mjs.)
for path in /mcpfoo /apifoo; do
  hval "apex CORS GET $path" "$APEX" "$path" Access-Control-Allow-Origin "*"
done
# Exactly ONE value, never credentials, nothing exposed. Two values make browsers reject
# the response, and a `*` origin is safe only while the other two are absent.
acao_count() { local label="$1" host="$2" path="$3" want="$4" got
  got=$(curl -s -D- -o /dev/null -H "Host: $host" "http://127.0.0.1:${PORT}${path}" | tr -d '\r' \
        | grep -ci '^access-control-allow-origin:' || true)
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  FAIL %s: %s Access-Control-Allow-Origin lines, want %s\n' "$label" "$got" "$want"; fi
}
acao_count "apex page, one value" "$APEX"       /marketplaces 1
acao_count "dev 308, one value"   dev.localtest /nutzaps      1
for name in Access-Control-Allow-Credentials Access-Control-Expose-Headers; do
  hval "apex page has no $name" "$APEX"       /marketplaces "$name" ""
  hval "dev 308 has no $name"   dev.localtest /nutzaps      "$name" ""
done
# And no Cross-Origin-Resource-Policy at the edge: `same-origin` or `same-site` there would
# stop every other site from showing our card image or icon at all, CORS or not. Most
# clients' cards, server-side ones included, load the image straight from us in the
# reader's browser (Primal re-hosts it).
for path in /social-card.png /apple-touch-icon.png /; do
  hval "apex $path has no Cross-Origin-Resource-Policy" "$APEX" "$path" Cross-Origin-Resource-Policy ""
done
# Through a REAL proxy hop (the test-only site the transform appends): an upstream that sends
# its own Access-Control-Allow-Origin keeps it, once; an upstream that sends none gets `*`.
# A plain `header` set fails the first two: reverse_proxy adds the upstream's value to ours.
acao_count "proxied, upstream sends its own" upstream-acao.localtest /own 1
hval "proxied, upstream's value kept" upstream-acao.localtest /own   Access-Control-Allow-Origin "https://upstream.example"
hval "proxied, upstream sends none"   upstream-acao.localtest /plain Access-Control-Allow-Origin "*"

# --- 13. What the log keeps out: (log-filter) ------------------------------------------------
# A DENYLIST keyed on canonical header names: a misspelt rule, or a logger the filter does
# not reach, fails SILENTLY - the line just carries the field. So every rule is driven end
# to end, sent on the wire and read back out of the log: on each site logger, on an alias
# hop, and on every kind of line `log default` takes - a host name no site claims, the
# error line of a 502 (bad gateway) from an upstream that refuses, the warning when a
# client hangs up mid-response, the TLS logger's line for an ALPN `acme-tls/1` probe, and
# the admin API's line for a request to it. Headers go out spelled the way clients write
# them, not canonically: Go canonicalises them on the way in, which is exactly what the
# rules rely on. Every address sent is from the documentation ranges (RFC 5737, RFC 3849);
# the address Caddy itself sees for this script is read back from client-addr.localtest
# and must appear nowhere in the log.
LF=(
  -H "X-Forwarded-For: 192.0.2.11"
  -H "X-Forwarded: for=192.0.2.12"
  -H "Forwarded: for=192.0.2.13;proto=https"
  -H "Forwarded-For: 192.0.2.14"
  -H "X-Real-IP: 192.0.2.15"
  -H "CLIENT-IP: 192.0.2.16"
  -H "X-Client-IP: 192.0.2.17"
  -H "X-Cluster-Client-IP: 192.0.2.18"
  -H "X-Originating-IP: 192.0.2.19"
  -H "True-Client-IP: 192.0.2.20"
  -H "CF-Connecting-IP: 192.0.2.21"
  -H "CF-Connecting-IPv6: 2001:db8::21"
  -H "CF-Pseudo-IPv4: 192.0.2.22"
  -H "Fastly-Client-IP: 192.0.2.23"
  -H "Fly-Client-IP: 192.0.2.24"
  -H "X-AppEngine-User-IP: 192.0.2.25"
  -H "X-Envoy-External-Address: 192.0.2.26"
  -H "X-Original-Forwarded-For: 192.0.2.27"
  -H "CloudFront-Viewer-Address: 192.0.2.28:46532"
  -H "X-Azure-ClientIP: 192.0.2.29"
  -H "X-Azure-SocketIP: 192.0.2.30"
  -H "Incap-Client-IP: 192.0.2.31"
  -H "X-ProxyUser-IP: 192.0.2.32"
  -H "WL-Proxy-Client-IP: 192.0.2.33"
  -H "Proxy-Client-IP: 192.0.2.34"
  -H 'If-None-Match: "probe-etag"'
  -H 'If-Match: "probe-etag-match"'
  -H 'If-Range: "probe-etag-range"'
  -H "X-API-Key: probe-api-key"
  -H "X-Cashu: cashuBprobetoken"
  -H "User-Agent: log-filter-probe/1.0"
  -H "Accept-Language: en-GB"
)
SEEN=$(curl -s -H "Host: client-addr.localtest" "http://127.0.0.1:${PORT}/")
curl -s -o /dev/null -H "Host: $APEX" "${LF[@]}" "http://127.0.0.1:${PORT}/log-filter-site?keep=1"
curl -s -o /dev/null -H "Host: blossom.localtest" "${LF[@]}" "http://127.0.0.1:${PORT}/log-filter-blossom"
# The operator's own request: its marker cookie must reach no line, tagged or not.
curl -s -o /dev/null -H "Host: $APEX" -H "Cookie: ${OP}" "${LF[@]}" "http://127.0.0.1:${PORT}/log-filter-operator"
curl -s -o /dev/null -H "Host: $APEX" "http://127.0.0.1:${PORT}/log-filter-query?zeta=1&alpha=2&path=/a/b&sp=a%20b&bad=%zz&flag"
curl -s -o /dev/null -H "Host: dev.localtest" "http://127.0.0.1:${PORT}/log-filter-alias?keep=1"
curl -s -o /dev/null -H "Host: unclaimed.localtest" "${LF[@]}" "http://127.0.0.1:${PORT}/log-filter-unclaimed"
curl -s -o /dev/null -H "Host: dead-upstream.localtest" "${LF[@]}" "http://127.0.0.1:${PORT}/log-filter-error"
# A client that hangs up mid-response, from inside the container (busybox wget), so that
# no port forwarder in between absorbs the reset. Repeated: where Caddy is when the client
# goes is a race, and only a hang-up mid-WRITE quotes the socket whose masking is checked
# below (mid-read, the error is `reading: context canceled`, with no address in it), so at
# least one of the eight must quote it.
docker exec "$NAME" sh -c 'mkdir -p /tmp/log-filter-big && head -c 67108864 /dev/zero > /tmp/log-filter-big/log-filter-abort'
docker exec "$NAME" sh -c 'for i in 1 2 3 4 5 6 7 8; do wget -q -O - -U log-filter-probe/1.0 --header "Host: abort-probe.localtest" http://127.0.0.1:8080/log-filter-abort 2>/dev/null | head -c 1000 > /dev/null; done' || true
# A request to the admin API, whose line puts the caller's address at the top level. By
# address: busybox's wget tries `localhost` over IPv6 first, where the API is not listening.
docker exec "$NAME" sh -c 'wget -q -O /dev/null http://127.0.0.1:2019/config/ 2>/dev/null' || true
# The TLS logger's line for a client offering ALPN acme-tls/1, which scanners probe for; and
# a plain-HTTP request to the TLS port, which the standard library answers with
# 400 (bad request) and does not log at Caddy's level.
python3 - "$TLS_PORT" <<'PY' || true
import socket, ssl, sys
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
ctx.set_alpn_protocols(["acme-tls/1"])
try:
    with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=5) as s:
        ctx.wrap_socket(s, server_hostname="tls-probe.localtest").close()
except (OSError, ssl.SSLError):
    pass
PY
curl -s -o /dev/null -m 5 "http://127.0.0.1:${TLS_PORT}/log-filter-plain-to-tls" || true
# Only the logged copies change: the browser still gets the ETag.
hdr "$APEX" "/log-filter-wire" Etag 1
sleep 1
LFR=$(docker logs "$NAME" 2>&1 | MARKER="$MARKER" SEEN="$SEEN" python3 -c '
import json, os, re, sys
marker = os.environ["MARKER"]
seen = os.environ.get("SEEN", "")
raw_text = sys.stdin.read()
lines = []
for raw in raw_text.splitlines():
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            lines.append(json.loads(raw))
        except ValueError:
            pass
p = f = 0
def check(ok, label):
    global p, f
    if ok:
        p += 1
    else:
        f += 1
        print("  FAIL log-filter: " + label)
def at(path):
    return [j for j in lines if re.split("[?#]", str((j.get("request") or {}).get("uri", "")))[0] == path]
IPV4 = re.compile(r"(?<![0-9.])([0-9]{1,3}[.]){3}[0-9]{1,3}(?![0-9.])")
TOP_GONE = ["remote_ip", "remote_port", "remote_addr", "remote"]
GONE = ["remote_ip", "client_ip", "remote_port"]
HDRS = ["X-Forwarded-For", "X-Forwarded", "Forwarded", "Forwarded-For", "X-Real-Ip",
        "Client-Ip", "X-Client-Ip", "X-Cluster-Client-Ip", "X-Originating-Ip",
        "True-Client-Ip", "Cf-Connecting-Ip", "Cf-Connecting-Ipv6", "Cf-Pseudo-Ipv4",
        "Fastly-Client-Ip", "Fly-Client-Ip", "X-Appengine-User-Ip",
        "X-Envoy-External-Address", "X-Original-Forwarded-For", "Cloudfront-Viewer-Address",
        "X-Azure-Clientip", "X-Azure-Socketip", "Incap-Client-Ip", "X-Proxyuser-Ip",
        "Wl-Proxy-Client-Ip", "Proxy-Client-Ip", "If-None-Match", "If-Match", "If-Range",
        "X-Api-Key", "X-Cashu"]
PROBE_VALUES = ["192.0.2.", "2001:db8::", "probe-etag", "probe-api-key", "cashuBprobetoken"]
def clean(j, label):
    req = j.get("request") or {}
    for k in GONE:
        check(k not in req, "%s: request.%s is logged" % (label, k))
    names = {k.lower() for k in (req.get("headers") or {})}
    for h in HDRS:
        check(h.lower() not in names, "%s: header %s is logged" % (label, h))
    text = json.dumps(j)
    for s in PROBE_VALUES:
        check(s not in text, "%s: a probe value reached the line" % label)
def ua_kept(j, label):
    hd = (j.get("request") or {}).get("headers") or {}
    check(hd.get("User-Agent") == ["log-filter-probe/1.0"], "%s: User-Agent not kept" % label)
def uri_is(path, want, label):
    got = at(path)
    check(len(got) == 1, "%s: %d lines, want 1" % (label, len(got)))
    for j in got:
        check(j["request"].get("uri") == want, "%s: logged URI is not %s" % (label, want))
    return got

# Every line in the log, not only the probes.
check(len(marker) == 64 and marker not in raw_text, "the operator marker is somewhere in the log")
check(re.fullmatch("[0-9A-Fa-f:.]+", seen) is not None, "client-addr: no client address read back")
check(seen not in raw_text, "the address Caddy saw for this script is somewhere in the log")
check("handshake error" not in raw_text, "a TLS handshake error was logged")
bad_top = sorted({"%s: %s" % (j.get("logger"), k) for j in lines for k in TOP_GONE if k in j})
check(not bad_top, "top-level address fields logged: %s" % bad_top)
bad_req = sorted({"%s: %s" % (j.get("logger"), k) for j in lines for k in GONE if k in (j.get("request") or {})})
check(not bad_req, "request address fields logged: %s" % bad_req)
bad_err = sorted({str(j.get("logger")) for j in lines if IPV4.search(str(j.get("error", "")))})
check(not bad_err, "an address inside an error field: %s" % bad_err)

site = at("/log-filter-site")
check(len(site) == 1, "site probe: %d lines, want exactly 1 (a second copy would double-count)" % len(site))
for j in site:
    check(j.get("logger") == "http.log.access.access_site", "site probe: wrong logger")
    clean(j, "site probe")
    ua_kept(j, "site probe")
    hd = j["request"].get("headers") or {}
    check(hd.get("Accept-Language") == ["en-GB"], "site probe: Accept-Language not kept")
    check(j["request"].get("uri") == "/log-filter-site?keep=1", "site probe: query not kept")
    check("etag" not in {k.lower() for k in (j.get("resp_headers") or {})}, "site probe: response Etag is logged")
blob = at("/log-filter-blossom")
check(len(blob) == 1, "blossom probe: %d lines, want 1" % len(blob))
for j in blob:
    check(j.get("logger") == "http.log.access.access_blossom", "blossom probe: wrong logger")
    clean(j, "blossom probe")
    ua_kept(j, "blossom probe")
for j in uri_is("/log-filter-operator", "/log-filter-operator", "operator probe"):
    check(j.get("operator") == "1", "operator probe: not tagged")
    check((j.get("request") or {}).get("headers", {}).get("Cookie") == ["REDACTED"], "operator probe: Cookie is not redacted")
    clean(j, "operator probe")
uri_is("/log-filter-query", "/log-filter-query?zeta=1&alpha=2&path=/a/b&sp=a%20b&bad=%zz&flag", "untouched query")
for j in uri_is("/log-filter-alias", "/log-filter-alias?keep=1", "alias probe"):
    check(j.get("logger") == "http.log.access.access_alias", "alias probe: wrong logger")
    loc = (j.get("resp_headers") or {}).get("Location")
    check(loc == ["https://nostrolo.gy/log-filter-alias?keep=1"], "alias probe: logged Location is not the redirect")
unclaimed = at("/log-filter-unclaimed")
check(len(unclaimed) >= 1, "unclaimed host name: no line at all")
for j in unclaimed:
    check(j.get("logger") == "http.log.access", "unclaimed host name: not the bare access logger")
    clean(j, "unclaimed host name")
    ua_kept(j, "unclaimed host name")
err = [j for j in at("/log-filter-error") if str(j.get("logger", "")).startswith("http.log.error")]
check(len(err) >= 1, "refusing upstream: no error line")
for j in at("/log-filter-error"):
    clean(j, "refusing upstream (%s)" % j.get("logger"))
    ua_kept(j, "refusing upstream (%s)" % j.get("logger"))

abort = [j for j in at("/log-filter-abort") if j.get("msg") == "aborting with incomplete response"]
check(len(abort) >= 1, "client hang-up: no reverse_proxy warning")
for j in abort:
    clean(j, "client hang-up")
    ua_kept(j, "client hang-up")
    # Its text depends on where Caddy was when the client went: mid-write it quotes the socket
    # (`writing: write tcp <ours>-><theirs>: ...`), which must read [addr]; mid-read it is
    # `reading: context canceled`, with no address to mask. Either is right. A raw address
    # in any error field fails `bad_err` above whichever it was.
    e = str(j.get("error", ""))
    check("tcp " not in e or "tcp [addr]->[addr]" in e, "client hang-up: the socket in the error field is not masked: " + e[:120])
check(any("tcp [addr]->[addr]" in str(j.get("error", "")) for j in abort),
      "client hang-up: no hang-up in eight quoted its socket, so the masking went unchecked")
alpn = [j for j in lines if j.get("logger") == "tls" and j.get("msg") == "tls-alpn challenge"]
check(len(alpn) >= 1, "ALPN probe: no tls-alpn line")
admin = [j for j in lines if j.get("logger") == "admin.api" and j.get("uri") == "/config/"]
check(len(admin) >= 1, "admin API request: no line")
print("COUNTS %d %d" % (p, f))
')
printf '%s\n' "$LFR" | grep -v '^COUNTS' || true
read -r _ lf_pass lf_fail <<<"$(printf '%s\n' "$LFR" | grep '^COUNTS')"
PASS=$((PASS+lf_pass)); FAIL=$((FAIL+lf_fail))

echo
if [ "$FAIL" -eq 0 ]; then
  echo "test-caddyfile.sh: ALL ${PASS} assertions passed"
else
  echo "test-caddyfile.sh: ${FAIL} FAILED, ${PASS} passed" >&2; exit 1
fi
