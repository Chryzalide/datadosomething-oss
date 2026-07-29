# Security

## Reporting a vulnerability

Write to **datadosomething.doctrine508@passmail.net**, with `security` in the
subject. Please do not open a public issue first.

You will get an acknowledgement. This is a one-person project rather than a
company with a rota, so the honest commitment is a reply within a few days and a
fix as soon as one exists — not a service-level agreement nobody would be able to
keep. If a report goes unanswered for a week, assume it was lost rather than
ignored, and send it again.

There is no bug bounty and no money to offer. Credit in the fix commit and in the
release notes, if you want it.

## What is worth reporting

Everything you would expect, and three areas specific to this codebase.

**Remote-URL ingestion.** The hosted envelope accepts a PDF by URL behind an
SSRF defence: DNS resolution before the fetch, private and link-local ranges
refused, redirects contained, size and time capped, content type checked, and a
single de-oracled refusal so a caller cannot use the error message to map an
internal network. If you can get it to reach somewhere it should not, or to tell
you the difference between "host does not exist" and "host exists and is
internal", that is a real finding.

**The cleanup verifier.** The promise is that a cleanup can never alter your
document: after the LLM pass, a deterministic verifier compares the result
against the original and rejects anything that added, removed, reordered or
reworded content. **A crafted document that gets altered content past that
verifier is the most valuable report this project can receive**, because the
guarantee is the product.

**Anything that writes a document to disk.** No document and no conversion result
is ever written to disk or to a database, at any point, in either envelope. A
path that violates that — a temporary file, a log line carrying document content,
a cache — is a security bug even if nothing else about it is exploitable.

## What is not a vulnerability here

**A self-hosted instance has no authentication, no quota and no rate limit.**
That is the design, stated plainly in the README and in the deployment guide:
you own the keys and the cost, so there is nothing for this software to meter.
An instance exposed to the internet lets anyone spend your provider budget, and
the container publishes to `127.0.0.1` by default and warns at startup whenever
it is bound anywhere else. Put your own reverse proxy and authentication in
front of it.

Reports that amount to "an exposed instance can be used by anyone" describe the
documented behaviour rather than a flaw. Reports that the default _changed_, or
that the startup warning does not appear when it should, are bugs and are worth
sending.

## Supported versions

The most recent published tree, and no other. This repository is generated from
the upstream monorepo, so a fix arrives as a new split rather than as a patch to
an older tag. There are no long-term support branches to backport to.
