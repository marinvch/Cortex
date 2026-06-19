# Design: Automatic session-end learning capture

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** Cortex userland only (committed at repo root). Not engine-installable into target projects.

## Problem

Cortex's self-learning loop is **ritual-driven, not continuous**. The ambient-capture
infrastructure exists — the `suggest_profile_update` MCP tool and the append-only
`brain/candidates.jsonl` queue — but nothing fires it automatically. Candidates are only
mined when the user runs `/level-up` (Step 0 reads transcripts since a watermark). There are
no Claude Code hooks wired to any session event.

Result: learning is captured retroactively in a batch at ritual cadence, and a session's
signal can be missed if transcripts are cleaned before the next `/level-up`.

## Goal

Capture learnings **continuously**: every session end auto-mines that session's transcript
and pre-fills `brain/candidates.jsonl`, so `/level-up` becomes pure review of a ready queue.
Storage stays fully human-gated (the boundary is unchanged).

## Constraints

- A Claude Code hook runs a **shell command**, not an MCP tool — so it cannot call
  `suggest_profile_update`. Automatic capture must be a script that appends to the queue file
  directly, writing the **exact same `Candidate` schema** the MCP tool produces.
- Must **never block or disrupt a session.** Any failure path is a silent no-op (exit 0).
- Must preserve "no Node needed for the personal layer": if Node is absent the hook no-ops
  and `/level-up` Step 0 remains the fallback capturer.
- Must respect the data boundary: write **only** to `brain/candidates.jsonl` (append-only).
  Never `context/*`, never `brain/memory.jsonl`. Default uncertain domain to `project`
  (`needsSanitization: true`) so it is forced through the sanitized promotion gate.

## Confirmed platform facts

- **`SessionEnd` hook** exists and fires **once per session end** (`reason` ∈
  `clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other`).
- **stdin payload** (all six fields present): `session_id`, `transcript_path`, `cwd`,
  `permission_mode`, `hook_event_name`, `reason`. We use `transcript_path` directly.
- **settings.json** shape: `hooks.SessionEnd` is an array of `{ matcher, hooks: [...] }`;
  `matcher` filters on `reason`. We match all real end reasons.
- **`$CLAUDE_PROJECT_DIR`** is available in hook commands.
- **Transcript JSONL** (verified against a real file): one JSON object per line with
  `type`, `message.role`, `message.content`, `isSidechain`, `cwd`, `sessionId`, `timestamp`.
  Human turns: `type === "user"`, `isSidechain === false`, `message.role === "user"`, and
  `message.content` is either a string or an array of blocks `[{type:"text",text}]`.
  Tool-results are also `type:"user"` but carry `tool_result` blocks — the miner keeps only
  `text` blocks and skips the rest.

## Components (all committed, data-free)

### 1. `.claude/hooks/reflect-session.mjs`

Self-contained Node ESM module: a **pure core** plus a thin CLI wrapper.

- `extractUserTurns(transcriptText) → string[]` — parse JSONL, keep human turns per the rules
  above, return their plain text. Skips sidechain lines, tool-results, and obvious
  command/system-reminder wrappers.
- `mineTranscript(turns) → Candidate[]` — regex over user text for recurring signal:
  corrections/preferences (`no, actually`, `don't`, `I prefer`, `always`, `never`,
  `instead`, `stop doing`) and repeat-fix phrasing. Caps results per session (~5). Each
  candidate's `trigger` is the matched source phrase.
- `appendCandidates(candidates, root)` — write the exact `Candidate` schema
  (`id, createdAt, text, domain, trigger, needsSanitization`) to
  `<root>/brain/candidates.jsonl`, append-only, atomic. **Dedup:** skip any candidate whose
  `text` already exists in the queue.
- **Domain default:** `project` when the signal isn't clearly a personal workflow/preference
  (per the `/level-up` rule), setting `needsSanitization: true`.
- **Root resolution:** `AI_OS_PERSONAL_ROOT` if set, else `cwd`/`$CLAUDE_PROJECT_DIR` (the
  Cortex repo root, where gitignored `brain/` lives).
- **CLI wrapper:** read hook JSON from stdin, take `transcript_path`; run the pipeline; stamp
  `brain/.last-reflect` with today's date. Everything wrapped in try/catch; **always exit 0.**

### 2. `.claude/settings.json`

Register the hook (cross-platform `node` invocation, no shell script):

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "clear|logout|prompt_input_exit|other",
        "hooks": [
          { "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/reflect-session.mjs\"" }
        ]
      }
    ]
  }
}
```

(`resume` and `bypass_permissions_disabled` are excluded — not real end-of-work events.)

### 3. `.claude/skills/level-up/SKILL.md` — reconcile Step 0

The SessionEnd hook becomes the **primary** capturer. Step 0 is downgraded to a **fallback**:
it only mines transcripts newer than the `brain/.last-reflect` watermark (covering sessions
where the hook no-op'd because Node was absent). Because the hook stamps the watermark on
every run, Step 0 normally finds nothing new — no double-capture. Step 2 (surface + confirm
candidates) is unchanged and now reviews a continuously pre-filled queue.

## Data flow

```
session ends → SessionEnd hook → node reflect-session.mjs
  ↳ read transcript_path → extractUserTurns → mineTranscript
  ↳ dedup vs existing queue → append Candidate{} to brain/candidates.jsonl
  ↳ stamp brain/.last-reflect
/level-up Step 0 (fallback): mine only transcripts newer than .last-reflect
/level-up Step 2: surface queue → user confirms/edits/rejects → gated storage
```

## Error handling

Every failure is a silent no-op that exits 0: Node absent (hook fails to launch — Claude Code
logs, session continues), no personal root, unreadable/missing transcript, malformed JSONL
lines (skipped individually), unwritable `brain/`. The script never throws to the session.

## Testing (TDD, zero-dependency)

`.claude/hooks/reflect-session.test.mjs`, run via `node --test` (no vitest, stays
userland-only):

- `extractUserTurns` keeps human text, skips sidechain + tool-result lines, handles both
  string and array content.
- `mineTranscript` extracts each target pattern; respects the per-session cap.
- `appendCandidates` writes the exact schema, dedups by `text`, and writes **only**
  `candidates.jsonl` (asserts no writes to `context/*` or `brain/memory.jsonl`).
- Domain defaults to `project` (`needsSanitization: true`) for ambiguous signal.

## Out of scope (YAGNI)

- Engine-installable variant for target projects.
- Semantic/LLM mining in the hook (kept cheap + deterministic; the agent-driven richer mine
  stays in `/level-up`).
- Auto-promotion or any write beyond the candidate queue.
```
