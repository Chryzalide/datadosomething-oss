# Self-host configuration reference

Every setting is an environment variable. Nothing is required for the app to
**start** — a misconfigured instance boots and tells you what is missing rather
than refusing to run. What is required to **convert** is at least one provider
key.

This is the page the app's config errors link to. For getting an instance up —
Docker, compose, exposure, upgrades, troubleshooting — see
[the deployment guide](./selfhost-deploy.md), which links here for this table
rather than repeating it.

## Provider keys (BYO-keys)

| Variable          | Required             | What it does                                                                     | If it is absent                                                                                                             |
| ----------------- | -------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY` | **Yes, in practice** | Mistral OCR for scanned PDFs and images; also the Nettoyage LLM (Mistral Small). | Scans and images cannot be read at all, and Nettoyage cannot run. Born-digital PDFs still convert if `JINA_API_KEY` is set. |
| `JINA_API_KEY`    | Optional             | Jina Reader for born-digital PDFs — roughly 100× cheaper per page than OCR.      | Born-digital PDFs still convert, but fall back to **OCR**, which costs much more. Nothing breaks; your bill grows.          |

With **neither** key set, no conversion can succeed. The endpoints answer `503`
with a message naming the variable to set, and the startup log says the same.

### A rejected key is reported differently from a missing one

If a key is present but wrong, expired, or lacking scope, the provider answers
`401`/`403`. That surfaces as a **configuration** error (`503`) naming the
variable to check — not as a generic conversion failure — so you can tell a bad
key from a provider outage.

Keys are never validated at startup: doing so would spend money on every restart
and turn a provider outage into a failed deploy.

## Nettoyage (verified cleanup)

| Variable               | Default                  | Notes                                                                                                                                                                                      |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NETTOYAGE_ENABLED`    | **`true`** (on)          | Accepts `true/1/yes/on` and `false/0/no/off`; an unrecognized value falls back to the default. Self-host defaults to **on** because you pay your own LLM calls — there is nothing to gate. |
| `NETTOYAGE_API_KEY`    | `MISTRAL_API_KEY`        | Optional separate API key for the Nettoyage `/v1/chat/completions` provider. Falls back to `MISTRAL_API_KEY` when unset.                                                                   |
| `NETTOYAGE_BASE_URL`   | `https://api.mistral.ai` | Optional custom base URL for any OpenAI-compatible `/v1/chat/completions` endpoint (e.g. Ollama, vLLM, LiteLLM, Scaleway, OVHcloud).                                                       |
| `NETTOYAGE_MODEL`      | `mistral-small-latest`   | Optional model identifier passed to the Nettoyage chat completion endpoint.                                                                                                                |
| `NETTOYAGE_TIMEOUT_MS` | `30000` (30 s)           | Optional per-request timeout in milliseconds for the Nettoyage LLM call.                                                                                                                   |

Nettoyage needs `NETTOYAGE_API_KEY` (or `MISTRAL_API_KEY`). Enabled without one,
it simply does not run and the output is served raw — it never fails a
conversion. You can also override Nettoyage per request by passing
`nettoyage=true|false` in the multipart `FormData` or query string.

Expect the cleanup to be **rejected** fairly often, and the result served raw
with an honest notice. That is the design: a deterministic verifier compares the
cleaned text against the raw one and rejects anything that would add, remove,
reorder or reword content. A conservative verifier serving raw output is correct
behaviour, not a bug.

## Custom OCR & Reader endpoints

| Variable            | Default                  | Notes                                                                              |
| ------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `OCR_BASE_URL`      | `https://api.mistral.ai` | Optional custom base URL for the OCR `/v1/ocr` endpoint.                           |
| `OCR_MODEL`         | `mistral-ocr-latest`     | Optional model identifier passed to the OCR endpoint.                              |
| `OCR_TIMEOUT_MS`    | `60000` (60 s)           | Optional per-request timeout in milliseconds for the OCR call.                     |
| `READER_BASE_URL`   | `https://r.jina.ai`      | Optional custom base URL for the born-digital PDF reader endpoint.                 |
| `READER_TIMEOUT_MS` | `60000` (60 s)           | Optional per-request timeout in milliseconds for the born-digital PDF reader call. |

## Server

| Variable             | Default                   | Notes                                                                                                                                                                    |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`               | `8080`                    | An invalid value falls back to the default, with a warning.                                                                                                              |
| `HOST`               | `0.0.0.0`                 | `0.0.0.0` is needed for a container port mapping to reach the app. Use `127.0.0.1` to keep it local to the machine.                                                      |
| `MAX_UPLOAD_BYTES`   | `104857600` (100 MB)      | A **stability** bound, not a quota — it stops a pathological upload from exhausting memory. Set to `0` to remove the bound entirely. Enforced while the body streams in. |
| `CONFIG_DOCS_URL`    | `docs/selfhost-config.md` | Where config errors point. Override it to send your team to your own runbook.                                                                                            |
| `SELFHOST_API_TOKEN` | Unset (disabled)          | Optional Bearer token protecting `/api/pdftomd` and `/api/pdftojson` using constant-time comparison (`Authorization: Bearer <token>`).                                   |

## There is no quota, and no authentication

A self-hosted instance applies **no quota, no rate limit, no page cap, no
account, no payment and no ads**. You supply the keys and you own the cost.

The consequence is worth stating plainly: **anyone who can reach the port can
run conversions against your API keys.** The app prints a warning at startup
whenever it is bound to something other than loopback. Keep the instance on a
private network, or put your own reverse proxy and authentication in front of it.

## Privacy

Documents and their conversions are never written to disk or to a database. They
live only in memory for the duration of the request, and every response is sent
with `Cache-Control: no-store`. The only outbound calls are to the provider APIs
whose keys you configured.
