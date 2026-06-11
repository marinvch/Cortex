# VS Code & GitHub Copilot — Latest Updates (2025-2026)

> Compiled: June 2025 | Coverage: VS Code v1.99–v1.101 + GitHub Copilot Changelog (Apr 2025–May 2026)

---

## VS Code v1.99 — March 2025

### 🤖 Agent Mode — General Availability

- **Agent mode reaches VS Code Stable** (`chat.agent.enabled`)
- Three unified chat modes in one view: **Ask**, **Edit**, **Agent**
- Switch modes mid-conversation without losing context
- Multiple simultaneous agent sessions supported (via pop-out editors/windows)
- Edit sessions preserved in chat history — can be restored and continued
- **Agent evaluation:** 56.0% pass rate on SWE-bench Verified with Claude 3.7 Sonnet

### 🔌 Model Context Protocol (MCP) Support

- MCP servers supported natively in agent mode
- Configure via `.vscode/mcp.json` or user/remote settings under `mcp` key
- Input variables for secrets: `${env:API_KEY}`, `${input:ENDPOINT}`
- `MCP: Add Server` command — quick setup from CLI invocation or from Docker/npm/PyPI
- Auto-discovers MCP servers from Claude Desktop configuration
- `MCP: List Servers` command for status/tool management
- **Select Tools** button to enable/disable individual tools per session
- Tool approval memory: remember per-session, workspace, or application level
- `chat.tools.autoApprove` experimental setting for full auto-approval

### 🛠️ New Built-in Agent Tools

| Tool | Description |
|------|-------------|
| `#fetch` | Fetch publicly accessible webpage content (headless browser, cached) |
| `#usages` | Combined Find References + Find Implementations + Go to Definition |
| Thinking Tool | Experimental — extended reasoning between tool calls (`github.copilot.chat.agent.thinkingTool`) |

### 💡 Code Editing

- **Next Edit Suggestions (NES)** — **General Availability** (`github.copilot.nextEditSuggestions.enabled`)
  - Compact edit indicators, improved gutter indicators
- **Tool-based Edit mode** (`chat.edits2.enabled`) — aligns edit mode with agent mode architecture
- **Inline suggestion syntax highlighting** enabled by default (`editor.inlineSuggest.syntaxHighlightingEnabled`)
- Muted diagnostics events during active AI file rewrites (reduces flicker)
- Explicit file save when AI edits are kept

### 🔑 Bring Your Own Key (BYOK) — Preview

- Copilot Free/Pro users can supply own API keys
- Supported providers: **Anthropic, Azure, Gemini, OpenAI, Ollama, OpenRouter**
- Access models on day-0 of release, not waiting for Copilot rollout

### 📄 Prompt & Instructions Improvements

- `.github/copilot-instructions.md` now behaves like any reusable `.prompt.md` file
  - Supports nested link resolution and enhanced language features
- `.prompt.md` files: glob patterns in `chat.promptFilesLocations`
- Autocompletion for filesystem paths in `.prompt.md` files
- Folder references no longer flagged as invalid in prompt files
- **User prompts** — new type stored in user data folder, synced across machines

### 🔍 Workspace Indexing

- **Instant remote workspace indexing** — auto-builds when first `#codebase`/`@workspace` question asked
- Builds in seconds for most repos; no manual command needed

### 🧪 Other Chat Features

- Create new VS Code workspaces with agent mode (experimental)
- VS Code extension tools available in agent mode (extensions contributing `toolReferenceName`)
- AI-powered semantic text search enabled by default in Search view (`Ctrl+I`)
- `#searchResults` tool to reference search results in chat

---

## VS Code v1.100 — April 2025

### 📋 Instruction Files & Prompt Files

- **`.instructions.md` files** with `applyTo:` front matter — auto-attached to matching files
  - Example: `applyTo: "**/*.test.ts"` → attaches test conventions automatically
- **`.prompt.md` files** with `mode:` and `tools:` front matter
  - Can define mode (Ask/Edit/Agent) and available tools
- Both types discoverable via `Chat: Use Prompt` command

### ⚡ Faster Agent Mode Edits

- OpenAI models: **apply_patch** for fast partial file edits
- Anthropic models: **replace_string_in_file** for targeted edits
- Significant reduction in agent loop time for large files

### 🔭 New Context Tools

| Tool | Description |
|------|-------------|
| `#githubRepo` | Search any GitHub repository (not just current workspace) |
| `#extensions` | Search VS Code Marketplace for extensions |
| `#fetch` | Enhanced: now fetches full page in clean Markdown format |

### 🌐 MCP Improvements (v1.100)

- **Streamable HTTP transport** support for remote MCP servers
- **Image output** from MCP tools now rendered in chat
- MCP config generation uses `inputs` (secrets not hard-coded in config)
- MCP server discovery from workspace-level settings

### 🎨 Inline Chat V2 (Preview)

- Redesigned inline chat interface
- Better diff display and navigation within inline edits

### 💬 Conversation & Performance

- **Conversation summary** — Copilot automatically summarizes long conversations
- **Prompt caching** — reduces latency for repeated context blocks
- Autofix diagnostics generated from agent mode edits

### 📦 NES Improvements

