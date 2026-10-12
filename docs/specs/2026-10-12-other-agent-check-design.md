# Design: checking that another agent reads what Cortex writes

- **Date:** 2026-10-12
- **Status:** Draft for review. **Recommendation: do not build yet.** The reasons are under
  [Not yet specified](#not-yet-specified).
- **Area:** `evals/` ([`evals/AGENTS.md`](../../evals/AGENTS.md)). This document changes no code.
- **Source of the idea:** the `verify:*-client` lanes in `morluto/rea`, which run a real Gemini,
  Codex or Claude client in a disposable profile and confirm it loads the skill and calls the
  server.

## Destination

A maintainer runs one command on their own machine and reads, for one named agent other than
Claude Code, whether a session started in a repo Cortex scaffolded had the root `AGENTS.md` in its
context. The result is recorded with the client's name and version.

## Context

- **Cortex says it serves other agents.** `AGENTS.md` states "Other tools read it natively", and
  roadmap decision D5 keeps Claude-only features out of anything another agent must read
  ([the 2026-09-26 roadmap](2026-09-26-cortex-roadmap-design.md)).
- **No test runs a real one.** `evals/` holds scored tasks for skills, the trigger check and the
  outcome harness, and every one of them drives `claude`.
- **A model run never happens in CI** (`evals/AGENTS.md`). `run.mjs` and `harness/run.mjs` refuse
  when `CI` is set, and no test may need the `claude` binary.
- **The harness already has the shape.** `harness/fixture.mjs` builds a repo with a context layer,
  `claude.mjs` launches a session with fixed arguments, and `RESULTS.md` is append-only and
  written by the runner.
- **None of the other clients is installed on the maintainer's machine** as of 2026-10-12: `codex`,
  `gemini`, `cursor-agent` and `opencode` are all absent from `PATH`.

## Decisions locked

| # | Decision | Rejected alternative |
|---|---|---|
| A1 | It is a maintainer-run lane under `evals/`, never in CI, on the maintainer's own login | A CI job with another vendor's API key |
| A2 | The question is one fact: did the session have the root brief. It is checked by a marker: the fixture's `AGENTS.md` holds a sentence with a generated word, the prompt asks for that word, and the reply is compared by a command | Asking a model to judge whether the agent "followed the context". Ground truth is built, never judged |
| A3 | One client per run, named on the command line with the path to its binary. A client that is not installed is a named skip, not a pass and not a failure | Detecting installed clients. A skip that is not named reads as coverage |
| A4 | The fixture is the harness's with-arm. No second fixture builder | A new fixture, which would be a second list of what the context layer is |
| A5 | The record carries the client name, its version string, the date and the result, and is appended by the runner | A hand-edited table in a README |
| A6 | Nothing is vendored into `core/claude-code.js` for another vendor's client | Rules about other clients' loading behaviour kept as if they were Claude Code's (ADR 0017 covers Anthropic's docs only) |

## Architecture

```
harness/fixture.mjs (with-arm) ─▶ + one marker sentence in AGENTS.md
        │
        ▼
evals/agents/run.mjs --client <name> --bin <path>
        │   launches one headless session in the fixture, one prompt
        ▼
compare reply with the marker ─▶ append to evals/agents/RESULTS.md
```

**Invariants this must not break:** the launch is refused when `CI` is set; `evals/` imports
nothing from `core/`, `index/` or `mcp/`; a failed call is never a zero.

## Risks & edges

- **A pass proves loading, not use.** The agent had the file. Whether it follows a rule in it is
  the outcome harness's question, and that harness has not had its first real run (step 2.3).
- **Each client's headless flags differ and change.** A lane per client is a maintenance cost paid
  on every client release.
- **Cost.** Each run spends tokens on another vendor's account.

## Not yet specified

- **Which client is first.** It should be the one the team at work uses beside Claude Code, and
  that has not been stated.
- **Each client's headless invocation**, its way to point at a disposable profile, and how it
  reports its version. None is installed here to read it from, and a spec written from memory of
  another vendor's flags would be a guess.
- **Whether the marker check is too weak to be worth a lane.** `AGENTS.md` is a published
  convention those clients document themselves. What Cortex adds that is its own is the scoped
  briefs and the routing table, and whether another client reads a nested `AGENTS.md` is the more
  useful question and the harder one to check.
- **Order against step 2.3.** The first real harness run has not happened. A second lane that
  spends tokens before the first has produced a number is out of order.

## Out of scope

- Any setup command that registers Cortex with another agent.
- Running Cortex's rituals in another agent.
- A comparison between agents.
