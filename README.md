# datadosomething — self-host

**Version `1.1.0`** · **Document Model & JSON Schema `v1.0`** · **Node `24.22.1`** · **License `Apache-2.0`**

Turn PDFs (born-digital or scanned) and images (`PNG`, `JPG`) into clean **Markdown** (`pdftomd`) or structured, schema-versioned **JSON** (`pdftojson`) — on your own infrastructure, with your own provider keys, **zero retention**, and **no quota**.

This is the Apache-2.0 distribution of the **datadosomething** suite: the pure conversion engine ([`packages/core`](packages/core)) and the thin self-hosted web & API envelope ([`apps/selfhost`](apps/selfhost)). Documents are never written to disk or to a database — they live in memory for the duration of a request, and the only outbound calls are to the provider APIs whose keys you configured.

> **Generated repository.** This tree is produced from the upstream monorepo by a scripted split, so the engine here is byte-identical to the one the hosted service runs. Open issues and pull requests here; they are applied upstream and flow back on the next split (see [CONTRIBUTING.md](CONTRIBUTING.md)).

---

## Table of contents

1. [What it does & how it works](#what-it-does--how-it-works)
2. [Use cases](#use-cases)
3. [Quick start & setup](#quick-start--setup)
4. [Configuration & environment variables](#configuration--environment-variables)
5. [API reference & examples](#api-reference--examples)
6. [Repository layout & development](#repository-layout--development)
7. [Versioning](#versioning)
8. [Author](#author)
9. [Support](#support)
10. [License](#license)

---

## What it does & how it works

Most PDF converters force an uncomfortable choice: fast text extractors mangle scans and tables, while raw OCR engines hallucinate, alter numbers during LLM post-processing, or charge OCR rates on native digital PDFs that already contain an embedded text layer.

**datadosomething** solves this with four architectural guarantees:

### 1. One canonical Document Model (`v1.0`), two pure projections

Every ingested document is mapped into a single internal pivot (`DocumentModel v1.0`) composed of a closed, ordered set of typed blocks carrying 1-based page provenance:

- `heading` (`level: 1..6`, `text`, `page`)
- `paragraph` (`text`, `page`)
- `list` (`ordered: boolean`, `items: string[]`, `page`, with nested indentation preserved)
- `table` (`rows: string[][]`, `page`)
- `code` (`text`, optional `language`, `page`, with multi-line formatting preserved)

Both `pdftomd` (Markdown) and `pdftojson` (JSON Schema Draft 2020-12, `schema_version: "1.0"`) are **pure, deterministic projections** of this model. They can never disagree about a document's structure, block count, or reading order.

### 2. Cost-aware dual-engine routing (with zero-key local PDF fallback)

Before making any network request, `packages/core` runs a local in-memory text-layer probe (`unpdf`) on uploaded PDF bytes:

- **Born-digital PDFs** (embedded text layer detected) are routed to **Jina Reader** (`jina-reader`), which is roughly **100× cheaper per page** than vision OCR. If `JINA_API_KEY` is not set, the router falls back to OCR when `MISTRAL_API_KEY` is present, or extracts the embedded text layer locally in-memory via **`LocalPdfReaderAdapter`** (`local-pdf`, zero API keys required).
- **Scanned PDFs, ambiguous/hybrid PDFs, and images (`PNG`/`JPG`)** are routed to **Mistral OCR** (`mistral-ocr`), preserving per-page provenance (`page: 1..N`) across all extracted blocks.

### 3. Verified Nettoyage (3-stage cleanup with a deterministic verifier)

**Verified Nettoyage is enabled by default on self-host.** It removes OCR framing artifacts and stray whitespace between extraction and rendering without ever trusting an LLM with your document's integrity:

1. **Stage 1 — Deterministic Rule Pass (`ruleCleanDocument`)**: Strips invisible OCR control characters, soft hyphens, zero-width joiners, bidi overrides, and `U+FFFD` replacement characters, and normalizes whitespace runs to a single space. Zero visible glyphs are altered.
2. **Stage 2 — Bounded LLM Pass (`runLlmCleanupPass`)**: Extracts only the flat list of in-block strings (`flattenTexts`) — keeping block structure, hierarchy, and page numbers completely out of the model's reach — and calls `mistral-small-latest` at `temperature=0` and `reasoning_effort="none"` to strip visible scan frame noise (`│`, `─`, `|`, `¦`, `¬`, `` ` ``).
3. **Stage 3 — Deterministic Verifier (`verifyCleanedDocument`)**: Compares every cleaned string against its Stage 1 counterpart using two mechanical invariants (`protectedProjection` byte equality + `isSubsequence` deletion-only check). **Any cleanup that adds, removes, reorders, or rewords a single letter, digit, punctuation mark, or currency symbol is rejected**, and the server returns the Stage 1 rule-clean output with an explicit notice (`outcome: "rule-only"`).

### 4. Kernel-enforced zero retention

Uploaded bytes are streamed into memory under a configurable stability ceiling (`MAX_UPLOAD_BYTES`), converted in-process, and returned with `Cache-Control: no-store`. Nothing is written to disk or to a database. In Docker Compose, the container runs as an unprivileged user with a **read-only root filesystem** (`read_only: true`) and **all Linux capabilities dropped** (`cap_drop: ALL`).

---

## Use cases

- **RAG & LLM Ingestion Pipelines**: Convert heterogeneous PDFs and scans into clean Markdown or page-indexed JSON blocks before chunking and embedding. Eliminating OCR box-drawing noise and broken whitespace improves retrieval quality and reduces token usage.
- **Confidential & Regulated Documents (Legal, Healthcare, Finance, Public Sector)**: Process contracts, medical records, audit reports, and invoices on your own machine or private VPC with zero disk persistence and direct calls only to the API keys you control.
- **Automated Structured Extraction (`pdftojson`)**: Consume a deterministic, schema-validated JSON block stream (`schema_version: "1.0"`) in ETL pipelines to extract tables, headings, and lists with guaranteed 1-based page provenance.
- **Technical Writing & Knowledge Base Archiving (`pdftomd`)**: Turn PDF specifications, research papers, and scanned handouts into clean GitHub-Flavored Markdown ready to paste into Obsidian, Notion, Git repositories, or static site generators.
- **Unlimited Internal Team Utility**: Run a lightweight self-hosted converter (zero runtime framework dependencies in `apps/selfhost`) behind your corporate SSO or reverse proxy with no per-seat fees, no page caps, and no rate limits.

---

## Quick start & setup

### Option 1 — Docker Compose (recommended, one command)

```bash
cp .env.example .env        # set at least MISTRAL_API_KEY in .env
docker compose up --build
```

Then open **<http://127.0.0.1:8080>**.

Compose builds `apps/selfhost/Dockerfile`, injects your `.env` keys at runtime (never baking them into the image), and binds port `8080` to **localhost (`127.0.0.1`) only**.

To change the host port without editing `docker-compose.yml`:

```bash
SELFHOST_PORT=9000 docker compose up -d   # listens on http://127.0.0.1:9000
```

### Option 2 — Standalone Docker

```bash
docker build -f apps/selfhost/Dockerfile -t datadosomething-selfhost .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e MISTRAL_API_KEY="$MISTRAL_API_KEY" \
  -e JINA_API_KEY="$JINA_API_KEY" \
  --read-only --tmpfs /tmp:size=64m --cap-drop ALL \
  datadosomething-selfhost
```

### Option 3 — Native Node.js (without Docker)

Requires **Node `24.22.1`** (see [`.nvmrc`](.nvmrc)) and **pnpm `10`**:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter selfhost... build
MISTRAL_API_KEY=your_key_here pnpm start
```

Full deployment & troubleshooting guide: **[docs/selfhost-deploy.md](docs/selfhost-deploy.md)**.

---

## Configuration & environment variables

Every setting is passed via environment variables. A missing key never causes the server to crash on boot: the instance starts, prints a clear diagnostic naming the missing variable, and answers `503` with actionable instructions until configured.

| Variable                       | Required / Default                   | Role                                                                                                                            |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY`              | **Recommended**                      | Powers Mistral OCR for scanned PDFs and images (`PNG`/`JPG`), and Mistral Small for Verified Nettoyage.                         |
| `JINA_API_KEY`                 | Optional                             | Powers Jina Reader for born-digital PDFs (~100× cheaper per page than OCR). Without any key, born-digital PDFs use `local-pdf`. |
| `NETTOYAGE_ENABLED`            | `true` (default on self-host)        | Enables the 3-stage Verified Nettoyage pipeline (`true/1/yes/on` or `false/0/no/off`).                                          |
| `NETTOYAGE_API_KEY`            | Falls back to `MISTRAL_API_KEY`      | Dedicated API key for the Nettoyage LLM endpoint (OpenAI-compatible `/v1/chat/completions`, e.g., Ollama, vLLM, LiteLLM).       |
| `NETTOYAGE_BASE_URL` / `MODEL` | Mistral API / `mistral-small-latest` | Custom base URL and model name for the Nettoyage LLM pass (plus `NETTOYAGE_TIMEOUT_MS`).                                        |
| `OCR_BASE_URL` / `OCR_MODEL`   | Mistral API / `mistral-ocr-latest`   | Custom base URL and model name for the OCR endpoint (plus `OCR_TIMEOUT_MS`).                                                    |
| `READER_BASE_URL`              | `https://r.jina.ai/`                 | Custom base URL for the Reader endpoint (plus `READER_TIMEOUT_MS`).                                                             |
| `SELFHOST_API_TOKEN`           | Optional (unset)                     | When set, requires `Authorization: Bearer <token>` on `POST /api/pdftomd` and `POST /api/pdftojson` (`/healthz` stays open).    |
| `PORT`                         | `8080`                               | HTTP listener port inside the process/container.                                                                                |
| `HOST`                         | `0.0.0.0`                            | Bind address inside the container (`docker-compose.yml` restricts host publication to `127.0.0.1`).                             |
| `MAX_UPLOAD_BYTES`             | `104857600` (100 MB)                 | Streaming memory stability ceiling per upload. Set to `0` to disable the limit.                                                 |
| `CONFIG_DOCS_URL`              | `docs/selfhost-config.md`            | Documentation pointer appended to `503` configuration error messages. Override to point to your internal runbook.               |

Full configuration reference: **[docs/selfhost-config.md](docs/selfhost-config.md)**.

### Security note: No quota — and no built-in authentication

A self-hosted instance applies **no quota, no rate limit, no page cap, no account, and no telemetry**. You supply the API keys and own the provider usage. Consequently, **anyone who can reach the port can run conversions against your API keys.** Keep the binding on `127.0.0.1` or a private network, or place a reverse proxy with authentication (Caddy, Nginx, Traefik, Cloudflare Access, Tailscale) in front of it before exposing it wider.

---

## API reference & examples

| Endpoint         | Method | Description                                                                                       |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `/`              | `GET`  | Self-contained, accessible one-page Web UI (zero external requests, zero trackers).               |
| `/api/pdftomd`   | `POST` | Multipart `file` upload (`PDF`, `PNG`, `JPG`) → `{ markdown, nettoyage? }`.                       |
| `/api/pdftojson` | `POST` | Multipart `file` upload (`PDF`, `PNG`, `JPG`) → `{ json, nettoyage? }` (`schema_version: "1.0"`). |
| `/healthz`       | `GET`  | Liveness probe → `{ "ok": true }` (`200 OK`).                                                     |

### Convert a PDF or scan to Markdown (`POST /api/pdftomd`)

```bash
curl -sS -F "file=@invoice.pdf" http://127.0.0.1:8080/api/pdftomd | jq .
```

```json
{
  "markdown": "# Invoice 2026-042\n\nTotal due: 1,250.00 EUR\n\n| Item | Qty | Amount |\n| --- | --- | --- |\n| Architecture Audit | 1 | 1,250.00 EUR |",
  "nettoyage": {
    "outcome": "cleaned"
  }
}
```

### Convert a PDF or scan to structured JSON (`POST /api/pdftojson`)

```bash
curl -sS -F "file=@invoice.pdf" http://127.0.0.1:8080/api/pdftojson | jq '.json | fromjson'
```

```json
{
  "schema_version": "1.0",
  "source": {
    "type": "pdf",
    "pages": 1,
    "provider": "mistral-ocr"
  },
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "text": "Invoice 2026-042",
      "page": 1
    },
    {
      "type": "paragraph",
      "text": "Total due: 1,250.00 EUR",
      "page": 1
    },
    {
      "type": "table",
      "rows": [
        ["Item", "Qty", "Amount"],
        ["Architecture Audit", "1", "1,250.00 EUR"]
      ],
      "page": 1
    }
  ]
}
```

---

## Repository layout & development

| Path                             | Role                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/core`](packages/core) | The pure engine (`@datadosomething/core`): Document Model, renderers, Nettoyage, ports & adapters.                                         |
| [`apps/selfhost`](apps/selfhost) | The thin self-hosted envelope (`selfhost`): `node:http` server, minimal accessible UI, BYO-keys configuration.                             |
| [`scripts/`](scripts)            | ESM build post-processor and the `pnpm license-check` supply-chain license gate.                                                           |
| [`docs/`](docs)                  | Deployment guide ([`selfhost-deploy.md`](docs/selfhost-deploy.md)) and config reference ([`selfhost-config.md`](docs/selfhost-config.md)). |

### Local development & quality gates

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build          # compiles TypeScript and rewrites ESM specifiers
pnpm typecheck      # strict composite typechecking across workspaces and tests
pnpm test           # Vitest unit & integration suites (no network or API keys required)
pnpm lint           # ESLint
pnpm boundaries     # dependency-cruiser gate (enforces AD-1 pure-core isolation)
pnpm license-check  # verifies every runtime dependency in the closure is permissively licensed
```

---

## Versioning

This repository uses **[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)** (`MAJOR.MINOR.PATCH`) and separates **software release versions** from **data contract versions**:

| Version scope                      | Current | Identifier / Location                                                                                        | Policy                                                                                                        |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Release & Workspace Version**    | `1.1.0` | `package.json`, `packages/core/package.json`, `apps/selfhost/package.json`, `CORE_VERSION` (`coreVersion()`) | Synchronized across all workspaces in this repo. Bumped according to SemVer (`MAJOR.MINOR.PATCH`).            |
| **Canonical Document Model**       | `1.0`   | `DOCUMENT_MODEL_VERSION` in `@datadosomething/core`                                                          | Closed internal block contract (`heading`, `paragraph`, `list`, `table`, `code`).                             |
| **`pdftojson` Public JSON Schema** | `1.0`   | `PDFTOJSON_SCHEMA_VERSION` / `PDFTOJSON_JSON_SCHEMA`                                                         | Public JSON Schema (Draft 2020-12) contract (`schema_version: "1.0"`). Versioned independently from releases. |

All release notes and version history are tracked in **[CHANGELOG.md](CHANGELOG.md)**.

---

## Author

Created and maintained by **Souryan Augé**:

- Website: **<https://souryan-auge.fr/>**
- LinkedIn: **<https://www.linkedin.com/in/souryan-auge/>**
- GitHub: **[@Chryzalide](https://github.com/Chryzalide)**

---

## Support

If this project saves you time, you can back it on Ko-fi:
**<https://ko-fi.com/souryan>**.

It is support only and **unlocks nothing** — everything in this repository is Apache-2.0 and stays that way, and nothing here is held back for donors. What you run on your own machine is the whole engine, with verified cleanup enabled by default.

---

## License

Apache-2.0 — see [LICENSE](LICENSE). Every runtime dependency in this tree is permissively licensed, and `pnpm license-check` enforces it in CI.