- NES now suggests **missing import statements** for TypeScript/JavaScript
- Import path resolution improvements

### 🔍 Semantic Search with Keyword Suggestions

- Keyword suggestions in Search view help find relevant results faster
- `github.copilot.chat.search.keywordSuggestions` setting

---

## VS Code v1.101 — May 2025

### 🧰 Chat Tool Sets

- Define **tool sets** — named groups of related tools
  - Example: `{ "gh-news": { "tools": [...], "description": "..." } }`
- Created via `Configure Tool Sets > Create new tool sets file`
- Referenced in chat by `#toolsetname`
- `.toolsets.json` file format

### 🔌 MCP — Full Protocol Support

| Feature | Details |
|---------|---------|
| **Prompts** | MCP prompt support — slash commands `/mcp.servername.promptname` |
| **Resources** | Browse, attach, and save MCP resources; templates supported |
| **Sampling** | MCP servers can request LLM calls back (experimental) |
| **Auth** | Full OAuth flow — 2025-3-26 spec + draft spec; GitHub/Entra support |
| **Dev Mode** | `dev.watch` for hot reload + `dev.debug` for Node.js/Python MCP servers |

### 🎯 Custom Chat Modes — Preview

- Define custom `.chatprompt.md` files with:
  - `description:` front matter
  - `tools:` list restriction
  - Custom system instructions
- Example use case: "Planning mode" — read-only, no code edits

### 🤖 Agent Mode Improvements (v1.101)

- **Implicit context** — current file offered as suggested context automatically
- Agent receives hint about cursor position (not file content) in agent mode
- Task diagnostic awareness — agent sees errors from problem matchers
- Terminal cwd awareness — knows current working directory in agent terminal
- Built-in tools now individually enable/disable-able (e.g., disable `editFiles`, `runCommands`)
- Fix task configuration errors with "Fix with GitHub Copilot" action

### 📚 Source Control Integration

- **Copilot Coding Agent integration** in GitHub Pull Requests extension:
  - "Assign to Copilot" from issue/PR view in VS Code
  - "Copilot on My Behalf" PR query
  - View coding agent session status and details
- Add **source control history item** (commit/PR) as chat context
- Source Control Graph view shows file-level details per history item

### 🔧 Other Editor Improvements

- **Settings search AI suggestions** (Preview) — semantic settings search
- **Find as you type** control (`editor.find.findOnType`)
- **Edit Context API** enabled by default (fixes IME bugs)
- Task `instancePolicy` property (prompt/silent/terminate-newest/terminate-oldest/warn)
- Language server terminal completions for Python REPL (via Pylance)
- NES expanded to Python imports

---

## GitHub Copilot Changelog — 2025–2026

### Models & AI

| Date | Update |
|------|--------|
| Apr 2026 | **GPT-5.5 GA** — available in Copilot |
| Apr 2026 | **Claude Opus 4.7 GA** — available in Copilot |
| May 2026 | Claude Sonnet 4 deprecated |
| May 2026 | GPT-4.1 upcoming deprecation announced |
| Apr 2026 | Model selection for Claude and Codex agents on github.com |

### Copilot Cloud Agent

| Date | Update |
|------|--------|
| Apr 2026 | **Copilot cloud agent GA** — research, plan, and code autonomously |
| Apr 2026 | Fix merge conflicts with Copilot cloud agent |
| May 2026 | More flexible secrets/variables for Copilot cloud agent |
| Apr 2026 | Model selection for cloud agent on github.com |

### BYOK & Local Models

| Date | Update |
|------|--------|
| Apr 2026 | **BYOK in VS Code GA** (was preview in v1.99) |
| Apr 2026 | Copilot CLI: BYOK and local models support |

### Enterprise & Organizations

| Date | Update |
|------|--------|
| Apr 2026 | **Copilot organization custom instructions GA** |
| Apr 2026 | **Manage agent skills with GitHub CLI** |
| May 2026 | Enterprise-managed plugins in Copilot CLI (public preview) |
| Apr 2026 | Data residency for US + EU + FedRAMP models |

### Platform & SDK

| Date | Update |
|------|--------|
| Apr 2026 | **Copilot SDK public preview** |
| Apr 2026 | GitHub CLI Copilot extensions enterprise-managed plugins |

---

## Summary: Key Themes Relevant to AI OS

1. **Custom Instructions proliferation** — `.instructions.md` with `applyTo:`, `.prompt.md` with mode/tools, custom chat modes (`.chatprompt.md`) — VS Code is rapidly standardizing prompt engineering
2. **MCP is the integration standard** — full protocol support (prompts, resources, sampling, auth, dev mode) — MCP is now the primary extension point for AI tooling
3. **Tool sets** — VS Code now has native grouping of tools, similar to what AI OS does with MCP tool partitioning
4. **Agent prompts as slash commands** — MCP prompts become `/mcp.server.prompt` slash commands
5. **Copilot Cloud Agent** — fully autonomous background coding agent — AI OS context enrichment becomes even more critical for cloud agent quality
6. **BYOK GA** — organizations can bring their own models while keeping AI OS context infrastructure
7. **Custom chat modes** — enables repo-specific agent behaviors via `.chatprompt.md` files — AI OS could generate these
