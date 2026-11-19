# nostrology-web

nostrology-web is the site at [nostrolo.gy](https://nostrolo.gy): charts and metrics on prominent domains of the Nostr ecosystem, observed from the raw events. It reads them from the PostgreSQL tables that nostrology-data refreshes every day, and never writes there. It is a SvelteKit app, served by Node behind Caddy.

## What it does

- **A page per domain**, with pills along its top and sections inside them. Every pill and section has an address of its own, such as `/git/hosting`, and the page's title names it.
- **A landing board** of live panels from the domains, refreshed hourly from the database.
- **The MCP endpoint's pages** (`/data`): how to register the endpoint nostrology-data serves in each MCP client, and a page for each metric, read from the MCP server's registry.
- **Sign-in with Nostr**: one NIP-98 (HTTP auth) signature, from a browser extension or a remote signer, for a session cookie. A section or a domain still in development is shown to the operator's session alone, and the operator is the key `OPERATOR_PUBKEY` names in `src/lib/unreleased.ts`.

## Domains

| Domain | Address | What it shows |
|---|---|---|
| Zapstore | [/zapstore](https://nostrolo.gy/zapstore) | Zapstore's apps, publishers, releases and zaps, with a page for each app and publisher |
| Marketplaces | [/marketplaces](https://nostrolo.gy/marketplaces) | listings on Nostr marketplaces: their growth, geography and shipping |
| Git-on-Nostr | [/git](https://nostrolo.gy/git) | repositories on Nostr: their hosting, maintainers and collaboration |
| Lightning | [/lightning](https://nostrolo.gy/lightning) | zaps by the Lightning provider that signed each receipt |
| Nutzaps | [/nutzaps](https://nostrolo.gy/nutzaps) | nutzaps, zaps paid in ecash, and the mints behind them, with a page for each mint |

The order is the site's nav.

## Running it

You need Node 22 and pnpm 10. To see the landing page without a database, from the repository root:

```sh
pnpm install
LANDING_FIXTURE=src/lib/landing/fixtures/board-inputs-2026-10-15.json.gz \
  DATABASE_URL=postgresql://db.invalid/x pnpm dev
```

The dev server listens on port 3000 and draws the landing board from the fixture. That `DATABASE_URL` is a placeholder that never resolves: the domain pages need it to name a PostgreSQL holding nostrology-data's tables.

| Setting | What it does |
|---|---|
| `DATABASE_URL` | the PostgreSQL that nostrology-data fills |
| `ORIGIN` | the site's own origin, which sign-in signs over and checks requests against |
| `AUTH_SESSION_SECRET` | the key that signs session cookies, at least 32 characters; without it, sign-in is off |
| `OPERATOR_MARKER` | a secret shared with Caddy, which then tags the operator's requests in its access log |
| `NOSTROLOGY_MCP_REGISTRY_URL` | where `/data` reads the MCP server's registry |
| `PUBLIC_MCP_ENDPOINT` | the MCP endpoint the pages quote; `https://nostrolo.gy/mcp` when empty |
| `PUBLIC_GA_MEASUREMENT_ID` | Google Analytics; empty, as in `.env.example`, turns it off |
| `LOG_DIR` | a directory the production server also writes its log to |

The [Dockerfile](Dockerfile) builds the production image, which serves on port 3000. [deploy/Caddyfile](deploy/Caddyfile) configures the Caddy in front of it, and [deploy/caddy-image](deploy/caddy-image) pins Caddy's image.

## Development

```sh
pnpm install
pnpm exec vitest run
pnpm run check
```

- The tests in `src/lib/db` run the production SQL. They need a scratch PostgreSQL 16 named by `TEST_DATABASE_URL`, and skip without one; [CLAUDE.md](CLAUDE.md) has the recipe.
- [deploy/test-caddyfile.sh](deploy/test-caddyfile.sh) tests the Caddyfile's routing in a container, so it needs Docker.
- [.github/workflows/gate.yml](.github/workflows/gate.yml) runs all of the above.
- `scripts/verify-*.mjs` check a deployed site from outside, some of them in a headless Chrome.
- [CLAUDE.md](CLAUDE.md) has the conventions a change follows: writing, the addresses of pills and sections, what is still in development, sign-in, dependencies and the test gate.

| Path | What it holds |
|---|---|
| `src/routes/` | the pages, a folder per domain under `(app)/`, and the sign-in endpoints under `api/auth/` |
| `src/lib/` | the code the pages share: the database queries in `db/`, each domain's pills and sections in `slug-tables/`, the charts and the components |
| `static/` | icons, images and the landing page's gate script; `pnpm dev` and `pnpm build` copy GSAP's two files from npm into `static/vendor/` |
| `deploy/` | the Caddy configuration and its test harness |
| `scripts/` | the checks of a deployed site, the social card's source and renderer, and the copy of GSAP's files that every `pnpm dev` and `pnpm build` runs first |

## License

Copyright (C) 2026 the Nostrology authors.

nostrology-web is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

nostrology-web is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

The license's full text is in [LICENSE](LICENSE).

The landing page runs GSAP (https://gsap.com) in the browser. GSAP is under GreenSock's Standard License (https://gsap.com/standard-license), not an open-source license: `pnpm dev` and `pnpm build` copy its files, unchanged, from the npm package the lockfile pins (`scripts/vendor-gsap.mjs`), and this repository holds none of them.

### Additional permission under GNU AGPL version 3 section 7

If you modify this program, or any covered work, by linking or combining it with GSAP (or a modified version of that library), containing parts covered by the terms of GreenSock's Standard License, the licensors of this program grant you additional permission to convey the resulting work.
