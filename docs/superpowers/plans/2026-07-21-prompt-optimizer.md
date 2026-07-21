# Prompt Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every prompt through a deterministic vagueness check; sharpen the vague ones into a
confirmed, precise prompt; save it under `docs/prompts/`; route the work to the right ritual.

**Architecture:** Hybrid. A `UserPromptSubmit` hook (`.claude/hooks/optimize-prompt.mjs`) scores the
prompt with pure, unit-tested functions and emits **nothing at all** unless the score clears the
threshold. When it does, it injects one directive pointing at `skills/optimize-prompt/SKILL.md`,
which owns the judgment: which questions to ask, how to synthesize, where to route. Agents without
hook support get identical behavior from a Prompt Optimization Protocol section in `AGENTS.md`.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, plain markdown. No build step,
no dependencies, no package.json.

## Global Constraints

- **Fail open, always.** Every hook path exits 0. A malformed payload, an unreadable file, a thrown
  regex — all produce silent success. The hook must never block or erase a prompt.
- **Privacy firewall.** `docs/prompts/` is gitignored; only `docs/prompts/README.md` is committed and
  it stays data-free. Never write personal or business facts into a committed file.
- **Plain files.** No new dependencies, no `package.json`, no build step. Tests run with
  `node --test`.
- **Match existing patterns.** Mirror `.claude/hooks/reflect-session.mjs`: named exports, a `main()`
  guarded by `import.meta.url === process.argv[1]`, `readFileSync(0, 'utf-8')` for stdin,
  `process.exit(0)` at the end.
- **Skill authoring rules** (from `skills/skill-creator/SKILL.md`): `description:` frontmatter carries
  **triggering conditions only**, never a workflow summary. Body under ~500 words.
- **Commits:** this repo's pre-commit hook is broken — prefix every commit with
  `SKIP_SIMPLE_GIT_HOOKS=1`.

---

## File Structure

| File | Responsibility |
|---|---|
| `.claude/hooks/optimize-prompt.mjs` | **Create.** The gate: scoring, bypass rules, directive text, stdin/stdout plumbing. Pure functions exported for test. |
| `.claude/hooks/optimize-prompt.test.mjs` | **Create.** Unit tests for every scoring and bypass branch. |
| `skills/optimize-prompt/SKILL.md` | **Create.** The brain: questions, synthesis, confirmation, saving, routing. |
| `.claude/skills/optimize-prompt/SKILL.md` | **Create.** Slash-command copy (gitignored). |
| `docs/prompts/README.md` | **Create.** Committed, data-free explanation of the folder convention. |
| `.gitignore` | **Modify.** Ignore `docs/prompts/` except its README. |
| `.claude/settings.json` | **Modify.** Register the `UserPromptSubmit` hook. |
| `AGENTS.md` | **Modify.** Add the Prompt Optimization Protocol section + a rituals-list bullet. |
| `README.md` | **Modify.** Add a rituals-table row. |

---

### Task 1: Verify the hook payload contract

The entire gate depends on one unverified fact: whether `UserPromptSubmit` delivers the prompt text
on stdin. The official docs page shows no input example for this event. **Resolve this before
writing the gate** — every later task assumes the answer.

**Files:**
- Create: `.claude/hooks/_probe.mjs` (temporary — deleted in Step 6)
- Modify: `.claude/settings.json`

- [ ] **Step 1: Write the probe**

```javascript
// .claude/hooks/_probe.mjs — TEMPORARY. Dumps the raw hook payload, then exits clean.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

try {
  const raw = readFileSync(0, 'utf-8');
  const out = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'brain', '.probe.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, raw);
} catch { /* fail open */ }
process.exit(0);
```

- [ ] **Step 2: Register it**

Add to `.claude/settings.json`, alongside the existing `SessionEnd` key:

```json
"UserPromptSubmit": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/_probe.mjs\""
      }
    ]
  }
]
```

- [ ] **Step 3: Restart Claude Code**

