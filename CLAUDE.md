# nostrology-web

SvelteKit (adapter-node) site behind Caddy.

## Writing conventions

These hold everywhere: comments, docs, log strings, commit messages, issues.

- **Name every Nostr kind as `kind-NNNNN (slug)`**, for example `kind-9735 (zap-receipts)`. The
  slug is the `slug =` field of that kind's entry in nozzl's `config/kinds.toml`; a kind that
  file does not list keeps the slug this tree already gives it, such as `kind-1 (posts)`. For a
  kind with neither, say what it is in a few words: `kind-24133 (NIP-46 remote-signing)`.
  nozzl's `scripts/check-kind-slugs.py <file>` checks the kinds that file lists. A line carrying
  `kind-slug-ok` is exempt, for a fixture or an assertion on runtime output.
- **Name every issue as `#NN (title)`**, with the issue's own title, cut at most to its leading
  clause, on every mention.
- **Name every HTTP status as `NNN (reason phrase)`**, for example `502 (bad gateway)`. Consumers
  branch on exactly which one they get, so a bare number invites a wrong guess.
- **Write times in UTC.**
- **Use plain ASCII punctuation in new text**: `-` rather than an em-dash, `->` rather than an
  arrow, `...` rather than an ellipsis. Non-ASCII punctuation escapes in JSON and breaks `grep`.

## Dependencies: the lockfile is the source, specifiers are exact

- `pnpm-lock.yaml` decides every install. CI (the test gate, `.github/workflows/gate.yml`),
  the Docker builder stage and the Docker runtime stage (the latter with `--prod`, which is
  what keeps devDependencies out of the image) all run `pnpm install --frozen-lockfile` and
  stop without the lockfile. Never add a `|| pnpm install` fallback: a failed frozen install
  is a stopped build, which is the correct outcome. From 2026-06-25 to 2026-09-13 the runtime
  stage had no lockfile and such a fallback, so the server ran whatever was newest in range
  at each rebuild while CI and the browser bundle ran the lockfile: nostrology-web#2 (Build:
  Dockerfile runtime stage installs prod deps UNPINNED).
- `package.json` specifiers are exact (`"pg": "8.23.0"`); `.npmrc` `save-prefix=''`
  makes `pnpm add` write them that way. The lockfile is still the control; exact
  specifiers are the second layer.
- pnpm's version has ONE source, `packageManager` in `package.json`. The Dockerfiles
  derive it, CI's `pnpm/action-setup` reads it (no `version:` input, the action errors
  if one disagrees), and a CI guard fails on any `pnpm@<digits>` literal in the Dockerfiles
  or the workflows.
  pnpm 10 switches itself to the declared version inside the repo, whatever version is
  installed globally.
- An upgrade is deliberate: `pnpm add <pkg>@<x.y.z>`, then commit `package.json` and the
  lockfile together; the test gate runs before any deploy of it (The test gate, below). One
  package per PR unless they must move together.
- Judge an image's dependencies from the BUILD LOG (`Lockfile is up to date` in every
  install step, the listed versions), never from the Dockerfile text: the Dockerfile
  said `--frozen-lockfile` for 2.5 months while every build log said
  `ERR_PNPM_NO_LOCKFILE`.
- To undo an upgrade, `git revert` its commit and deploy that: `package.json` and the
  lockfile go back together, and every install reads the lockfile, so the image is rebuilt
  from the set that ran before.

## Analytics and the access log: the operator is whoever is signed in as the operator

Operator treatment is two things, and both last exactly as long as the operator's session:
pages served without Google Analytics, and `operator=1` on every access-log line. Signing out,
or the session expiring, ends both. The operator's session lasts 400 days, everyone else's 30.

- **GA4** loads on every page except one rendered for the operator's verified session (and on
  none while `PUBLIC_GA_MEASUREMENT_ID` is empty, as `.env.example` leaves it for a local run):
  `src/hooks.server.ts` sets `locals.analyticsOff` from `isOperator(locals.session)`
  (`$lib/unreleased`), and the root layout then never loads gtag. Nothing else switches it off:
  no query parameter, no stored flag, no header and no other cookie of ours (the operator decided
  `?ga_optout=1` goes, 2026-11-14: "if anybody other than the operator can do this, then no").
  The operator's login and logout reload the page, because the layout decides GA once per load.
- **The log tag** is Caddy's, because the app never sees static assets. The operator's login
  response sets a second cookie, `__Host-nozzl_op`, to a secret both Caddy and the app hold
  (`OPERATOR_MARKER`); `deploy/Caddyfile` `(operator-marker)` tags a request carrying exactly
  that value. Logout clears it with the session, and anyone else's login clears it. A leaked
  marker fakes the tag and nothing else. `src/hooks.server.ts` clears a marker that arrives
  without the operator's session (left behind by a new session key, say), but never on
  `/api/auth/*`: a cookie the hook adds lands after the endpoint's own and would undo a login.
