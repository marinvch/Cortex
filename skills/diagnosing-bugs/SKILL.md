---
name: diagnosing-bugs
description: A diagnosis loop for hard bugs and performance regressions, run against the repo's own map — blast radius, documented invariants, untested dependents. Use when the user says "diagnose" or "debug this", or reports something broken, throwing, failing, flaky or slow.
capability: judgment
---

# /diagnosing-bugs — build the loop first

A discipline for bugs that did not fall to the first reading. Skip a phase only when you can say why.

Cortex's version differs from a generic debugging loop in one way: **this repo has a map, so use it
before guessing.** Phase 0 exists for that. Everything after it is the upstream discipline, which is
sound and has not been improved by rewording.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first** —
write `<REDACTED>` in its place. Build loops against environment variables so the credential stays in
the environment rather than in what you print. Captured traces carry auth headers; quote only the
lines that carry signal.

If the redacted output is not enough to diagnose the bug, say so and ask.

## Phase 0: Orient with what the repo already knows

Cheap, deterministic, and it routinely re-ranks the hypotheses before any exist. Skip it only when
the repo has no `.cortex/` index.

```bash
node index/cortex-impact.mjs <suspect files>   # who depends on this, and what no test covers
node index/cortex-review.mjs <suspect files>   # which documents govern it, and which name it
```

Read four things off that:

- **The unverified list.** A bug lives disproportionately in code nothing exercises. If the suspect's
  dependents are uncovered, that is where to look and the regression test in Phase 5 already has its
  home.
- **The documented invariants.** `AGENTS.md`, `CONTEXT.md` and the ADRs that govern these files
  often *state the bug*: "the raw body is required for signature verification", "this must never
  reach memory". A violated invariant is a hypothesis with evidence behind it.
- **Drift.** If the code and the document describing it disagree, one of them is the bug. Do not
  assume it is the document.
- **Depth.** `index.layers` places the file: a depth-0 foundation file failing means everything above
  it is suspect, and an entry-point file failing usually does not implicate the kernel.

Bring what you find into Phase 3 as ranked hypotheses. Do **not** let it substitute for Phase 1 — a
plausible cause read off a document is still a guess until a loop goes red on it.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. With a **tight** pass/fail signal — one that
goes red on *this* bug — you will find the cause; bisection, hypothesis-testing and instrumentation
all just consume it. Without one, no amount of staring at code will save you.

Spend disproportionate effort here. Be aggressive, be creative, refuse to give up.

Ways to construct one, roughly in order of preference:

1. **A failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **A curl or HTTP script** against a running dev server.
3. **A CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **A headless browser script** driving the UI and asserting on DOM, console or network.
5. **Replay a captured trace** — save a real request, payload or event log and replay it in isolation.
6. **A throwaway harness** — the smallest subset of the system that reaches the code path.
7. **A property or fuzz loop**, when the symptom is "sometimes wrong output".
8. **A bisection harness**, when the bug appeared between two known states, so `git bisect run` can
   consume it.
9. **A differential loop** — the same input through two versions or configs, diffed.
10. **A human-in-the-loop script**, last resort. If a person must click, drive *them* from a script so
    the loop still has structure and its output still feeds back to you.

### Tighten it

Treat the loop as the product. Once you have *a* loop: make it faster (cache setup, narrow scope),
make the signal sharper (assert the exact symptom, not "did not crash"), make it deterministic (pin
the clock, seed the RNG, isolate the filesystem, freeze the network).

A 30-second flaky loop is barely better than none. A 2-second deterministic one is a superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise,
add stress, narrow timing windows, inject sleeps. A 50% flake is debuggable; 1% is not. Keep raising
the rate until it is.

### When you genuinely cannot build one

Stop and say so. List what you tried, and ask for one of: access to an environment that reproduces
it, a redacted captured artifact, or permission to add temporary instrumentation. Do **not**
hypothesise without a loop.

### Done when

