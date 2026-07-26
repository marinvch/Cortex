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
