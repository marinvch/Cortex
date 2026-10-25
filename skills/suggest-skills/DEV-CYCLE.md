# Dev-cycle skills to write into the target repo

Two Claude-Code skills that enforce the development cycle. Write them verbatim (filling nothing —
they read `AGENTS.md` at runtime for stack and conventions).

---

`.claude/skills/plan-feature/SKILL.md`:

```markdown
---
name: plan-feature
description: Write an implementation plan for a feature/ticket in THIS repo before any code. Use when a feature or ticket is assigned. Enforces plan-before-implementing.
---
# /plan-feature
Read AGENTS.md for stack + conventions. Then produce a plan ONLY (no code):
1. Restate the requirement + acceptance criteria. Ask for missing criteria.
2. List the files/components this touches (search the repo to confirm).
3. Design: data flow, state, UI states (loading/empty/error), edge cases.
4. Break into small ordered steps, each independently testable.
5. Call out risks + a test plan.
End by asking the user to approve the plan before implementation starts.
```

---

`.claude/skills/investigate-bug/SKILL.md`:

```markdown
---
name: investigate-bug
description: Systematically investigate a bug in THIS repo. Use when given a bug report or failing behavior. Find root cause before proposing a fix.
---
# /investigate-bug
1. Reproduce: restate expected vs actual; find where the behavior is triggered in the code.
2. Trace: follow the data/render path; form a root-cause hypothesis (don't patch symptoms).
3. Confirm the root cause with evidence (code refs, a failing test if possible).
4. Propose the smallest correct fix + how to verify it. Plan before editing (the hard rule).
```

---

`docs/decisions.md` — create if absent:

```markdown
# Decision Log — <Project>
Append-only. Newest on top. Why a technical call was made, so it isn't re-litigated.
```

---

**Why these are skills and `AGENTS.md` holds the rules:** slash commands only fire in Claude Code.
The *same* dev-cycle rules live in `AGENTS.md`'s "Development cycle" section, so Copilot and Gemini
users follow plan-before-implementing too, just without the slash command. Put rules in
`AGENTS.md`; treat skills as a Claude convenience.