Hooks are snapshotted at startup — an edit to `settings.json` does **not** take effect in the
running session. Tell the user: *"Restart Claude Code, type any short message, then say continue."*

- [ ] **Step 4: Read the payload**

Run: `cat brain/.probe.json`
Expected: JSON containing `"hook_event_name": "UserPromptSubmit"`.

**Decision gate — check for a `prompt` field:**

- **Present** (e.g. `"prompt": "hello"`) → the design holds. Continue to Task 2 unchanged.
- **Absent** → **stop and report to the user.** The deterministic gate is not implementable as
  designed; the fallback is to drop the hook and run the protocol from `AGENTS.md` alone
  (approach A from brainstorming). Do not silently invent a workaround.

- [ ] **Step 5: Record the finding in the spec**

Append the verified payload shape to the "Component 1" section of
`docs/superpowers/specs/2026-07-21-prompt-optimizer-design.md`, replacing the "Open item resolved
during implementation" paragraph.

- [ ] **Step 6: Remove the probe**

```bash
rm .claude/hooks/_probe.mjs brain/.probe.json
```

Revert the `UserPromptSubmit` block in `.claude/settings.json` (Task 3 adds the real one).

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-21-prompt-optimizer-design.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(spec): pin the verified UserPromptSubmit payload shape"
```

---

### Task 2: The scoring core (TDD)

**Files:**
- Create: `.claude/hooks/optimize-prompt.mjs`
- Test: `.claude/hooks/optimize-prompt.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `wordCount(s: string): number`
  - `shouldBypass(prompt: string, env?: object): boolean`
  - `scoreVagueness(prompt: string): number` — 0–5
  - `buildDirective(score: number): string`
  - `evaluate(prompt: string, env?: object): object | null` — the hook payload, or `null` for silence
  - `THRESHOLD: number` — exported so it is tunable in one place

- [ ] **Step 1: Write the failing tests**

```javascript
// .claude/hooks/optimize-prompt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordCount, shouldBypass, scoreVagueness, buildDirective, evaluate, THRESHOLD,
} from './optimize-prompt.mjs';

test('wordCount ignores surrounding and repeated whitespace', () => {
  assert.equal(wordCount('  add   the booking stuff '), 4);
  assert.equal(wordCount(''), 0);
});

test('scoreVagueness scores a vague prompt at or above threshold', () => {
  assert.equal(scoreVagueness('add the booking stuff'), 4); // short +2, no component +1, no domain +1
  assert.equal(scoreVagueness('fix it'), 4);
  assert.equal(scoreVagueness('make it faster'), 5);        // + no action verb
});

test('scoreVagueness scores a grounded prompt below threshold', () => {
  const precise = 'refactor the recall handler in mcp/server.js so the database query is cached';
  assert.ok(scoreVagueness(precise) < THRESHOLD);
});

test('shouldBypass skips slash commands, steers and explicit opt-outs', () => {
  assert.equal(shouldBypass('/capture buy milk'), true);
  assert.equal(shouldBypass('yes'), true);
  assert.equal(shouldBypass('go ahead'), true);
  assert.equal(shouldBypass('just rename this'), true);
  assert.equal(shouldBypass('fix the null check in tools/cortex.sh:42'), true);
  assert.equal(shouldBypass(`${'word '.repeat(61)}`), true);
  assert.equal(shouldBypass(''), true);
  assert.equal(shouldBypass('add the booking stuff', { CORTEX_NO_OPTIMIZE: '1' }), true);
});

test('shouldBypass lets a genuinely vague prompt through to scoring', () => {
  assert.equal(shouldBypass('add the booking stuff', {}), false);
});

test('buildDirective names the skill and reports the score', () => {
  const d = buildDirective(4);
  assert.match(d, /4\/5/);
  assert.match(d, /skills\/optimize-prompt\/SKILL\.md/);
  assert.match(d, /docs\/prompts\//);
});

test('evaluate returns the hook payload only for vague, non-bypassed prompts', () => {
  const hit = evaluate('add the booking stuff', {});
  assert.equal(hit.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(hit.hookSpecificOutput.additionalContext, /Prompt vagueness score/);

  assert.equal(evaluate('/capture buy milk', {}), null);
  assert.equal(evaluate('refactor the recall handler in mcp/server.js so queries are cached', {}), null);
  assert.equal(evaluate(undefined, {}), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/hooks/optimize-prompt.test.mjs`
