# Automatic Session-End Learning Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `SessionEnd` hook mines each session's transcript into `brain/candidates.jsonl` so `/level-up` reviews a pre-filled, human-gated queue.

**Architecture:** A self-contained Node ESM script (`.claude/hooks/reflect-session.mjs`) with a pure, testable core (`extractUserTurns` → `mineTranscript` → `appendCandidates`) plus a thin CLI wrapper that reads the hook's stdin JSON. Registered via a `SessionEnd` hook in `.claude/settings.json`. `/level-up` Step 0 is downgraded to a watermark-gated fallback.

**Tech Stack:** Node ≥20 ESM (`.mjs`), zero runtime dependencies. Tests via the built-in `node --test` runner + `node:assert/strict`.

## Global Constraints

- **Boundary (NON-NEGOTIABLE):** the script writes **only** to `<root>/brain/candidates.jsonl` and `<root>/brain/.last-reflect`. Never `context/*`, never `brain/memory.jsonl`.
- **Candidate schema (verbatim from `engine/src/mcp-server/candidates.ts`):** `{ id, createdAt, text, domain: 'personal'|'project', trigger, needsSanitization }` where `needsSanitization === (domain === 'project')`.
- **Domain default:** `project` unless the signal is clearly a personal preference/workflow.
- **Never disrupt a session:** every failure path is a silent no-op; the CLI wrapper always `process.exit(0)`.
- **No Node dependency for the personal layer:** if Node/transcript/root is unavailable the hook no-ops and `/level-up` Step 0 remains the fallback.
- **Personal root resolution order:** `AI_OS_PERSONAL_ROOT` → hook payload `cwd` → `CLAUDE_PROJECT_DIR` → `process.cwd()`.
- **Commits:** prefix every `git commit` with `SKIP_SIMPLE_GIT_HOOKS=1` (the repo's root pre-commit hook is broken).
- **Branch:** all work on `feat/auto-session-capture`.

---

### Task 1: `extractUserTurns` — parse transcript JSONL into human-turn text

**Files:**
- Create: `.claude/hooks/reflect-session.mjs`
- Test: `.claude/hooks/reflect-session.test.mjs`

**Interfaces:**
- Produces: `extractUserTurns(transcriptText: string) => string[]` — one entry per genuine human turn. Keeps lines where `type === 'user'`, `isSidechain` is falsy, `message.role === 'user'`; extracts string content directly or joins `text` blocks from array content; skips tool-result blocks and command/system-reminder wrapper turns.

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/hooks/reflect-session.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUserTurns } from './reflect-session.mjs';

const lines = [
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: 'I prefer tabs over spaces.' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'always run the tests first' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'sure' }] } }),
  JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'text', text: 'sidechain noise' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', content: 'tool output' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: '<command-name>/audit</command-name>' }] } }),
  'not json at all',
].join('\n');

