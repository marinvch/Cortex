# Cortex Vault — Audit & Re-Architecture Plan

> Turning this folder into an **Obsidian-style second brain + AI operating system**: a plain-markdown
> knowledge vault you own, with the AIS-OS "layers of knowledge" (the Three Ms operator brain, the
> Four Cs architecture, and the onboard / audit / level-up rituals) layered on top.
> Free. No build step. No app required. Readable by Claude and any text editor.

---

## Part 1 — Audit of the current setup

### What was here

The folder was **not** a blank starter — it was already a fairly advanced AIOS called **Cortex**:

| Layer | What existed | State |
|---|---|---|
| Operating manual | `AGENTS.md` (canonical) + `CLAUDE.md`/`GEMINI.md` shims | Good, but engine-coupled |
| Code engine | `engine/` — a TypeScript npm package + `node_modules` | Heavy; requires Node; not needed for a second brain |
| Data boundary | `shared` / `personal` / `project` three-domain model | Strong idea, over-engineered for personal PKM |
| Skills | `.claude/skills/{onboard,audit,level-up}` | Present, but written around the engine + boundary gates |
| Personal layer | `context/`, `brain/`, `decisions/` | **Empty — never onboarded** (gitignored) |
| Project memory | `.github/cortex/memory/` | Engine scaffolding |

### Scored against the Four Cs (the AIS-OS audit framework)

| C | Score | Why |
|---|---|---|
| **Context** — knows you & your business | **3 / 25** | `context/` is empty. The manual is about the *system*, not about *you*. A fresh session can't answer "who is this and what do they do." |
| **Connections** — reaches your stuff | **2 / 25** | No tools wired. No `connections.md` registry. Zero of the 7 data domains reachable. |
| **Capabilities** — knows how to do work | **12 / 25** | Three skills exist, but they're coupled to the engine and the boundary model, not to knowledge work. No note-taking / capture capability. |
| **Cadence** — runs without being asked | **4 / 25** | A session-reflect hook exists, but no daily/weekly ritual, no scheduled briefings, no recurring surface. |
| **Total** | **~21 / 100** | **Stage 0 — Foundation.** A powerful chassis with no driver, no fuel, and the wrong body for the job. |

### The core findings

1. **It was built for a different job.** Cortex optimizes for giving *codebases* an AI brain (the engine scans repos). You want a *second brain for yourself* — notes, ideas, knowledge, plus a business operating layer. Different goal.
2. **The engine is dead weight here.** A Node/TypeScript package with `node_modules` adds install friction, a build step, and a Node dependency — the opposite of "free, plain files." For a personal markdown vault it earns nothing.
3. **The three-domain boundary is overkill.** `shared`/`personal`/`project` with a sanitized promotion gate is elegant for multi-tenant company data, but it's friction for a personal vault. We keep one simple rule instead (see plan).
4. **The good bones are worth keeping.** The cross-tool manual pattern (`AGENTS.md` + shims), the three rituals as *concepts*, and "plain files, you own them, MIT" all survive — they just get re-pointed at knowledge work.
5. **It was never actually used.** The personal layer is empty. Nothing of yours is lost by restructuring.

---

## Part 2 — The target architecture

A vault with **two intertwined systems** sharing one folder:

```
KNOWLEDGE LAYER (Obsidian-style PKM)        OPERATING LAYER (AIS-OS)
inbox → daily → notes → MOCs                context · connections · decisions
projects · areas · resources                references (frameworks) · skills (rituals)
```

### Design principles (borrowed from both worlds)

- **Obsidian-first, app-optional.** Plain `.md`, `[[wikilinks]]`, `#tags`, YAML frontmatter, daily notes, Maps of Content. Works in Obsidian if you ever install it; works in any editor and with Claude today.
- **PARA + Zettelkasten.** `projects / areas / resources / archives` for actionability; `notes/` for atomic, linked, permanent knowledge.
- **Boring is beautiful.** No engine, no build, no Node. One rule for privacy, not three domains.
- **The layers of knowledge stay.** The Three Ms (how you think about AI work) and the Four Cs (what you build) ship as reference frameworks; the three rituals drive the compounding loop.
- **Both personal & business.** `context/about-me.md` + `context/about-business.md`; `areas/` and `projects/` each hold personal and business items side by side.

