# Cortex Capability Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Cortex-installed repo the ability to navigate itself (a committed structural map) and to extend itself (meta-skills that author new skills, agents, hooks and MCP servers), with no third-party runtime dependency.

**Architecture:** Three additions to the existing installer. Meta-skills are pure markdown templates copied into `.claude/skills/`. `.cortex/plugins.json` declares recommended plugins without installing them. `src/map.mjs` scans the repo with zero-dependency heuristics and writes `.cortex/map.md`, vendored into `.cortex/lib/` so the SessionEnd hook can regenerate it on drift.

**Tech Stack:** Node ≥18, ES modules, `node:test`, zero runtime dependencies.

## Global Constraints

- **Zero runtime dependencies.** `package.json` must declare no `dependencies`. `npm run check:egress` fails the build otherwise.
- **No network APIs.** No `fetch`, `node:http(s)`, `node:net`, `node:dgram`, axios, undici in `src/`, `bin/`, `templates/`.
- **Node ≥18.** No syntax or API newer than Node 18. In particular, `node --test` takes no glob argument.
- **Every write goes through `resolveInRepo(repoRoot, rel)`** from `src/paths.mjs`. Nothing may write outside the target repo.
- **Every write into `.cortex/memory/` goes through the guard** in `src/guard.mjs`. The map is not memory and does not pass the guard; it is derived from code that is already in the repo.
- **File cap: 2000 files scanned.** The map records scanned-vs-total when capped. Never truncate silently.
- **Existing suites stay green:** `test/guard.test.mjs`, `test/paths.test.mjs`, `test/install.test.mjs`.
- **Test fixtures that contain secret-shaped strings must assemble them at runtime** via fragment joining, never as literals — GitHub push protection rejects literals. See the `mk()` helper in `test/guard.test.mjs`.

---

### Task 1: Capabilities section in the generated AGENTS.md block

Adds a `## Capabilities` section listing built-in meta-skills and pointing at the map. Built-ins live **inside** the `cortex:generated` markers so `--refresh` maintains them. Skills the team creates later register in a separate `## Project skills` section **outside** the markers, so refresh never destroys them.

**Files:**
- Modify: `src/render.mjs` (add `capabilitiesSection`, call it in `renderGeneratedBlock`, add `## Project skills` to `renderAgentsMd`)
- Test: `test/render.test.mjs` (create)

**Interfaces:**
- Consumes: `renderGeneratedBlock(facts)`, `renderAgentsMd(facts)`, `refreshAgentsMd(existing, facts)` — all existing in `src/render.mjs`
- Produces: `renderGeneratedBlock` output now contains `## Capabilities`; `renderAgentsMd` output now contains `## Project skills` outside the markers

- [ ] **Step 1: Write the failing test**

Create `test/render.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderAgentsMd, refreshAgentsMd, renderGeneratedBlock, GEN_START, GEN_END } from '../src/render.mjs';

const FACTS = {
  name: 'acme',
  purpose: 'Storefront',
  languages: ['TypeScript'],
  packageManager: 'pnpm',
  framework: 'Next.js',
  testRunner: 'Vitest',
  scripts: { install: 'pnpm install', dev: 'pnpm run dev', build: null, test: null, lint: null },
  directories: ['src'],
  linters: ['ESLint'],
  ci: 'GitHub Actions',
  tsStrict: true,
};

test('the generated block advertises the built-in meta-skills and the map', () => {
  const block = renderGeneratedBlock(FACTS);
  for (const name of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.match(block, new RegExp(name), `expected the block to mention ${name}`);
  }
  assert.match(block, /\.cortex\/map\.md/);
});

test('project skills register OUTSIDE the markers so refresh cannot destroy them', () => {
  const doc = renderAgentsMd(FACTS);
  const projectIdx = doc.indexOf('## Project skills');
  const endIdx = doc.indexOf(GEN_END);
  assert.ok(projectIdx > -1, 'expected a Project skills section');
  assert.ok(projectIdx > endIdx, 'Project skills must come after the generated block ends');
});

test('refresh preserves a team-created project skill', () => {
  const doc = renderAgentsMd(FACTS).replace(
    '## Project skills',
    '## Project skills\n\n- `/deploy-preview` — created 2026-07-26',
  );
  const { content, refreshed } = refreshAgentsMd(doc, { ...FACTS, testRunner: 'Jest' });
  assert.equal(refreshed, true);
  assert.match(content, /\/deploy-preview/);
  assert.match(content, /\*\*Tests:\*\* Jest/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — "expected the block to mention cortex-skill"

- [ ] **Step 3: Write minimal implementation**

In `src/render.mjs`, add before `renderGeneratedBlock`:

```javascript
/** Built-in capabilities. Lives inside the markers, so --refresh keeps it current. */
function capabilitiesSection() {
  return `This repo's brain can extend itself. Ask for any of these:

- \`/cortex-skill\` — create a new skill scoped to this repo
- \`/cortex-agent\` — create a subagent
- \`/cortex-hook\` — create a hook
- \`/cortex-mcp\` — scaffold an MCP server

- Structural map: \`.cortex/map.md\` — where things live and how they connect
- Memory: \`.cortex/memory/gotchas.md\`, \`.cortex/memory/decisions.md\`
`;
}
```

Change `renderGeneratedBlock` to insert the section before `GEN_END`:

```javascript
export function renderGeneratedBlock(f) {
  return `${GEN_START}

## Stack & tooling

${stackSection(f)}
## Run it

${commandsSection(f)}
## Key directories

${directoriesSection(f)}
## Capabilities

${capabilitiesSection()}${GEN_END}`;
}
```

In `renderAgentsMd`, insert a `## Project skills` section immediately after the generated block (between `${renderGeneratedBlock(f)}` and `## Conventions`):

```javascript
## Project skills

Skills, agents and hooks this team created with the meta-skills above. This section sits outside the
generated markers, so \`--refresh\` never touches it.

_None yet._

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite for regressions**

Run: `npm test`
Expected: PASS — install tests still green (they assert on `AGENTS.md` content)

- [ ] **Step 6: Commit**

```bash
git add src/render.mjs test/render.test.mjs
git commit -m "feat(render): advertise capabilities in AGENTS.md; project skills outside the markers"
```

---

### Task 2: Meta-skill templates and installer wiring

**Files:**
- Create: `templates/skills/cortex-skill/SKILL.md`
- Create: `templates/skills/cortex-agent/SKILL.md`
- Create: `templates/skills/cortex-hook/SKILL.md`
- Create: `templates/skills/cortex-mcp/SKILL.md`
- Create: `src/skills.mjs`
- Modify: `src/install.mjs` (import and call `installMetaSkills`)
- Test: `test/skills.test.mjs` (create)

**Interfaces:**
- Consumes: `resolveInRepo(repoRoot, rel)` from `src/paths.mjs`
- Produces: `META_SKILLS: string[]` (skill directory names) and `installMetaSkills(repoRoot, plan, dryRun) -> void` (pushes `{rel, note}` entries onto `plan`), both exported from `src/skills.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/skills.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { META_SKILLS, installMetaSkills } from '../src/skills.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'cortex-skills-'));