- **The marker's value** is never in the repository. The deployment generates it
  (`OPERATOR_MARKER`, 64 lowercase hex characters), hands the same value to the app and to Caddy,
  and makes a new one whenever the session key is new: kept, it would leave the operator's
  browsers tagged while signed out.

Test a change with `deploy/test-caddyfile.sh` (sections 6 and 7), the unit suites, and on the
live site `node scripts/verify-login.mjs` and `node scripts/verify-ga.mjs <urls>`. The operator's
own check, which needs their cookies, is `verify-ga.mjs --operator` (its header says how): the
one verify run served as the operator, and tagged `operator=1`, because the operator hands it
their own cookies. No script can sign in as the operator. Every verify script is told apart in
the access log by its `nozzl-verify-*` User-Agent, and those that render our pages in a browser
block Google's hosts there (`scripts/lib/google.mjs`), except `verify-ga.mjs` without
`--operator`, which exists to watch GA measure, so GA counts its visits.

Caddy reads `OPERATOR_MARKER` when its container is created, so a new value needs both
containers recreated, never Caddy alone, which would leave the app on the old value. A graceful
reload of an edited Caddyfile leaves the connections opened before it on the old config, its
logging included, until they close (long-lived `/mcp` streams among them): check a logging change
only once they have, or recreate Caddy, which closes them all.

## Link previews: the edge sends `Access-Control-Allow-Origin: *`

Web Nostr clients that build a link card in the reader's browser (noStrudel, older Jumble
forks, Nostter's fallback) can read our pages only if responses carry that header, and
without it the card fails silently. Caddy's `(link-preview-cors)` snippet in
`deploy/Caddyfile` sets it on GET/HEAD everywhere except `/mcp` and `/api`, on
the apex and on the dev/www 308s.
- It uses `?`, which sets the header only if the response has none, so an upstream's own
  value wins and never doubles.
- It is safe only while no GET/HEAD response depends on the client's IP or on a credential
  other than cookies. The session and operator cookies do change responses, and `*` makes
  browsers withhold any read that carried them. Exclude any route gated another way.
- Never send `Cross-Origin-Resource-Policy: same-origin` or `same-site` on pages or images:
  it would stop every other site showing the card image (`cross-origin` is harmless, but
  the harness rejects any value).
- A human page for a browser GET of `/mcp` would need its own header (the exclusion
  covers it), and the `/mcp` checks in both tests would change with it.

Tests: `deploy/test-caddyfile.sh` section 12. After a deploy, run `node
scripts/verify-link-previews.mjs`: wire and browser checks, every request with the User-Agent
`nozzl-verify-link-previews`, and every `/mcp` one at `/mcp?traffic_type=internal`, which marks
it as our own.

## Every domain page's What is counted has an address: `/<domain>/methodology`

**This is the expectation for every new domain surface, not a feature of the pages that have it
today.** "How did you arrive at that number?" is the question the operator fields most often,
and the answer is always the same section, so each domain page owes an address that lands the asker
on it: `https://nostrolo.gy/<domain>/methodology` - the page on the pill holding the section,
the section expanded, just under the nav. Live on `/git`, `/marketplaces` and `/routstr`
(still hidden from the nav and the sitemap) since 2026-10-19. Before that the address was
`<domain>#methodology` (from 2026-10-17 on /git and /marketplaces, from 2026-10-18 on
/routstr), and an old link of that form still lands for as long as that courtesy is kept
(`$lib/legacy-hash`, next section).

What a new domain page must do - `$lib/methodology.ts` holds the slug and the section entry,
the section is `$lib/components/MethodologySection.svelte`:

- **Its slug table has the section** (next section): `methodology: methodologySection('<the
  pill holding it>')`. The server then answers `/<domain>/methodology` like any section's
  address, and sends the section already open; `$lib/domain-page` opens it after every move to
  that address and never closes it, so a reader who opened it by hand keeps it open across the
  pills. Opening or closing it by hand writes no address.
- The section is **`<MethodologySection bind:open={$methodologyOpen} href={addressOf(<TABLE>,
  METHODOLOGY)}>`**, its content as the slot, written in the `+page.svelte` itself - never a
  hand-built `<details>`, which would carry no link icon, and never inside a component of the
  page's own, which the coverage test cannot see into (extract the slot's content instead if
  it grows). The heading is always "What is counted": the component's own, not a prop, so no
  page drifts from it. It closes the pill that holds it, after the figures it qualifies -
  copy inside it that points at them says "on this page", never "below". The component is a
  `<details>`, **collapsed by default**, with `id={METHODOLOGY_ID}`: the figures come first,
  the method is there for whoever opens it, and a closed `<details>` still ships its content
  in the SSR HTML, so it stays readable, indexable and linkable.
