# /optimize-context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/optimize-context` — a ritual run inside any repo that measures its agent context, ranks what costs context without earning it, applies only content-preserving fixes, and proposes every prose deletion with the lines quoted.

**Architecture:** Two markdown deliverables plus wiring. `references/context-engineering.md` holds the rules as a Cortex framework (single source of truth); `skills/optimize-context/SKILL.md` is the four-pass procedure that applies them. Verification is a fixture repo with known, deliberately-planted defects — built first, so the ritual can fail against it before it exists.

**Tech Stack:** Plain markdown. No Node, no build step, no dependencies. Verification uses `wc`, `grep`, and reading the ritual's output by hand.

## Global Constraints

- **Plain files only.** No script in `tools/`, no tokenizer dependency, no config file. Spec: "A vault script would not exist in a target repo, breaking the self-contained promise."
- **Never delete prose without a human yes.** Automatic changes are limited to moves that preserve total information.
- **Committed files stay data-free.** `references/` and `skills/` are tracked; no personal or employer content. (`AGENTS.md` privacy rule + employer firewall.)
- **Token estimate is bytes ÷ 4.** Sufficient for ranking; do not add a tokenizer.
- **Ritual targets other repos, never this vault.** `/cortex-doctor` owns vault structure.
- **Commits need `SKIP_SIMPLE_GIT_HOOKS=1`** (the root pre-commit hook is broken/orphaned).
- Branch: `docs/context-engineering-followups`. Do not push to `master` directly.
- Fixture lives in the scratchpad, never in the repo: `$SCRATCH` = `<scratchpad>` (the agent's temp
  scratchpad directory).

---

## File Structure

| Path | Responsibility |
|---|---|
| `references/context-engineering.md` | The rules, as a framework doc. Cited by three skills; restated by none. |
| `skills/optimize-context/SKILL.md` | The four-pass procedure + the safety rule. |
| `AGENTS.md` | One row in the ritual table. |
| `README.md` | One row in the "The rituals (skills)" table. |
| `skills/skill-creator/SKILL.md` | Replace its inline rules with a citation to the new reference. |
| `.claude/skills/optimize-context/` | Mirror (gitignored, local only). |
| `$SCRATCH/fixture-repo/` | Verification fixture. Never committed. |

---

### Task 1: Build the verification fixture

The fixture is the test. It must exist and its expected findings must be written down **before** the ritual, so the ritual can fail against it.

**Files:**
- Create: `$SCRATCH/fixture-repo/AGENTS.md`
- Create: `$SCRATCH/fixture-repo/CLAUDE.md`
- Create: `$SCRATCH/fixture-repo/package.json`
- Create: `$SCRATCH/fixture-repo/src/api/handler.js`
- Create: `$SCRATCH/fixture-repo/.cursor/rules/project.mdc`
- Create: `$SCRATCH/fixture-expected.md`

**Interfaces:**
- Produces: a repo path used by Task 4's verification, and `fixture-expected.md` — the finding list Task 4 checks the ritual's output against.

- [ ] **Step 1: Create the fixture directory and a real `package.json`**

```bash
SCRATCH="<scratchpad>"  # the agent's temp scratchpad directory
mkdir -p "$SCRATCH/fixture-repo/src/api" "$SCRATCH/fixture-repo/.cursor/rules"
cat > "$SCRATCH/fixture-repo/package.json" <<'EOF'
{
  "name": "fixture-app",
  "version": "1.0.0",
  "scripts": { "dev": "vite", "test": "vitest", "build": "vite build" },
  "dependencies": { "react": "^18.2.0", "zustand": "^4.5.0" }
}
EOF
```

- [ ] **Step 2: Write a deliberately bloated `AGENTS.md` with all four planted defects**

Defect A = discoverable-from-code prose. Defect B = **one non-discoverable line buried inside it** (this is success criterion 3 — the line the ritual must KEEP). Defect C = an inlined template. Defect D = a directory with an invariant and no leaf.

```bash
cat > "$SCRATCH/fixture-repo/AGENTS.md" <<'EOF'
# Fixture App — Project Brain

## Stack
- Framework: React 18.2.0
- State: zustand 4.5.0
- Build: vite

## Scripts
- `npm run dev` — starts the dev server
- `npm run test` — runs vitest
- `npm run build` — production build

## Project structure
- `src/` — source code
- `src/api/` — API handlers
- `src/api/handler.js` — the handler
- `src/legacy/` — DO NOT TOUCH, deleted Q3 2026, still imported by billing
- `src/components/` — React components
- `src/hooks/` — custom hooks

## PR template
Copy this into every pull request description:

```markdown
## What changed

