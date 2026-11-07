# Changelog

All notable changes to the **datadosomething** Apache-2.0 distribution (`@datadosomething/core` and `apps/selfhost`) are documented in this file.

This project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`) and separates **release versioning** from **data-contract versioning**:

- **Release & Workspace Version (`1.1.1`)**: Synchronized across the root manifest (`datadosomething-selfhost`), `@datadosomething/core` (`CORE_VERSION` / `coreVersion()`), and `apps/selfhost`.
  - **MAJOR**: Incompatible changes to the HTTP API routes, environment variable semantics, runtime floor, or public TypeScript exports of `@datadosomething/core`.
  - **MINOR**: Backward-compatible features, new provider adapters, or additive configuration options.
  - **PATCH**: Deterministic bug fixes, rule/verifier refinements, dependency security updates, and documentation improvements.
- **Data Contract Versions (`1.0`)**: `DOCUMENT_MODEL_VERSION` (`"1.0"`) and `PDFTOJSON_SCHEMA_VERSION` (`"1.0"`) version the canonical block set (`heading`, `paragraph`, `list`, `table`, `code`) and the published JSON Schema (Draft 2020-12) independently from engine releases, so patch and minor engine upgrades never break downstream consumers of `/api/pdftojson`.

---

## [1.1.1] - 2026-11-07

Security hardening, PDF proxy lifecycle cleanup, multiline code verifier preservation, and automated SemVer release gate.

### Added

- Automated SemVer release and README synchronization gate (`scripts/version.mjs`) enforcing lockstep versions across all workspace manifests, `CORE_VERSION`, `CHANGELOG.md`, and `README.md`.

### Fixed

- `@datadosomething/core`: Ensure `unpdf` document proxies are deterministically destroyed (`pdf.destroy()`) in `finally` blocks across `countPdfPages` and `inspectPdfTextLayer`, and short-circuit `inspectPdfTextLayer` character counting once `MIN_CHARS_PER_PAGE` is reached.
- `@datadosomething/core`: Preserve line boundaries and leading indentation in `verifyCleanedText` when verifying multiline code blocks during Stage 3 of Verified Nettoyage.
- `apps/selfhost`: Reject non-origin-form request targets (`400 Bad Request`), enforce cross-origin request checks (`Sec-Fetch-Site` and `Origin` vs `Host` -> `403 Forbidden`) on `POST /api/*`, and bound `parsePageSelection` ranges to `MAX_PAGE_SELECTION = 10,000`.

---

## [1.1.0] - 2026-10-22

Engine performance, structural fidelity, custom OpenAI-compatible provider endpoints, and self-host developer experience upgrades.

### Added

- **Zero-Cost Local PDF Reader Adapter (`@datadosomething/core`)**:
  - `LocalPdfReaderAdapter` (`provider: "local-pdf"`) extracts embedded text layers page-by-page (`page: 1..N`) in-memory via `unpdf` with zero API keys and zero outbound network calls, wired into `EngineRouter` as a fallback for born-digital PDFs when cloud reader/OCR keys are absent.
- **Code Blocks & Nested List Preservation (`@datadosomething/core`)**:
  - Canonical `CodeBlock` (`type: "code"`, optional `language`, multi-line `text`, `page`) across `DocumentModel`, `markdownToDocument`, `renderMarkdown`, `renderJson`, `PDFTOJSON_JSON_SCHEMA`, and `ruleCleanCodeText` (preserving indentation and line breaks while stripping invisible OCR control characters).
  - Indentation preservation for nested bullet and numbered lists (`2`/`4` leading spaces per nesting level).
- **Custom Provider & OpenAI-Compatible Endpoints (`apps/selfhost`)**:
  - Additive environment variables for custom/local LLM and OCR endpoints (Ollama, vLLM, LiteLLM, Scaleway, OVHcloud): `NETTOYAGE_API_KEY`, `NETTOYAGE_BASE_URL`, `NETTOYAGE_MODEL`, `NETTOYAGE_TIMEOUT_MS`, `OCR_BASE_URL`, `OCR_MODEL`, `OCR_TIMEOUT_MS`, `READER_BASE_URL`, `READER_TIMEOUT_MS`.
- **Self-Host CLI, Optional Bearer Auth & Per-Request Controls (`apps/selfhost`)**:
  - Standalone `datadosomething` CLI (`apps/selfhost/src/cli.ts`) for local file-to-stdout / `--out` conversions (`--format md|json`, `--pages`, `--no-nettoyage`).
  - Optional constant-time Bearer token protection (`SELFHOST_API_TOKEN`) on `/api/pdftomd` and `/api/pdftojson` while keeping `/healthz` reachable for container probes.
  - Per-request `pages` selection (`1-5,8`), `nettoyage` boolean override, and `source: { type, pages, provider }` metadata in conversion responses.
  - Accessible drag-and-drop upload zone, page-range input, Nettoyage toggle, source provenance badge, and input-derived download filenames in the self-hosted Web UI.
- **Bounded HTTP Retry (`@datadosomething/core`)**:
  - `fetchWithRetry` with exponential backoff and `Retry-After` header support on transient `429` and `502`/`503`/`504` responses across all outbound provider adapters.

### Changed

- **Sparse LLM Nettoyage Pass & Per-Slot Verifier Reconciliation (`@datadosomething/core`)**:
  - `runLlmCleanupPass` now filters out strings that contain no removable scan noise (`NETTOYAGE_REMOVABLE_NOISE`) and short-circuits the LLM call completely when 0 slots require cleanup.
  - `reconcileCleanedTexts` verifies LLM output per text slot rather than rejecting an entire document when a single slot fails verification, falling back to Stage 1 (`rule-Clean`) only on the rejected slot(s).
- **Single-Pass `unpdf` Inspection & Real Page Provenance (`@datadosomething/core`)**:
  - `inspectPdfTextLayer` shares a single `getDocumentProxy` parse across `probeTextLayer` and `countPdfPages`, and `JinaReaderAdapter` now populates exact PDF page counts on `DocumentModel.source.pages`.

---

## [1.0.0] - 2026-10-22

First stable Apache-2.0 release of the pure conversion engine (`@datadosomething/core`) and the self-hosted BYO-keys application (`apps/selfhost`).

### Added

- **Canonical Document Model (`v1.0`) & Pure Renderers (`@datadosomething/core`)**:
  - Closed, versioned block contract (`heading`, `paragraph`, `list`, `table`) with mandatory 1-based page provenance and optional `bbox` and `confidence` metadata.
  - Deterministic Markdown renderer (`renderMarkdown`) and JSON renderer (`renderJson` / `projectToJson`) backed by the published Draft 2020-12 JSON Schema (`PDFTOJSON_JSON_SCHEMA`, `schema_version: "1.0"`).
- **Cost-Aware Dual-Engine Router (`@datadosomething/core`)**:
  - Local in-memory PDF text-layer probe (`probeTextLayer`) and page counter (`countPdfPages`) via `unpdf` before any outbound API request.
  - `JinaReaderAdapter` for born-digital PDFs and `MistralOcrAdapter` for scanned PDFs and images (`PNG`, `JPG`), with automatic fallback when only an OCR key is configured.
  - Typed configuration and credential-refusal errors (`EngineConfigError`, `EngineAuthError`, `NoEngineAvailableError`) naming the exact environment variable to inspect.
- **Verified Nettoyage — 3-Stage Cleanup Pipeline (`@datadosomething/core`)**:
  - **Stage 1 (`ruleCleanDocument`)**: Deterministic removal of invisible OCR control/artifact characters (`OCR_ARTIFACT_CHARS`) and whitespace normalization (`NETTOYAGE_WHITESPACE`).
  - **Stage 2 (`runLlmCleanupPass`)**: Bounded in-block text cleanup via `MistralSmallAdapter` at `temperature=0` and `reasoning_effort="none"`, keeping document structure unreachable by construction (`flattenTexts` / `withTexts`).
  - **Stage 3 (`verifyCleanedDocument`)**: Deterministic verifier enforcing `protectedProjection` equality and `isSubsequence` containment, rejecting any candidate that adds, removes, reorders, or rewords protected content and falling back to Stage 1 (`outcome: "rule-only"`).
- **Self-Hosted Envelope (`apps/selfhost`)**:
  - Zero-dependency `node:http` server exposing `GET /` (self-contained accessible Web UI with zero external requests), `POST /api/pdftomd`, `POST /api/pdftojson`, and `GET /healthz`.
  - Streaming upload size guard (`MAX_UPLOAD_BYTES`, default 100 MB), startup configuration diagnostics (`configReport`), Verified Nettoyage enabled by default (`NETTOYAGE_ENABLED=true`), and zero disk/database retention (`Cache-Control: no-store`).
- **Hardened Container & Supply-Chain Gates**:
  - Multi-stage `apps/selfhost/Dockerfile` pinned to `node:24.18.0-slim` and `docker-compose.yml` bound to `127.0.0.1` with `read_only: true` and `cap_drop: ALL`.
  - Architectural boundary enforcement (`pnpm boundaries` via `dependency-cruiser`) and permissive runtime dependency verification (`pnpm license-check`).
