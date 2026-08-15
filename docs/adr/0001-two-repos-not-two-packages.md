# 0001. Ship Cortex and the personal vault as two repositories

**Date:** 2026-08-15
**Status:** accepted

## Context

Cortex was one repository that was simultaneously a product and one person's vault instance. Eight
directories of personal content were gitignored, so anyone cloning it got rituals describing
folders that were, for them, empty. The 2026-08-12 design chose a monorepo with two packages
(`cortex-dev` + `cortex-brain`) to resolve this.

Two problems surfaced when it came to build. A monorepo still ships the vault rituals to every
developer who installs the codebase tool. And the personal content is gitignored, so it exists
only in a working tree — it cannot simply be `git mv`d into a subdirectory and reviewed.

## Decision

Two **repositories**. `marinvch/Cortex` is the public, installable context manager. The personal
vault moved to a separate private repo.

## Alternatives rejected

| Option | Why not |
|---|---|
| One monorepo, two packages (the 2026-08-12 decision) | Every installer still carries rituals about daily notes they will never run; the split is a directory boundary, not a distribution one |
| Drop the vault entirely | Loses the memory layer that differentiates Cortex from the alternatives |
| Keep them fused | The product cannot be shared or forked cleanly while it contains someone's private notes |

## Consequences

The public repo is data-free and genuinely shareable. `README.md` leads with the plugin install.

The cost: the two halves can drift, and there is no longer one place to run both test suites. The
vault half also loses this repo's CI. `tools/cortex-vault-extract.sh` performs the split as
copy → verify → remove, because the source is gitignored and therefore unrecoverable if a delete
goes wrong.