## Why

## How to test

## Screenshots
```

## Conventions
- Match the surrounding code style.
EOF
```

- [ ] **Step 3: Write the drifted shim and the duplicated Cursor rule**

`CLAUDE.md` should hold its own copy rather than point — that is the drift.

```bash
cat > "$SCRATCH/fixture-repo/CLAUDE.md" <<'EOF'
# Fixture App

## Stack
- Framework: React 18.2.0
- State: zustand 4.5.0
- Build: vite

## Conventions
- Match the surrounding code style.
EOF
cat > "$SCRATCH/fixture-repo/.cursor/rules/project.mdc" <<'EOF'
---
alwaysApply: true
---
Stack is React 18 with zustand. Match the surrounding code style.
EOF
```

- [ ] **Step 4: Plant the invariant in code so Pass 3 has something true to find**

```bash
cat > "$SCRATCH/fixture-repo/src/api/handler.js" <<'EOF'
// INVARIANT: the webhook signature is computed over the RAW body.
// Any middleware that JSON-parses before this point silently breaks verification.
export function handleWebhook(rawBody, signature) {
  return verify(rawBody, signature);
}
EOF
```

- [ ] **Step 5: Write the expected findings — this is the assertion**

```bash
cat > "$SCRATCH/fixture-expected.md" <<'EOF'
# Expected findings — fixture-repo

The ritual MUST produce all of these. Any miss is a failure.

1. [propose] AGENTS.md "## Stack" + "## Scripts" — discoverable from package.json. CUT.
2. [propose] AGENTS.md "## Project structure" — discoverable from the tree. CUT,
   **except** the `src/legacy/` line (DO NOT TOUCH / still imported by billing).
   The report MUST quote that line as KEPT. <- success criterion 3
3. [safe] AGENTS.md "## PR template" — inlined bulk. MOVE to a file, reference it.
4. [safe] CLAUDE.md holds its own copy of Stack + Conventions instead of pointing
   at AGENTS.md. Drifted shim. REPLACE with a pointer.
5. [handoff] src/api/ holds an invariant (raw body for signature verification)
   and has no scoped AGENTS.md leaf. NOMINATE /scope-area src/api/.
6. Report leads with measured always-loaded bytes, before -> projected after.

MUST NOT happen:
- Any prose deleted without an explicit yes.
- The `src/legacy/` line cut as part of the structure section.
- A leaf nominated for src/components/ or src/hooks/ (no invariant, no gotcha).
EOF
```

- [ ] **Step 6: Verify the fixture is well-formed**

```bash
ls -R "$SCRATCH/fixture-repo"; wc -c "$SCRATCH/fixture-repo/AGENTS.md" "$SCRATCH/fixture-repo/CLAUDE.md"
```

Expected: 5 files present; `AGENTS.md` roughly 900–1100 bytes.

- [ ] **Step 7: No commit**

The fixture lives in the scratchpad by design and is never committed. Nothing to commit in this task.

---

### Task 2: Write `references/context-engineering.md`

**Files:**
- Create: `references/context-engineering.md`

**Interfaces:**
- Produces: the wikilink target `[[context-engineering]]`, and five named rules (**Rule 1–5**) that Task 3's SKILL.md cites by number rather than restating.

- [ ] **Step 1: Write the framework doc**

Frontmatter must match the other `references/` files (check `references/nested-briefs.md` for the exact shape). Body:

