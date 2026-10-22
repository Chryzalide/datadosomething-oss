# Multi-stage image for apps/selfhost — the OSS, BYO-keys artifact (Story 4.3).
#
# This is the image OTHERS run. We never deploy it (AR-11: `apps/selfhost` is not
# deployed on the VPS), and CI builds it only to prove this file works — it is
# pushed to no registry.
#
# Build context is the repo ROOT, like the hub's:
#   docker build -f apps/selfhost/Dockerfile -t datadosomething-selfhost .
#
# It must build identically in the monorepo and in the public split tree. The
# only difference between the two is that `apps/` holds one app there instead of
# two, so nothing below may name `apps/hub`.
#
# Base pinned to the exact Node 24 patch in .nvmrc (2026-10-21 security release).

# ---- Builder ---------------------------------------------------------------
FROM node:24.22.1-slim AS builder
WORKDIR /app
# Non-interactive: without it pnpm refuses to purge node_modules for the
# production re-install below ("no TTY").
ENV CI=true
RUN corepack enable

# MANIFESTS FIRST, then install, then sources. Docker keys a layer on the
# CONTENT of what it copies, so copying source before `pnpm install` made every
# `.ts` edit re-run the whole install — re-downloading pnpm itself and the entire
# dependency tree on each build. Verified A/B on this machine: with one line
# changed in `src/server.ts`, the old order re-runs the install step and this one
# reports CACHED.
#
# An earlier version of this file copied `apps` wholesale and explained it with
# "the lockfile has an `apps/hub` importer, and `--frozen-lockfile` fails if that
# workspace's manifest is absent". That is NOT true under `--filter selfhost...`:
# pnpm resolves only the filtered subtree, and the build below succeeds with no
# hub manifest present. Tested, not assumed — which also means this stays valid
# in the public split tree, where `apps/hub` does not exist at all.
#
# `--filter selfhost...` is still what keeps the hub's dependency tree (Next,
# React) from ever being installed or copied.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/selfhost/package.json ./apps/selfhost/package.json
RUN pnpm install --frozen-lockfile --filter selfhost...

# Sources last: everything above this line is cached across ordinary code edits.
COPY packages ./packages
COPY apps/selfhost ./apps/selfhost
COPY scripts ./scripts

# Build core -> selfhost only. `scripts/add-esm-extensions.mjs` runs as part of
# each package's own `build`, which is why the build happens IN the image: an
# image that copied a `dist` produced elsewhere would start and then fail to
# resolve its own modules (Story 4.1).
RUN pnpm --filter selfhost... build

# Drop dev dependencies (TypeScript, Vitest) from the tree the runner copies.
# `dist` is already built and install does not touch it.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter selfhost...

# ---- Runner ----------------------------------------------------------------
FROM node:24.22.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# 0.0.0.0 INSIDE the container: a published port cannot reach a listener bound
# to the container's loopback. What is not exposed by default is the *host*
# side — see docker-compose.yml, which publishes to 127.0.0.1 only.
ENV HOST=0.0.0.0

# Only the three paths the app needs. pnpm's node_modules is a graph of relative
# symlinks into node_modules/.pnpm, so the root tree comes across wholesale — but
# `apps/` is copied one app at a time so the hub's source can never ride along,
# not even in an image nobody reads. (In the split tree there is nothing else to
# copy anyway; this keeps the two builds equivalent.)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/packages/core ./packages/core
COPY --from=builder --chown=node:node /app/apps/selfhost ./apps/selfhost

# Unprivileged user shipped in the base image. The app writes nothing to disk
# (AD-7 zero retention), so it needs no writable location of its own.
USER node
EXPOSE 8080

# `/healthz` is the route Story 4.1 already serves. Node 24 has global fetch, so
# the check needs no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# `main.js` handles SIGTERM by closing the listener, so `docker compose down`
# lets in-flight conversions finish.
CMD ["node", "apps/selfhost/dist/main.js"]
