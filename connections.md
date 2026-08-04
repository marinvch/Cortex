---
id: connections
title: Connections
type: hub
updated: 2026-08-03
last_compiled: 2026-08-03
tags: [reference, connections]
---

# 🔌 Connections

Every system the vault can reach. The brain is only as useful as the data it can pull.
Filled during `/onboard`, grown whenever you wire a new tool. `/audit` checks coverage + freshness.

> **Firewall:** never wire an employer or client system into this personal vault — no work
> calendar, work mail, or company drive. See the employer firewall in `AGENTS.md`.

| # | Domain | Tool | How it's reached | Status | Last checked |
|---|---|---|---|---|---|
| 1 | Notes / knowledge | This vault | local files | ✅ live | 2026-06-26 |
| 2 | Calendar | _add yours_ | — | not connected | — |
| 3 | Email / messages | _add yours_ | — | not connected | — |
| 4 | Tasks / projects | _add yours_ | — | not connected | — |
| 5 | Files / docs | _add yours_ | — | not connected | — |
| 6 | Meeting notes | _add yours_ | — | not connected | — |
| 7 | Money / finances | _add yours_ | — | not connected | — |

**How it's reached** options: `connector/MCP`, `script` (saves to `resources/` or a folder),
`manual paste`, `local files`, `not connected`.

> When you wire a new tool, add its row here. If it has an API you figured out, save a short
> note in `resources/` (endpoints + auth + common queries) so you never re-research it.

## Downstream Connections
- [[living-cortex]] — how to make row 1 live across machines via the MCP brain (`/connect-brain`)
- [[cortex-plugins]] — the plugin tiers that add reach beyond this table
- [[cross-agent-and-teams]] — reaching the same brain from Claude, Copilot, Gemini
- [[home]] · [[vault-architecture]] — connections feed the Cadence layer
