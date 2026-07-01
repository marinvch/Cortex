---
name: self-audit
description: Use when the user says "self audit", "audit your skills", "improve Cortex", "improve yourself", "what ritual is missing", "is the OS healthy", "make yourself better", or periodically to keep the operating system sharp. Looks inward at Cortex's own skills/rituals/wiring — not the knowledge content — and ships one improvement.
---

# /self-audit — audit the operating system and improve it

Cortex looking **inward at itself**: the `skills/`, the `AGENTS.md` rituals, `connections.md`, and
how they're wired — then shipping **one** concrete improvement. One run = one improvement.

> Not to be confused with `/audit`, which scores the four **knowledge** layers (Capture, Knowledge,
> Context, Cadence) of your *content*. `/self-audit` scores the **system** that operates on that content.

## What to check (score each 🟢/🟡/🔴, one line of evidence)

1. **Coverage** — is there a recurring task or pain (visible in recent `daily/`, `inbox/`,
   `context/current-focus`) that has **no ritual**? Gaps are the highest-leverage finds.
2. **Quality** — any skill whose `description:` summarizes its workflow (a discovery bug), reads
   vaguely, is stale, or **duplicates** another skill's job?
3. **Wiring** — is every `skills/<name>/` listed in `AGENTS.md` **and** the README table **and**
   copied into `.claude/skills/`? Any dead `[[links]]` or broken references?
4. **Fit** — do the rituals still match how the user actually works today, or have they drifted?

## What to do

1. **Read** `skills/` (names + descriptions), `AGENTS.md` rituals, the README table, and skim recent
   `daily/`/`inbox/`/`context/current-focus.md` for real signal. Read-only so far.
2. **Score** the four dimensions above with one line of evidence each.
3. **Pick the single highest-leverage weakness** — the one fix that most improves the OS. Don't try
   to fix everything.
4. **Propose it** in one or two sentences, then on the user's go-ahead **ship it**:
   - Missing/weak skill → drive **[[skill-creator]]** to add or patch the `SKILL.md`.
   - Broken wiring → add the missing `AGENTS.md` bullet / README row / `.claude/skills/` copy.
5. **Report** in a few lines: the four scores, the one gap you closed, and the artifact you shipped.

## Don't
- Don't boil the ocean — **one** improvement per run; log the rest for next time.
- Don't touch the knowledge layers or personal content — that's `/audit` and `/weekly-review`.
- Read first; make changes only with a green light. Keep committed skills data-free.

Pairs with [[skill-creator]] (to ship skill improvements), complements `/audit` (content health) and
`/level-up` (Notice → Decide → Build leverage).