test('installs one SKILL.md per meta-skill', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    assert.ok(existsSync(join(root, '.claude/skills', name, 'SKILL.md')), `missing ${name}`);
  }
});

test('every meta-skill has valid frontmatter with a matching name', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    const body = readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8');
    assert.match(body, /^---\n/, `${name} must start with frontmatter`);
    assert.match(body, new RegExp(`^name:\\s*${name}$`, 'm'), `${name} frontmatter name must match dir`);
    assert.match(body, /^description:\s*\S/m, `${name} needs a description`);
  }
});

test('each meta-skill tells the agent to register what it creates', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    const body = readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8');
    assert.match(body, /## Project skills/, `${name} must register into the Project skills section`);
  }
});

test('dry run writes nothing but still reports a plan', () => {
  const root = repo();
  const plan = [];
  installMetaSkills(root, plan, true);
  assert.ok(plan.length >= META_SKILLS.length);
  assert.equal(existsSync(join(root, '.claude')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills.test.mjs`
Expected: FAIL — cannot find module `../src/skills.mjs`

- [ ] **Step 3: Create the four templates**

`templates/skills/cortex-skill/SKILL.md`:

```markdown
---
name: cortex-skill
description: Create a new skill scoped to THIS repo. Use when the user says "make a skill for X", "turn this into a command", "add a ritual", or when a task keeps repeating and deserves a repeatable procedure.
---

# /cortex-skill — author a repo-scoped skill

## Before writing anything
1. Read `AGENTS.md` for this project's stack, conventions and dev cycle.
2. Read `## Project skills` in `AGENTS.md` and list `.claude/skills/`. **If a skill already covers
   this, say so and stop** — improve the existing one instead of adding a near-duplicate.
3. Ask the user what triggers the skill and what a good result looks like. One question at a time.

## Write it
Create `.claude/skills/<kebab-name>/SKILL.md`:

```
---
name: <kebab-name>
description: <when to use this, in trigger language the model will match on>
---

# /<kebab-name>

<numbered steps, each one concrete action, grounded in THIS repo's real paths and commands>
```

Rules:
- The `name` must match the directory name exactly.
- The `description` is the only thing a model sees when deciding to invoke it — write triggers, not a summary.
- Reference real files and real commands from this repo. Never invent paths.
- Keep it short. A skill that is not read is not a skill.

## Register it
Append a line to the `## Project skills` section of `AGENTS.md`:

`- \`/<kebab-name>\` — <one-line purpose> (created <YYYY-MM-DD>)`

That section is outside the `cortex:generated` markers, so `cortex-init --refresh` will not remove it.

## Close
Tell the user the skill exists and to commit it, so the whole team gets it.
```

`templates/skills/cortex-agent/SKILL.md`:

```markdown
---
name: cortex-agent
description: Create a subagent for THIS repo. Use when the user wants a specialist that runs in its own context — a reviewer, an explorer, an auditor — or says "make an agent for X".
---

# /cortex-agent — author a repo-scoped subagent

## When an agent is the right answer
Use an agent when the work needs an **isolated context**: a broad read-only sweep, an adversarial
review, or a long search whose intermediate output should not pollute the main conversation.
If the work is a procedure the main agent should follow inline, write a skill instead (`/cortex-skill`).

## Before writing
1. Read `AGENTS.md` for stack and conventions.
2. List `.claude/agents/`. Do not duplicate an existing agent.
3. Ask what the agent should be handed, and what it should return.

## Write it
Create `.claude/agents/<kebab-name>.md`:

```
---
name: <kebab-name>
description: <when the main agent should dispatch this>
tools: Read, Glob, Grep
---

<system prompt: the agent's single responsibility, what it must read first,
what it must NOT do, and the exact shape of the report it returns>
```

Rules:
- Grant the narrowest `tools` list that works. A read-only agent must not get `Write` or `Edit`.
- State the return format explicitly — the caller only sees the final message.
- Give it one job. Agents with two jobs do neither well.

## Register it
Append to `## Project skills` in `AGENTS.md`:

`- \`<kebab-name>\` (agent) — <one-line purpose> (created <YYYY-MM-DD>)`

## Close
Tell the user to commit it so the team shares the agent.
```

`templates/skills/cortex-hook/SKILL.md`:

```markdown
---
name: cortex-hook
description: Create a hook for THIS repo. Use when the user wants something to happen automatically — "every time X", "before/after Y", "stop me from Z", "run the linter on save".
---

# /cortex-hook — author a repo-scoped hook

## Before writing
1. Read `.claude/settings.json` if it exists. **Never overwrite it — merge.**
2. Confirm which event is wanted:
   - `PreToolUse` — inspect or block a tool call before it runs
   - `PostToolUse` — react after a tool call succeeds
   - `UserPromptSubmit` — inspect or rewrite an incoming prompt
   - `SessionEnd` — harvest at the end of a session (Cortex already registers one here)
3. Ask what should happen and whether failure should block.

## Write it
Create `.claude/hooks/<kebab-name>.mjs`:

```
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { payload = {}; }

// <the check>

// exit 0 to allow; exit 2 with a message on stderr to block
process.exit(0);
```

Rules:
- Read the payload from stdin as JSON. Never assume it parses — wrap it.
- Exit 0 on success. A hook that throws on unexpected input breaks every session.
- Keep it fast. It runs on every matching event.
- No network calls.

## Register it
Merge into `.claude/settings.json` — read the file, add one entry, write it back:

```
{ "hooks": { "<Event>": [ { "hooks": [ { "type": "command",
    "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/<kebab-name>.mjs\"" } ] } ] } }
```

Then append to `## Project skills` in `AGENTS.md`:

`- \`<kebab-name>\` (hook, <Event>) — <one-line purpose> (created <YYYY-MM-DD>)`

## Close
Warn the user that hooks run automatically for everyone who clones the repo, and to commit deliberately.
```

`templates/skills/cortex-mcp/SKILL.md`:

```markdown
---
name: cortex-mcp
description: Scaffold an MCP server for THIS repo. Use when the user wants to expose project data or actions as agent tools — "give the agent access to our API", "make an MCP server for X".
---

# /cortex-mcp — scaffold a repo-scoped MCP server

## Decide first
An MCP server is a running process with dependencies. Before scaffolding one, check whether a
**skill** would do — if the answer is "read these files and follow these steps," it would.
Reach for MCP only when the agent needs a live capability: querying a database, calling an internal
service, or reading state that is not in the repo.

Tell the user this trade-off explicitly and get agreement before writing anything.

## Before writing
1. Read `AGENTS.md` for the stack.
2. Ask which tools the server exposes, what each takes, and what each returns.

## Write it
Create `.cortex/mcp/<name>/server.mjs` using the stdio JSON-RPC pattern, one handler per tool, and a
`package.json` beside it if it needs dependencies. Keep tool descriptions written for a model:
say when to use the tool, not just what it does.

Register in the repo's `.mcp.json` (create if absent, **merge** if present):

```
{ "mcpServers": { "<name>": { "command": "node", "args": [".cortex/mcp/<name>/server.mjs"] } } }
```

Rules:
- Validate every input. A tool that throws on bad input surfaces as an unusable tool.
- Never read outside the repo, and never return secrets or `.env` values.
- If the server needs credentials, read them from the environment and document which vars are required.

## Register it
Append to `## Project skills` in `AGENTS.md`:

`- \`<name>\` (mcp) — <one-line purpose> (created <YYYY-MM-DD>)`

## Close
Tell the user which env vars they must set and that teammates need them too.
```

- [ ] **Step 4: Write `src/skills.mjs`**

```javascript
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Meta-skills: the repo's ability to extend itself.
 *
 * They are plain markdown because that is all a capability needs to be — a skill that
 * creates skills is itself just a skill. No generator code, no dependencies, and they
 * work the moment they are written.
 */
export const META_SKILLS = ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp'];

export function installMetaSkills(repoRoot, plan, dryRun) {
  for (const name of META_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    plan.push({ rel, note: 'meta-skill' });
    if (dryRun) continue;
    const abs = resolveInRepo(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(PKG_ROOT, 'templates', 'skills', name, 'SKILL.md'), abs);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/skills.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 6: Wire into the installer**

In `src/install.mjs`, add the import at the top:

```javascript
import { installMetaSkills } from './skills.mjs';
```

Then call it inside `install()`, immediately before `vendorLib(repoRoot, plan, dryRun);`:

```javascript
  // ── meta-skills ──────────────────────────────────────────────────────────
  installMetaSkills(repoRoot, plan, dryRun);
```

- [ ] **Step 7: Assert the installer writes them**

Append to `test/install.test.mjs`:

```javascript
test('install stamps the meta-skills so the repo can extend itself', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  for (const name of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.ok(existsSync(join(root, '.claude/skills', name, 'SKILL.md')), `missing ${name}`);
  }
});
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green

- [ ] **Step 9: Document it in the README**

In `README.md`, add to the "What it writes" table, after the `.cortex/lib/` row:

```markdown
| `.claude/skills/cortex-{skill,agent,hook,mcp}/` | Meta-skills — the repo can author its own capabilities |
```

And add a section after "How the brain learns":

```markdown
## How the brain grows

The repo ships with four meta-skills. When a developer needs a new capability they ask for it, and
Cortex writes it into the repo — scoped to this codebase, not a generic marketplace copy.

    /cortex-skill    create a skill        /cortex-hook   create a hook
    /cortex-agent    create a subagent     /cortex-mcp    scaffold an MCP server

Created capabilities register in the `## Project skills` section of `AGENTS.md`, which sits outside
the generated markers — `--refresh` never destroys them.
```

- [ ] **Step 10: Commit**

```bash
git add templates/skills src/skills.mjs src/install.mjs test/skills.test.mjs test/install.test.mjs README.md
git commit -m "feat(skills): meta-skills so a repo can author its own capabilities"
```

---

### Task 3: Plugin manifest that declares rather than installs

**Files:**
- Create: `src/plugins.mjs`
- Modify: `src/install.mjs` (call `writePluginManifest`, accept `withPlugins`)
- Modify: `bin/cortex-init.mjs` (parse `--with-plugins`)
- Test: `test/plugins.test.mjs` (create)

**Interfaces:**
- Consumes: `resolveInRepo` from `src/paths.mjs`
- Produces: `RECOMMENDED` (array of `{name, marketplace, why, network}`) and `writePluginManifest(repoRoot, plan, {dryRun, withPlugins}) -> void`, exported from `src/plugins.mjs`
- `install(repoRoot, opts)` gains `opts.withPlugins` (boolean, default `false`)

- [ ] **Step 1: Write the failing test**

Create `test/plugins.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RECOMMENDED, writePluginManifest } from '../src/plugins.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'cortex-plugins-'));

test('writes a manifest describing each recommendation', () => {
  const root = repo();
  writePluginManifest(root, [], {});
  const m = JSON.parse(readFileSync(join(root, '.cortex/plugins.json'), 'utf8'));
  assert.equal(m.version, 1);
  assert.ok(Array.isArray(m.recommended));
  for (const entry of m.recommended) {
    assert.ok(entry.name, 'every entry needs a name');
    assert.ok(entry.why, 'every entry needs a reason a human can read');
    assert.equal(typeof entry.network, 'boolean', 'network access must be stated, not implied');
  }
});

test('anything that touches the network is flagged as such', () => {
  const ctx = RECOMMENDED.find((p) => p.name === 'context7');
  assert.ok(ctx, 'context7 should be listed as an option');
  assert.equal(ctx.network, true);
  const sp = RECOMMENDED.find((p) => p.name === 'superpowers');
  assert.equal(sp.network, false);
});

test('does NOT enable plugins without an explicit opt-in', () => {
  const root = repo();
  writePluginManifest(root, [], {});
  const settingsPath = join(root, '.claude/settings.json');
  if (existsSync(settingsPath)) {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(s.enabledPlugins, undefined, 'must not provision a developer environment silently');
  }
});

test('enables only the non-network defaults with --with-plugins', () => {
  const root = repo();
  writePluginManifest(root, [], { withPlugins: true });
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.enabledPlugins, 'expected enabledPlugins');
  const keys = Object.keys(s.enabledPlugins);
  assert.ok(keys.some((k) => k.startsWith('superpowers@')));
  assert.ok(!keys.some((k) => k.startsWith('context7@')), 'network plugins are never auto-enabled');
});

test('merges into an existing settings.json rather than clobbering it', () => {
  const root = repo();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { SessionEnd: [] } }));
  writePluginManifest(root, [], { withPlugins: true });
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.hooks, 'existing keys survived');
  assert.ok(s.enabledPlugins);
});