test('extractUserTurns keeps only genuine human prose', () => {
  const turns = extractUserTurns(lines);
  assert.deepEqual(turns, ['I prefer tabs over spaces.', 'always run the tests first']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: FAIL — `extractUserTurns` is not exported (module/file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```javascript
// .claude/hooks/reflect-session.mjs

/** True for turns that are command/system wrappers, not human prose. */
function isWrapper(text) {
  return /<command-(name|message|args)>|<\/command-|<local-command-stdout>|<system-reminder>/i.test(text);
}

/** Parse Claude Code transcript JSONL → array of genuine human-turn text. */
export function extractUserTurns(transcriptText) {
  const turns = [];
  for (const line of String(transcriptText).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (!obj || obj.type !== 'user' || obj.isSidechain) continue;
    const content = obj.message?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    }
    text = text.trim();
    if (!text || isWrapper(text)) continue;
    turns.push(text);
  }
  return turns;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/reflect-session.mjs .claude/hooks/reflect-session.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): extractUserTurns — parse transcript JSONL into human turns"
```

---

### Task 2: `mineTranscript` — regex-mine turns into candidate drafts

**Files:**
- Modify: `.claude/hooks/reflect-session.mjs`
- Test: `.claude/hooks/reflect-session.test.mjs`

**Interfaces:**
- Consumes: `extractUserTurns` output (`string[]`).
- Produces: `mineTranscript(turns: string[]) => Array<{ text: string, domain: 'personal'|'project', trigger: string }>` — splits turns into sentences, emits a draft for each sentence containing a signal phrase. Personal-preference signals → `domain: 'personal'`; all other signals → `domain: 'project'`. Dedups by `text` within the run; caps at 5 drafts.

- [ ] **Step 1: Write the failing test**

```javascript
// append to .claude/hooks/reflect-session.test.mjs
import { mineTranscript } from './reflect-session.mjs';

test('mineTranscript classifies personal vs project signals', () => {
  const drafts = mineTranscript([
    'I prefer concise commit messages.',
    'Always run the full test suite before pushing.',
  ]);
  const personal = drafts.find((d) => d.text.startsWith('I prefer'));
  const project = drafts.find((d) => d.text.startsWith('Always run'));
  assert.equal(personal.domain, 'personal');
  assert.equal(project.domain, 'project');
  assert.match(personal.trigger, /i prefer/i);
});

test('mineTranscript dedups and caps at 5', () => {
  const dup = mineTranscript(['I prefer X.', 'I prefer X.']);
  assert.equal(dup.length, 1);
  const many = mineTranscript(
    Array.from({ length: 8 }, (_, i) => `Always do thing number ${i}.`),
  );
  assert.equal(many.length, 5);
});

test('mineTranscript returns nothing for plain chatter', () => {
  assert.deepEqual(mineTranscript(['can you open the file', 'thanks']), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: FAIL — `mineTranscript` is not exported.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to .claude/hooks/reflect-session.mjs

const PERSONAL_SIGNALS = [
  /\bi prefer\b/i, /\bi'?d prefer\b/i, /\bi like to\b/i, /\bi always\b/i,
  /\bi never\b/i, /\bi usually\b/i, /\bfrom now on\b/i, /\bgoing forward\b/i,
];
const PROJECT_SIGNALS = [
  /\bno,? actually\b/i, /\binstead of\b/i, /\brather than\b/i, /\bdon'?t\b/i,
  /\bdo not\b/i, /\bstop\b/i, /\balways\b/i, /\bnever\b/i, /\bmake sure\b/i,
  /\bbe sure to\b/i, /\bremember to\b/i,
];

function firstMatch(signals, sentence) {
  for (const re of signals) {
    const m = sentence.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Turns → candidate drafts. Personal-preference signals win over project signals. */
export function mineTranscript(turns) {
  const drafts = [];
  const seen = new Set();
  for (const turn of turns) {
    const sentences = String(turn).split(/(?<=[.!?])\s+|\n+/);
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence || sentence.length > 240) continue;
      const personal = firstMatch(PERSONAL_SIGNALS, sentence);
      const trigger = personal || firstMatch(PROJECT_SIGNALS, sentence);
      if (!trigger) continue;
      const text = sentence.slice(0, 240);
      if (seen.has(text)) continue;
      seen.add(text);
      drafts.push({ text, domain: personal ? 'personal' : 'project', trigger });
      if (drafts.length >= 5) return drafts;
    }
  }
  return drafts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/reflect-session.mjs .claude/hooks/reflect-session.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): mineTranscript — classify signals into candidate drafts"
```

---

### Task 3: `appendCandidates` — write the boundary-safe queue

**Files:**
- Modify: `.claude/hooks/reflect-session.mjs`
- Test: `.claude/hooks/reflect-session.test.mjs`

**Interfaces:**
- Consumes: `mineTranscript` output.
- Produces: `appendCandidates(drafts, root) => Candidate[]` — appends new candidates (deduped by `text` against existing file content) to `<root>/brain/candidates.jsonl` using the verbatim schema; returns the freshly-written candidates. Creates `<root>/brain/` if missing. Writes nothing else.

- [ ] **Step 1: Write the failing test**

```javascript
// append to .claude/hooks/reflect-session.test.mjs
import { appendCandidates } from './reflect-session.mjs';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('appendCandidates writes only candidates.jsonl with correct schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-'));
  const written = appendCandidates(
    [{ text: 'Always run tests.', domain: 'project', trigger: 'always' }],
    root,
  );
  assert.equal(written.length, 1);
  const c = written[0];
  assert.equal(c.text, 'Always run tests.');
  assert.equal(c.domain, 'project');
  assert.equal(c.needsSanitization, true);
  assert.ok(c.id && c.createdAt && c.trigger === 'always');
  // Boundary: brain/ contains ONLY candidates.jsonl; no memory.jsonl / context written.
  assert.deepEqual(readdirSync(join(root, 'brain')), ['candidates.jsonl']);
  const onDisk = readFileSync(join(root, 'brain', 'candidates.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(onDisk.length, 1);
  assert.equal(JSON.parse(onDisk[0]).text, 'Always run tests.');
});

test('appendCandidates dedups against existing file content', () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-'));
  appendCandidates([{ text: 'Always run tests.', domain: 'project', trigger: 'always' }], root);
  const second = appendCandidates([
    { text: 'Always run tests.', domain: 'project', trigger: 'always' },
    { text: 'I prefer tabs.', domain: 'personal', trigger: 'i prefer' },
  ], root);
  assert.equal(second.length, 1);
  assert.equal(second[0].text, 'I prefer tabs.');
  assert.equal(second[0].needsSanitization, false);
  const onDisk = readFileSync(join(root, 'brain', 'candidates.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(onDisk.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: FAIL — `appendCandidates` is not exported.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to .claude/hooks/reflect-session.mjs
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append-only, boundary-safe. Writes ONLY <root>/brain/candidates.jsonl. */
export function appendCandidates(drafts, root) {
  if (!Array.isArray(drafts) || drafts.length === 0) return [];
  const file = join(root, 'brain', 'candidates.jsonl');
  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const seen = new Set(
    existing.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l).text; } catch { return null; }
    }).filter(Boolean),
  );
  const fresh = [];
  for (const d of drafts) {
    if (!d || !d.text || seen.has(d.text)) continue;
    seen.add(d.text);
    fresh.push({
      id: newId(),
      createdAt: new Date().toISOString(),
      text: d.text.trim(),
      domain: d.domain,
      trigger: String(d.trigger || '').trim(),
      needsSanitization: d.domain === 'project',
    });
  }
  if (fresh.length === 0) return [];
  mkdirSync(dirname(file), { recursive: true });
  const body = `${existing.replace(/\s*$/, '')}${existing.trim() ? '\n' : ''}` +
    `${fresh.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
  return fresh;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/reflect-session.mjs .claude/hooks/reflect-session.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): appendCandidates — boundary-safe candidate queue writes"
```

---

### Task 4: CLI wrapper — wire stdin payload → pipeline, always exit 0

**Files:**
- Modify: `.claude/hooks/reflect-session.mjs`

**Interfaces:**
- Consumes: hook stdin JSON (`{ transcript_path, cwd, ... }`).
- Produces: a `main()` that runs only when the file is invoked directly; resolves the root, reads the transcript, runs `extractUserTurns → mineTranscript → appendCandidates`, stamps `<root>/brain/.last-reflect` with today's date, and never throws.

- [ ] **Step 1: Add the wrapper (no unit test — verified by integration in Step 2)**

```javascript
// append to .claude/hooks/reflect-session.mjs
import { fileURLToPath } from 'node:url';

function resolveRoot(payload) {
  return process.env.AI_OS_PERSONAL_ROOT || payload.cwd ||
    process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function runFromPayload(payload, root) {
  const transcriptPath = payload && payload.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const text = readFileSync(transcriptPath, 'utf-8');
  const written = appendCandidates(mineTranscript(extractUserTurns(text)), root);
  try {
    const wm = join(root, 'brain', '.last-reflect');
    mkdirSync(dirname(wm), { recursive: true });
    writeFileSync(wm, `${new Date().toISOString().slice(0, 10)}\n`);
  } catch { /* watermark is best-effort */ }
  return written;
}

function main() {
  try {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, 'utf-8')); } catch { /* no/invalid stdin */ }
    runFromPayload(payload, resolveRoot(payload));
  } catch { /* never disrupt the session */ }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 2: Integration-test the wrapper against a fixture transcript**

```bash
# Build a tiny fixture transcript and a throwaway root, then drive the hook via stdin.
mkdir -p /tmp/cortex-it
printf '%s\n%s\n' \
  '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"text","text":"I prefer short PR descriptions."}]}}' \
  '{"type":"user","isSidechain":false,"message":{"role":"user","content":"always rebase before merging"}}' \
  > /tmp/cortex-it/transcript.jsonl
printf '{"transcript_path":"/tmp/cortex-it/transcript.jsonl","cwd":"/tmp/cortex-it"}' \
  | node .claude/hooks/reflect-session.mjs
echo "exit=$?"
cat /tmp/cortex-it/brain/candidates.jsonl
cat /tmp/cortex-it/brain/.last-reflect
```

Expected: `exit=0`; `candidates.jsonl` has two lines — one `personal` (`needsSanitization:false`, text "I prefer short PR descriptions.") and one `project` (`needsSanitization:true`, text "always rebase before merging"); `.last-reflect` holds today's date.

- [ ] **Step 3: Verify the no-op safety paths**

```bash
# Missing transcript → silent no-op, exit 0, no files created.
printf '{"transcript_path":"/tmp/does-not-exist.jsonl","cwd":"/tmp/cortex-empty"}' \
  | node .claude/hooks/reflect-session.mjs; echo "exit=$?"
test -e /tmp/cortex-empty/brain && echo "UNEXPECTED brain dir" || echo "ok: no brain dir"
# Garbage stdin → still exit 0.
printf 'not json' | node .claude/hooks/reflect-session.mjs; echo "exit=$?"
```

Expected: both `exit=0`; `ok: no brain dir`.

- [ ] **Step 4: Re-run the unit suite (wrapper must not break exports)**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/reflect-session.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): CLI wrapper — stdin payload to pipeline, always exit 0"
```

---

### Task 5: Register the `SessionEnd` hook in `.claude/settings.json`

**Files:**
- Modify or Create: `.claude/settings.json`

**Interfaces:**
- Consumes: nothing. Produces: a committed `SessionEnd` hook entry that runs `node "$CLAUDE_PROJECT_DIR/.claude/hooks/reflect-session.mjs"`.

- [ ] **Step 1: Inspect the current committed settings**

Run: `cat .claude/settings.json 2>/dev/null || echo "NO FILE"`
Note whether a `hooks` key already exists (merge into it) or the file is absent (create it).

- [ ] **Step 2: Write the merged settings**

If the file is **absent**, create `.claude/settings.json` with exactly:

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
    ]
  }
}
```

If the file **exists**, add the `SessionEnd` array above under the existing top-level `hooks` object (preserving all other keys). `resume` and `bypass_permissions_disabled` are intentionally excluded.

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid json')"`
Expected: `valid json`.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(hook): register SessionEnd reflect-session hook"
```

---

### Task 6: Reconcile `/level-up` Step 0 to a watermark-gated fallback

**Files:**
- Modify: `.claude/skills/level-up/SKILL.md` (Step 0 block, lines ~12–35)

**Interfaces:**
- Consumes: nothing. Produces: updated skill copy describing the hook as the primary capturer and Step 0 as a fallback.

- [ ] **Step 1: Replace Step 0's opening sentence**

Find:

```
0. **Reflect on recent sessions (mine behavior, don't interview):** learn from what you actually
   did, not just what the user remembers to say. This step ONLY queues candidates — it never writes
   `context/*` or `brain/memory.jsonl`. Storage stays gated by Step 2.
```

Replace with:

```
0. **Reflect on recent sessions (fallback miner):** the `SessionEnd` hook
   (`.claude/hooks/reflect-session.mjs`) already auto-mines each finished session into
   `brain/candidates.jsonl` and stamps the watermark. This step is the **fallback** for sessions
   the hook missed (e.g. Node absent): it mines only transcripts newer than the watermark, ONLY
   queues candidates, and never writes `context/*` or `brain/memory.jsonl`. Storage stays gated by
   Step 2. If the watermark is current and no newer transcripts exist, print "queue is current —
   skipping fallback mine" and go to Step 1.
```

- [ ] **Step 2: Verify the boundary line and Step 2 handoff still read correctly**

Run: `sed -n '12,40p' .claude/skills/level-up/SKILL.md`
Expected: Step 0 now describes the fallback role; the watermark bullet and `suggest_profile_update` guidance remain; Step 2 ("Surface ambient-capture candidates") is unchanged.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/level-up/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(level-up): Step 0 becomes watermark-gated fallback to the hook"
```

---

### Task 7: Final verification + open PR

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite green**

Run: `node --test .claude/hooks/reflect-session.test.mjs`
Expected: PASS (6 tests, 0 fail).

- [ ] **Step 2: Confirm no stray artifacts and boundary intact**

Run: `git status --short` (expect clean) and `git diff --stat origin/dev...HEAD`
Expected: only `.claude/hooks/reflect-session.mjs`, `.claude/hooks/reflect-session.test.mjs`, `.claude/settings.json`, `.claude/skills/level-up/SKILL.md`, and the two `docs/superpowers/*` files changed. No `context/`, `brain/`, or `engine/` changes.

- [ ] **Step 3: Push and open the PR to `dev`**

```bash
git push -u origin feat/auto-session-capture
gh pr create --base dev --head feat/auto-session-capture \
  --title "feat: automatic session-end learning capture" \
  --body "Implements docs/superpowers/specs/2026-06-19-auto-session-capture-design.md. SessionEnd hook mines transcripts into brain/candidates.jsonl; /level-up Step 0 becomes a watermark-gated fallback. Boundary-safe (append-only candidates, domain defaults to project), always-exit-0 hook, 6 node --test units passing."
```

Expected: PR created against `dev`.

---

## Self-Review

**Spec coverage:** `reflect-session.mjs` core (Tasks 1–3) ✓; CLI wrapper + always-exit-0 + watermark (Task 4) ✓; `.claude/settings.json` SessionEnd hook with matcher excluding `resume`/`bypass_permissions_disabled` (Task 5) ✓; `/level-up` Step 0 fallback reconciliation (Task 6) ✓; zero-dep `node --test` covering extract/mine/append + boundary + dedup + domain default (Tasks 1–3) ✓; error/no-op paths (Task 4 Step 3) ✓; root resolution order (Task 4 `resolveRoot`) ✓; verbatim Candidate schema (Task 3) ✓.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `extractUserTurns(string)→string[]` → `mineTranscript(string[])→{text,domain,trigger}[]` → `appendCandidates(drafts,root)→Candidate[]`; `runFromPayload(payload,root)` reuses all three. `domain`/`needsSanitization` invariant identical in spec, Task 3 impl, and Task 3 tests. ✓
