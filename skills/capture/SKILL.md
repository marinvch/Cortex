---
name: capture
description: Drop a thought into the vault in one step with zero friction. Use when the user says "capture this", "note this down", "remember that", "add to inbox", or pastes a stray idea/link they want to keep. Speed over structure — file it, don't organize it.
---

# /capture — frictionless capture

The whole point is speed. Don't ask clarifying questions. File it and confirm in one line.

## What to do
1. Take whatever the user gives (a thought, link, quote, task).
2. Append it as a timestamped bullet to **today's daily note** (`daily/YYYY-MM-DD.md`, under
   `## 💡 Captured`) if it exists; otherwise create `inbox/<slug>.md` with a one-line frontmatter
   (`type: capture`, `created: <date>`).
3. If it's clearly a task, prefix `- [ ]`. If it's a link, keep the URL.
4. Reply with one line: *"Captured → daily note"* or *"Captured → inbox/<file>"*. Nothing more.

## The one hard stop — the employer firewall
Before writing, check the content against the firewall in `AGENTS.md`. If this is a **personal**
vault and the capture is day-job material — employer/client name, a work ticket or feature, a
colleague, internal architecture, work code — **do not write it**. Reply in one line:

> *"Not captured — that's day-job content and this is the personal vault. It belongs in your work
> vault, or in that repo's own `AGENTS.md`."*

Do not sanitize it and file it anyway. Speed never overrides the firewall.

## Don't
- Don't rewrite it into a polished note (that's `/weekly-review`'s job).
- Don't ask which folder — capture goes to inbox/daily, always.
- Don't lose anything. If unsure where, default to `inbox/`.