test('dry run writes nothing', () => {
  const root = repo();
  writePluginManifest(root, [], { dryRun: true, withPlugins: true });
  assert.equal(existsSync(join(root, '.cortex/plugins.json')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugins.test.mjs`
Expected: FAIL — cannot find module `../src/plugins.mjs`

- [ ] **Step 3: Write `src/plugins.mjs`**

```javascript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveInRepo } from './paths.mjs';

/**
 * Plugins are DECLARED, never installed.
 *
 * cortex-init runs inside other people's repositories, frequently corporate ones.
 * Silently writing `enabledPlugins` would provision third-party code into a developer's
 * environment on their behalf. So the default is a manifest plus a printed command, and
 * enabling requires an explicit --with-plugins.
 *
 * `network` is a required field: anything that leaves the machine must say so here, because
 * the whole reason Cortex is safe to run at a company is that it makes no network calls.
 */
export const MARKETPLACE = 'claude-plugins-official';

export const RECOMMENDED = [
  {
    name: 'superpowers',
    marketplace: MARKETPLACE,
    default: true,
    network: false,
    why: 'Deep generic workflow — brainstorming, planning, TDD, systematic debugging. Ships to 11 agent platforms, so a mixed-tool team is equipped evenly.',
  },
  {
    name: 'code-simplifier',
    marketplace: MARKETPLACE,
    default: true,
    network: false,
    why: 'Simplifies recently modified code without changing behaviour. Pure skills, no network.',
  },
  {
    name: 'context7',
    marketplace: MARKETPLACE,
    default: false,
    network: true,
    why: 'Up-to-date library documentation. Sends library queries to Upstash over the network — the one capability Cortex cannot own, and never enabled by default.',
  },
];

const MANIFEST_REL = '.cortex/plugins.json';
const SETTINGS_REL = '.claude/settings.json';

function writeJson(repoRoot, rel, value) {
  const abs = resolveInRepo(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2) + '\n');
}

export function writePluginManifest(repoRoot, plan, { dryRun = false, withPlugins = false } = {}) {
  plan.push({ rel: MANIFEST_REL, note: 'recommended capabilities (declared, not installed)' });
  if (!dryRun) {
    writeJson(repoRoot, MANIFEST_REL, { version: 1, marketplace: MARKETPLACE, recommended: RECOMMENDED });
  }

  if (!withPlugins) {
    plan.push({
      rel: SETTINGS_REL,
      note: 'not enabling plugins — re-run with --with-plugins to opt in',
      skipped: true,
    });
    return;
  }

  const enable = RECOMMENDED.filter((p) => p.default && !p.network);
  plan.push({ rel: SETTINGS_REL, note: `enabled ${enable.map((p) => p.name).join(', ')}` });
  if (dryRun) return;

  const abs = resolveInRepo(repoRoot, SETTINGS_REL);
  let settings = {};
  if (existsSync(abs)) {
    try {
      settings = JSON.parse(readFileSync(abs, 'utf8'));
    } catch {
      plan.push({ rel: SETTINGS_REL, note: 'SKIPPED — existing settings.json is not valid JSON', skipped: true });
      return;
    }
  }
  settings.enabledPlugins ??= {};
  for (const p of enable) settings.enabledPlugins[`${p.name}@${p.marketplace}`] = true;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(settings, null, 2) + '\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/plugins.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire into the installer**

In `src/install.mjs`, add the import:

```javascript
import { writePluginManifest } from './plugins.mjs';
```

Change the signature:

```javascript
export function install(repoRoot, { refresh = false, dryRun = false, withPlugins = false } = {}) {
```

And call it immediately after `installMetaSkills(repoRoot, plan, dryRun);`:

```javascript
  // ── plugin recommendations ───────────────────────────────────────────────
  writePluginManifest(repoRoot, plan, { dryRun, withPlugins });
```

- [ ] **Step 6: Add the CLI flag**

In `bin/cortex-init.mjs`, add to `parseArgs` opts init:

```javascript
  const opts = { dryRun: false, refresh: false, withPlugins: false, cwd: process.cwd() };
```

Add the branch inside the loop, before the `--cwd` branch:

```javascript
    else if (a === '--with-plugins') opts.withPlugins = true;
```

Pass it through:

```javascript
  const { facts, plan } = install(opts.cwd, {
    refresh: opts.refresh,
    dryRun: opts.dryRun,
    withPlugins: opts.withPlugins,
  });
```

Add to the `HELP` string, after the `--refresh` line:

```
    --with-plugins  also enable the recommended plugins in .claude/settings.json
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Verify the default really does not provision**

Run:
```bash
node bin/cortex-init.mjs --cwd "$(mktemp -d)" --dry-run
```
Expected: the plan lists `.cortex/plugins.json` and shows `.claude/settings.json` as skipped with "re-run with --with-plugins to opt in"

- [ ] **Step 9: Document it in the README**

In `README.md`, under "Commands", add:

```bash
npx @marinvch/cortex-init --with-plugins  # also enable the recommended plugins
```

And add a section before "The secret guard":

```markdown
## Plugins are declared, not installed

`cortex-init` runs inside other people's repositories. Writing `enabledPlugins` on their behalf would
provision third-party code into a developer's environment without asking, so by default Cortex writes
`.cortex/plugins.json` — a manifest saying what this project expects — and prints the install command.

`--with-plugins` opts in, and even then only non-network plugins are enabled. Anything that leaves the
machine is marked `"network": true` in the manifest and never enabled automatically.
```

- [ ] **Step 10: Commit**

```bash
git add src/plugins.mjs src/install.mjs bin/cortex-init.mjs test/plugins.test.mjs README.md
git commit -m "feat(plugins): declare recommended capabilities without provisioning environments"
```

---

### Task 4: Repo scanning with an honest cap

**Files:**
- Create: `src/map.mjs`
- Test: `test/map.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces, from `src/map.mjs`: `MAX_FILES = 2000`, `scanRepo(repoRoot, {maxFiles}) -> {files: string[], total: number, capped: boolean}` where `files` are repo-relative POSIX paths

- [ ] **Step 1: Write the failing test**

Create `test/map.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanRepo, MAX_FILES } from '../src/map.mjs';

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-map-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

test('finds source files and reports the total', () => {
  const root = repoWith({ 'src/a.ts': '', 'src/b.ts': '', 'README.md': '' });
  const res = scanRepo(root);
  assert.equal(res.capped, false);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(res.files.includes('src/b.ts'));
});

test('skips node_modules, .git and build output', () => {
  const root = repoWith({
    'src/a.ts': '',
    'node_modules/pkg/index.js': '',
    'dist/bundle.js': '',
    '.git/config': '',
  });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  for (const bad of ['node_modules/pkg/index.js', 'dist/bundle.js', '.git/config']) {
    assert.ok(!res.files.includes(bad), `should not scan ${bad}`);
  }
});

test('honours .gitignore', () => {
  const root = repoWith({ 'src/a.ts': '', 'generated/big.ts': '', '.gitignore': 'generated/\n' });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(!res.files.includes('generated/big.ts'));
});

test('honours .cortexignore, which wins over .gitignore', () => {
  const root = repoWith({
    'src/a.ts': '',
    'fixtures/huge.ts': '',
    '.cortexignore': '# not knowledge\nfixtures/\n',
  });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(!res.files.includes('fixtures/huge.ts'), '.cortexignore must exclude from the map');
});

test('caps the scan and says so, rather than truncating silently', () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`src/f${i}.ts`] = '';
  const root = repoWith(files);
  const res = scanRepo(root, { maxFiles: 5 });
  assert.equal(res.files.length, 5);
  assert.equal(res.capped, true);
  assert.equal(res.total, 12);
});

test('default cap matches the spec', () => {
  assert.equal(MAX_FILES, 2000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.mjs`
Expected: FAIL — cannot find module `../src/map.mjs`

- [ ] **Step 3: Write the scanner in `src/map.mjs`**

```javascript
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Structural map generator.
 *
 * Zero-dependency heuristic extraction. Serena answers "where is this symbol?" live, by
 * querying an LSP. Cortex answers it durably: a file committed to the repo, reviewed in PRs,
 * inherited on clone, and readable by an agent that can only read files.
 */

export const MAX_FILES = 2000;

const ALWAYS_SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', 'target', '__pycache__', '.venv', 'venv', '.cortex',
]);

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.prisma', '.sql',
]);

/**
 * Minimal ignore-file support: directory and exact-name entries. Globs are skipped rather
 * than half-supported, because a glob we parse wrongly excludes files the reader expects
 * to see, and the map has no way to signal that it happened.
 *
 * Reads `.gitignore` and `.cortexignore`; entries from either exclude a path.
 */
function ignoreFilter(repoRoot) {
  const names = new Set();
  for (const file of ['.gitignore', '.cortexignore']) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    let lines = [];
    try {
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
      names.add(line.replace(/^\/+/, '').replace(/\/+$/, ''));
    }
  }
  return (rel) => rel.split('/').some((part) => names.has(part));
}

export function scanRepo(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const ignored = ignoreFilter(repoRoot);
  const found = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(repoRoot, abs).split(sep).join('/');
      if (ignored(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        const dot = entry.name.lastIndexOf('.');
        if (dot > -1 && SOURCE_EXT.has(entry.name.slice(dot))) found.push(rel);
      }
    }
  };

  walk(repoRoot);
  found.sort();
  return { files: found.slice(0, maxFiles), total: found.length, capped: found.length > maxFiles };
}

/** Line count, used for the size signal in the map. */
export function countLines(repoRoot, rel) {
  try {
    return readFileSync(join(repoRoot, rel), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/map.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/map.mjs test/map.test.mjs
git commit -m "feat(map): repo scanner with an explicit, reported file cap"
```

---

### Task 5: JS/TS extractor

**Files:**
- Modify: `src/map.mjs` (add extractor registry and the JS/TS extractor)
- Test: `test/map.test.mjs` (append)

**Interfaces:**
- Consumes: `scanRepo` from Task 4
- Produces, from `src/map.mjs`: `EXTRACTORS` (array of `{name, match(rel) -> boolean, extract(source) -> {imports: string[], exports: string[]}}`) and `extractorFor(rel) -> extractor | null`

- [ ] **Step 1: Write the failing test**

Append to `test/map.test.mjs`:

```javascript
import { extractorFor, EXTRACTORS } from '../src/map.mjs';

test('extracts ES module imports', () => {
  const ex = extractorFor('src/a.ts');
  const { imports } = ex.extract(`
import { a } from './db';
import def from "stripe";
import './side-effect.css';
export { x } from './re-export';
const y = require('node:fs');
`);
  for (const want of ['./db', 'stripe', './side-effect.css', './re-export', 'node:fs']) {
    assert.ok(imports.includes(want), `expected import ${want}, got ${JSON.stringify(imports)}`);
  }
});

test('extracts named and default exports', () => {
  const ex = extractorFor('src/a.ts');
  const { exports } = ex.extract(`
export function createSession() {}
export const LIMIT = 5;
export class Cart {}
export default function handler() {}
export async function slow() {}
`);
  for (const want of ['createSession', 'LIMIT', 'Cart', 'handler', 'slow']) {
    assert.ok(exports.includes(want), `expected export ${want}, got ${JSON.stringify(exports)}`);
  }
});

test('does not treat a non-JS file as parseable', () => {
  assert.equal(extractorFor('main.go'), null);
  assert.equal(extractorFor('schema.prisma'), null);
});

test('every extractor declares a name used in the coverage report', () => {
  for (const ex of EXTRACTORS) {
    assert.ok(ex.name, 'extractor needs a name');
    assert.equal(typeof ex.match, 'function');
    assert.equal(typeof ex.extract, 'function');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.mjs`
Expected: FAIL — `extractorFor` is not exported

- [ ] **Step 3: Add the extractor to `src/map.mjs`**

Append:

```javascript
// ── Extractors ───────────────────────────────────────────────────────────────
// Shaped as a registry so a second language is additive rather than a rewrite. Only
// JS/TS ships until its fidelity is measured; everything else is listed, not parsed,
// and the map says which is which.

const JS_EXT = /\.(?:m|c)?[jt]sx?$/;

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_DECL = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_DEFAULT = /(?:^|\n)\s*export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /(?:^|\n)\s*export\s*\{([^}]*)\}/g;

const all = (re, source, out) => {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(source)) !== null) if (m[1]) out.push(m[1]);
};

export const EXTRACTORS = [
  {
    name: 'JavaScript/TypeScript',
    match: (rel) => JS_EXT.test(rel),
    extract(source) {
      const imports = [];
      all(IMPORT_FROM, source, imports);
      all(IMPORT_BARE, source, imports);
      all(REQUIRE, source, imports);

      const exports = [];
      all(EXPORT_DECL, source, exports);
      all(EXPORT_DEFAULT, source, exports);

      EXPORT_LIST.lastIndex = 0;
      let m;
      while ((m = EXPORT_LIST.exec(source)) !== null) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exports.push(name);
        }
      }

      return { imports: [...new Set(imports)], exports: [...new Set(exports)] };
    },
  },
];

export function extractorFor(rel) {
  return EXTRACTORS.find((e) => e.match(rel)) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/map.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/map.mjs test/map.test.mjs
git commit -m "feat(map): JS/TS import and export extraction via a pluggable registry"
```

---

### Task 6: Map rendering, coverage honesty and staleness hash

**Files:**
- Modify: `src/map.mjs` (add `buildMap`, `readMapHash`, `isStale`)
- Test: `test/map.test.mjs` (append)

**Interfaces:**
- Consumes: `scanRepo`, `extractorFor`, `countLines`, `fileExists` from Tasks 4-5
- Produces, from `src/map.mjs`:
  - `MAP_REL = '.cortex/map.md'`
  - `buildMap(repoRoot, {maxFiles}) -> {markdown: string, hash: string, stats: {scanned, total, capped, parsed: string[], listedOnly: string[]}}`
  - `readMapHash(repoRoot) -> string | null`
  - `isStale(repoRoot) -> boolean`

- [ ] **Step 1: Write the failing test**

Append to `test/map.test.mjs`:

```javascript
import { buildMap, isStale, readMapHash, MAP_REL } from '../src/map.mjs';
import { writeFileSync as wf, mkdirSync as md } from 'node:fs';

test('renders sections an agent can act on', () => {
  const root = repoWith({
    'package.json': JSON.stringify({ name: 'acme', main: 'src/index.ts' }),
    'src/index.ts': "export function boot() {}\nimport './db';",
    'src/db.ts': 'export const client = 1;',
    'prisma/schema.prisma': 'model User {}',
  });
  const { markdown } = buildMap(root);
  assert.match(markdown, /# Structural map/);
  assert.match(markdown, /## Entry points/);
  assert.match(markdown, /## Data layer/);
  assert.match(markdown, /## Coverage/);
  assert.match(markdown, /src\/index\.ts/);
  assert.match(markdown, /boot/);
});

test('states which languages were parsed and which were only listed', () => {
  const root = repoWith({ 'src/a.ts': 'export const x = 1;', 'main.go': 'package main' });
  const { markdown, stats } = buildMap(root);
  assert.ok(stats.parsed.includes('JavaScript/TypeScript'));
  assert.ok(stats.listedOnly.length > 0, 'go should be listed but not parsed');
  assert.match(markdown, /listed only/i);
});

test('records the cap in the map instead of pretending completeness', () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`src/f${i}.ts`] = 'export const x = 1;';
  const root = repoWith(files);
  const { markdown, stats } = buildMap(root, { maxFiles: 5 });
  assert.equal(stats.capped, true);
  assert.match(markdown, /5 of 12/);
});

test('the hash changes when structure changes but not on cosmetic edits', () => {
  const root = repoWith({ 'src/a.ts': 'export function one() {}' });
  const before = buildMap(root).hash;

  wf(join(root, 'src/a.ts'), 'export function one() {}\n// a comment that changes nothing structural');
  assert.equal(buildMap(root).hash, before, 'a comment must not invalidate the map');

  wf(join(root, 'src/a.ts'), 'export function one() {}\nexport function two() {}');
  assert.notEqual(buildMap(root).hash, before, 'a new export must invalidate the map');
});

test('isStale is true when no map exists and false right after writing one', () => {
  const root = repoWith({ 'src/a.ts': 'export const x = 1;' });
  assert.equal(isStale(root), true);

  const { markdown, hash } = buildMap(root);
  md(join(root, '.cortex'), { recursive: true });
  wf(join(root, MAP_REL), markdown);

  assert.equal(readMapHash(root), hash);
  assert.equal(isStale(root), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.mjs`
Expected: FAIL — `buildMap` is not exported

- [ ] **Step 3: Add rendering and hashing to `src/map.mjs`**

Add the import at the top of the file, beside the existing `node:fs` import:

```javascript
import { createHash } from 'node:crypto';
```

Append:

```javascript
// ── Rendering ────────────────────────────────────────────────────────────────

export const MAP_REL = '.cortex/map.md';

const ROUTE_HINTS = [/^app\/.*\/route\.[jt]sx?$/, /^pages\/api\//, /^routes\//, /^src\/routes\//];
const DATA_HINTS = [/schema\.prisma$/, /^migrations\//, /^models\//, /\.sql$/, /^db\//, /^src\/db\//];

const HASH_LEN = 12;

function entryPoints(repoRoot, files) {
  const out = [];
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  if (pkg?.main) out.push([pkg.main, 'package main']);
  if (pkg?.bin) {
    for (const [name, path] of Object.entries(typeof pkg.bin === 'string' ? { [pkg.name ?? 'cli']: pkg.bin } : pkg.bin)) {
      out.push([path, `bin: ${name}`]);
    }
  }
  for (const candidate of ['src/index.ts', 'src/index.js', 'src/main.ts', 'app/page.tsx', 'main.go']) {
    if (files.includes(candidate) && !out.some(([p]) => p === candidate)) out.push([candidate, 'conventional entry']);
  }
  return out;
}

/**
 * Build the map. `hash` covers only structural facts — file list, imports, exports — so a
 * comment or a renamed local does not invalidate it and the committed map stays quiet in diffs.
 */
export function buildMap(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const { files, total, capped } = scanRepo(repoRoot, { maxFiles });

  const parsed = new Set();
  const listedOnly = new Set();
  const perFile = [];

  for (const rel of files) {
    const ex = extractorFor(rel);
    if (!ex) {
      const dot = rel.lastIndexOf('.');
      listedOnly.add(dot > -1 ? rel.slice(dot) : rel);
      perFile.push({ rel, imports: [], exports: [], parsed: false });
      continue;
    }
    parsed.add(ex.name);
    let source = '';
    try {
      source = readFileSync(join(repoRoot, rel), 'utf8');
    } catch {
      source = '';
    }
    const { imports, exports } = ex.extract(source);
    perFile.push({ rel, imports, exports, parsed: true });
  }

  const routes = files.filter((f) => ROUTE_HINTS.some((re) => re.test(f)));
  const data = files.filter((f) => DATA_HINTS.some((re) => re.test(f)));
  const entries = entryPoints(repoRoot, files);

  const structural = JSON.stringify(perFile.map((f) => [f.rel, f.imports, f.exports]));
  const hash = createHash('sha256').update(structural).digest('hex').slice(0, HASH_LEN);

  const largest = perFile
    .map((f) => ({ rel: f.rel, lines: countLines(repoRoot, f.rel) }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 5);

  const lines = [];
  lines.push(`<!-- cortex:map hash=${hash} -->`);
  lines.push(`# Structural map`);
  lines.push('');
  lines.push('Generated by cortex-init and regenerated when the structure changes. Committed on');
  lines.push('purpose: every agent and every teammate reads the same map.');
  lines.push('');

  lines.push('## Entry points');
  lines.push('');
  if (entries.length) for (const [p, why] of entries) lines.push(`- \`${p}\` — ${why}`);
  else lines.push('_None detected._');
  lines.push('');

  if (routes.length) {
    lines.push('## Routes');
    lines.push('');
    for (const r of routes) lines.push(`- \`${r}\``);
    lines.push('');
  }

  if (data.length) {
    lines.push('## Data layer');
    lines.push('');
    for (const d of data) lines.push(`- \`${d}\``);
    lines.push('');
  }

  lines.push('## Modules');
  lines.push('');
  for (const f of perFile) {
    if (!f.parsed) continue;
    const ex = f.exports.length ? ` — exports: ${f.exports.slice(0, 8).join(', ')}` : '';
    const im = f.imports.length ? ` — imports: ${f.imports.slice(0, 8).join(', ')}` : '';
    lines.push(`- \`${f.rel}\`${ex}${im}`);
  }
  lines.push('');

  if (largest.length) {
    lines.push('## Largest files');
    lines.push('');
    for (const l of largest) lines.push(`- \`${l.rel}\` (${l.lines} lines)`);
    lines.push('');
  }

  lines.push('## Coverage');
  lines.push('');
  lines.push(`- Scanned ${files.length} of ${total} source files.${capped ? ' **Capped — this list is partial.**' : ''}`);
  lines.push(`- Parsed: ${parsed.size ? [...parsed].join(', ') : 'nothing'}`);
  lines.push(
    `- Listed only (not parsed): ${listedOnly.size ? [...listedOnly].sort().join(', ') : 'none'}`,
  );
  lines.push('');

  return {
    markdown: lines.join('\n'),
    hash,
    stats: { scanned: files.length, total, capped, parsed: [...parsed], listedOnly: [...listedOnly] },
  };
}

export function readMapHash(repoRoot) {
  try {
    const head = readFileSync(join(repoRoot, MAP_REL), 'utf8').slice(0, 200);
    return head.match(/cortex:map hash=([0-9a-f]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isStale(repoRoot) {
  const current = readMapHash(repoRoot);
  if (!current) return true;
  return current !== buildMap(repoRoot).hash;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/map.test.mjs`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/map.mjs test/map.test.mjs
git commit -m "feat(map): render the map, state coverage honestly, hash structure for staleness"
```

---

### Task 7: Install the map, vendor the generator, add --no-map

**Files:**
- Modify: `src/install.mjs` (write the map, vendor `map.mjs`, accept `noMap`)
- Modify: `bin/cortex-init.mjs` (parse `--no-map`)
- Test: `test/install.test.mjs` (append)

**Interfaces:**
- Consumes: `buildMap`, `MAP_REL` from `src/map.mjs`
- Produces: `install(repoRoot, opts)` gains `opts.noMap` (boolean, default `false`); `.cortex/lib/map.mjs` is vendored

- [ ] **Step 1: Write the failing test**

Append to `test/install.test.mjs`:

```javascript
test('writes a structural map and vendors the generator that maintains it', () => {
  const root = fixture({
    pkg: NEXT_PKG,
    files: { 'src/index.ts': "export function boot() {}\nimport './db';", 'src/db.ts': 'export const c = 1;' },
    dirs: ['src'],
  });
  install(root);
  assert.ok(existsSync(join(root, '.cortex/map.md')));
  assert.ok(existsSync(join(root, '.cortex/lib/map.mjs')), 'hook needs the generator after npx is gone');
  const map = readFileSync(join(root, '.cortex/map.md'), 'utf8');
  assert.match(map, /cortex:map hash=/);
  assert.match(map, /boot/);
});

test('--no-map opts out', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root, { noMap: true });
  assert.equal(existsSync(join(root, '.cortex/map.md')), false);
});

test('a broken repo does not fail the install; the map degrades and says so', () => {
  const root = fixture({ pkg: NEXT_PKG });
  writeFileSync(join(root, 'package.json'), '{ this is not valid json');
  assert.doesNotThrow(() => install(root));
  assert.ok(existsSync(join(root, 'AGENTS.md')), 'install must still complete');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/install.test.mjs`
Expected: FAIL — `.cortex/map.md` does not exist

- [ ] **Step 3: Wire the map into `src/install.mjs`**

Add the import:

```javascript
import { buildMap, MAP_REL } from './map.mjs';
```

Change the signature:

```javascript
export function install(repoRoot, { refresh = false, dryRun = false, withPlugins = false, noMap = false } = {}) {
```

Add this block immediately after the `writePluginManifest(...)` call:

```javascript
  // ── structural map ───────────────────────────────────────────────────────
  // Never fail the install over the map. A repo with an unreadable file still deserves a brain.
  if (!noMap) {
    try {
      const { markdown, stats } = buildMap(repoRoot);
      write(MAP_REL, markdown, `mapped ${stats.scanned} files${stats.capped ? ' (capped)' : ''}`);
    } catch (err) {
      plan.push({ rel: MAP_REL, note: `SKIPPED — map generation failed: ${err.message}`, skipped: true });
    }
  }
```

Add `'map.mjs'` to the vendored list:

```javascript
const VENDORED = ['guard.mjs', 'paths.mjs', 'memory.mjs', 'map.mjs'];
```

- [ ] **Step 4: Add the CLI flag**

In `bin/cortex-init.mjs`, add to the opts init:

```javascript
  const opts = { dryRun: false, refresh: false, withPlugins: false, noMap: false, cwd: process.cwd() };
```

Add the branch:

```javascript
    else if (a === '--no-map') opts.noMap = true;
```

Pass it through to `install`:

```javascript
  const { facts, plan } = install(opts.cwd, {
    refresh: opts.refresh,
    dryRun: opts.dryRun,
    withPlugins: opts.withPlugins,
    noMap: opts.noMap,
  });
```

Add to `HELP` after the `--with-plugins` line:

```
    --no-map        skip generating .cortex/map.md
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green

- [ ] **Step 6: Verify against a real repo**

Run:
```bash
node bin/cortex-init.mjs --cwd . --dry-run
```
Expected: the plan includes `.cortex/map.md` with a "mapped N files" note

- [ ] **Step 7: Document it in the README**

In `README.md`, add to the "What it writes" table after the memory rows:

```markdown
| `.cortex/map.md` | Structural map — entry points, routes, module graph, coverage |
```

Add a section after "How the brain grows":

```markdown
## The structural map

`.cortex/map.md` records where things live: entry points, routes, the data layer, what each module
exports and imports, and the files that have grown too large. It is committed, so a teammate who
clones inherits it and a Copilot user reads it without any tooling.

Extraction is zero-dependency heuristics — no parser, no native bindings, nothing added to install
weight. That means it is strong on JavaScript and TypeScript and weaker elsewhere, so **the map states
its own coverage**: which languages it parsed, which it could only list, and whether the file cap was
hit. A map that overstates itself is worse than no map, because agents trust it.
```

- [ ] **Step 8: Commit**

```bash
git add src/install.mjs bin/cortex-init.mjs test/install.test.mjs README.md
git commit -m "feat(install): write the structural map, vendor its generator, add --no-map"
```

---

### Task 8: Regenerate the map on drift from the session hook

**Files:**
- Modify: `templates/cortex-reflect.mjs` (regenerate the map when stale)
- Test: `test/reflect.test.mjs` (create)

**Interfaces:**
- Consumes: `isStale`, `buildMap`, `MAP_REL` from the vendored `.cortex/lib/map.mjs`
- Produces: `refreshMapIfStale(repoRoot) -> {refreshed: boolean, reason?: string}` exported from `templates/cortex-reflect.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/reflect.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { install } from '../src/install.mjs';
import { refreshMapIfStale } from '../templates/cortex-reflect.mjs';
import { readMapHash } from '../src/map.mjs';

function installedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cortex-reflect-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}');
  install(root);
  return root;
}

test('does nothing when the map is current', () => {
  const root = installedRepo();
  const before = readMapHash(root);
  const res = refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});

test('regenerates when the structure drifts', () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/b.ts'), 'export function two() {}');

  const res = refreshMapIfStale(root);
  assert.equal(res.refreshed, true);
  assert.notEqual(readMapHash(root), before);
  assert.match(readFileSync(join(root, '.cortex/map.md'), 'utf8'), /two/);
});

test('a cosmetic edit does not churn the committed map', () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}\n// just a comment');
  const res = refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/reflect.test.mjs`
Expected: FAIL — `refreshMapIfStale` is not exported

- [ ] **Step 3: Add map refresh to `templates/cortex-reflect.mjs`**

First change the `node:fs` import at the top of the file to add `writeFileSync`:

```javascript
import { readFileSync, writeFileSync } from 'node:fs';
```

Then add this after the existing `appendGotchas` dynamic-import block. It is `async` because the
vendored module is loaded with dynamic `import()`, which returns a promise — the `root` parameter
exists so tests can point it at a fixture repo rather than the hook's own project directory:

```javascript
/**
 * Keep the committed map honest. A map that drifts from the code is worse than no map,
 * because agents trust it. Regeneration is quiet by design: the hash covers structure only,
 * so a comment or a renamed local produces no diff and the committed file stays stable.
 */
export async function refreshMapIfStale(root = repoRoot) {
  try {
    const url = new URL(`file://${join(root, '.cortex/lib/map.mjs').replace(/\\/g, '/')}`);
    const mod = await import(url);
    if (!mod.isStale(root)) return { refreshed: false };
    const { markdown } = mod.buildMap(root);
    writeFileSync(join(root, mod.MAP_REL), markdown);
    return { refreshed: true };
  } catch (err) {
    return { refreshed: false, reason: err.message };
  }
}
```

Then call it in the hook's main path, immediately before the `const candidates = extractGotchas(transcript);` line:

```javascript
const mapResult = await refreshMapIfStale();
if (mapResult.refreshed) console.error('cortex: structural map refreshed (.cortex/map.md)');
```

- [ ] **Step 4: Make the test await the async function**

Update `test/reflect.test.mjs` — change each call site to `await refreshMapIfStale(root)` and mark the test callbacks `async`:

```javascript
test('does nothing when the map is current', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});

test('regenerates when the structure drifts', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/b.ts'), 'export function two() {}');

  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, true);
  assert.notEqual(readMapHash(root), before);
  assert.match(readFileSync(join(root, '.cortex/map.md'), 'utf8'), /two/);
});

test('a cosmetic edit does not churn the committed map', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}\n// just a comment');
  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/reflect.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full suite and the egress check**

Run: `npm test && npm run check:egress`
Expected: PASS both — the egress check scans `templates/`, so any accidental network import fails here

- [ ] **Step 7: Commit**

```bash
git add templates/cortex-reflect.mjs test/reflect.test.mjs
git commit -m "feat(reflect): regenerate the structural map when it drifts from the code"
```

---

### Task 9: End-to-end verification on a real fixture

**Files:**
- Modify: `SPEC.md` (record the capability layer as delivered)

**Interfaces:**
- Consumes: everything above
- Produces: nothing new — this is the gate before the work is called done

- [ ] **Step 1: Build a fixture repo**

```bash
F="$(mktemp -d)/storefront"
mkdir -p "$F/src" "$F/app/api/checkout" "$F/prisma"
cat > "$F/package.json" <<'EOF'
{ "name": "acme-storefront", "description": "Storefront",
  "scripts": { "dev": "next dev", "test": "vitest" },
  "dependencies": { "next": "14.1.4", "react": "18.2.0" },
  "devDependencies": { "vitest": "1.4.0" } }
EOF
echo "export function boot() {}" > "$F/src/index.ts"
echo "import './index'; export const db = 1;" > "$F/src/db.ts"
echo "export async function POST() {}" > "$F/app/api/checkout/route.ts"
echo "model User {}" > "$F/prisma/schema.prisma"
echo "ACME_TOKEN=zulu-tango-9931-quebec" > "$F/.env"
```

- [ ] **Step 2: Install and inspect**

```bash
node bin/cortex-init.mjs --cwd "$F" --yes 2>&1
cat "$F/.cortex/map.md"
```

Expected: the map lists `app/api/checkout/route.ts` under Routes, `prisma/schema.prisma` under Data layer, `boot` as an export of `src/index.ts`, and a Coverage section naming JavaScript/TypeScript as parsed.

- [ ] **Step 3: Verify the guard still blocks, now with more files present**

```bash
cd "$F" && node --input-type=module -e "
const { appendGotchas } = await import('./.cortex/lib/memory.mjs');
const r = appendGotchas(process.cwd(), [
  'Checkout retries three times before surfacing an error.',
  'Partner token is zulu-tango-9931-quebec.',
], { date: '2026-07-26' });
console.log('written', r.written.length, 'blocked', r.blocked.length);
"
```
Expected: `written 1 blocked 1`

- [ ] **Step 4: Verify the map never leaked a secret**

```bash
grep -r "zulu-tango" "$F/.cortex/" || echo "CLEAN"
```
Expected: `CLEAN` — the map reads source files, so this confirms it does not surface `.env` content

- [ ] **Step 5: Verify refresh preserves created capabilities**

```bash
node -e "
const fs=require('fs'); const p='$F/AGENTS.md';
fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('_None yet._','- \`/deploy-preview\` — created 2026-07-26'));
"
node bin/cortex-init.mjs --cwd "$F" --refresh >/dev/null
grep -c "deploy-preview" "$F/AGENTS.md"
```
Expected: `1` — a team-created skill survives refresh

- [ ] **Step 6: Update SPEC.md**

In `SPEC.md`, replace the "Out of scope" bullet about the personal vault with an added line under Design, and add to the requirements table:

```markdown
| R8 | The repo can extend itself — author its own skills, agents, hooks and MCP servers | capability layer |
| R9 | The repo carries a committed structural map stating its own coverage | capability layer |
```

- [ ] **Step 7: Full verification**

Run: `npm test && npm run check:egress`
Expected: PASS both

- [ ] **Step 8: Commit and push**

```bash
git add SPEC.md
git commit -m "docs(spec): record the capability layer requirements as delivered"
git push origin master
```

- [ ] **Step 9: Confirm CI is green**

```bash
curl -s "https://api.github.com/repos/marinvch/ai-os/actions/runs?per_page=1" \
  | grep -oE '"(head_sha|status|conclusion)": *("[^"]*"|null)'
```
Expected: `status: completed`, `conclusion: success`. Do not call the work done until this reports success — the run must be checked, not assumed.

---

## Notes for the implementer

- **The map is the piece most likely to disappoint.** Heuristic extraction is strong on JS/TS and thin elsewhere. If a test forces a choice between broader coverage and honest coverage reporting, choose honest reporting — the Coverage section is what keeps the map from lying.
- **`--with-plugins` is off by default and must stay that way.** The test asserting `enabledPlugins` is absent without the flag is not a formality; it encodes the promise that Cortex does not provision other people's environments.
- **Do not "tidy" the secret fixtures in `test/guard.test.mjs` into literal strings.** GitHub push protection will reject the push.
- **`AGENTS.md` has two capability lists on purpose.** Built-ins inside the `cortex:generated` markers, team-created ones outside. Moving the second inside would make `--refresh` delete work the team did.
