# Cross-agent shims

`AGENTS.md` is the one source of truth. Each AI tool reads a different filename, so write a tiny
shim for each that points back to it. This is what makes a mixed-tool team work — one dev on
Claude, one on Copilot, one on Gemini, all reading the same project knowledge.

**Shims must never hold their own copy of the content — it drifts.**

Codex, Amp, Aider, Jules and most newer agents read `AGENTS.md` natively; they need no shim.

---

`CLAUDE.md` — Claude Code:

```markdown
@AGENTS.md
```

`GEMINI.md` — Gemini CLI:

```markdown
See AGENTS.md for all project context, architecture, and conventions.
```

`.github/copilot-instructions.md` — GitHub Copilot:

```markdown
All project context and conventions live in AGENTS.md at the repo root. Follow it.
```

`.cursor/rules/project.mdc` — Cursor:

```markdown
---
alwaysApply: true
---
Read AGENTS.md at the repo root for architecture, conventions, and the dev cycle.
```