```markdown
# Context Engineering

How to write context an AI agent reads well. Applies to any `AGENTS.md`, `CLAUDE.md`, skill body,
or rules file — in this vault or in a repo Cortex installs into.

The premise: newer models handle ambiguity well, so exhaustive rules cost tokens without buying
behavior. Every byte in an always-loaded file is re-read every session; the cost recurs while the
value decays.

## Rule 1 — Trust judgment over enumeration
Write the principle ("match the surrounding style"), not every case. Be prescriptive only where a
mistake is destructive or unrecoverable.

## Rule 2 — Progressive disclosure
Detail loads at the moment it's used, not every session. Long templates, reference tables and
worked examples go in a `templates/` or `reference/` file the body points at. Nested `AGENTS.md`
leaves ([[nested-briefs]]) are this rule applied to directories.

## Rule 3 — Don't restate what's discoverable
Cut what the agent can read from the code itself: file trees, dependency lists, script names,
framework versions. **Test per line, not per section** — a directory listing is waste, but one line
inside it saying "do not touch, still imported by billing" is the most valuable line in the file.

## Rule 4 — One canonical copy
A fact lives in exactly one file; everything else points at it. Shims hold a pointer, never their
own copy — copies drift silently.

## Rule 5 — Repetition is sometimes load-bearing
Deliberate repetition of a safety control is not redundancy. Before cutting a repeated rule, ask
what breaks if only one copy survives. Rules 1–4 never override this one.

## Applying it
`/optimize-context` audits a repo against these rules. `/skill-creator` follows them when writing a
new ritual. `/scope-area` is Rule 2 for directories.

Related: [[vault-architecture]] · [[nested-briefs]] · [[operating-principles]]
```

- [ ] **Step 2: Verify the frontmatter matches the other references**

```bash
head -8 references/nested-briefs.md references/context-engineering.md
```

Expected: same key set (`id`, `title`, `type`, `tags`, `updated`).

- [ ] **Step 3: Verify no dead links were introduced**

Run: `bash tools/cortex.sh`
Expected: dead-link count is `0 dead`, node count increased by 1.

- [ ] **Step 4: Commit**

```bash
SKIP_SIMPLE_GIT_HOOKS=1 git add references/context-engineering.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(reference): context-engineering rules as a Cortex framework"
```

---

### Task 3: Write `skills/optimize-context/SKILL.md`

**Files:**
- Create: `skills/optimize-context/SKILL.md`

**Interfaces:**
- Consumes: `[[context-engineering]]` Rules 1–5 from Task 2 — cite by number, never restate.
- Produces: the ritual invoked in Task 4.

- [ ] **Step 1: Write the frontmatter**

`description:` is triggering conditions only — never a workflow summary (`skill-creator` rule).

```markdown
---
name: optimize-context
description: Audit and slim the AI-agent context files in a repo — AGENTS.md, CLAUDE.md, shims, rules files, skill bodies. Use when a repo's AGENTS.md has grown large, when agents there feel slow or drift off-convention, or when the user says "optimize the context", "our AGENTS.md is bloated", "reduce context", "context engineering pass", "audit the agent instructions". Runs inside a target repo, not the vault.
---
```

- [ ] **Step 2: Write the body — four passes**

Include verbatim: the scope list, the four passes, the tag meanings (`[safe]`, `[propose]`, `[handoff]`), and the report shape. Cite Rules 1–5 rather than restating them.

```markdown
# /optimize-context — make a repo's agent context earn its tokens

Runs **inside a target repo** (Cortex-installed or not). Measures the files that steer AI agents
there, ranks what costs context without earning it, fixes what is mechanically safe, and proposes
everything else. The rules it applies are [[context-engineering]] Rules 1–5.

> Not for this vault — `/cortex-doctor` owns vault structure.

## The hard rule: never delete prose without a human yes

You cannot mechanically tell *redundant* from *deliberately repeated because it is load-bearing*
([[context-engineering]] Rule 5). In the Cortex vault itself, the employer-firewall enforcement
repeated across `/capture`, `/audit` and `/onboard` scores as textbook duplication — and cutting it
would silently remove a safety control.

So: automatic changes are limited to moves that **preserve total information**. Anything that
reduces it is quoted, reasoned, and waits for a yes.

## Files in scope
Root and nested `AGENTS.md` · `CLAUDE.md` · `GEMINI.md` · `.github/copilot-instructions.md` ·
`.github/instructions/*.md` · `.cursor/rules/*.mdc` · `.claude/skills/*/SKILL.md`

## Pass 1 — Measure
Per file: bytes, estimated tokens (bytes ÷ 4 — do not add a tokenizer), and whether it loads
**every session** (root `AGENTS.md`, `CLAUDE.md`, shims) or **on demand** (nested leaves, skill
bodies). Always-loaded bytes is the headline number; lead the report with it.

## Pass 2 — Find waste
- **Discoverable from code** (Rule 3) — file trees, dep lists, script names, versions. Check each
  claim against `package.json` and the actual tree. **Test per line:** keep any line carrying a fact
  the code does not state, and quote what you kept.
- **Duplicated across files** (Rule 4) — a shim holding its own copy; a convention stated in both
  root and a leaf. Keep one canonical copy; point the rest at it.
- **Inlined bulk** (Rule 2) — file templates, long examples, reference tables inside an
  always-loaded body. Move to a file; reference it from the step that needs it.

## Pass 3 — Find missing structure
The only pass that *adds*. Find directories that are high-churn, security/data sensitive, or hold an
invariant an agent could break, **and** have no scoped `AGENTS.md` leaf. Read the code to confirm
the invariant is real. Do not nominate a directory with no invariant and no gotcha.

## Pass 4 — Report, then act
Rank findings by always-loaded bytes recovered. Tag each:
- **`[safe]`** — content-preserving (extract a template, repoint a drifted shim). Apply it.
- **`[propose]`** — reduces information. Quote the exact lines, give the reason, wait for a yes.
- **`[handoff]`** — an approved leaf nomination. Invoke `/scope-area <dir>`; do not write leaves
  here (Rule 4 — `/scope-area` owns that job).

Close with: measured always-loaded bytes before → projected after.

## Don't
- Don't delete prose on your own authority. Ever.
- Don't rewrite another tool's rules file beyond pointing it at `AGENTS.md`.
- Don't add a script, a config file, or a dependency — this must run in any repo.
- Don't touch the vault.
```

