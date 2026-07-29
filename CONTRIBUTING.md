# Contributing

Thanks for looking. Before anything else, one fact that explains most of what
follows.

## This repository is generated

You are looking at the output of a script. The engine and the self-hosted app are
developed in a private monorepo alongside a hosted application that is **not**
open source, and `pnpm oss:split` extracts the Apache-2.0 half of that tree into
this one — rewriting the root manifest, pruning the hosted app out of the
lockfile, and refusing to finish if anything belonging to the hosted side leaked
in.

Two consequences worth knowing before you spend an evening on a patch:

- **The engine here is byte-identical to the one the hosted service runs.** There
  is no "community edition" that lags. A bug you find here is the same bug there.
- **A commit pushed straight to this repository would be overwritten by the next
  split.** That is not a policy about your patch; it is what "generated" means.

So the workflow is a little unusual, and it is honest about it rather than
pretending otherwise.

## Issues

**Open them here.** This is the right place, and it is read.

The most useful bug report contains a PDF that reproduces the problem, or — if
the document is confidential, which it usually is — a description of what it
contains structurally: born-digital or scanned, how many pages, what the failing
region looks like (a table, a two-column layout, a header that repeats). The
conversion path differs sharply between those cases, and knowing which one you
are on is most of the diagnosis.

Include the version of the image or the commit you are running, and the startup
log — it states which provider keys were found, which decides which path your
document took.

## Pull requests

**Open them here too.** A pull request against this repository is welcome and is
read as a proposal: the change is applied upstream, with your authorship
preserved in the commit, and it comes back here on the next split. You will see
your patch land as part of a generated commit rather than as your own merge, and
that is not a slight — it is the only shape the pipeline has.

If that trade is not one you want to make, say so in the issue and we will find
another way. Nobody should be surprised by it after the fact.

What makes a change easy to accept:

- **A test that fails without it.** This codebase is unusually strict about this,
  and the reason is written into the suites themselves: an assertion that names a
  key rather than a claim will pass while the behaviour it protects is gutted.
  Assert the substance.
- **A note on what you decided not to do.** Rejected alternatives are worth as
  much as the change, and the repository records them rather than losing them.
- **No new dependency without a reason that survives being said out loud.** The
  distributed closure is four packages, deliberately, and every one of them is
  checked for a permissive licence by `pnpm license-check` in CI.

## Running the checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build          # core, then the app — the ESM output is post-processed, so this is not optional
pnpm typecheck
pnpm test
pnpm lint
pnpm boundaries     # the dependency rules: the engine imports no app, no vendor SDK, no database
pnpm license-check  # nothing non-permissive in what we distribute
```

All of them run in CI on every push and pull request, and none of them needs a
network or a provider key. The suites that would call a live provider are opt-in
behind `RUN_INTEGRATION_TESTS`, because a suite that fails without a network is a
suite people learn to ignore.

## The one rule the architecture rests on

`packages/core` is pure. It never imports an app, a database client, an HTTP
framework, or a vendor SDK — those live behind ports, and adapters are wired in
by the app at the edge. `pnpm boundaries` enforces it and fails CI on any
forbidden edge, so you will find out immediately rather than in review.

The same rule is why the cleanup pass can promise what it promises: a
deterministic verifier compares the cleaned document against the original and
rejects any result that added, removed, reordered or reworded content. If you
change anything in that path, that guarantee is the thing to protect.

## Security

Please do not open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).
