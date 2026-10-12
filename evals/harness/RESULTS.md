# Outcome harness: results

Every section below was written by `node evals/harness/run.mjs --record` from the records of one
run. Nothing here is typed by hand, and a section is never edited afterwards: a later measurement is
a new section. This file is a log. It gates nothing, and two sections with a different model,
Claude Code version or fixture version are two measurements, not a trend.

What the table means, and the rule its reading follows, are in
[`evals/README.md`](../README.md#the-outcome-harness). The rule was fixed before the first session
ran.

## 2026-10-12 · 30 of 30 sessions scored · run 20261012T025221Z-51b1

- model: claude-sonnet-5, as the sessions reported it · effort medium · Claude Code 2.1.296
- fixture: shop v1 · with `bb1d514b93c23e557e67e6a8a81994106bf985c1068da2d562e805126fb12c30` · without `47d7723fca1cce3ec81a94792532c846531c273a9fc94753808293082feb33cc`
- `~/.claude/CLAUDE.md` existed during the run: yes
- failed calls: 0
- total cost: $4.36 · wall-clock: 13m 05s

```text
outcome harness · shop v1 · claude-sonnet-5 · medium · 2026-10-12  ·  30 scored, 0 failed calls
task              arm       pass   works  rule   turns         tokens              cost     failed calls
T1 discount       with      3/3    3/3    3/3    8 (7–9)       232k (192k–274k)    $0.28    0
                  without   3/3    3/3    3/3    9 (9–12)      268k (265k–331k)    $0.32    0
T2 cancel         with      3/3    3/3    3/3    17 (17–19)    433k (424k–469k)    $0.53    0
                  without   3/3    3/3    3/3    19 (19–19)    618k (594k–662k)    $0.66    0
T3 note           with      3/3    3/3    3/3    14 (13–15)    326k (288k–367k)    $0.41    0
                  without   3/3    3/3    3/3    20 (15–21)    701k (405k–735k)    $0.64    0
T4 by-status      with      3/3    3/3    3/3    15 (13–16)    377k (328k–499k)    $0.46    0
                  without   3/3    3/3    3/3    16 (14–19)    564k (437k–608k)    $0.56    0
T5 search-empty   with      3/3    3/3    —      6 (6–7)       189k (189k–190k)    $0.23    0
  (control)       without   3/3    3/3    —      6 (6–6)       182k (182k–218k)    $0.21    0
rule tasks T1–T4  with      12/12  12/12  12/12
                  without   12/12  12/12  12/12
reading: tasks do not discriminate — the with-arm passed 12 of 12 rule-task sessions and the without-arm 12 of 12. The tasks are too easy to show anything: the fixture needs a new version
```

**Reading: tasks do not discriminate.** The with-arm passed 12 of 12 rule-task sessions and the without-arm 12 of 12. The tasks are too easy to show anything: the fixture needs a new version.

### Failed sessions

None.

### Failed calls

None.
