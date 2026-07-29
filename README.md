# datadosomething — self-host

PDF → clean **Markdown** or structured **JSON**, on your own infrastructure, with
your own provider keys and **no quota**.

This is the Apache-2.0 distribution of the **datadosomething** suite: the pure
conversion engine and a thin app over it. Documents are never written to disk or
to a database — they live in memory for the duration of a request, and the only
outbound calls are to the provider APIs whose keys you configured.

> **Generated repository.** This tree is produced from the upstream monorepo by a
> scripted split, so the engine here is byte-identical to the one the hosted
> service runs. Open issues and pull requests here; they are applied upstream and
> flow back on the next split.

## Run it

```bash
cp .env.example .env        # put at least MISTRAL_API_KEY in it
docker compose up --build
```

Then open <http://127.0.0.1:8080>.

Full guide: **[docs/selfhost-deploy.md](docs/selfhost-deploy.md)**.
Every environment variable: **[docs/selfhost-config.md](docs/selfhost-config.md)**.

## What you get

| Endpoint              | Gives you                                                                 |
| --------------------- | ------------------------------------------------------------------------- |
| `GET /`               | A one-page UI: drop a PDF, get the result.                                |
| `POST /api/pdftomd`   | `{ markdown }` — clean Markdown.                                          |
| `POST /api/pdftojson` | `{ json }` — a versioned, flat list of typed blocks with page provenance. |
| `GET /healthz`        | `{ ok: true }`.                                                           |

Both outputs are projections of the same canonical Document Model, so they can
never disagree about a document's structure.

**Verified Nettoyage is on by default here.** OCR noise and stray whitespace are
removed by a deterministic rule pass, then a bounded LLM pass at `temperature=0`,
then a deterministic verifier that compares the result against the original and
**rejects any cleanup that added, removed, reordered or reworded content**. When
it rejects, you get the raw output with an honest notice. That is the guarantee:
cleanup can never quietly alter your document.

## Bring your own keys

| Variable          | For                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `MISTRAL_API_KEY` | OCR for scans and images; also the Nettoyage LLM. Effectively required.                          |
| `JINA_API_KEY`    | Born-digital PDFs, ~100× cheaper per page than OCR. Optional — without it they fall back to OCR. |

A missing or rejected key produces an explicit error naming the variable to fix,
never an opaque failure, and the instance still starts and tells you what is
missing.

## No quota — and no authentication

A self-hosted instance applies no quota, no rate limit, no page cap, no account,
no payment and no ads. The trade-off is worth stating plainly: **anyone who can
reach the port can spend your API keys.** The compose file therefore publishes to
`127.0.0.1` only, and the app warns on every start when it is bound wider. Put
your own reverse proxy and authentication in front of it before exposing it.

## Layout

| Path            | Role                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/core` | The pure engine: Document Model, renderers, Nettoyage, ports. No vendor SDKs, no framework, no I/O of its own. |
| `apps/selfhost` | The thin envelope: `node:http`, zero runtime dependencies of its own, BYO-keys.                                |

The engine talks to providers only through ports, so replacing an adapter is a
local change. `pnpm boundaries` fails the build on any import that crosses those
lines.

## Develop

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test          # vitest
pnpm lint
pnpm boundaries    # dependency-boundary gate
pnpm build
pnpm license-check # no non-commercially licensed dependency may enter this tree
```

Node 24 (`.nvmrc`), pnpm 10.

## Support

If this saves you time, you can back it on Ko-fi:
**<https://ko-fi.com/souryan>**.

It is support only and **unlocks nothing** — everything in this repository is
Apache-2.0 and stays that way, and nothing here is held back for donors. What you
run on your own machine is the whole engine, with cleanup enabled by default.

## License

Apache-2.0 — see [LICENSE](LICENSE). Every runtime dependency in this tree is
permissively licensed, and `pnpm license-check` enforces it.