Expected: FAIL — `Cannot find module './optimize-prompt.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// .claude/hooks/optimize-prompt.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Score at or above which the optimizer fires. Tune here after reviewing docs/prompts/. */
export const THRESHOLD = 3;

const ACTION_VERBS =
  /\b(add|create|update|delete|fix|remove|migrate|refactor|write|build|review|audit|explain|document|test|tests|rename|move|debug|optimi[sz]e|install|scan|implement|generate|wire|split|merge|run)\b/i;

const DOMAIN_WORDS =
  /\b(auth|db|database|api|ui|schema|test|tests|hook|hooks|skill|skills|vault|graph|mcp|git|ci|cli|docs?|readme|agents?|prompt|prompts)\b/i;

/** Broad "you named something concrete" signal: path, filename, `backtick`, #123, URL. */
const COMPONENT_REF =
  /(`[^`]+`)|(\b[\w.-]+\/[\w./-]+)|(\b\w[\w-]*\.(md|mjs|js|ts|json|sh|ya?ml|html)\b)|(#\d+)|(https?:\/\/)/i;

/** Narrow "you named the exact file" signal — precise enough to skip the optimizer entirely. */
const FILE_LOCATOR = /(\b[\w.-]+\/[\w./-]+\.\w+\b)|(\b[\w.-]+\.\w+:\d+\b)/;

const BYPASS_WORDS = /\b(just|quickly|only|typo|rename)\b/i;
const STEER_WORDS =
  /^(y|yes|no|ok|okay|sure|continue|go ahead|proceed|stop|undo|next|thanks|ty)\b/i;

export function wordCount(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function shouldBypass(prompt, env = process.env) {
  const p = String(prompt ?? '').trim();
  if (!p) return true;
  if (env.CORTEX_NO_OPTIMIZE === '1') return true;
  if (p.startsWith('/')) return true;          // an explicit ritual is already named
  if (STEER_WORDS.test(p)) return true;        // "yes", "continue" — mid-flow steering
  if (BYPASS_WORDS.test(p)) return true;       // user signalled "small, don't ceremony this"
  if (FILE_LOCATOR.test(p)) return true;       // exact target named
  if (wordCount(p) > 60) return true;          // already detailed
  return false;
}

export function scoreVagueness(prompt) {
  const p = String(prompt ?? '');
  let score = 0;
  if (wordCount(p) < 10) score += 2;
  if (!ACTION_VERBS.test(p)) score += 1;
  if (!COMPONENT_REF.test(p)) score += 1;
  if (!DOMAIN_WORDS.test(p)) score += 1;
  return score;
}

export function buildDirective(score) {
  return [
    `Prompt vagueness score ${score}/5.`,
    'Before acting, run the Prompt Optimization Protocol (skills/optimize-prompt/SKILL.md):',
    "ask at most 2 questions grounded in this repo's real file and folder names,",
    'synthesize one precise prompt as [ACTION] [COMPONENT] [in DOMAIN] [with CONSTRAINTS] -> [RITUAL],',
    'show it and wait for a one-word confirmation,',
    'save it to docs/prompts/YYYY-MM-DD-<slug>.md, then hand off to the named ritual.',
  ].join(' ');
}

export function evaluate(prompt, env = process.env) {
  if (shouldBypass(prompt, env)) return null;
  const score = scoreVagueness(prompt);
  if (score < THRESHOLD) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildDirective(score),
    },
  };
}