- [ ] **Step 3: Verify the description triggers correctly and holds no workflow summary**

```bash
grep -c "Pass 1\|four pass\|measure then" skills/optimize-context/SKILL.md
head -4 skills/optimize-context/SKILL.md
```

Expected: the `description:` line contains trigger phrases only; the passes appear in the body.

- [ ] **Step 4: Commit**

```bash
SKIP_SIMPLE_GIT_HOOKS=1 git add skills/optimize-context/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(skill): /optimize-context — audit a repo's agent context"
```

---

### Task 4: Verify against the fixture (the real test)

**Files:**
- Read: `$SCRATCH/fixture-repo/**`, `$SCRATCH/fixture-expected.md`
- Modify: `skills/optimize-context/SKILL.md` (only if a criterion fails)

**Interfaces:**
- Consumes: the fixture from Task 1, the ritual from Task 3.

- [ ] **Step 1: Run the ritual against the fixture**

Copy the mirror first so the slash command exists, then run it with the fixture as target:

```bash
cp -r skills/optimize-context .claude/skills/
```

Then, in a fresh context, follow `skills/optimize-context/SKILL.md` against
`$SCRATCH/fixture-repo` and capture the report.

- [ ] **Step 2: Check the report against every expected finding**

Open `$SCRATCH/fixture-expected.md` and confirm findings 1–6 all appear. Record any miss.

- [ ] **Step 3: Check the three MUST NOT conditions**

Confirm: no prose was deleted without a yes; the `src/legacy/` line is quoted as **KEPT**; no leaf
was nominated for `src/components/` or `src/hooks/`.

- [ ] **Step 4: Verify success criterion 3 specifically**

This is the criterion that makes the ritual trustworthy and the one most likely to fail. The report
must show the `src/legacy/` line being kept *inside* a section it is otherwise cutting. If the
ritual cut the whole section, the per-line test in Pass 2 needs strengthening — fix it, re-run.

- [ ] **Step 5: Verify criterion 4 — works with no Cortex brain**

```bash
mkdir -p "$SCRATCH/fixture-bare" && cp "$SCRATCH/fixture-repo/package.json" "$SCRATCH/fixture-bare/"
cp "$SCRATCH/fixture-repo/.cursor/rules/project.mdc" "$SCRATCH/fixture-bare/"
```

Run the ritual against `$SCRATCH/fixture-bare` (no `AGENTS.md` at all). Expected: it reports the
Cursor rule as the only context file and does not error or invent findings.

- [ ] **Step 6: Commit any fixes**

```bash
SKIP_SIMPLE_GIT_HOOKS=1 git add skills/optimize-context/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "fix(skill): tighten optimize-context per fixture verification"
```

If no fixes were needed, skip the commit and note that verification passed clean.

---

### Task 5: Wire it in and remove the duplication it would otherwise create

