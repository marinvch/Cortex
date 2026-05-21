# Getting Started with AI OS

Welcome to AI OS — the framework that gives GitHub Copilot a brain, tailored to your codebase. This guide will get you up and running in 10 minutes or less, no matter your tech stack.

---

## What is AI OS?

AI OS is a structured AI context framework that supercharges GitHub Copilot with deep, project-aware guidance. It works with any language or framework, auto-detects your stack, and generates precise instructions, agents, and tools for your codebase. 

Unlike generic Copilot prompts, AI OS installs a persistent context layer: it scans your repository, learns your conventions, and creates a suite of artifacts (instructions, agents, skills, and tools) that make Copilot smarter, safer, and more productive for your team.

---

## Prerequisites

- **GitHub account** with Copilot enabled
- **VS Code** with the GitHub Copilot extension installed
- **Node.js 18+** (LTS recommended)

> **Note:** You do *not* need Node.js in your target repo — only for running the installer.

---

## Install in 60 Seconds

1. Open a terminal in your project root.
2. Run:

   ```bash
   npx -y github:marinvch/ai-os
   ```

3. AI OS will scan your codebase and generate:

   - **`copilot-instructions.md`** — tailored Copilot rules for your stack
   - **Agents** — `.github/agents/*.agent.md` for common workflows
   - **COPILOT_CONTEXT.md** — session context card for Copilot
   - **MCP server** — `.ai-os/mcp-server/` (27+ Copilot tools)
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
✔ Copilot instructions: OK
✔ Agents: OK
✔ Skills: OK
✔ Drift: none
```

If you see any ❌, follow the suggestions to resolve.

---

## Your First AI OS Session

1. **Open VS Code** in your project.
2. **Open the Copilot Chat** panel (or use the Copilot sidebar).
3. **Type:**
   - `@workspace` — loads the workspace agent (project context)
   - Or select an agent from the agent list (if available)
4. **Reference a skill:**
   - Try: `Use the brainstorming skill to generate ideas for a new feature.`
   - Or: `@workspace Use the systematic-debugging skill to diagnose this test failure.`

> **Tip:** Skills like `brainstorming`, `writing-plans`, and `systematic-debugging` are available out of the box.

---

## Stack-Specific Examples

### Node.js/TypeScript

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `copilot-instructions.md` with TypeScript/Node.js rules
- `.github/agents/nodejs.agent.md`
- `.vscode/mcp.json` with Node.js tools

### Python

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `copilot-instructions.md` with Python rules
- `.github/agents/python.agent.md`
- `.vscode/mcp.json` with Python tools

### Java/Maven

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `copilot-instructions.md` with Java/Maven rules
- `.github/agents/java.agent.md`
- `.vscode/mcp.json` with Java tools

### Ruby on Rails

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `copilot-instructions.md` with Rails rules
- `.github/agents/rails.agent.md`
- `.vscode/mcp.json` with Ruby tools

### Go module

```bash
npx -y github:marinvch/ai-os
```

**Expected output:**
- `copilot-instructions.md` with Go rules
- `.github/agents/go.agent.md`
- `.vscode/mcp.json` with Go tools

---

## Install Profiles

AI OS supports three install profiles:

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

This will re-scan your repo and regenerate all AI OS artifacts, pruning any that are no longer needed.

---

## Drift Detection

To check if your AI OS artifacts are out of sync with your codebase:

```bash
npx -y github:marinvch/ai-os --check-drift
```

- **Drift** means your codebase has changed (e.g., new frameworks, deleted files) and your Copilot context is stale.
- The output will list any files that need to be updated or removed.
- To fix drift, run with `--refresh-existing`.

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

**1. Does AI OS work with any tech stack?**
> Yes! AI OS auto-detects 30+ languages and frameworks, including TypeScript, Python, Java, Go, Ruby, and more.

**2. Will my existing `copilot-instructions.md` be preserved?**
> Yes. AI OS merges your custom USER_BLOCKs and never overwrites your manual content.

**3. How do I uninstall AI OS?**
> Run:
> ```bash
> npx -y github:marinvch/ai-os --uninstall
> ```
> This removes all generated artifacts.

**4. I don’t see MCP tools in Copilot. What do I do?**
> Make sure `.vscode/mcp.json` exists and reload VS Code. Run `--doctor` to check MCP health.

**5. How do I upgrade AI OS?**
> Just re-run the installer. For major upgrades, use `--clean-update` to force a full regeneration.

**6. Can I use AI OS in CI/CD?**
> Yes. Use `--check-drift` in your CI workflow to ensure Copilot context stays in sync.

**7. Can my whole team use AI OS?**
> Yes! All generated artifacts are committed to your repo. Every developer gets the same Copilot context.

**8. What if I want to add or remove skills?**
> Use the `skills add` or `skills remove` commands, or edit `.github/copilot/skills/` directly.

---

Ready to give Copilot a brain? [Read the User Guide →](USER-GUIDE.md)
