# Multi-stage Node.js build for the nostrology web app.
#
# Every install in this file reads pnpm-lock.yaml and refuses to run without it
# (--frozen-lockfile, no fallback), so the image runs exactly the dependency set CI
# tested. From 2026-06-25 to 2026-09-13 the runtime stage received no lockfile and a
# `|| pnpm install --prod` fallback re-resolved the server's dependencies from
# package.json ranges on every rebuild (nostrology-web#2).
#
# pnpm's version has ONE source: package.json's "packageManager" field. The base stage
# derives it from there, CI's pnpm/action-setup reads the same field, and a CI guard
# fails on any pnpm@<digits> literal in this file.

# base-pin: node:22-alpine resolved 2026-10-26
# Pinned by OCI index digest, and the tag beside it is therefore decorative: Docker resolves
# the digest and ignores the tag. The pin makes every pull content-addressed (the daemon
# verifies the registry against its own CA store) and makes a rebuild reproducible. Node 22
# rather than 20 because 20 is end-of-life and its compiled-in root set is frozen holding the
# roots compromised in the 2026-10 eMudhra/emSign incident; this digest is v22.23.4, whose set
# dropped them. To bump: change the tag AND re-resolve the digest AND update the base-pin line,
# in one commit - the test job's "Node major has exactly one source" step enforces it.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base

WORKDIR /app

COPY package.json .npmrc ./

# Install the pnpm that package.json declares, then assert on what npm actually
# installed. `pnpm --version` would not do as the check: pnpm 10 silently switches
# itself to the declared version, so it prints the right number even when npm
# installed the wrong one.
RUN set -eu; \
    want="$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')"; \
    npm install -g "pnpm@${want}"; \
    have="$(npm ls -g pnpm --depth=0 --json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).dependencies.pnpm.version')"; \
    test "${have}" = "${want}" || { echo "installed pnpm ${have}, package.json declares ${want}" >&2; exit 1; }

# Build stage: full install (build tooling is in devDependencies), then compile the
# browser bundle and the SSR server into build/.
FROM base AS builder

COPY pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# Runtime stage: production dependencies only, from the same lockfile the builder
# used, so the server loads the versions the browser bundle was compiled against.
FROM base

# The install sits ABOVE the build output on purpose. A changed COPY invalidates every
# layer below it, and build/ changes on every commit, so with the install underneath it
# each deploy re-ran `pnpm install --prod` and wrote a fresh node_modules layer (64.6 MB,
# 2026-09-14) into a new image. Stranded web images were the largest cost in the
# deployment's Docker storage, and this layer was about 65 MB of each. Measured A/B after
# a one-line source change: this order adds 2 new layers (build/ at 3.7 MB, and
# log-setup.cjs); the old order added 4, including the install. The cached install is
# reused until pnpm-lock.yaml, package.json (incl. its packageManager), .npmrc or the node
# base image changes.
COPY --from=builder /app/pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/build ./build
COPY --from=builder /app/log-setup.cjs ./

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "-r", "./log-setup.cjs", "build"]