function main() {
  try {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, 'utf-8')); } catch { /* no/invalid stdin */ }
    const result = evaluate(payload && payload.prompt);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch { /* never disrupt the session */ }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/hooks/optimize-prompt.test.mjs`
Expected: PASS — 7 tests, 0 failures.

If `scoreVagueness('add the booking stuff')` is not exactly 4, do not edit the assertion to match the
code. Work out which signal misfired and fix the regex.

- [ ] **Step 5: Verify the whole hook suite still passes**

Run: `node --test .claude/hooks/`
Expected: PASS — including the pre-existing `reflect-session.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/optimize-prompt.mjs .claude/hooks/optimize-prompt.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): vagueness gate for the prompt optimizer"
```

---

### Task 3: Register the hook and verify end-to-end

**Files:**
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `.claude/hooks/optimize-prompt.mjs` from Task 2.
- Produces: a live `UserPromptSubmit` registration.

- [ ] **Step 1: Prove the wiring works before touching settings**

```bash
echo '{"hook_event_name":"UserPromptSubmit","prompt":"add the booking stuff"}' \
  | node .claude/hooks/optimize-prompt.mjs
```

Expected: one line of JSON containing `"additionalContext"` and `4/5`.

```bash
echo '{"hook_event_name":"UserPromptSubmit","prompt":"fix the null check in tools/cortex.sh:42"}' \
  | node .claude/hooks/optimize-prompt.mjs
```

Expected: **no output at all**, exit 0.

```bash
echo 'not json' | node .claude/hooks/optimize-prompt.mjs; echo "exit=$?"
```

Expected: no output, `exit=0`.

- [ ] **Step 2: Register the hook**

`.claude/settings.json` becomes:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "clear|logout|prompt_input_exit|other",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/reflect-session.mjs\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/optimize-prompt.mjs\""
          }
        ]
      }
    ]
  }
}
```

No `matcher` — `UserPromptSubmit` ignores it.

- [ ] **Step 3: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('settings.json OK')"`
Expected: `settings.json OK`

- [ ] **Step 4: Live verification (requires a restart)**

Hooks are snapshotted at startup. Ask the user to restart Claude Code, then check both directions:

| Type this | Expected |
|---|---|
| `make it faster` | Up to 2 grounded questions, then a synthesized prompt shown for confirmation |
| `run node --test .claude/hooks/` | Runs immediately — no questions, no mention of scoring |

Then confirm graceful degradation: temporarily rename the hook
(`mv .claude/hooks/optimize-prompt.mjs .claude/hooks/optimize-prompt.mjs.off`), submit any prompt,
and verify the session is **unaffected** — no error, no blocked prompt. Restore the file afterwards.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): register optimize-prompt on UserPromptSubmit"
```

---

### Task 4: The skill and its storage convention

**Files:**
- Create: `skills/optimize-prompt/SKILL.md`
- Create: `.claude/skills/optimize-prompt/SKILL.md` (copy)
- Create: `docs/prompts/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the directive text from `buildDirective()` (Task 2), which names this file by path.
- Produces: the `docs/prompts/YYYY-MM-DD-<slug>.md` record format used by nothing else — it is the
  human-facing output.

- [ ] **Step 1: Write the skill**

Note the four-backtick outer fence — the skill body contains its own fenced block.

````markdown
---
name: optimize-prompt
description: Use when a prompt is vague, short, or missing its target — "fix it", "make it faster", "add the booking stuff" — or when the UserPromptSubmit hook reports a vagueness score of 3 or higher. Also use when the user says "optimize this prompt", "sharpen this", "what should I have asked".
---

# /optimize-prompt — sharpen a prompt before acting on it

A vague prompt makes the agent guess, and a guess costs a whole turn. This ritual converts an
unclear ask into one precise prompt, gets it confirmed, records it, and hands it to the right
ritual.

## What to do

