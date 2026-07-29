# Deploying a self-hosted instance

Everything here is about `apps/selfhost` — the Apache-2.0, bring-your-own-keys
envelope. You supply provider keys, you own the cost, there is no quota and no
account. Documents never leave your infrastructure except to the provider APIs
whose keys you configured.

For what each environment variable does, see
[the configuration reference](./selfhost-config.md). This page does not repeat
that table; it covers getting an instance up and keeping it that way.

## Quick start

```bash
git clone <this-repo> && cd <this-repo>
cp .env.example .env        # put at least MISTRAL_API_KEY in it
docker compose up --build
```

Then open <http://127.0.0.1:8080>.

That is the whole deploy. Compose reads `.env` for the keys, builds the image
from `apps/selfhost/Dockerfile`, and publishes port 8080 **on localhost only**.

### What "working" looks like

The startup log tells you where you stand before you convert anything:

```
datadosomething selfhost listening on http://0.0.0.0:8080
Configuration looks complete: reader + OCR keys present.
```

With a key missing you get a diagnostic instead, and the instance **still
starts** — a container that refused to boot over a missing key would tell you
less, not more:

```
[config error] No provider key is configured, so no document can be converted.
Set MISTRAL_API_KEY (required for scans and images) and optionally JINA_API_KEY.
See docs/selfhost-config.md for the full configuration reference.
```

Two quick probes:

```bash
curl -s http://127.0.0.1:8080/healthz                       # {"ok":true}
curl -F "file=@your.pdf" http://127.0.0.1:8080/api/pdftomd  # {"markdown":"…"}
```

`/healthz` answers `200` whenever the server is up. It deliberately says nothing
about your keys: health means "the process is serving", and conflating that with
"is configured" would make a restart loop out of a missing key.

## The keys

At minimum set `MISTRAL_API_KEY`. Add `JINA_API_KEY` if you convert born-digital
PDFs — without it they still convert, but through OCR, which costs roughly 100×
as much per page. The instance says so at startup.

Keys are read from the environment at container start. They are never baked into
the image, so the image itself is safe to move around; `.env` is not, and is
git-ignored for that reason. Rotating a key is `docker compose up -d` away.

Full table, defaults, and what happens when each one is absent:
[configuration reference](./selfhost-config.md).

## Exposing it beyond localhost

Compose publishes to `127.0.0.1:8080` on purpose.

**A self-hosted instance has no authentication, no quota and no rate limit.**
That is the design (Story 4.1: you own the keys, so there is nothing to meter),
and it means anyone who can reach the port can spend your provider budget. On a
laptop or a private network that is fine. On a public IP it is an open invitation
billed to you.

If you need it reachable, put your own reverse proxy and authentication in front
of it and keep the container itself on loopback or a private Docker network — do
not simply widen the published port. When you do change the binding, the app
prints the warning again on every start.

To move the host-side port without touching the compose file:

```bash
SELFHOST_PORT=9000 docker compose up -d   # → 127.0.0.1:9000
```

## What the container is allowed to do

The compose service runs with the filesystem read-only, all Linux capabilities
dropped, a 64 MB `tmpfs` for `/tmp`, and as the image's unprivileged `node` user.
None of that constrains the app, because the app writes nothing to disk:
conversions live in memory for the duration of the request and every response
carries `Cache-Control: no-store`. Zero retention stops being a promise and
becomes something the kernel enforces.

Logs are capped at 3 × 10 MB so a long-running instance cannot fill the disk.

**`no-new-privileges` is left commented out**, not forgotten. On the host this
was verified against (Docker 29.6, Linux 7.0) that single flag makes the
container fail to exec its entrypoint — `exec /usr/local/bin/docker-entrypoint.sh:
operation not permitted` — before any application code runs. It is not this
image: stock `node:24-slim` fails identically with only that flag set. If your
host is unaffected, uncomment the `security_opt` block in `docker-compose.yml`;
if the container starts restart-looping with that error, that is what you are
looking at.

## Running the image without compose

```bash
docker build -f apps/selfhost/Dockerfile -t datadosomething-selfhost .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e MISTRAL_API_KEY="$MISTRAL_API_KEY" \
  --read-only --tmpfs /tmp:size=64m --cap-drop ALL \
  datadosomething-selfhost
```

The build context is the repository root and the image carries its own
`HEALTHCHECK`, so `docker ps` reports health with or without compose.

## Running it without Docker

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter selfhost... build
MISTRAL_API_KEY=… pnpm --filter selfhost start
```

Node 24 (see `.nvmrc`) and pnpm 10. The build step is not optional: the emitted
ESM is post-processed to be Node-loadable.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The container stops on `SIGTERM` by closing the listener first, so in-flight
conversions finish rather than being cut off.

## Troubleshooting

| Symptom                                                     | What it means                                                                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot start: … is already in use`                         | Something else holds the port. `SELFHOST_PORT=9000 docker compose up -d`, or stop the other process.                                                                                      |
| `503` naming an environment variable                        | A **configuration** problem — the key is missing, or the provider rejected it (`401`/`403`). The message names the variable to fix.                                                       |
| `502`                                                       | A **provider** problem, not yours: the API was reached and failed for some other reason. Retry; check the provider's status page.                                                         |
| `413`                                                       | The upload exceeded `MAX_UPLOAD_BYTES` (100 MB default). Raise it, or set it to `0` to lift the bound.                                                                                    |
| Output arrives raw, with a notice, although Nettoyage is on | Working as designed. The verifier rejects any cleanup that would alter content, and it is deliberately conservative. See [the configuration reference](./selfhost-config.md) § Nettoyage. |
| Born-digital PDFs are slow and expensive                    | `JINA_API_KEY` is not set, so they take the OCR path. The startup log says so.                                                                                                            |
| Health is `unhealthy` but the log looks fine                | The healthcheck calls `/healthz` on `$PORT` inside the container. If you overrode `PORT`, keep the container-side port and the published mapping consistent.                              |

## Publishing the public repo (maintainers)

The public Apache-2.0 repository is **generated**, never hand-copied:

```bash
pnpm oss:split ../datadosomething-oss
```

That writes `packages/core` + `apps/selfhost` and the files they need into the
target directory, rewrites the root manifest to Apache-2.0, prunes the hosted
app's importer out of the lockfile, and then verifies its own output: no
`apps/hub` path, no reference to it in any source file, no hub CI pipeline, no
dangling documentation links. It fails loudly rather than publishing a tree it
cannot vouch for.

It writes a directory and **publishes nothing**. Creating the repository,
choosing its visibility and pushing are deliberate manual steps:

```bash
cd ../datadosomething-oss
pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm boundaries && pnpm build
pnpm license-check          # AR-10: nothing non-commercial in the distributed closure
git init && git add -A && git commit -m "datadosomething self-host (Apache-2.0)"
# then create the public repo and push
```

`pnpm license-check` also runs in CI on every push here, so a dependency with a
non-commercial license (the CC-BY-NC case AR-10 names) fails the build long
before it could reach the public repo.
