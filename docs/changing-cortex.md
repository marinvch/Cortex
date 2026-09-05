# Changing Cortex itself

**Read this before editing anything in this repository.** It is the one file that applies no
matter which package you are in — `AGENTS.md` routes you to a leaf by directory, and these rules
sit above that routing.

It lives here rather than in `AGENTS.md` because it has a different reader. That file is the
operating manual for *using* Cortex — the rituals, the vault, the firewall — and most of the people
and agents reading it are not changing the product. Keeping sixty lines of contributor invariants
in front of them cost attention on every turn and pushed the root past its own size finding.

Every rule below has an ADR holding the argument and the rejected alternatives. Read the ADR
before overturning one; the line here is the trigger, not the case.

- **`/cortex-install` never modifies a target repo before the user chooses**, and is
  model-invocable anyway. What protects the repo is the **consent gate**, not an invocation flag:
  indexing and the findings report are read-only by construction, and `/cortex-scaffold` is the
  separate skill that applies changes. If you are editing source before the user picked something,
  you have left the skill. Do not add `disable-model-invocation` to it for consistency — that flag
  marks *once-only or destructive*, not *read-only*.
  [ADR 0005](adr/0005-the-install-sequence-may-start-itself.md).
- The rituals that **do** carry `disable-model-invocation: true` are once-only, destructive, or
  reached by name, so none may auto-fire. `grep -l '^disable-model-invocation: true' skills/*/SKILL.md`
  is the list of record; keep the flag when editing their frontmatter. Anchor the grep — the flag is
  discussed in prose too, and the unanchored version counts a skill that merely mentions it, which is
  how this line carried the wrong number from 2.14.0 until 2.36.0.
- **The findings report is `/cortex-install`'s script, so `analyse()`'s ranking is control flow.**
  The wizard walks `offers()` top-down, so re-ranking a finding changes the interview, not just a
  document. Offers collapse by action; severity never implies an offer. Read the worklist with
  `cortex-findings.mjs --offers`, which writes nothing.
  [ADR 0006](adr/0006-the-report-is-the-wizards-script.md).
- **A guarantee attaches to the act, not to the skill that performs it.** If a promise can be kept
  by code, put it in code — the `.gitignore` write for `.cortex/` happens in `index/lib/generated.mjs`
  at first creation, so no skill has to remember it. If it genuinely needs judgment, leave it in
  prose and **test that the prose is there**: `core/test/plugin.test.js` fails when a skill that can
  create `.cortex/` does not state the consent gate. Five entry points could perform that first write
  and one carried each promise, which is how a repo ended up with untracked artifacts created by a
  ritual that never asked. [ADR 0016](adr/0016-a-guarantee-belongs-to-the-act-not-to-the-skill.md).
- **Assert the property, not the symptom you thought of.** The read-only test for `--out` checked
  for a stray `.cortex/` directory, so when a change started editing the target's `.gitignore`
  instead, CI stayed green while the promise was broken. It fingerprints the whole tree now. A test
  naming one symptom passes for every other way of failing.
- **A destructive shell tool must route its target through `resolve_in_root` (`tools/_cortex-lib.sh`).**
  The shell counterpart of `core/paths.js`, in the shared lib so the next tool inherits it. Not a
  string-prefix check — a symlink out of the root passes any prefix comparison.
  [ADR 0010](adr/0010-the-shell-half-gets-the-guard-too.md).
- **Never hand-edit a version. Run `node tools/cortex-version.mjs --set <x.y.z>`.** `VERSION` is the
  interface; the seven sites holding a copy are implementation, and the writer and the drift check
  read one `SITES` list. The `## [x.y.z]` changelog entry is the one thing the tool will not write.
  [ADR 0013](adr/0013-the-version-has-one-home.md), and
  [ADR 0014](adr/0014-the-package-split-stays-rejected.md) before proposing a package split.
- **Every ritual declares a `capability:` floor — `mechanical` · `judgment` · `strong`.**
  `node tools/cortex-capability.mjs` prints the table from the frontmatter, so it cannot drift. The
  failure it prevents is not a crash: a weak model runs `/cortex-enrich`, writes plausible-but-wrong
  summaries, and those feed `recall` — a bad answer *every* time anyone searches. A ritual missing
  the key fails `core/test/plugin.test.js`, and every `strong` one must carry a
  `## When the floor is not met` section — a declared floor with no way under it is a wall.
- **`mode`, `audience` and `profile` are three questions, never two.** `mcp/lib/mode.js` answers
  repo-vs-vault, `mcp/lib/resolve.js` answers solo/team/server, `core/profile.js` answers
  home/work/lab. A work laptop can run a repo brain on a team. `core/profile.js` reads **only**
  `CORTEX_PROFILE` — nothing about the root, the connector or the cwd may move it, and a test
  asserts that. [ADR 0015](adr/0015-a-profile-is-the-world-an-install-serves.md),
  [ADR 0008](adr/0008-three-audiences-one-seam.md).
- **`lab` refusing nothing and publishing nothing is ONE decision, stored as one policy object.** A
  profile that refused nothing locally and still pushed would be a way to switch the firewall off
  and keep leaking. If you add a fourth profile, decide both halves together.