**Files:**
- Modify: `AGENTS.md` (ritual table + gotchas list)
- Modify: `README.md` ("## The rituals (skills)" table)
- Modify: `skills/skill-creator/SKILL.md` (replace inline rules with a citation)
- Create: `.claude/skills/optimize-context/` (mirror)

**Interfaces:**
- Consumes: the ritual name and one-line purpose from Task 3.

- [ ] **Step 1: Add the row to the `AGENTS.md` ritual table**

Insert after the `/cortex-audit` row, matching the existing column style:

```markdown
| `/optimize-context` | per repo | audit + slim that repo's agent context files |
```

- [ ] **Step 2: Add the gotcha that distinguishes it from its siblings**

Append to the "Gotchas worth knowing" list — this is the confusion the row alone will not prevent:

```markdown
- `/optimize-context` targets **other repos**; `/cortex-doctor` targets this vault. Same instinct,
  different subject. It never deletes prose on its own authority.
```

- [ ] **Step 3: Add the README row**

```markdown
| `/optimize-context` | per repo | Audit + slim a repo's agent context (AGENTS.md, shims, rules files) |
```

- [ ] **Step 4: Replace `skill-creator`'s inline rules with a citation**

`skills/skill-creator/SKILL.md` currently spells out the templates/ and principles-over-rules
guidance inline. That is now duplication of `[[context-engineering]]` — exactly Rule 4. Replace the
two bullets added in commit `d0ed0a0` with:

```markdown
   - **Follow [[context-engineering]]** when shaping the body — Rules 1–3 especially: principles
     over enumeration, long material in `templates/`, don't restate what the code already says.
```

- [ ] **Step 5: Mirror and verify the graph**

```bash
cp -r skills/* .claude/skills/
bash tools/cortex.sh
```

Expected: `0 dead`.

- [ ] **Step 6: Verify every wiring point landed**

```bash
grep -c "optimize-context" AGENTS.md README.md skills/skill-creator/SKILL.md
ls .claude/skills/optimize-context/
```

Expected: `AGENTS.md` ≥ 2 (row + gotcha), `README.md` = 1, `skill-creator` = 1, mirror present.

- [ ] **Step 7: Commit**

```bash
SKIP_SIMPLE_GIT_HOOKS=1 git add AGENTS.md README.md skills/skill-creator/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs: wire /optimize-context into the manual, README and skill-creator"
```

---

### Task 6: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin docs/context-engineering-followups
```

- [ ] **Step 2: Update the existing PR, or note it if already open**

PR #311 is already open on this branch. These commits join it automatically on push. Update its body
to cover the new scope:

```bash
gh api repos/marinvch/ai-os/pulls/311 -X PATCH -F body=@pr-body.md
```

(`gh pr edit` fails on this repo — use the REST endpoint.)

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Four passes, cheapest first | Task 3 Step 2 |
| Scope of files read | Task 3 Step 2 |
| Per-line discoverability test | Task 3 Step 2; verified Task 4 Step 4 |
| `[safe]` / `[propose]` / `[handoff]` tags | Task 3 Step 2 |
| Hard rule: no prose deletion without yes | Task 3 Step 2; verified Task 4 Step 3 |
| `references/context-engineering.md` as single source | Task 2; duplication removed in Task 5 Step 4 |
| AGENTS.md + README rows, mirror | Task 5 |
| No script in tools/ | Global Constraints |
| Does not touch the vault | Task 3 Step 2 ("Don't") |
| Success criterion 1 (report with before→after) | Task 4 Step 2, expected finding 6 |
| Success criterion 2 (never deletes without yes) | Task 4 Step 3 |
| Success criterion 3 (keeps non-discoverable line) | Task 4 Step 4 |
| Success criterion 4 (works with no Cortex brain) | Task 4 Step 5 |
| Success criterion 5 (nominates only real invariants) | Task 4 Step 3, MUST NOT list |

No gaps.

**Placeholder scan:** No TBD/TODO. Every step has its actual content — fixture files, doc bodies,
and verification commands are written out, not described.

**Type consistency:** The rule numbering is used consistently — `references/context-engineering.md`
defines Rules 1–5 (Task 2 Step 1); `skills/optimize-context/SKILL.md` cites Rule 2, 3, 4, 5 by
number (Task 3 Step 2); `skill-creator` cites Rules 1–3 (Task 5 Step 4). Tag names `[safe]`,
`[propose]`, `[handoff]` are identical in the spec, Task 3, and Task 4's fixture expectations.