### Target folder map

```
ai-os/  (the vault)
├─ README.md                 ← what this is + how to use it (rewritten)
├─ home.md                   ← MOC home / dashboard — your entry point every day
├─ AGENTS.md                 ← the operating manual (rewritten, engine-free)
├─ CLAUDE.md / GEMINI.md     ← thin shims importing AGENTS.md
├─ connections.md            ← registry of every tool the vault can reach (Four Cs)
│
│  ── KNOWLEDGE LAYER ──
├─ inbox/                    ← capture zone. Everything lands here first.
├─ daily/                    ← daily notes (YYYY-MM-DD.md). Your log + journal.
├─ notes/                    ← permanent atomic notes, densely [[wikilinked]]
├─ projects/                 ← active workstreams w/ an outcome + deadline (personal + business)
├─ areas/                    ← ongoing responsibilities (health, finances, a client, content)
├─ resources/                ← topic reference material you collect
│
│  ── OPERATING LAYER ──
├─ context/                  ← about-me, about-business, priorities, how-i-work, values, current-focus
├─ decisions/                ← log.md — append-only "what I decided and why"
├─ references/               ← 3ms-framework, 4cs-framework, voice, (legacy alive-os kept)
├─ templates/                ← daily, note, project, area, meeting, decision, MOC templates
├─ archives/                 ← old/inactive stuff. Don't delete — move here.
└─ .claude/skills/           ← the rituals (rewritten engine-free) + new capture/daily/review
```

### The one privacy rule (replaces the three-domain boundary)

> **Anything personal or business-sensitive lives in gitignored folders** (`context/`, `daily/`,
> `notes/`, `projects/`, `areas/`, `decisions/`, `inbox/`). The committed template files
> (`README`, `AGENTS.md`, `references/` frameworks, `templates/`, empty folder placeholders) stay
> **data-free** so the vault is still shareable/forkable. That's it — one rule, not a gated pipeline.

### The skills (rituals) — rewritten free, vault-aware

| Skill | Job | Cadence |
|---|---|---|
| `/onboard` | Interview you → fill `context/`, seed `home.md`, populate `connections.md`. No engine, no Node. | Once |
| `/capture` | Drop a thought into `inbox/` (or today's daily note) in one line. | Anytime |
| `/daily` | Open/append today's daily note from the template; pull priorities + due items. | Each day |
| `/audit` | Four-Cs health report on the vault (now scoring notes, links, freshness, cadence). | Weekly |
| `/level-up` | Three Ms interview → find one automation or knowledge gap → ship one artifact. | Biweekly |
| `/weekly-review` | Process `inbox/`, update `projects/`, restamp `current-focus`, archive stale. | Weekly |

### What happens to the old Cortex pieces

- `engine/` + `node_modules` → **deprecated, not deleted.** Left in place but removed from the core path and documented as optional/legacy. (Couldn't be bulk-moved this session because the sandbox shell is offline; flagged for a one-line cleanup later.)
- Three-domain boundary language → **replaced** by the one privacy rule.
- `references/alive-os-framework.md` (if present) → **kept** in references as background; superseded by the 3Ms + 4Cs as the active frameworks.

---

## Part 3 — Build order

1. **Knowledge-layer scaffold** — create the vault folders, `home.md` dashboard, templates, and one example note per type so the structure is self-documenting.
2. **AIOS knowledge layers** — write `references/3ms-framework.md`, `references/4cs-framework.md`, `connections.md`, `decisions/log.md`, and the `context/` scaffolding.
3. **Manual + skills** — rewrite `AGENTS.md` and the six skills to be engine-free and vault-aware.
4. **Verify** — wikilinks resolve, folder set is coherent, no Node dependency in the core path, README accurate.

> After build: run `/onboard` in a Claude Code / Cowork session pointed at this folder to fill your
> personal layer. Then `/daily` each morning, `/audit` weekly, `/level-up` biweekly.

*Frameworks adapted from The Three Ms of AI™ and The Four Cs of an AIOS™ © 2026 Nate Herk (MIT, attributed).*
