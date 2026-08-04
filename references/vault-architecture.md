---
type: reference
title: Vault Architecture — the four layers
updated: 2026-06-26
tags: [reference, framework]
---

# Vault Architecture — the four layers

The Cortex Vault stands on four layers. `/audit` scores each out of 25. Build them in order:
a later layer is hollow without the ones beneath it.

| # | Layer | One-liner | "This layer is real" test |
|---|---|---|---|
| 1 | **Capture** | Nothing is lost | A stray thought reliably ends up in `inbox/` or `daily/`, not forgotten |
| 2 | **Knowledge** | Ideas connect | `notes/` holds atomic, wikilinked notes; a topic with 7+ notes has a MOC |
| 3 | **Context** | The brain knows you | A fresh session answers "who is this, what do they do, what matters now" from `context/` |
| 4 | **Cadence** | It runs without asking | A ritual fires on schedule; the inbox gets emptied; a brief lands without you starting it |

---

## 1. Capture (foundation)
Lowest friction wins. `inbox/`, `daily/`, and `/capture`. If capture is hard, nothing else
matters because the raw material never arrives. **Build this first and keep it frictionless.**

## 2. Knowledge
Raw captures get processed into permanent, atomic, linked notes in `notes/`, indexed by Maps of
Content. This is where a *pile* becomes a *graph*. `projects/`, `areas/`, and `resources/` (the
PARA split) keep knowledge actionable: project = outcome + deadline, area = ongoing standard,
resource = reference material.

## 3. Context
`context/` + `connections.md`. Who you are, your business, your priorities, your [[voice]], and every
tool/data source the vault can reach. This is what lets the brain answer *as you* and pull *your*
live data instead of guessing. Filled by `/onboard`, grown by `/level-up`.

## 4. Cadence
The rituals and schedules that make the vault work while you don't: `/daily`, `/weekly-review`,
`/audit`, `/level-up`, and any scheduled briefings. Don't automate a cadence until the manual
version works — automating a broken process just breaks it faster. The always-on build-out — the
MCP brain plus server cron that runs these rituals while you're away — is wired in [[living-cortex]].

---

## Dependency order
**Capture is non-skippable.** Knowledge and Context can grow in parallel. Cadence comes last —
rituals are only worth scheduling once the layers beneath them hold real material.

> See [[operating-principles]] for the thinking that feeds these layers.