1. **Score it** (the hook does this in Claude Code; do it yourself everywhere else):
   under 10 words `+2`; no action verb `+1`; no component reference `+1`; no domain keyword `+1`.
   Under 3 — act on the prompt as written, say nothing. Skip entirely for slash commands,
   confirmations ("yes", "continue"), anything naming an exact file, and prompts saying "just" or
   "quickly".
2. **Ask at most 2 questions**, highest-value first, skipping any the prompt already answers:
   - WHAT should happen (missing outcome)
   - WHERE it lives (missing component)
   - HOW it lands (new / change / migration)
   Ground every question in this repo's **real names** — "`skills/` or `tools/`?" beats "which
   layer?". Generic questions are why the old engine-era booster was never worth using.
3. **Synthesize one prompt:** `[ACTION] [COMPONENT] [in DOMAIN] [with CONSTRAINTS] -> [RITUAL]`
4. **Confirm.** Show it, wait for a one-word yes or an adjustment. One adjustment round, then go.
   Never act on an unconfirmed prompt.
5. **Save** to `docs/prompts/YYYY-MM-DD-<slug>.md` — slug is kebab-case from 3–5 of the most
   specific words of the *optimized* prompt. If the file exists, append another block.
6. **Route** to the ritual named in the synthesis.

## Routing

| Prompt shape | Ritual |
|---|---|
| new feature or non-trivial change | `superpowers:brainstorming`, then `/analyze-spec` if risky |
| bug, test failure, surprise behavior | `superpowers:systematic-debugging` |
| stray thought, link, task | `/capture` |
| vault structure or health | `/cortex-doctor` or `/cortex-audit` |
| "make a ritual for X" | `/skill-creator` |

## Record format

```markdown
---
type: optimized-prompt
created: 2026-07-21
score: 4
ritual: superpowers:brainstorming
---
## Raw
<the original prompt, verbatim>

## Clarified
- Q: <question> -> A: <answer>

## Optimized
<the synthesized prompt>
```

## Don't
- Don't ask more than 2 questions. Friction is what gets this ritual disabled.
- Don't fire on slash commands, confirmations, or mid-flow replies.
- Don't act on a prompt the user hasn't confirmed.
- Don't optimize a prompt that is already precise — silence is the correct output.
- Don't write the record anywhere but `docs/prompts/` (gitignored; keeps the privacy firewall).
````

- [ ] **Step 2: Verify the description triggers correctly**

Re-read the frontmatter with fresh eyes against `skills/skill-creator/SKILL.md` rule 3: the
`description:` must list **triggering conditions only** and must not summarize the workflow.
Expected: it names vague-prompt examples and the hook's score signal, and says nothing about
questions, synthesis, or saving.

- [ ] **Step 3: Write the committed, data-free folder README**

```markdown
# docs/prompts/

Optimized prompts, one file per sharpened ask, written by [[optimize-prompt]].

Filename: `YYYY-MM-DD-<slug>.md` — slug is kebab-case from the optimized prompt.

**These files are gitignored.** Real prompts name real clients, repos, and plans, so they stay on
your machine — only this README is committed, so a fork inherits the convention and none of the
content. See the privacy rule in `AGENTS.md`.

Each file records the raw prompt, the clarifying questions and answers, and the final optimized
prompt. Over time the folder becomes a corpus for tuning the vagueness threshold in
`.claude/hooks/optimize-prompt.mjs`.
```

- [ ] **Step 4: Ignore the folder but keep the README**

Append to `.gitignore`, under the "Personal layer" section:

```gitignore
# Optimized prompts (contain real project/client detail) — keep the convention, not the content
docs/prompts/
!docs/prompts/README.md
```

- [ ] **Step 5: Verify the ignore rule does exactly what it claims**

```bash
mkdir -p docs/prompts && printf -- '---\ntype: optimized-prompt\n---\n' > docs/prompts/2026-07-21-throwaway.md
git check-ignore -v docs/prompts/2026-07-21-throwaway.md
git check-ignore -v docs/prompts/README.md; echo "README ignored? exit=$?"
rm docs/prompts/2026-07-21-throwaway.md
```

