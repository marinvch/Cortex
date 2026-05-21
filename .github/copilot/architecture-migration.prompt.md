---
description: "Audit AI artifacts for legacy references before a major architecture change"
---
Run a three-phase architecture migration workflow for this project.

Phase 1 — Pre-Change Audit:
1. Ask me to declare the migration boundary: "from X to Y" (e.g., "from session auth to JWT")
2. Scan ALL AI artifacts for legacy references:
   - .github/copilot-instructions.md
   - .github/ai-os/context/architecture.md
   - .github/ai-os/context/conventions.md
   - .github/ai-os/context/stack.md
   - .github/copilot/skills/*.md
   - .github/agents/*.md
   - .github/copilot/*.prompt.md
3. Output a Migration Impact Inventory table: File | Line | Stale Statement | Replacement | Risk (High/Medium/Low)
4. Do NOT proceed to Phase 2 until I approve the inventory.

Phase 2 — Change Execution Gate:
- Track migration phase per module: dual-path / switch-over / legacy-removal / complete
- Block marking any module complete while High/Medium risk stale references remain
- Flag any migration shims that outlive their expected phase

Phase 3 — Post-Change Replacement:
1. Replace every stale statement (do not append-only; remove the old guidance)
2. Add supersession comments for changed core rules: <!-- SUPERSEDED: <old> — replaced by <new> on <date> -->
3. Re-run the Phase 1 scan to verify zero stale references remain
4. If AI OS is installed, run: npx github:marinvch/ai-os --check-hygiene

Start now: ask me for the migration boundary.