You can name **one command** you have **already run at least once** — show the invocation and its
output, redacted — that is:

- **Red-capable.** It drives the actual bug path and asserts the *user's exact symptom*, so it goes
  red now and green once fixed. Not "runs without erroring".
- **Deterministic.** Same verdict every run, or a pinned high reproduction rate.
- **Fast.** Seconds, not minutes.
- **Agent-runnable.** You can run it unattended.

If you catch yourself reading code to build a theory before that command exists, **stop.** Jumping to
a hypothesis is the exact failure this skill prevents. No red-capable command, no Phase 2.

## Phase 2: Reproduce and minimise

Run the loop. Watch it go red. Confirm it produces the failure the **user** described rather than a
different one nearby — wrong bug, wrong fix — and that it reproduces across runs. Capture the exact
symptom so later phases can prove the fix addressed it.

Then shrink to the smallest scenario that still goes red. Cut inputs, callers, config, data and steps
**one at a time**, re-running after each cut. Done when every remaining element is load-bearing:
removing any one turns it green.

A minimal repro shrinks the hypothesis space in Phase 3 and becomes the regression test in Phase 5.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses before testing any of them**. Single-hypothesis generation anchors
on the first plausible idea.

Each must be falsifiable — state the prediction: *"If X is the cause, then changing Y makes the bug
disappear."* If you cannot state the prediction, it is a vibe: sharpen it or discard it.

Rank anything Phase 0 turned up as a violated invariant near the top. It is the only class of
hypothesis that arrives with written evidence.

**Show the ranked list to the user before testing.** They re-rank it instantly ("we deployed a change
to #3 yesterday") or know what is already ruled out. Cheap checkpoint, big saving. Do not block on
it — proceed with your ranking if they are away.

## Phase 4: Instrument

Every probe maps to a specific prediction from Phase 3. **Change one variable at a time.**

Prefer a debugger or REPL if the environment supports it — one breakpoint beats ten logs. Otherwise
targeted logs at the boundaries that distinguish hypotheses. Never "log everything and grep".

**Tag every debug log** with a unique prefix like `[DEBUG-a4f2]`, so cleanup is one grep. Untagged
logs survive; tagged ones die.

For performance regressions, logs are usually the wrong tool: establish a baseline measurement, then
bisect. Measure first, fix second.

## Phase 5: Fix, and prove the test would have caught it

Write the regression test **before** the fix, but only where a **correct seam** exists — one that
exercises the real bug pattern as it occurs at the call site. A unit test that cannot replicate the
chain which triggered the bug gives false confidence.

**If no correct seam exists, that is itself the finding.** Say so. The architecture is preventing the
bug from being locked down, and that outlives this bug.

Where a seam exists:

1. Turn the minimised repro into a failing test there.
2. **Watch it fail, and check it fails for the right reason.** A test that passes before the fix is
   not a regression test, and one that fails for an unrelated reason is worse — it will go green on
   the fix and prove nothing. This repo has shipped four assertions that passed for the wrong reason;
   they are only ever found by making the code wrong on purpose and watching.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 loop against the original, un-minimised scenario.

## Phase 6: Cleanup

Before declaring done:

- [ ] The original repro no longer reproduces — re-run the Phase 1 loop, do not reason about it.
- [ ] The regression test passes, and failed before the fix for the right reason.
- [ ] All `[DEBUG-...]` instrumentation is gone. Grep the prefix.
- [ ] Throwaway harnesses are deleted or clearly marked.
- [ ] **The hypothesis that turned out correct is written in the commit or PR message**, so the next
      person to touch this learns what you learned. If it contradicts something in `AGENTS.md`,
      `CONTEXT.md` or an ADR, fix that sentence too — a bug caused by a stale document recurs.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). Phases 1–6 are
upstream, lightly reworded. Phase 0, the invariant-ranking note in Phase 3, and the
fails-for-the-right-reason step in Phase 5 are Cortex additions — they are what the index and the
context layer make possible.
