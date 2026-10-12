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

## 2026-10-12 · 30 of 30 sessions scored · run 20261012T060152Z-5115

- model: claude-sonnet-5, as the sessions reported it · effort medium · Claude Code 2.1.296
- fixture: shop v2 · with `a719795ff97656337c65219bd5d19ec61232be6a767b0678a180b88f0cdfe14e` · without `0826604e498065bf2fc50453a9e63871efc4462405a8366a8e0414451727d97e`
- `~/.claude/CLAUDE.md` existed during the run: yes
- failed calls: 0
- total cost: $4.60 · wall-clock: 13m 48s

```text
outcome harness · shop v2 · claude-sonnet-5 · medium · 2026-10-12  ·  30 scored, 0 failed calls
task              arm       pass   works  rule   turns         tokens              cost     failed calls
T1 unit-price     with      3/3    3/3    3/3    10 (10–11)    277k (277k–278k)    $0.36    0
                  without   3/3    3/3    3/3    12 (11–12)    309k (309k–351k)    $0.39    0
T2 cancel         with      3/3    3/3    3/3    25 (22–26)    776k (661k–824k)    $0.81    0
                  without   3/3    3/3    3/3    22 (20–25)    756k (625k–785k)    $0.75    0
T3 note           with      2/3    3/3    2/3    15 (9–16)     410k (197k–417k)    $0.41    0
                  without   0/3    3/3    0/3    11 (10–14)    348k (228k–472k)    $0.40    0
T4 revenue        with      3/3    3/3    3/3    16 (6–16)     416k (235k–505k)    $0.45    0
                  without   1/3    3/3    1/3    17 (15–19)    452k (402k–533k)    $0.52    0
T5 search-empty   with      3/3    3/3    —      7 (7–7)       190k (190k–191k)    $0.24    0
  (control)       without   3/3    3/3    —      6 (6–6)       218k (217k–218k)    $0.23    0
rule tasks T1–T4  with      11/12  12/12  11/12
                  without   7/12   12/12  7/12
reading: supported, at this size — the with-arm passed 11 of 12 rule-task sessions and the without-arm 7 of 12, a lead of 4 on 2 tasks. This is worth the next thirty sessions and claims no significance
```

**Reading: supported, at this size.** The with-arm passed 11 of 12 rule-task sessions and the without-arm 7 of 12, a lead of 4 on 2 tasks. This is worth the next thirty sessions and claims no significance.

### Failed sessions

- T3 note · with · repeat 2: rule: a store at version 3 reports a higher version after migrate()
- T3 note · without · repeat 1: rule: a store at version 3 reports a higher version after migrate()
- T3 note · without · repeat 2: rule: a store at version 3 reports a higher version after migrate()
- T3 note · without · repeat 3: rule: a store at version 3 reports a higher version after migrate()
- T4 revenue · without · repeat 1: rule: an order that is paid and has not shipped is not revenue yet
- T4 revenue · without · repeat 2: rule: an order that is paid and has not shipped is not revenue yet

### Failed calls

None.
