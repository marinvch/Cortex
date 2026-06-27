---
name: scan-projects
description: Sync the personal vault with the code repos on your machine — list which have a cortex "codebase brain", which are registered in projects/, and offer to register the rest (metadata only). Trigger on "scan my projects", "which repos have a brain", "sync my projects to the vault". Read-mostly; only writes opt-in metadata stubs.
---

# /scan-projects — bridge repos ↔ vault (metadata only)

Keeps the vault aware of which projects exist **without absorbing any code**. Honors the privacy
firewall: a project file holds name / path / URL / stack / date only — never code, secrets, or
client data. This is the vault-side companion to the per-repo brain installed by `/install-project`
(and by `cortex-init --register-to-vault`). See [[connections]].

## Step 1 — Find the code root
Ask for (or confirm) the folder that holds the user's repos (e.g. `D:\Projects`, `~/code`). If
they've run this before, reuse the last root noted in `connections.md`.

## Step 2 — Walk it (read-only)
For each immediate subdirectory that is a git repo (`.git/` present), gather:
- **name** — folder name, or `package.json` `"name"` if present.
- **local path** and **remote URL** (`git -C <dir> remote get-url origin`).
- **Has a brain?** — `AGENTS.md` or `.claude/skills/plan-feature/` exists.
- **Registered?** — a file already exists at `projects/<slug>.md` in the vault.
- **stack** — framework + language guessed from `package.json`.

Never open source files. Folder listing + `package.json` + git metadata only.

## Step 3 — Report the matrix
```
Repo                 Brain   Registered
my-app               ✅      ✅
client-api           ✅      ❌  ← can register
old-script           ❌      ❌  ← no brain (run /install-project there)
```
End with a summary: `N repos · M with brains · K registered`.

## Step 4 — Offer to sync (opt-in, metadata only)
For repos that have a brain but are **not** registered, offer to write a stub to
`projects/<slug>.md`. Ask before writing. Use exactly this shape (same as
`cortex-init --register-to-vault`, so the two stay consistent):
```markdown
---
type: project
title: <name>
status: active
domain: business
created: <today>
tags: [project, codebase]
---
# <name>
- **Local path:** `<path>`
- **Repo:** <url>
- **Stack:** <framework · language · pkg-mgr>
- **Brain installed:** <date>

## Outcome
<one line>
```
No code. No secrets. No client data.

## Step 5 — Flip the connection
Once ≥1 project is registered, set the **Tasks / projects** row in `connections.md` to
`Codebase brains` / `local files` / `✅ live` with today's date. Suggest re-running `/scan-projects`
after installing new brains.

## Rules
- Read-only **except** the opt-in `projects/*.md` stubs and the one `connections.md` row.
- Metadata only — the firewall stays intact; company code never enters the vault.
- A repo with no brain → suggest running `/install-project` (or `npx github:marinvch/ai-os`) there.
- One repo = one stub. Re-running refreshes the metadata (path/stack/date), never deletes notes.