- **The link icon** (since 2026-10-18, the operator's ask) comes with the component: a
  subtle link glyph at the far right of the section's head - the right end of the closed
  card, the top-right corner of the open one - drawn only while the pointer is on the head
  or the icon, or while it has keyboard focus. The head is the whole `<summary>`, which
  carries the card's padding (the body has its own), so all of the closed card both
  toggles and arms the icon. A click copies the section's address (`href`, made absolute -
  never the page's query or hash) and shows a tick, or an amber cross if the clipboard
  refuses; a live region announces either. What must stay true if it is ever touched:
  - **It never follows the link.** It is an `<a href="/<domain>/methodology">`, so with no
    JavaScript, on a right-click "Copy link" or on a modified/middle click it is simply the
    link, and the same one a click copies; a plain click (or Enter) is `preventDefault` +
    copy, which leaves the section, the address bar and the scroll as they were.
  - **Hidden means transparent AND `pointer-events: none`, and it is armed only under
    `@media (hover: hover)`.** A phone has no hover, so the icon never shows there, and a
    tap at the head's right end must toggle the section. With the gate removed, a tap there
    on a touch phone COPIED instead of toggling (mutation run, 2026-10-18), because the
    tap's sticky hover arms it. A touchscreen whose PRIMARY pointer hovers (a touch laptop)
    passes the gate, so a finger can still land on the armed icon: a click whose pointer
    was a touch therefore toggles the section and copies nothing (review, 2026-10-18,
    reproduced in Chrome with a synthesized tap).
  - **It sits OUTSIDE the `<summary>`**, positioned over it: a closed `<details>` draws only
    its summary, and inside the summary it would be a control nested in a disclosure
    control whose accessible name would swallow its own. The icon's own `:hover` keeps it
    drawn as the pointer crosses onto it, since the summary loses `:hover` there.
  - **A pointer click lets go of focus.** Chrome focuses a clicked link, and the next key
    press would turn that into `:focus-visible` and draw the icon for good; Enter's focus
    (a click with `detail` 0) is the keyboard's own and stays.
  - **It never preloads** (`data-sveltekit-preload-data="off"`). The site preloads a link's
    data on hover (app.html), and this link is never followed: a hover would run the page's
    server load for nothing and log a visit that never happened (fresh-context review,
    2026-10-19).
- **Add the page to `PAGES` in `scripts/verify-methodology-link.mjs`** (its path, a pill to
  arrive from, a string from the section's content, its page title). That list is hand-kept,
  so a page missing from it passes the verifier without ever being loaded - and the verifier
  is the only check of the hover gate, the touch tap and the real clipboard.
- A page with no "What is counted" (/nutzaps, /zapstore, /lightning today) owes nothing here -
  the convention starts the moment a page has one to link to.

Tests: `src/lib/methodology.test.ts` (the section entry, and every slug table that has it),
`src/lib/components/MethodologySection.test.ts` (the section and the icon's click: what it
copies, and that it toggles, writes and scrolls nothing), `src/routes/methodology-coverage.test.ts`
(every page with a "What is counted" carries it through the component, on the pill its slug
table says, on the shared logic; exceptions named with their reason), and per page the
`/git/methodology` describe of `git-page.test.ts` and the "pills and their addresses" describe
of `marketplaces-page.test.ts` / `routstr-page.test.ts`, plus the section closed at the domain's
address and open at its own in each `*.ssr.test.ts`. After a deploy, run `node
scripts/verify-methodology-link.mjs https://nostrolo.gy`: jsdom has no layout, no
router and no `:hover`, so only a browser can see the section left behind the nav, a scroll the
router wins back, hydration re-closing the section, or the icon drawn where it should not be
(its step 7: a real pointer, the real clipboard read back, real keys, a finger on a hover
desktop and a touch phone's tap). The verifier is Chrome only: headless WebKit hung on
synthetic pointer input on the workstation it was built on, and safaridriver needs an admin's
`--enable`, so in Safari the HOVER is a manual check (hover the head, click the icon, paste).
On 2026-10-18 the rest of step 7 that needs no pointer - layout, placement, `:has()` support,
the hidden state, the click path - passed in Playwright's WebKit 26.0.

## Pills and sections have addresses: `/<domain>/<pill>`, `/<domain>/<section>`

**The operator's steer (2026-10-18/19), for the entire site and for every new domain from day
one:** a domain page's pills and sections are addressed by path - `/git/hosting`,
`/git/zaps`, `/git/methodology`. A link to a section names the section, never its pill, so it
survives the section moving. It is also visible in the first-party request log, through the
page load and the link-preview fetches: a `#` part never reaches any server, and the site
sends no beacons. Since 2026-10-19 every domain page with pills follows it: on /git,
/marketplaces and /routstr each pill is a part of one page with an address of its own, and on
/zapstore and /nutzaps each pill is a page of its own; no pill has a `#` address any more.

**The house style for a new domain** (each step is explained in the bullets below). Its pills
are either parts of one page, one route with an address for each pill (/git), or pages of
their own, a route each (/zapstore):

1. A slug table, `$lib/slug-tables/<domain>.ts`, listed in `$lib/slug-tables/index.ts`: the pills
   in order with their labels, and `methodology: methodologySection('<pill>')` if the page has a
   "What is counted" (it should: the section above). A pill that is a page of its own is marked
   `ownRoute`; a collection with a page at its own address goes in `ownRoutes`, and a parameter
   folder directly under the domain is named by its matcher in `ownShapes`. A section, What is
   counted among them, sits on a pill of the domain's own page, never on a pill that is a page
   of its own (on /zapstore, on Overview).
2. The server loads: where the pills are parts of one page, `+layout.server.ts` fetches the
   document (returning `{}` when `untrack(() => redirectsAway(...))`) and `+page.server.ts`
   returns `{ target: answerAddress(...) }`; where each pill is a page of its own, the default
   pill's load calls `answerAddress` first, before it asks the database anything, and returns
   its `target` with the data.
3. Where the pills are parts of one page, the page calls `domainPage(<TABLE>, () =>
   data.target)` once, draws `<PillBar>` from the table and `<TransientNote text={$note} />`,
   and passes `pageTitle(<TABLE>, '<the domain title>', data.target)` to SocialMeta; each pill's
   content sits in `{#if $tab === '<slug>'}<div id="panel-<slug>">`. Where each pill is a page of
   its own, `<PillBar>` sits in the layout the pills' pages share (`(shell)/+layout.svelte`), so
   the clicked link survives the navigation and keeps the focus, with `current={pillAt(<TABLE>,
   $page.url.pathname)}`; the default pill's page calls `domainPage` for the note, and each page
   names itself in its own title. PillBar reads from the table whether a click keeps the scroll.
4. A hidden domain passes `noindex` (from each of its pages, where each pill is a page of its
   own) and is in the sitemap's hidden set (`$lib/seo/sitemap`); its addresses follow it in the
   sitemap, both ways, by themselves.
5. Its loads join `src/routes/(app)/domain-loads.test.ts`; its page joins `PAGES` in
   `src/routes/(app)/slug-addresses.ssr.test.ts` where the pills are parts of one page, and its
   pill bar `src/routes/(app)/pills-as-pages.test.ts` where each is a page of its own. The
   domain joins `DOMAINS` in `scripts/verify-section-link.mjs` (with `pages: true` where each
   pill is a page of its own) and, with a "What is counted", `PAGES` in
   `scripts/verify-methodology-link.mjs`. The other tests read the slug tables and need nothing.

- **Terms:** a *domain* (/git) is a subject area with its own page and nav entry. A *pill* is
  one of the switches along the top of its page and the part of the page it shows, named by
  its address (/git/hosting is a pill); the first is the *default pill*, shown at the domain's
  own address. A pill holds *sections*, titled cards (Zaps, What is counted). A *slug* is any
  word directly under a domain in an address. A *detail page* is about one thing, found by its
  ID, which sits under a *collection* (`/zapstore/apps/<pubkey>/<app>`). "View" is not a term
  here, and "name" became "slug" on 2026-10-19 (it clashed with a section's title).
- **`$lib/slug-table.ts`** holds the rules, the resolver and the helpers, and
  **`$lib/slug-tables/<domain>.ts`** one slug table per domain, each listed in
  `$lib/slug-tables/index.ts` (the operator chose the name on 2026-10-19):
  - its pills, in page order, each with its label - the pill bar is drawn from them - and, for a
    pill that is a page of its own (/zapstore/leaderboards, /nutzaps/mints), `ownRoute`;
  - its sections, each with its pill, element id and title, and a preview of its own where it
    has one (Zaps);
  - former and retired slugs;
  - collections with a page at their own address, which are routes of their own (`ownRoutes`:
    /zapstore/apps). /zapstore/publishers, which holds only its detail pages, is not: its word
    is a slug like any other, a 302 (found) to /zapstore with the note;
  - words of a shape that a route of its own takes directly under the domain, by its param
    matcher (`ownShapes`): /zapstore/<pubkey> is `hex64`, the old address of a publisher's page,
    kept as a 308 (permanent redirect).

  Live for /git, /marketplaces, /routstr, /zapstore and /nutzaps. Its lookups read own keys
  only (`own`): `constructor` is slug-shaped and every object inherits it, and /git/constructor
  and /constructor/abc answered 500 (internal server error) until 2026-10-19. No slug may be
  `gone`, the marker of the redirect for an unknown slug.
- **`src/hooks.ts` `reroute`** renders `/<domain>/<slug>` with the domain's page, for one
  slug-shaped segment only and never for a word that belongs to a route of its own
  (`routedElsewhere`: a collection, a pill that is a page of its own, a word of an own route's
  shape). A slug never holds a dot, which is also how /relays tells its relay pages
  (`/relays/relay.damus.io`) from slugs, the day it has any.
- **The server answers the address, in two loads** (`$lib/server/slug-address`):
  - the domain's `+page.server.ts` answers with `answerAddress`, which the router runs again on
    every move between the page's addresses:
    - the default pill's own slug (`/git/overview`): 308 (permanent redirect) to the domain's
      own address, that pill's only one;
    - any other current pill or section: that pill, opened at the section (under the nav,
      glowing once);
    - a former slug: 308 (permanent redirect) to the current slug;
    - a recorded retired section: its last pill, with a 6 s note naming it;
    - any other slug: 302 (found) to `/<domain>#gone`, with a generic note;
    - not a slug at all: 404 (not found).

    The redirects keep the query and are never cached (`Cache-Control: no-store`): slugs are
    not permanent, and a 308 (permanent redirect) with no Cache-Control may be cached with no
    expiry, so a reused slug would never reach the server again.
  - its `+layout.server.ts` fetches the page's document, reading the address only inside
    `untrack` (`redirectsAway`): it fetches nothing for an address that redirects, and the
    router never runs it again on a pill click, which therefore costs one request of about 360
    bytes rather than the document again.
- **Pills are links** (`$lib/components/PillBar.svelte`, since 2026-10-19, on every domain with
  pills), the open one marked `aria-current="page"` at its own address and `"true"` at a
  section's address on it (its link goes to the pill's address, not the section's). A click is
  a SvelteKit navigation, so the address bar shows the pill's own address and Back returns to
  the previous pill (the operator's call, 2026-10-19); where the pills are parts of one page it
  opens the pill at once rather than after the server's answer. Each link keeps the focus,
  keeps the scroll where the pills are parts of one page (a pill that is a page of its own
  starts at its top, as any page does), and never preloads: a preload is logged like a visit,
  and hovering across the bar, or a finger landing on a pill to scroll, would log visits nobody
  made (the pill links of /zapstore and /nutzaps preloaded on hover until 2026-10-19). For the
  same reason the main nav's link to the domain the reader is on
  never preloads (`SiteNav`): on /git/hosting a hover over "Git-on-Nostr" fetched /git's data.
  Enter on a pill leaves focus on it, so /git's scroll to a panel that starts off screen (on a
  phone) is for a pointer's click only.
- **`$lib/domain-page.ts` is the page's half**, one module for every domain page, called once
  as the page initialises:
  - THE ADDRESS DECIDES: after every navigation the open pill is the one the server's answer
    names;
  - the page opens at a section on a cold load only when the document was opened fresh
    (`afterNavigate`'s `enter`), and after an in-site link, from a timer past the router's own
    scroll; never on a reload or on Back and Forward, whose scroll is the reader's own. It
    scrolls the section under the measured nav, glows it once and gives it focus, so the next
    Tab and a screen reader carry on from there;
  - the page moves itself once the router has started, keeping the query and replacing the
    entry (`goto`), so Back never returns to the address it left: the `#gone` hash is dropped,
    which costs no request as only the hash differs, and a retired slug's address becomes its
    pill's. Never the router's shallow `replaceState`: it keeps its own record of the address
    on the entry, and Back to that entry loads that address again, whatever the bar said.
- Every address names itself (canonical and `og:url`), and its page title names the pill or
  the section (`pageTitle`: "Nostrology - Git on Nostr - Hosting"), so a browser tab and a
  search result tell them apart. A section with a preview of its own draws it; every other
  address draws the domain's own (the operator left the previews as they were, 2026-10-19).
- **Old `#` links** (`$lib/legacy-hash`): `/git#hosting` and `/git#methodology`, written before
  2026-10-19, open the pill or the section they meant before the first paint, and the address
  then moves to `/git/hosting`, replacing the entry. Followed while the page is open, an old
  link is a jump within the page, on an entry the browser pushes behind the router's back, so
  that move is a full load (`reload` in `$lib/legacy-hash`): the router's own move left Back
  stuck (fresh-context review, 2026-10-19). A courtesy, not a commitment (the operator,
  2026-10-19: "I don't want to be maintaining compatibility with these old-form links forever,
  ideally"): the module's header lists what to delete to drop it. The one `#` the site still
  writes is `#gone`, which the page reads and drops at once, and no slug may be `gone`.
- **The sitemap lists every pill and section address** of each domain that is not hidden,
  straight from the slug tables (`slugTablePaths` in `$lib/seo/sitemap`): the operator, on
  2026-10-19, "This is the new canonical form that should be indexed." A hidden domain's
  addresses are noindexed with it, and join the sitemap by themselves the day it is not.
- **A section with an address carries a link icon** (`$lib/components/SectionLink.svelte`, on
  Zaps since 2026-10-19, /marketplaces' Recent listings since 2026-10-23 and its Categories since
  2026-11-04; What is counted's is its own, above), after its `<h2>` and outside it
  (panel-checks pins the heading), on a `relative` card. On a desktop it is drawn only while
  the pointer is on the heading or the icon, or with keyboard focus, and a click copies the
  section's address - never the query or a hash - as What is counted's icon does. On a phone
  (P1, the operator's choice) it is drawn on one card at a time: the section with an address
  whose heading is wholly on screen below the nav and nearest the top (`nearestTop` in
  `$lib/section-link`, worked out again on scroll, resize, a layout shift and a pill change),
  as a 44 px target. A finger's tap opens the phone's own share menu (`navigator.share({ url
  })`, inside the tap, the URL alone); a closed menu does nothing, a missing or failing share
  copies instead, and a tap within a second of a share is ignored (by the clock: some browsers
  never settle a share). It never preloads (`data-sveltekit-preload-data="off"`). A section
  added to /git's or /marketplaces' slug table must get its icon, or `git-section-links.test.ts`
  or `marketplaces-section-links.test.ts` fails; another domain's first section with an address
  needs a test of that kind of its own. Any reader's joins `SECTIONS` in
  `scripts/verify-section-link.mjs`, which `src/lib/unreleased.test.ts` holds to the tables. The
  icon is the way to grab a link that the operator made the condition for more addresses
  (2026-10-19: "we won't be doing this until we introduce the way to grab a link for a given
  section"), and sections have taken theirs one at a time since, each at the operator's call. Its
  card's grid wants `[&>*]:min-w-0`: without it a row's unbreakable content can carry the card, and
  the icon at its right end, past a phone's screen.

Tests: `src/lib/slug-table.test.ts` (the rules and helpers; each slug table sound, its routes
of its own and its own shapes matching the folders both ways, no other parameter folder under
a domain), `src/hooks.test.ts`, `src/lib/server/slug-address.test.ts`,
`src/routes/(app)/domain-loads.test.ts` (each domain's loads: each status, uncached, the
database never asked on a redirect, the layout's read of the address untracked),
`src/lib/domain-page.test.ts`, `src/lib/legacy-hash.test.ts`,
`src/lib/components/PillBar.test.ts`, `src/routes/(app)/pills-as-pages.test.ts` (the pill bars
of /zapstore and /nutzaps at every address of their slug tables, and the note),
`src/lib/shared/browser-builtins.test.ts` (no built-in that Safari before 15.4 lacks in the
page's code: `own` used `Object.hasOwn`), `src/lib/section-link.test.ts` (where the page lands,
the glow, the focus, `nearestTop`), `SectionLink.test.ts`, `TransientNote.test.ts`, each
domain page's own tests, `git-section-links.test.ts` and `marketplaces-section-links.test.ts` (the
cold load, every navigation, the icon on every section and where a phone draws it; on
/marketplaces, two such sections on one pill), `git-section-links.ssr.test.ts`,
`src/routes/(app)/slug-addresses.ssr.test.ts` (every address a domain page answers itself,
rendered: naming itself, noindex exactly when hidden, its pill, its own title) and, in
`src/lib/seo/sitemap.test.ts` and `indexability.test.ts`, the sitemap held to the slug tables
both ways. A test that clicks a pill stands the router in with
`src/routes/(app)/pill-router.test-helper.ts`. After a deploy:
- `node scripts/verify-section-link.mjs` - the rules on the wire for each domain in its
  hand-kept `DOMAINS` (a new domain joins it), every pill address its pill bar links, and in a
  real browser at a desktop and a phone width: pill clicks (one small data request each, the
  focus kept, the scroll kept on /git at a desktop width and each new page at its top on
  /zapstore and /nutzaps, no preload on hovering a pill or the nav's link to the domain), Back
  and Forward, an old `#` link, the note, and for each section in its hand-kept `SECTIONS`
  (/git/zaps, /marketplaces/categories): the landing, also on a 360 px phone, with the card held
  inside its parent, the nav's link back to its domain, and the icon (a real hover and the real
  clipboard on the desktop; on the phone a real tap, with the share menu stood in for);
- `node scripts/verify-sitemap.mjs` - every listed URL answers 200 (ok) at once and names
  itself (the detail pages by a random sample, `--sample=<n>`), and every address a domain page
  links as its own is listed;
- `node scripts/verify-unreleased.mjs` - as a STRANGER (no operator cookie): every address a
  slug table still marks `unreleased` answers 302 (found) to its domain uncached, the domain's
  page and the section's pill carry no trace of it, and the sitemap does not list it. Its list
  is hand-kept and `src/lib/unreleased.test.ts` fails if it drifts from the tables, because a
  check that enumerates its own subject can pass while examining nothing;
- `node scripts/verify-methodology-link.mjs https://nostrolo.gy`.

What only a person can check, after a deploy that touches an icon: on an iPhone, a tap opens
the share sheet with the address, and closing it and tapping again opens it again; in desktop
Safari, hovering the heading draws the icon and a click copies (no verifier drives WebKit's
pointer, as for What is counted).

## A section, pill or domain still in development: visible to the operator alone

`$lib/unreleased.ts`. A part of the site can be built, deployed and live while only the
OPERATOR'S OWN logged-in session sees it - the operator's instruction of 2026-10-24, for
/marketplaces' Recent listings and whatever comes next: *"I want this section only visible to
the logged in user WhisperHash... To any other visitor, including a logged in one, the new
section should not ever be visible."*

**A SECTION is the shape that works today.** `unreleased: true` on its entry in the domain's
slug table, and then two halves in the two server loads - different halves, both needed:
- `+page.server.ts` answers the ADDRESS from `visibleTable(t, seesUnreleased(locals.session))`,
  so the slug answers exactly as a word nobody has ever used (a 302 (found) to the domain with
  the generic note - never a 404 (not found), which the slug rules forbid, and never a title or
  a preview naming it). The sitemap takes the anonymous view of every table, so the address is
  not listed; the page adds `noindex` at that address, which is the operator's own view of it;
- `+layout.server.ts` asks `seesSection(t, '<slug>', locals.session)` before reading anything
  the section needs, so for everyone else there is no query, no row in the SSR payload and none
  in that route's `__data.json`. **It asks about the SECTION, not the session**, so the flag is
  the only switch: deleting `unreleased: true` releases the address, the title, the preview, the
  sitemap entry and the rows together, in one edit.
- The page then draws the card only when the server SENT rows (`{#if data.recent}`), and the
  component takes `rows` with NO DEFAULT, so losing that guard is a `pnpm run check` error
  rather than a silent empty card.

**A PILL is not supported, and `slugTableProblems` refuses the flag on one** so the trap cannot
be set: `visibleTable` does filter pills and the server's answer would follow, but every domain
page hands the WHOLE table to the browser (its `PillBar`, `$lib/domain-page` and the old-link
reading in `$lib/legacy-hash`, `pageTitle`, the sections a phone's link icon chooses among), so
a hidden pill would still be drawn in the pill bar, and where the pills are parts of one page a
click on it, or an old `/<domain>#<that pill>` link, would paint its whole panel before the
server's answer bounced it. Supporting one means giving each page the reader's VIEW of the table
rather than the table: work on every domain page, not a flag.

**A DOMAIN is not the slug table's job.** It is a route and a nav entry, and it gates in three
places, all of them needed:
1. EVERY server load of the domain asks `seesUnreleased(locals.session)`: its `+page.server.ts`
   answers `error(404, 'Not Found')` to everyone else, and its `+layout.server.ts`, if it has
   one, reads nothing for them - SvelteKit serializes every node's data into
   `/<domain>/__data.json`, so a layout that reads regardless leaks through it;
2. its `$lib/nav.ts` entry carries `unreleased: true`, so the nav, the mobile panel, the footer
   AND the error page all leave it out. `nav.gating.test.ts` asserts all four with a fixture
   entry, because each renders the list itself, so a gate on the nav alone leaves the domain
   published on the others;
3. its path joins `HIDDEN_TREES` in `$lib/seo/sitemap.ts`, so the sitemap does not list an
   address that answers 404 (not found) to every crawler.
Releasing it is deleting the flag, the 404 (not found) and the `HIDDEN_TREES` entry together.

**It is a gate, not /wip.** `/wip` lists surfaces that are finished and merely unlinked, and
its own comment is honest about what that is: "obscurity, not true concealment". This is
different, and its limit has to be stated the same way: everything the page is BUILT from ships
to every visitor, because it is one bundle - the slug table's entry, the section component with
its heading, caption and column headings, and its outbound URL builders. Only the DATA and the
RENDERING are gated. A reader cannot see the section; a developer reading our JavaScript can see
that one exists and what it would look like. One visible consequence: `#<that slug>` as an old
`#` link is not inert for a visitor - `$lib/legacy-hash` reads the whole table, so it opens the
pill and then bounces off the address - while an unknown hash does nothing. Same boundary.
"In development" in prose is `unreleased` in code; they are one thing.

**Who the operator is**: `OPERATOR_PUBKEY` in `$lib/unreleased.ts`, a 64-char lowercase hex
constant, compared against the pubkey in the HMAC-verified session cookie - the one identity on
a request a client cannot assert (next section). A fork changes it to its own key.

Tests: `src/lib/unreleased.test.ts` (the decision and the filter),
`src/routes/(app)/domain-loads.test.ts` (both loads, for a visitor, another logged-in npub and
the operator), `src/lib/seo/sitemap.test.ts` + `indexability.test.ts` (out of the sitemap, and
a redirect rather than a page), and the domain page's own SSR test (no card, no heading, no row,
no address in the HTML when the server sent no rows).

## Logging in with Nostr: the session cookie

Three endpoints, in `src/routes/api/auth/` with the logic in `$lib/server/auth/`:
`POST /api/auth/challenge` issues a nonce bound to a pubkey, the browser signs ONE kind-27235
(NIP-98 HTTP auth) event over `ORIGIN` + `/api/auth/login` and a body holding that nonce, and
`POST /api/auth/login` exchanges it for an HttpOnly `__Host-` session cookie good for 30 days,
or 400 days for the operator, whose login also sets the operator marker (see the analytics
section).
`POST /api/auth/logout` clears both. One signature per session, because a NIP-46 (remote signer)
signature can mean a person approving it on a phone. `hooks.server.ts` verifies the cookie on
every request and puts `{ pubkey }` on `locals.session`.

- **Two settings, both required:** `ORIGIN` (adapter-node's, the only source of the signed URL
  and of the allowed Origin) and `AUTH_SESSION_SECRET`, at least 32 characters. With the
  secret missing or short, login is unconfigured: every session reads as anonymous and the
  endpoints answer 503 (service unavailable). Without `ORIGIN` the endpoints answer the same,
  while existing sessions still verify. A deployment generates the secret once and keeps it, since
  a new one logs everyone out. Locally, set both (`ORIGIN=http://localhost:3000`, the dev server's
  port) to log in.
- **The endpoints protect themselves**, in this order: configuration, the Origin fence
  (SvelteKit's own CSRF check covers only form content types), a 4 KB body cap that also stops a
  chunked body (adapter-node's BODY_SIZE_LIMIT only compares Content-Length), a body with no
  Content-Type refused unread with 415 (unsupported media type) (SvelteKit hands such a body to
  no one), the cheap nonce checks, then the signature, then the nonce's claim. A response that
  leaves a body unread closes its connection, or the next request on it - another visitor's,
  behind Caddy - would wait for the rest. A spent nonce is never forgotten while a replay of its
  request could still pass: a flood that fills the set gets 503 (service unavailable), never a
  replay. Read the comments in `$lib/server/auth/` before changing any of it; most of them record
  an attack that worked.
- **The cookie is `s2.<pubkey>.<expiresAt>.<mac>`**, stateless (no table), revocable only by
  rotating the secret, which logs everyone out. Any other format is refused.
- **Logged:** a refusal's reason, and `auth login ok` with its duration. **Never logged:** who
  logged in, the client's address, the token, the nonce, the cookie or the secret.
- **On the live site:** `node scripts/verify-login.mjs https://nostrolo.gy` logs in with a
  throwaway key and checks the cookie, the session in the nav, the refusals and logout. Its
  requests carry the User-Agent `nozzl-verify-login`. No test covers a real browser extension
  or a remote signer: after a change here, log in with one by hand.

## The test gate

`.github/workflows/gate.yml` is what every deploy that brings new code waits for: a deploy
dispatches it on main and ships only the commit it passed. It runs vitest against a scratch
Postgres, checks that no more tests skipped than its ceiling, that no fewer ran than its floor and
that every test file in `src/lib/db` ran, then runs `pnpm run check` and `deploy/test-caddyfile.sh`.
It holds no secret and cannot ask for a deploy's credential, because it runs every locked package,
and it has no push or pull_request trigger, because a deploy dispatches it and waits for that run.
`scripts/gate-workflow.test.mjs` holds its shape, and fails on a new test file in `src/lib/db` until
the `db-files` step's number moves with it; a deliberate new skip raises the ceiling, and a large
deletion lowers the floor, in the workflow and its shape test together.

The tests that run the production SQL are in `src/lib/db`. They skip with no database and vitest
still exits 0, so to run them locally, on the sort order the gate uses, and expect 0 skipped:

```sh
docker run -d --rm --name dbtest --tmpfs /var/lib/postgresql/data -p 127.0.0.1:15441:5432 -e POSTGRES_PASSWORD=dbtest \
  -e POSTGRES_INITDB_ARGS='--locale-provider=icu --icu-locale=en-US-u-ka-shifted' postgres:16-alpine
until docker exec dbtest pg_isready -U postgres -h 127.0.0.1 -q; do sleep 1; done
TEST_DATABASE_URL=postgresql://postgres:dbtest@127.0.0.1:15441/postgres pnpm exec vitest run src/lib/db
docker stop dbtest
```
