---
applyTo: "**"
---

# Prompt Quality Pack — ai-os

> Language: **TypeScript** · Package manager: **npm**

## 1. Prompt Template

Use this structure for best results:

```
Goal: <one sentence — what should be accomplished>
Scope: #file:<path> or describe the affected area
Constraints: <framework rules, must-nots, or size limits>
Agent: <agent name if a specialist is needed>
Skill: <skill keyword if domain-specific guidance is needed>
Done-when: <acceptance criteria — how will we know it worked?>
```

## 2. Agent Routing Table

Use `@<agent-name>` to invoke a specialist agent:

| Agent | Description | When to use |
|---|---|---|
| `ai-os Initializer` | Maintain and evolve the AI framework artifacts for the ai-os repo (docs, skills, prompts) using the real TypeScript stack. | What artifact to update or create (e.g. "update skills", "add agent for auth") |
| `Architecture Migration` | Three-phase guide for ai-os architecture migrations: audit legacy AI guidance, gate on phased migration status, and drive post-change context replacement. | Describe the migration: "from X to Y" (e.g., "from session auth to JWT", "from REST to tRPC") |
| `Codebase Explorer` | Read-only navigator for ai-os — answers "how does X work?" questions. | Ask about any feature, file, or pattern (e.g. "how does auth work?") |
| `Expert Markdown Developer` | Expert Markdown developer specializing in Markdown patterns for ai-os. | Describe the feature, bug or refactor you need help with |
| `Expert TypeScript Developer` | Expert TypeScript developer specializing in TypeScript patterns for ai-os. | Describe the feature, bug or refactor you need help with |
| `ai-os — Feature Enhancement Advisor` | Scan ai-os for improvement opportunities and expansion ideas. Use when you want prioritized enhancements, gap analysis, roadmap proposals, and concrete implementation recommendations for this repository only. | Describe scope (e.g. reliability, DX, CI/CD, security, performance) and depth (quick/medium/deep). |
| `ai-os — Idea Validator` | Validates enhancement recommendations from the Feature Enhancement Advisor against actual codebase reality. Use after the Enhancement Advisor produces a report — before any implementation begins. | Paste the Enhancement Advisor numbered report here, or describe the finding(s) to validate. |
| `ai-os — Implementation Agent` | Executes the Approved Work Order produced by the Idea Validator. Implements changes in dependency-safe sequence. Use only after the Idea Validator has produced a verified Approved Work Order. | Paste the Approved Work Order from the Idea Validator, or name a specific item to implement. |

## 3. Model Routing

Each phase of the development workflow uses a specific model. Apply these when invoking the `task` tool or specialist agents:

| Phase | Task | Model |
|---|---|---|
| 1 — Brainstorm | Exploring ideas, clarifying requirements, writing design spec | `claude-sonnet-4.6` |
| 2 — Validate spec | Reviewing design doc, spec consistency checks, spec self-review | `gpt-5.3-codex` |
| 3 — Execute | Implementation, writing code, file changes, refactoring | `claude-sonnet-4.6` |
| 4 — Validate implementation | Code review, verifying acceptance criteria, integration checks | `gpt-5.3-codex` |

> **Why:** Sonnet 4.6 excels at creative problem-solving and generation; Codex models excel at rigorous code analysis and consistency verification. Alternating gives you the best of both.

## 4. Skill Trigger Keywords

Skills load automatically when your prompt matches their description:

_No skills installed yet._

## 5. MCP Health Check

Verify the MCP server is connected before starting a session.
If `get_session_context` or `get_repo_memory` returns no output, the server is not running.
Restart it via the VS Code MCP panel or re-run the install.

## 6. Plan-Mode Trigger

Switch to **Plan mode** first when:
- The task has 3 or more sequential steps
- The change is irreversible (delete, drop, migrate, deploy)
- Multiple files or systems are affected

## 7. Post-Change Context Refresh

After structural changes (new dependencies, new files, architecture moves), refresh AI OS context:

```bash
npx -y github:marinvch/ai-os --refresh-existing
```

## 8. Anti-Patterns

- **Mixing concerns** — one prompt should do one thing
- **Vague `#codebase`** when a specific file path is known — use `#file:<path>`
- **Accepting unsourced claims** — verify with `get_repo_memory` or `search_codebase`
- **Skipping Plan mode** for irreversible changes
- **Ignoring stale context** — run `check_for_updates` if output quality drops