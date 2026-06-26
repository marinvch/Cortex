---
name: onboard
description: One-time setup for the Cortex Vault. Interview the user, fill the context/ files, seed home.md, and populate connections.md. Use the first time the vault is set up, or when someone says "set me up", "onboard me", "fill in my brain". Plain files only — no engine, no Node.
---

# /onboard — teach the brain who you are

Warm, brief, one question at a time. Write ONLY to the personal layer (`context/`, `home.md`,
`connections.md`). These are gitignored — tell the user their answers are private and not committed.

## Steps

1. **Identity** → `context/about-me.md`. Who they are, role, what they're good at, the task that
   eats their week, how they learn.
2. **Business / professional context** → `context/about-business.md`. What they do/sell, who they
   serve, where revenue lands. (If no business, capture their main work context instead.)
3. **Priorities** → `context/priorities.md`. The 2-3 things that would make this quarter a waste
   if undone. Push for a number, deadline, or deliverable — refuse vague "grow my business".
4. **How they work** → `context/how-i-work.md`. Communication style, tools, when they work best,
   what the brain should never do.
5. **Values** → `context/values.md`. What they optimize for, non-negotiables.
6. **Voice** → `references/voice.md`. Ask them to **paste** 1-2 real things they wrote (email,
   post, message), unedited. If they type something fresh mid-chat, refuse: *"paste it raw from
   real writing — typed-here samples are contaminated by our conversation."*
7. **Connections** → `connections.md`. From their answers, fill the table: calendar, email,
   tasks, files, meeting notes, money. Mark each `not connected` until actually wired.
8. **Seed `home.md`** → fill the "Who this brain serves" links and confirm they resolve.
9. **Stamp** `context/current-focus.md` with today's date and their #1 priority for the week.

## Close (3 lines max)

```
✓ Your brain knows who you are, what matters this quarter, and how you sound.
Today: ask me — "what should I focus on this week?"
Then: /daily each morning, /weekly-review on Fridays, /audit weekly.
```

When they ask the focus question, answer using ONLY the new context files: 3 bullets in their
voice, each tied to a stated priority, ending with the one thing to do first and why.

## Rules
- Idempotent — re-run any time. If a `context/*` file already has real content, ask before
  overwriting; back up the old one to `archives/onboard-{date}/`.
- One-shot scaffold after the interview — write all files in a batch, don't ping-pong.
- Never invent facts. Only write what the user actually said.