- **Skills are per-repo; rituals are per-machine — `/cortex-skills` writes the first kind.** What it
  writes is `.claude/skills/` in the *target*, committed with that code and chosen from
  `index.stack`. Add a new candidate as a declarative row with its own `when()` in
  `index/lib/skills.mjs`, so the next repo with that stack gets it too. The evidence sentence must
  name what was **detected**; a candidate that cannot cite the index does not belong in the list.
- **`/cortex-impact` reads the graph backwards** — who imports me, and is any of it tested — and
  every number it prints is a floor. Regex import resolution makes dynamic imports invisible, so the
  field is `atLeast`, never `total`. The actionable half is the *unverified* list, not the count.
  Coverage lives in `index/lib/coverage.mjs`, shared with `findings.mjs`; do not write a second copy
  of that heuristic. [ADR 0004](adr/0004-no-runtime-dependencies.md) rules out a parser.
- **`/cortex-review` is the only thing that reads the context layer back.** Everything else in
  Cortex writes documents — `AGENTS.md`, `CONTEXT.md`, ADRs — or audits them for bloat. This one
  judges a *change* against them, on two axes: does it break a documented rule, and did it just
  make one of those documents wrong. The second is the half no other review tool looks for, and
  the repo has shipped the failure twice: `index/AGENTS.md` said coverage used two signals while
  it used three, and the root pointed at `mcp/lib/scrub.js` months after scrub moved to `core/`.
  Neither broke a test. `index/lib/review.mjs` finds and cites; it never judges — a mention is
  where a defect would hide, not a defect. Keep it that way: the moment it starts concluding, it
  needs a model and stops being usable in CI.
- **`tools/test/install-on-a-project.test.sh` is the only test that asserts the *product* works.**
  Everything else points Cortex at fixtures shaped by whoever wrote the test. This one runs
  index → findings → `--offers` against a repo shaped like real product code, and asserts the target
  is left without a `.cortex/` — the consent promise made executable. Point it at a real project
  with `CORTEX_E2E_REPO=<path>`; that pass is read-only.
- **The shell half has behaviour tests — `bash tools/test/run.sh`.** `bash -n` and shellcheck never
  *run* a script, which is how four real bugs shipped in `tools/server/`. Tests build real git repos
  in temp dirs (a bare repo on disk is a complete remote, so no network), and every test touching
  `$HOME` must override it. Add a case when you touch anything under `tools/`.
- `.cortex/index/` and `.cortex/findings/` are generated and gitignored in a target repo.
  `.cortex/memory/` is **committed** — that is how several developers share one context. The
  asymmetry is deliberate, and it makes the privacy rule a hard requirement: `core/scrub.js`
  refuses any memory write carrying a credential, and never sanitises silently.
  [ADR 0002](adr/0002-committed-repo-memory.md) — the gate is mandatory *because* the store is
  committed; the two cannot be reasoned about apart.

- **A ritual must be reachable from another ritual, or say what reaches it.**
  `node tools/cortex-skill-graph.mjs --check` fails when one is isolated in both directions, and
  `tools/test/skill-graph.test.sh` runs it. **A pass is weaker than this rule** — one outbound edge
  clears the check, so it cannot see a front door that has been stripped, only total disconnection
  ([`tools/AGENTS.md`](../tools/AGENTS.md)). Read the inbound edges; do not infer them from green.
  The failure has no error state: a ritual nothing points at
  still runs when you type its name, so only a user who already knows it exists ever gets there.
  `/wizard` and `/team-add` each sat that way — `/team-init` created a team-brain and never named the
  command a member runs to join it. A ritual genuinely triggered from outside (a hook, a git state)
  declares `reached-by: <what triggers it>` in its frontmatter; the hatch has to name the trigger,
  because a bare `true` is the check switched off wearing the check's clothes.
- **Before a ritual writes, it asks `tools/cortex-preflight.mjs` rather than re-deriving the answer.**
  Root, profile and index freshness are the three facts every ritual needs first, and each prose copy
  of them is a copy that drifts — the mode/audience bullet in `AGENTS.md` still said *two questions*
  long after `profile` made it three. The profile half comes from `core/profile.js` and is not
  reimplemented anywhere, in bash or otherwise.

## The rules that are not here

Two neighbours own material this file deliberately does not duplicate:

- **Per-package invariants** live in the leaf — [`core/AGENTS.md`](../core/AGENTS.md),
  [`index/AGENTS.md`](../index/AGENTS.md), [`mcp/AGENTS.md`](../mcp/AGENTS.md). The Vault door, the
  two server modes, determinism, regex import resolution and the coverage signals are all there.
- **Decisions with their rejected alternatives** live in [`docs/adr/`](adr/). When a line above and
  an ADR disagree, the ADR wins and the line is stale — fix it.

`tools/test/changing-cortex.test.sh` asserts this file stays reachable from `AGENTS.md` and keeps
covering each invariant that used to live there. A pointer nobody follows is the failure mode this
whole split risks, so it is checked rather than trusted.
