# Getting Started with Cortex

Welcome to Cortex — the assistant-agnostic AI context engine that gives any AI assistant a brain, tailored to your codebase. This guide will get you up and running in 10 minutes or less, no matter your tech stack.

---

## What is Cortex?

Cortex is a structured AI context engine that gives any AI assistant deep, project-aware guidance. It works with any language or framework, auto-detects your stack and which assistants you use, then generates `AGENTS.md` as the canonical primary artifact plus adapter views for each assistant (GitHub Copilot, Claude Code, Gemini, Cursor, JetBrains, Neovim).

Unlike generic prompts, Cortex installs a persistent context layer: it scans your repository, learns your conventions, and creates a suite of artifacts (instructions, agents, skills, and tools) that make your AI assistant smarter, safer, and more productive for your team.

---

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **Any AI assistant:** GitHub Copilot, Claude Code, Gemini CLI, Cursor, JetBrains AI, or Neovim + MCP

> **Note:** You do *not* need Node.js in your target repo — only for running the installer.

---

## Install in 60 Seconds

1. Open a terminal in your project root.
2. Run:

   ```bash
   npx -y github:marinvch/ai-os
   ```

3. Cortex will scan your codebase and generate:

   - **`AGENTS.md`** — canonical cross-tool instructions for your stack (primary artifact)
   - **`copilot-instructions.md`** — Copilot adapter view (generated from `AGENTS.md`)
   - **`CLAUDE.md`** — Claude Code adapter view (generated from `AGENTS.md`)
   - **Agents** — `.github/agents/*.agent.md` for common workflows
   - **MCP server** — `.cortex/mcp-server/` (27+ tools via stdio MCP)
   - **MCP config** — `.vscode/mcp.json`
   - **14 agent skills** — `.github/copilot/skills/`

   You’ll see a summary of what was generated and where.

---

## Verify the Install

Run the health check:

```bash
npx -y github:marinvch/ai-os --doctor
```

A healthy install will show:

```
✔ MCP server: OK
✔ AGENTS.md: OK
✔ Agents: OK
✔ Skills: OK
✔ Drift: none
```

If you see any ❌, follow the suggestions to resolve.

---

## Your First Cortex Session

1. **Open your project** in your preferred AI assistant (VS Code + Copilot, Claude Code, Cursor, etc.).
2. The assistant will pick up `AGENTS.md` automatically — or load the adapter view for your assistant.
3. **Reference a skill:**
   - Try: `Use the brainstorming skill to generate ideas for a new feature.`
   - Or: `Use the systematic-debugging skill to diagnose this test failure.`

> **Tip:** Skills like `brainstorming`, `writing-plans`, and `systematic-debugging` are available out of the box and work with any assistant.

---

## Stack-Specific Examples

### Node.js/TypeScript

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `AGENTS.md` with TypeScript/Node.js rules (canonical)
- `copilot-instructions.md`, `CLAUDE.md` (adapter views)
- `.github/agents/nodejs.agent.md`
- `.vscode/mcp.json` with Node.js tools

### Python

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `AGENTS.md` with Python rules (canonical)
- `copilot-instructions.md`, `CLAUDE.md` (adapter views)
- `.github/agents/python.agent.md`
- `.vscode/mcp.json` with Python tools

### Java/Maven

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `AGENTS.md` with Java/Maven rules (canonical)
- `copilot-instructions.md`, `CLAUDE.md` (adapter views)
- `.github/agents/java.agent.md`
- `.vscode/mcp.json` with Java tools

### Ruby on Rails

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `AGENTS.md` with Rails rules (canonical)
- `copilot-instructions.md`, `CLAUDE.md` (adapter views)
- `.github/agents/rails.agent.md`
- `.vscode/mcp.json` with Ruby tools

### Go module

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `AGENTS.md` with Go rules (canonical)
- `copilot-instructions.md`, `CLAUDE.md` (adapter views)
- `.github/agents/go.agent.md`
- `.vscode/mcp.json` with Go tools

---

## Install Profiles

Cortex supports three install profiles:

- `--profile minimal` — Only Copilot instructions and MCP wiring (fastest, smallest)
- `--profile standard` — Default: instructions, agents, skills, tools (recommended)
- `--profile full` — All integrations, extra skills, and advanced agents

**Example:**

```bash
npx -y github:marinvch/ai-os --profile full
```

---

## Refreshing the Install

If you change your stack, add new frameworks, or want to update all artifacts:

```bash
npx -y github:marinvch/ai-os --refresh-existing
```

This will re-scan your repo and regenerate all Cortex artifacts, pruning any that are no longer needed.

---

## Drift Detection

To check if your Cortex artifacts are out of sync with your codebase:

```bash
npx -y github:marinvch/ai-os --check-drift
```

- **Drift** means your codebase has changed (e.g., new frameworks, deleted files) and your Copilot context is stale.
- The output lists any files that need updating and the type of drift detected.
- **Semantic drift** is also detected: if `config.json` lists a framework that no longer appears in your instructions, or your `agents.json` count doesn't match your `.agent.md` files, a warning is shown.
- To fix any drift, run with `--refresh-existing`.

Example output when drift is detected:

```
## Cortex Drift Report

Found 2 issue(s):

### ⚠️ Warnings (1)
- `.github/copilot-instructions.md`: Context snapshot is 10 days old (threshold: 7 days)
  Fix: `npx -y github:marinvch/ai-os --refresh-existing`

### 🔀 Semantic Drift (1)
- `.github/copilot-instructions.md`: Primary framework "React" from config.json is not mentioned
  Fix: `npx -y github:marinvch/ai-os --refresh-existing`
```

---

## Customizing Instructions

You can add your own rules or notes to Copilot instructions using **USER_BLOCK** markers. These blocks are preserved on every refresh.

**Example:**

```markdown
<!-- AI-OS:USER_BLOCK:START id="my-rules" -->
My custom rules here
<!-- AI-OS:USER_BLOCK:END id="my-rules" -->
```

Add these blocks anywhere in `copilot-instructions.md` or agent files.

---

## FAQ

**1. Does Cortex work with any tech stack?**
> Yes! Cortex auto-detects 30+ languages and frameworks, including TypeScript, Python, Java, Go, Ruby, and more.

**2. Will my existing `copilot-instructions.md` be preserved?**
> Yes. Cortex merges your custom USER_BLOCKs and never overwrites your manual content.

**3. How do I uninstall Cortex?**
> Run:
> ```bash
> npx -y github:marinvch/ai-os --uninstall
> ```
> This removes all generated artifacts.

**4. I don’t see MCP tools in Copilot. What do I do?**
> Make sure `.vscode/mcp.json` exists and reload VS Code. Run `--doctor` to check MCP health.

**5. How do I upgrade Cortex?**
> Just re-run the installer. For major upgrades, use `--clean-update` to force a full regeneration.

**6. Can I use Cortex in CI/CD?**
> Yes. Use `--check-drift` in your CI workflow to ensure Copilot context stays in sync.

**7. Can my whole team use Cortex?**
> Yes! All generated artifacts are committed to your repo. Every developer gets the same Copilot context.

**8. What if I want to add or remove skills?**
> Use the `skills add` or `skills remove` commands, or edit `.github/copilot/skills/` directly.

---

Ready to give Copilot a brain? [Read the User Guide →](USER-GUIDE.md)
