---
name: debug-issue
description: Diagnose a hard bug or performance regression with a loop that can go red, ranked against the repo's invariants and untested dependents. Triggers — "diagnose", "debug this", or a test or feature that is broken, failing, flaky or slow.
metadata:
  capability: judgment
---

# /debug-issue — a red command before a theory

For a bug that survived the first read of the code. The work runs in seven steps, and each one ends
on a condition you can check. Skipping a step is allowed when you can state the reason.

The order matters more than any single step. Theories formed before there is a command that fails
on the bug are cheap to produce and expensive to be wrong about, so the theories come fourth.

## Keep secrets out of what you show

You will paste commands, output and captured requests. Replace every credential with `<REDACTED>`
before it appears. Drive the loop from environment variables so the value never has to be typed
into a command. A captured trace usually carries auth headers; quote the lines that matter and
leave the rest out.

If the redacted material no longer shows the bug, say that and ask for another way in.

## 1. Orient on what the repo already records

The repo has an index and a context layer; read them before forming any view. Skip this step only
when there is no `.cortex/` index.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" <suspect files>   # dependents, and which of them no test covers
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" <suspect files>   # the documents that govern or name these files
```

Take four things from the output:

- **Untested dependents.** Bugs collect where nothing runs the code. An uncovered dependent is a
  place to look first, and it is also where the regression test in step 6 will live.
- **Stated invariants.** The governing `AGENTS.md`, `CONTEXT.md` and ADRs often describe the bug
  directly: "the raw body is required for signature verification", "this must never reach memory".
  A broken invariant is a suspect with written evidence.
- **Document and code that disagree.** One of them is wrong. Do not assume it is the document.
- **Where the file sits.** `index.layers` gives its depth. A failing depth-0 file puts everything
  above it in question; a failing entry point rarely implicates the kernel.

Carry these into step 4 as candidates. They are not a diagnosis. A cause read off a document stays a
guess until a command fails on it.

## 2. Get one command that fails on the bug

Most of the effort belongs here. Once a command goes red on this bug and green when it is fixed,
bisection, probing and fixing all become mechanical. Without it, reading more code does not
converge.

### What the command must be

You are done with this step when you have run the command at least once and can show it with its
output, redacted, and it is:

- **Red on the user's symptom.** It exercises the real failing path and checks for the exact
  behaviour the user reported. "Exits without error" is not a check.
- **Repeatable.** The same verdict every run, or a known, high failure rate.
- **Quick.** Seconds.
- **Unattended.** You can run it yourself, without a person.

If you notice you are building a theory from the source and this command does not exist yet, stop
and return here. Step 3 does not start without it.

### Where to get one

Prefer the earlier options; use a later one when the earlier ones cannot reach the bug.

1. A test that fails, at whichever level reaches the path: unit, integration or end to end.
2. An HTTP request, `curl` or a short script, against a running dev server.
3. The CLI run on a fixture, with its output diffed against a known-good copy.
4. A headless browser script that drives the page and checks the DOM, console or network.
5. A captured request, payload or event log replayed on its own.
6. A small harness that boots only the part of the system that reaches the code.
7. A property or fuzz run, when the output is only sometimes wrong.
8. A script `git bisect run` can drive, when the bug arrived between two known commits.
9. The same input through two versions or two configurations, with the outputs diffed.
10. A script that tells a person what to click and records what they see. Last, because it needs a
    person, but it still gives the loop a fixed shape and returns its result to you.

### Make it worth running a hundred times

Once one exists, improve it before using it. Cut setup time and narrow the scope. Check the exact
symptom rather than the absence of a crash. Remove the sources of variation: fix the clock, seed the
random number generator, give it its own temporary directory, stub the network. A slow command that
fails one run in three will mislead you; a fast one that always agrees with itself will not.

### When the bug is intermittent

Aim for a higher failure rate, not a perfect reproduction. Run the trigger in a loop, in parallel,
under load, with sleeps added to widen the race window. Fifty percent is workable and one percent is
not, so keep pushing the rate up.

### When no command is possible

Say so and stop. List what you tried, and ask for one of: an environment where the bug reproduces, a
redacted capture of the failure, or permission to add temporary instrumentation. Do not move to
theories without the command.

## 3. Confirm it, then shrink it

Run the command and watch it fail. Check that the failure is the one the user described and not a
neighbouring one, since fixing the wrong failure is a common way to close a bug that is still open.
Record the exact symptom; step 6 has to show it is gone.

Then remove things one at a time: inputs, callers, configuration, data, steps. Re-run after each
removal. Stop when every remaining piece is needed, meaning removing any one of them makes the
command pass. The smaller case narrows step 4 and becomes the regression test in step 6.

## 4. Write down candidate causes, ranked

List three to five causes before testing any of them. Testing the first idea that fits tends to
confirm it.

Give each a prediction that could prove it wrong: "if X causes this, changing Y makes the failure go
away." A cause with no such prediction cannot be tested; sharpen it or drop it.

A broken invariant found in step 1 goes near the top. It is the only kind of candidate that comes
with evidence already written down.

Show the ranked list to the user before you test it. They often know something that reorders it at
once, such as a change deployed to the third candidate yesterday, or a cause already ruled out. If
they are away, carry on with your own order.

## 5. Probe one prediction at a time

Each probe tests one prediction from step 4, and changes one thing.

A debugger or REPL is better than logging when the environment has one. Otherwise, log at the
boundaries where the candidates would behave differently. Logging everything and searching the
output is not a probe.

Put a unique tag on every temporary log line, for example `[DEBUG-a4f2]`, so one search finds them
all at cleanup.

For a performance regression, measure instead of logging: take a baseline, then bisect against it.

## 6. Fix behind a test that fails for the right reason

Write the regression test first, at a **seam that reproduces the real failure**: one where the
calls run the way they do in production. A test that cannot reproduce the chain of calls that
caused the bug will pass whether or not the bug is fixed.

**If there is no such seam, report that as a finding.** The code's shape is stopping this bug from
being pinned down, and that problem will outlast this bug.

Where the seam exists:

1. Turn the reduced case from step 3 into a test there.
2. Run it and confirm it fails, **for the reason you expect.** A test that passes before the fix
   proves nothing. One that fails for some other reason is worse: it will pass after the fix and
   look like proof. This repo has shipped four assertions that passed for the wrong reason, and each
   was found only by breaking the code on purpose and watching the test.
3. Make the fix.
4. Run the test and confirm it passes.
5. Run the step 2 command on the original, unreduced case.

## 7. Close out

Check each before saying the bug is fixed:

- [ ] The step 2 command passes on the original case. Run it; do not infer it.
- [ ] The regression test passes now and failed before the fix, for the expected reason.
- [ ] No `[DEBUG-...]` lines remain. Search for the tag.
- [ ] Temporary harnesses are deleted or clearly labelled as such.
- [ ] **The commit or PR message states the cause that turned out to be true**, so the next person
      to touch the code has it. If that contradicts a sentence in `AGENTS.md`, `CONTEXT.md` or an
      ADR, correct the sentence in the same change. A bug caused by a wrong document comes back.

Then return to the list from step 4 and mark each candidate **confirmed**, **ruled out** (naming the
probe that ruled it out) or **not tested**, and report the list with the fix.

An untested candidate is acceptable when the confirmed cause accounts for every symptom. It is not
acceptable when it could change the fix: two causes can produce the same symptom, and fixing one
leaves the other. Test it before calling the diagnosis finished, or report it as still open.
