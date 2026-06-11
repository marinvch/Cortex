# Design: Cortex — restructure ai-os for wide adoption (the AIS-OS lesson)

**Date:** 2026-06-11
**Status:** Draft for review
**Branch:** TBD (follow-on to `feat/personal-brain-extension` / PR #266)
**Predecessor:** `docs/superpowers/specs/2026-06-10-personal-ai-os-fusion-design.md` (the Cortex fusion, now shipped)

---

## Context

This design follows a deep, ground-truth audit of **`nateherkai/AIS-OS`** (760★, single commit, MIT)
against the current **ai-os/Cortex** codebase, and a structured interview locking the strategic
direction. The goal: **rethink and restructure ai-os so it can be widely adopted "everywhere"** —
the way AIS-OS spread — *without* surrendering ai-os's engineering moat.

### The audit, in one line
> *AIS-OS is a great userland with no kernel; ai-os is a great kernel with no userland.* They are
> mirror opposites.

**What AIS-OS does that drives adoption (almost none of it is code):**
1. **Distribution** — repo-as-course-artifact → a 375K-member community + a 2-hour masterclass →
   760★ off a *single commit*. (This is its #1 driver and cannot be copied by restructuring a repo.)
2. **Memorable vocabulary as the spine** — *Three Ms* (how you think) + *Four Cs* (what you build) +
   *Cadence*, *EAD / "Eliminate first"*, *L0–L4*, *"Boring is beautiful."* Sticky, quotable, teachable.
   **The vocabulary is the moat.**
3. **Gamified scored progress** — `/audit` yields a 0–100 score, a named stage ladder
   (Foundation→Built→Compounding→Autonomous), leverage multipliers, and a single "do this next."
4. **Onboarding craft** — *"7 questions, no Q8,"* 60-seconds-each framing, one-shot idempotent
   scaffold, *paste your voice raw*, suggest the first query.
5. **Anti-sprawl governance** — `EXPANSIONS.md` gates folder growth behind a rule + anti-pattern list.

**What AIS-OS structurally *cannot* do (ai-os already does):** self-maintain (it's static Markdown,
one commit); a *real* audit (theirs is Claude eyeballing a prose rubric — ai-os has a 45-tool MCP
engine, 680 tests, a real memory engine, drift/freshness detection); touch code at all; enforce a
data boundary (`context/` isn't even gitignored in AIS-OS).

**The strategic insight:** everything transplantable from AIS-OS is **userland + go-to-market craft**.
ai-os's reach is therefore a **packaging, positioning, vocabulary, and audience** problem — *not* an
engineering one. And on the one axis where AIS-OS has a headline feature (the scored audit), ai-os can
*beat* it outright by making the score **engine-measured instead of LLM-guessed.**

---

## Decisions locked during the interview

1. **Audience: agnostic / progressive.** Both a non-developer path and a developer path are
   first-class. Widest reach; hardest to message.
2. **Borrow all four craft levers:** gamified scored audit + stage ladder; a memorable framework;
   hard-capped onboarding craft; `EXPANSIONS.md`-style governance.
3. **Distribution: content + community** (the AIS-OS playbook). The repo is the CTA/teaching artifact;
   the restructure must serve a **demoable 60-second "wow"** and a teachable narrative.
4. **Positioning: engine-first credibility, reconciled to an *outcome-led* hero.** Lead with the
   result ("an AI OS that stays *alive*"), use the engine as *proof*, signpost two doors
   ("I have code" / "I don't"). This resolves the engine-first × audience-agnostic tension.
5. **Framework: a fresh, ai-os-native, two-layer spine** (chosen over deepening Alive·Bounded·Sovereign):
   - **How you operate — The Living Loop:** `Seed → Use → Promote → Audit → (loop)`.
     Maxim: *"It compounds because it loops."*
   - **What it measures — The Five Vital Signs:** `Context · Memory · Freshness · Boundary · Autonomy`,
     each **engine-computed**.
   - **Maturity ladder (shared):** `Dormant → Seeded → Living → Compounding → Autonomous`.
6. **`/audit` becomes an engine-measured 0–100 maturity score** across the Five Vital Signs + ladder +
   leverage-ranked "do this next."
7. **"Everywhere" = all four surfaces:** multi-tool (≈done via canonical `AGENTS.md` + shims),
   **multi-domain** (a "project" can be code *or* a life/work domain), **multi-device** (optional
   remote-brain server), and **non-dev adoptable** (the pure-Markdown path is genuinely complete alone).

> Note on relationship to `Alive·Bounded·Sovereign`: ABS (from the fusion spec) was 3 adjectives.
> The fresh framework supersedes it as the *teaching spine*. ABS may survive as a one-line
> sub-tagline, but the Living Loop + Five Vital Signs is the vocabulary going forward. **Confirm in review.**

---

## The framework, fully specified

### The Living Loop (how you operate)
A repeating operating cycle every user follows — the same four verbs are the rituals:

| Phase | Ritual | What happens |
|---|---|---|
| **Seed** | `/onboard` | Capture who you are / how you work / current focus (and, for devs, init code projects). |
| **Use** | (day-to-day) | You work with the OS; it accumulates raw signal + ambient-capture candidates. |
| **Promote** | `/level-up` | Confirm candidates; sanitized `project → personal` promotion; evolve the manual. |
| **Audit** | `/audit` | Engine measures the Five Vital Signs → score → "do this next" → back to Use/Seed. |

Maxim: *"It compounds because it loops."* (Directly maps to the three existing ritual skills — no new rituals needed; they are re-narrated as the loop.)

### The Five Vital Signs (what it measures — and how the engine computes each)

| Vital Sign | Question | Engine signal (real, not guessed) |
|---|---|---|
| **Context** | Does it know you / the work? | presence + freshness of `context/*`; per-project config/stack detection |
| **Memory** | Does it remember? | `brain/memory.jsonl` entry count, stale ratio, dedup health, promotion audit log |
| **Freshness** | Is it current? | existing freshness/drift detectors: snapshot age, changed-source-files, drift status |
| **Boundary** | Does data stay where it should? | `--check-boundaries`: cross-domain leaks, required `.gitignore` rules |
| **Autonomy** | Does it run without you? | scheduled rituals / hooks / server presence (the weakest layer today — honest scoring) |

Each scores 0–20 → summed to **0–100** → mapped to the ladder
(`0–19 Dormant · 20–49 Seeded · 50–74 Living · 75–89 Compounding · 90–100 Autonomous`),
with **leverage multipliers** (e.g. *0 Context = "amnesiac" 4×; all-stale = 3×; 0 Autonomy = "still
manual" 2×*) ranking the single highest-leverage "do this next."

> This is the headline differentiator vs AIS-OS: **the same five words are both the teachable
> framework and the literally-computed scorecard.** Framework and `/audit` are one artifact.

---

## The restructure (what changes, by area)

### 1. Front door & positioning (SHARED userland)
- Rewrite root `README.md` to the **outcome-led hero**: *"Cortex — an AI OS that stays alive."*
  Sub: *"Most AI setups are dead folders of notes. This one re-scans, remembers, and keeps itself
  current."* Two clearly-signposted doors: **I have code →** (engine path) / **I don't →** (Markdown path).
- Engine appears as **proof of "alive"** ("a real scanner, a real memory engine, drift detection —
  not a static kit"), not as the lead.
- `references/` gains `living-loop.md` + `five-vital-signs.md` (the teaching spine); `quick-reference.md`
  updates to the new vocabulary. `AGENTS.md` references the new framework.

### 2. `/audit` → engine-measured maturity score (ENGINE + skill)
- **New engine action `--score` (or `--vital-signs --json`)** that computes the five axes from existing
  detectors (freshness/drift, memory stats, boundaries, context presence, autonomy signals), returns a
  0–100 score, the stage, per-axis breakdown, leverage-ranked gaps, and one "do next."
- The `/audit` skill calls it (gated on Node) and renders the scoreboard; **graceful Markdown-only
  fallback** computes a coarse score from file presence when the engine is absent (so non-devs still get
  a score — honestly labeled "estimated").
- Reuses Phase-3/4 work: `check-boundaries`, freshness/drift detectors, memory stats.

### 3. `/onboard` → hard-capped, two-path, idempotent (SHARED skill)
- **Hard-capped question set** (e.g. "6 questions, no 7th"), 60-seconds-each framing.
- **Two paths from one question** ("Do you have code projects? y/n"): dev path runs `npx ai-os --init`
  per project (engine lights up); non-dev path stays pure Markdown and is *complete on its own*.
- **Idempotent** (skip answered), **one-shot scaffold** with backups to an `archives/`-style location,
  **suggest the first query** at the end ("ask me: what should I focus on this week?").
- Borrow AIS-OS's *paste-raw* capture for any "voice/style" input.

### 4. Governance (SHARED)
- Add `EXPANSIONS.md` at root: a rule gating folder growth (e.g. *add a folder only if ≥2 of:
  conceptually distinct / used 3+×/month / a future skill needs it*) + an anti-pattern list
  (no `notes/`, no `tmp/`, one canonical `AGENTS.md`, etc.).

### 5. "Everywhere" — the four surfaces
- **Multi-tool** (≈done): canonical `AGENTS.md` + `CLAUDE.md`/`GEMINI.md` shims already exist; verify
  Codex/Copilot/Cursor coverage and document it.
- **Multi-domain (NEW, significant):** de-couple "project" from "code repo." A `projects/<name>` may be a
  **life/work domain** (no code). Engine changes: the `node`/code-presence gating must degrade to a
  *domain* mode (context + memory + boundary still apply; freshness/drift/scan are code-only and simply
  don't contribute to the score for non-code domains — scored fairly). The `/onboard` non-dev path seeds
  domains; `/audit` scores them on the applicable Vital Signs.
- **Multi-device / server (NEW track, previously deferred):** the optional remote-brain server (Level 1
  from the fusion spec) — the existing zero-dep `engine/bundle/server.js` MCP server hosting `brain/` +
  `context/` server-side, reachable over MCP remote transport. **Hard requirements:** auth + TLS,
  project/company instances stay off the shared server (or encrypted-at-rest), budget controls. Treated
  as its own late phase; does not block the userland restructure.
- **Non-dev adoptable:** audit the Markdown path end-to-end so it delivers real value with **zero Node** —
  `/onboard`, `/audit` (estimated score), `/level-up` (manual promotion) all degrade gracefully.

### 6. Distribution enablement (content + community)
- The restructure must produce a **60-second demoable "wow"** — likely the `/audit` scoreboard
  (visual, gamified, instantly legible) and the "it remembered / it stayed current" moment.
- Deliverables that serve teaching (not code): a crisp README hero, a scripted demo path, screenshots,
  and the framework one-pager (`living-loop.md` / `five-vital-signs.md`) usable as course material.
- A licensing/branding check (Cortex vs ai-os naming, MIT clarity) before any public push.

---

## Implied engine changes (summary)
- **New:** `--score`/`--vital-signs` action computing the 0–100 maturity score from existing detectors
  + leverage ranking + ladder mapping; JSON output for the skill.
- **Modified:** domain-mode handling so non-code `projects/<name>` are first-class (code-only signals
  excluded from their score rather than failing).
- **Reused:** `check-boundaries`, freshness/drift, memory stats, `promote_to_brain`, ambient capture —
  all already shipped in the fusion; the score *composes* them.
- **Later track:** authenticated remote-brain MCP server (deployment Level 1).

---

## Phasing (proposal — refine in planning)
- **Phase A — Framework & front door (SHARED, no engine):** `living-loop.md`, `five-vital-signs.md`,
  rewritten README hero + two doors, `EXPANSIONS.md`, updated `AGENTS.md`/`quick-reference.md`.
- **Phase B — Engine maturity score:** `--vital-signs --json` action + tests; reuse existing detectors.
- **Phase C — `/audit` rebuild:** skill renders the engine score; Markdown-only estimated fallback.
- **Phase D — `/onboard` rebuild:** hard-capped, two-path, idempotent, suggest-first-query.
- **Phase E — Multi-domain:** de-couple project-from-code in engine + userland; non-code domain scoring.
- **Phase F — Non-dev completeness pass:** verify the zero-Node path end-to-end.
- **Phase G — Distribution kit:** demo script, screenshots, framework one-pager, README polish, licensing.
- **Phase H (later track) — Remote-brain server:** auth + TLS + budget controls.

---

## Risks & open questions
1. **Audience-agnostic is the hardest message.** Two doors mitigate it, but the hero must land for a
   non-dev without lying to a dev. The outcome-led framing is the bet — validate with real readers.
2. **Distribution is not a code task.** The restructure *enables* the AIS-OS playbook but cannot
   manufacture a 375K community. Set expectations: the repo gets adoption-*ready*; growth is content/effort.
3. **Multi-domain dilutes the moat.** Going beyond code competes more directly with AIS-OS on its turf
   (where it has the community). Keep the *code-aware* superpower prominent so the dev wedge stays sharp.
4. **Server track raises the security bar** (auth/TLS/IP boundary) — keep it optional and late.
5. **Framework naming** — "Living Loop" / "Five Vital Signs" / ladder names are proposals; confirm, and
   decide ABS's fate (sub-tagline vs retired).
6. **Branding** — Cortex vs ai-os, and MIT clarity, before any public/community push.
7. **Scope realism** — Phases A–D are tractable now; E (multi-domain) and H (server) are large. Consider
   shipping A–D as "Cortex v1.1 (adoption-ready)" and treating E+H as a separate track.

---

## Open decisions to confirm before planning
- Framework names final? (Living Loop · Five Vital Signs · Dormant→…→Autonomous)
- Fate of `Alive·Bounded·Sovereign` (sub-tagline vs retired)?
- Exact onboarding question count + the two-path split wording.
- Score axis weights (equal 20 each?) and the leverage-multiplier list.
- Ship A–D first as "adoption-ready," or commit to A–H as one program?
- Product name (Cortex vs ai-os) for the public front door.
