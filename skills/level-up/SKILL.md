---
name: level-up
description: Biweekly growth ritual for the Cortex Vault. Walks Notice → Decide → Build to surface one piece of leverage (an automation, a note worth writing, a connection worth wiring) and ship one artifact. Trigger on "level up", "what should I automate next", "find me leverage". One run = one shipped thing.
---

# /level-up — find one piece of leverage, ship it

One interview = one artifact. Also installs the [[operating-principles]] habits over time. Reads
`context/priorities.md`, `context/current-focus.md`, `connections.md`, `decisions/log.md`, recent
`daily/*`, and existing `skills/*`.

## Phase 1 — Notice (find the candidate)
Ask, conversationally:
1. What did you do 3+ times this week? (frequency)
2. What felt manual, boring, or copy-paste? (drudgery)
3. Where did you think "a smart intern could do this"? (delegation)
4. If your workload doubled tomorrow, what breaks first? (constraint)
5. What knowledge did you keep re-looking-up? (a missing note)

Output: 1-3 candidates, one line of "why this is leverage" each. Ask the user to pick one.

## Phase 2 — Decide (scope it)
Walk the five filters from [[operating-principles]]:
1. **Constraint** — which bottleneck does this solve?
2. **Eliminate → Automate → Delegate.** Ask "what if we just stop doing this?" If nothing breaks,
   exit cheerfully — that's a win. Log it to `decisions/log.md` and stop.
3. **Map the steps** — trigger, inputs, transformations, decision points, destination. If they
   can't articulate them, send them to sketch it first.
4. **Lowest autonomy that works** — suggest < draft < supervise < auto. Default low; push back on
   "fully autonomous" without proof.
5. **Tie to an outcome** — more output / less time / fewer errors / learning + a specific metric.
   If they can't name one, stop.

Write the scoped spec to `decisions/log.md` as a dated entry.

## Phase 3 — Build (ship one artifact)
Ask how to ship, lowest-infrastructure first:
1. **A note** — a permanent note in `notes/` (often the answer for "I keep re-looking this up").
2. **A template** — a reusable scaffold in `templates/`.
3. **A saved prompt / SOP** — a `resources/` doc the user runs by hand.
4. **A new ritual** — a `skills/<name>/SKILL.md` (deterministic first; one AI step only if needed).
5. **A scheduled task** — only once the manual version works.

Default to the highest non-automated option that solves it. Build it, confirm it works, and
remind the user to run it manually for a week before trusting it.

## Output every run
1. One `decisions/log.md` entry. 2. One shipped artifact. 3. A one-screen recap.

## Rules
- Notice always runs first, even if the user arrives with an idea.
- Eliminate-first: if the answer is "stop doing it", that's success, not failure.
- Boring is beautiful — bias to notes/templates/prompts over agents.