Expected: the throwaway file **is** matched by `.gitignore`; `README.md` is **not** (`exit=1`).

- [ ] **Step 6: Expose it as a slash command**

```bash
mkdir -p .claude/skills/optimize-prompt
cp skills/optimize-prompt/SKILL.md .claude/skills/optimize-prompt/SKILL.md
```

`.claude/skills/` is gitignored — this copy is local only, which is why the canonical file lives in
`skills/`.

- [ ] **Step 7: Commit**

```bash
git add skills/optimize-prompt/SKILL.md docs/prompts/README.md .gitignore
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(skill): /optimize-prompt ritual + gitignored docs/prompts store"
```

---

### Task 5: Wire it into the operating manual

Without this task the ritual is invisible to Gemini, Copilot, and to `/cortex-doctor`, which flags
skill-wiring drift.

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `skills/optimize-prompt/SKILL.md` from Task 4.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Add the protocol section to `AGENTS.md`**

Insert immediately **before** the line beginning
``## The rituals (canonical in `skills/`;``:

```markdown
## Prompt Optimization Protocol

Before acting on a prompt, score it: under 10 words `+2`; no action verb `+1`; no component
reference `+1`; no domain keyword `+1`. **Score 3 or higher → run [[optimize-prompt]] first** — ask
at most 2 questions grounded in this repo's real names, synthesize one precise prompt, confirm it,
save it to `docs/prompts/`, then route to the named ritual. Below 3, act on the prompt as written
and say nothing about scoring.

Skip entirely for slash commands, confirmations ("yes", "continue"), prompts naming an exact file,
and prompts saying "just" or "quickly". In Claude Code a `UserPromptSubmit` hook enforces this
automatically; every other agent applies it from this section.
```

- [ ] **Step 2: Add the rituals-list bullet to `AGENTS.md`**

Append to the rituals bullet list, after the `/cortex-audit` entry:

```markdown
- `/optimize-prompt` (automatic) — the **prompt gate**: scores each incoming prompt and, when it's
  vague, asks up to two grounded questions, synthesizes one precise prompt for confirmation, saves it
  to `docs/prompts/` (gitignored), and routes the work to the right ritual. Enforced by a
  `UserPromptSubmit` hook in Claude Code; by the protocol section above everywhere else.
```

- [ ] **Step 3: Add the rituals-table row to `README.md`**

Insert after the `/cortex-audit` row (currently line 142):

```markdown
| `/optimize-prompt` | automatic | Score each prompt; sharpen vague ones into a confirmed precise prompt, save to `docs/prompts/`, route to the right ritual |
```

- [ ] **Step 4: Verify there is no wiring drift**

```bash
grep -c "optimize-prompt" AGENTS.md README.md
ls skills/optimize-prompt/SKILL.md .claude/skills/optimize-prompt/SKILL.md docs/prompts/README.md
```

Expected: `AGENTS.md` ≥ 2 matches, `README.md` ≥ 1 match, all three files listed.

- [ ] **Step 5: Run the full test suite one last time**

Run: `node --test .claude/hooks/`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md README.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs: wire /optimize-prompt into the operating manual"
```

---

## Post-implementation: tuning

The threshold is a guess until it meets real prompts. Known tension: at `THRESHOLD = 3`, a terse but
perfectly clear instruction like "run the tests" scores 3 and triggers a needless question. If false
positives annoy you in the first week, raise `THRESHOLD` to `4` in
`.claude/hooks/optimize-prompt.mjs` and update the number in the `AGENTS.md` protocol section to
match. The `docs/prompts/` corpus exists so this becomes a data-driven call rather than a vibe.

Deliberately out of scope, per the spec: propagating the optimizer to other repos via
`/install-project`, and an MCP `boost_prompt` tool.
