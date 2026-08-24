import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { briefCandidates } from "./layers.mjs";
import { scan } from "../../core/scrub.js";
import { buildCoverage, testStem } from "./coverage.mjs";
import { UNRESOLVED_LANGUAGES } from "./imports.mjs";
import { findOrphans } from "./orphans.mjs";

// Findings are PROPOSALS. Nothing here edits a repository — this module returns data and the
// caller writes exactly one report file. The skill that finds things and the skill that changes
// things are deliberately different skills, so "the user decides" is structural rather than a
// promise the model has to keep.

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// The actions a finding is allowed to propose. Deliberately closed: an offer names a ritual Cortex
// already ships, so the wizard can walk the ranked report and ask about each in turn. A finding
// Cortex cannot act on carries no offer and is reported as context — inventing one to fill the
// column would ask a question the index never earned.
const ACTIONS = new Set(["scaffold", "brief", "enrich", "bundle", "triage-secrets", "memory"]);

// Below this, enrichment is a token bill for a summary of code a person could just read. Stated as
// a named constant because it is a judgement call, not a fact — the number is meant to be argued
// with rather than discovered in a conditional.
const ENRICH_WORTH_IT = 50;

function offer(action, targets = []) {
  if (!ACTIONS.has(action)) throw new Error(`unknown offer action: ${action}`);
  return { action, targets };
}

function finding(severity, kind, title, detail, evidence = [], proposes = null) {
  return { severity, kind, title, detail, evidence, offer: proposes };
}

/** What this finding proposes, or null when it proposes nothing. */
export function offerOf(f) {
  return f.offer ?? null;
}

/**
 * The ranked worklist the install wizard walks: one entry per action, most severe first.
 *
 * Collapsing is the point. A repo with thirty findings must not become a thirty-question
 * interview — five areas that each want a brief are one decision naming five candidates. An entry
 * inherits the severity of its highest-ranked member, so merging can never bury a critical finding
 * behind a low one, and carries the titles that produced it so the wizard can say why it is asking.
 */
export function offers(findings) {
  const byAction = new Map();
  for (const f of findings) {
    const o = offerOf(f);
    if (!o) continue;
    if (!byAction.has(o.action)) {
      byAction.set(o.action, { action: o.action, severity: f.severity, targets: [], findings: [] });
    }
    const entry = byAction.get(o.action);
    if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[entry.severity]) entry.severity = f.severity;
    for (const t of o.targets) if (!entry.targets.includes(t)) entry.targets.push(t);
    entry.findings.push(f.title);
  }
  return [...byAction.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.action.localeCompare(b.action),
  );
}

/** Languages present in this repo whose imports Cortex extracts but cannot resolve. */
function blindLanguages(index) {
  const out = new Set();
  for (const f of index.files) if (f.category === "code" && UNRESOLVED_LANGUAGES.has(f.lang)) out.add(f.lang);
  return [...out].sort();
}

/**
 * The bare module name a test file is testing, e.g. `mcp/test/paths.test.js` → `paths`.
 * Tests routinely live in a sibling directory rather than beside the code, so matching on the
 * containing directory reports false positives on the ordinary src/ + test/ layout.
 */
export { testStem };

/** Production modules that no test covers, grouped by directory. */
function untestedAreas(index, root) {
  // Three signals, because each alone misreports. Naming catches `paths.js` ← `paths.test.js` even
  // when they sit in different directories; imports catch a module exercised by a test named after
  // something else, which is how most integration tests are organised; mentions catch a CLI run as
  // a subprocess, which neither of the others can see.
  // Three signals, each alone misreporting — see index/lib/coverage.mjs, which owns this because
  // impact.mjs needs the same answer and a second copy would drift.
  const coverage = buildCoverage(index, root);

  const byDir = new Map();
  for (const f of index.files) {
    if (f.category !== "code" || f.isTest) continue;
    const covered = coverage.isCovered(f.path);
    const dir = f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") : ".";
    if (!byDir.has(dir)) byDir.set(dir, { dir, code: 0, untested: 0, commits: 0, examples: [] });
    const d = byDir.get(dir);
    d.code++;
    if (!covered) {
      d.untested++;
      d.commits += f.commits;
      if (d.examples.length < 4) d.examples.push(f.path);
    }
  }

  return [...byDir.values()]
    .filter((d) => d.untested >= 3)
    .sort((a, b) => b.commits - a.commits || b.untested - a.untested);
}

/** A repo the indexer found no source files in — the greenfield install flow, not a broken repo. */
export function isGreenfield(index) {
  return index.stats.files === 0;
}

export function analyse(index, root) {
  const out = [];
  const has = (p) => existsSync(join(root, p));

  // A greenfield repo has nothing to analyse, and ranking absent documentation as a defect is
  // nonsense there: "no AGENTS.md" is only high-leverage when there is code to explain, and
  // "domain terms drift" needs a domain. The design specifies two install flows; this is the
  // other one. Say what it is and stop — scaffolding is the whole job.
  if (isGreenfield(index)) {
    out.push(
      finding(
        "low",
        "greenfield",
        "Greenfield repo — nothing to index yet",
        "The indexer found no source files, so there is nothing to analyse and no findings to rank. " +
          "This is the greenfield install flow: scaffold the context layer now and it grows with the " +
          "code, rather than being reverse-engineered from it later. Re-run the index once there is " +
          "code and this report becomes useful.",
      ),
    );
    return out;
  }

  // --- Context layer: the thing Cortex exists to manage -------------------------------------
  if (!has("AGENTS.md") && !has("CLAUDE.md")) {
    out.push(
      finding(
        "high",
        "context",
        "No agent context file",
        "This repo has no AGENTS.md, so every agent starts from zero and re-derives the same conclusions each session. This is the single highest-leverage file Cortex can add.",
        [],
        offer("scaffold"),
      ),
    );
  } else if (has("AGENTS.md")) {
    const lines = readFileSync(join(root, "AGENTS.md"), "utf8").split("\n").length;
    if (lines > 250) {
      out.push(
        finding(
          "medium",
          "context",
          `AGENTS.md is ${lines} lines`,
          "A single large context file is loaded in full on every turn, whether or not it is relevant. Splitting the area-specific parts into scoped leaves with a routing table keeps the root small and loads detail only where work happens.",
          [],
          // Split into leaves — never re-scaffold. The root file here is curated, and the
          // never-clobber rule is the whole reason it survives a second install.
          offer("brief"),
        ),
      );
    }
  }
  if (!has("CONTEXT.md")) {
    out.push(
      finding(
        "medium",
        "context",
        "No CONTEXT.md glossary",
        "Domain terms are undefined, so agents and new developers guess at what words mean and drift apart. A short glossary of the terms this repo uses — with the ones to avoid — costs little and stops a recurring class of confusion.",
        [],
        offer("scaffold"),
      ),
    );
  }
  if (!has("docs/adr")) {
    out.push(
      finding(
        "low",
        "context",
        "No architecture decision records",
        "Decisions that were hard to reach are not written down, so they get re-litigated. ADRs are created lazily — only when a decision is hard to reverse, surprising without context, or a real trade-off.",
        [],
        offer("scaffold"),
      ),
    );
  }

  // --- Secrets: the one thing that blocks committed memory ------------------------------------
  //
  // A file may opt out with a `cortex:allow-secrets` comment. Security test corpora and
  // documentation of credential formats legitimately contain secret-shaped strings, and a scanner
  // that cries wolf on its own fixtures teaches people to ignore every other finding. Exemptions
  // are counted in the report, never silent.
  const leaky = [];
  const exempt = [];
  for (const f of index.files) {
    if (f.category === "docs" || f.bytes > 400_000) continue;
    let text;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const hits = scan(text);
    if (!hits.length) continue;
    if (text.includes("cortex:allow-secrets")) {
      exempt.push({ path: f.path, hits: hits.length });
      continue;
    }
    leaky.push({ path: f.path, hits });
  }
  if (exempt.length) {
    out.push(
      finding(
        "low",
        "security",
        `${exempt.length} file${exempt.length === 1 ? "" : "s"} exempted from the secret scan`,
        "These carry a `cortex:allow-secrets` marker, so their secret-shaped strings are treated as fixtures. Worth re-reading occasionally: the marker is a claim by whoever added it, not a guarantee — and a file that later gains a real credential keeps the exemption it was granted for a fixture.",
        // Named, not merely counted. "Worth re-reading" is not an instruction anyone can act on
        // against a number, and the entire reason an exemption is surfaced instead of applied
        // silently is so a human can go and check it.
        exempt.map((e) => `${e.path} — ${e.hits} secret-shaped ${e.hits === 1 ? "string" : "strings"}`),
      ),
    );
  }
  if (leaky.length) {
    // A test certificate is a real private key and belongs in the report. It is not a leaked
    // production credential, and ranking it `critical` makes it the FIRST thing the wizard asks
    // about — severity is control flow here (ADR 0006).
    //
    // Run against six well-maintained open-source repositories, four came back critical and every
    // single match was a test fixture, a placeholder or a comment. A tool that cries wolf on four
    // of six respected repos teaches people to skip the section, and then it fails on the one that
    // matters. So: critical only when something outside a test path matched.
    const inTestPath = (p) => /(^|\/)(tests?|testdata|__tests__|spec|fixtures?|examples?|mocks?)(\/|$)/i.test(p);
    const production = leaky.filter((l) => !inTestPath(l.path));
    const allFixtures = production.length === 0;
    out.push(
      finding(
        allFixtures ? "medium" : "critical",
        "security",
        allFixtures
          ? `Secret-shaped strings in ${leaky.length} test file${leaky.length === 1 ? "" : "s"}`
          : `Possible secrets in ${production.length} file${production.length === 1 ? "" : "s"}`,
        allFixtures
          ? "Every match sits under a test or fixture path, so this is very likely intentional — test certificates and dummy credentials are normal. Reported rather than hidden because Cortex cannot tell a fixture from a real key that was filed in the wrong place. Add a `cortex:allow-secrets` marker to settle it."
          : "Cortex refuses to write memory containing these patterns, and they should not be in the repo either. Verify each one — some will be test fixtures or examples, which is exactly why this is reported rather than acted on.",
        leaky.slice(0, 20).map((l) => `${l.path}: ${l.hits.map((h) => h.kind).join(", ")}`),
        // Show and stop. There is deliberately no action here that edits a file: some hits are
        // fixtures, and one false positive acted on destroys trust in every other finding.
        offer(
          "triage-secrets",
          leaky.map((l) => l.path),
        ),
      ),
    );
  }

  // --- Tests ---------------------------------------------------------------------------------
  if (index.stats.tests === 0 && index.stats.categories.code > 0) {
    out.push(
      finding(
        "high",
        "tests",
        "No test files found",
        "Nothing in this repo matches a test convention Cortex recognises. If tests do exist somewhere unusual, tell Cortex where — otherwise every change here is unverified.",
      ),
    );
  } else {
    const untested = untestedAreas(index, root);
    if (untested.length) {
      const total = untested.reduce((a, d) => a + d.untested, 0);
      out.push(
        finding(
          untested[0].commits > 5 ? "high" : "medium",
          "tests",
          `${total} module${total === 1 ? "" : "s"} appear untested`,
          "No test file is named after these, and no test imports them. Ranked by recent commit activity — the top entries change often and are unverified, which is where regressions come from. A module exercised only indirectly, through a helper a test imports, will show up here.",
          untested
            .slice(0, 8)
            .map(
              (d) =>
                `${d.dir} — ${d.untested}/${d.code} untested, ${d.commits} ${
                  index.stats?.churnWindow === "all history" ? "commits ever" : "recent commits"
                }: ${d.examples.join(", ")}`,
            ),
        ),
      );
    }
  }

  // --- Structure -----------------------------------------------------------------------------
  const blind = blindLanguages(index);
  if (blind.length) {
    out.push(
      finding(
        "low",
        "structure",
        `Import graph does not cover ${blind.join(", ")}`,
        "Cortex reads imports by convention rather than with a compiler, and it cannot resolve this language's module system. Files in it are left out of the unreferenced list, and `/cortex-impact` will report no dependents for them — that is Cortex being blind, not the files being unused. Treat any structural claim about them as absent rather than negative.",
        [],
      ),
    );
  }

  const orph = findOrphans(index, root);
  if (orph.length) {
    out.push(
      finding(
        "low",
        "structure",
        `${orph.length} file${orph.length === 1 ? " appears" : "s appear"} unreferenced`,
        "No resolvable import points at these, they import nothing themselves, and no other file in the repo names their path — so a script invoked from CI, a shell test or a doc is not listed here. What remains can still be a false positive: Cortex resolves imports by convention, so a dynamically loaded or framework-discovered file has no visible pointer. Treat this as a list to check, not to delete.",
        orph.slice(0, 15).map((f) => f.path),
      ),
    );
  }

  const big = index.files.filter((f) => f.category === "code" && f.lines > 600).sort((a, b) => b.lines - a.lines);
  if (big.length) {
    out.push(
      finding(
        "medium",
        "structure",
        `${big.length} file${big.length === 1 ? "" : "s"} over 600 lines`,
        "Large files are hard for a human to hold and expensive for an agent to load. These are candidates for splitting — but only where the split produces a real seam, not just smaller files.",
        big.slice(0, 10).map((f) => `${f.path} — ${f.lines} lines`),
      ),
    );
  }

  const hot = index.files
    .filter((f) => f.commits > 0 && !f.isTest && f.category === "code")
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);
  if (hot.length) {
    out.push(
      finding(
        "low",
        "structure",
        "Hot spots",
        `The files changing most often ${index.stats?.churnWindow === "all history" ? "in this repo's whole history — its history is shorter than the usual three-month window" : "in the last three months"}. Effort spent on context, tests or refactoring pays off here first — this is where YAGNI applies to improvement work.`,
        hot.map((f) => `${f.path} — ${f.commits} commits`),
      ),
    );
  }

  // --- Repo-scale offers ----------------------------------------------------------------------
  //
  // These three are not defects, so they are all low. Enrichment is optional and costs tokens,
  // memory is a choice about sharing, and a plugin tier is a convenience — ranking any of them as
  // a problem would spend the report's calibration on things that are working as intended.

  // Enrichment pays on a repo too large to hold in one head. On a small one it is a token bill for
  // a summary of code you could just read, so the threshold is stated rather than implied.
  if (index.stats.files >= ENRICH_WORTH_IT && !has(".cortex/index/enriched.json")) {
    out.push(
      finding(
        "low",
        "enrichment",
        `${index.stats.files} files — enrichment would make recall describe what code means`,
        "The index knows how this repo is wired; enrichment adds what each file is for, so recall answers in meaning rather than structure. It costs tokens — one LLM pass over every file, in batches — and it is additive: the index stays the source of truth and a stale enrichment degrades Cortex to deterministic behaviour rather than breaking it.",
        [],
        offer("enrich"),
      ),
    );
  }

  if (!has(".cortex/memory")) {
    out.push(
      finding(
        "low",
        "memory",
        "No committed memory store",
        "`.cortex/memory/` is the one part of `.cortex/` that is committed, and that asymmetry is the point: it is how several developers and their agents share one context instead of each re-deriving it. Nothing personal or secret may go in it — Cortex refuses writes carrying credentials rather than sanitising them silently.",
        [],
        offer("memory"),
      ),
    );
  }

  // Offer a tier only where the index gives a reason for it. Reciting the whole list is how a
  // wizard turns into a catalogue, and a tier nobody has a use for is a question that costs
  // attention and returns nothing.
  const tiers = [];
  const ext = (p) => p.slice(p.lastIndexOf("."));
  if (index.files.some((f) => [".tsx", ".jsx", ".vue", ".svelte"].includes(ext(f.path)) || ["css", "scss", "html", "vue", "svelte"].includes(f.lang))) {
    tiers.push("browser-qa");
  }
  if (index.files.some((f) => /^(openapi|swagger)\.(ya?ml|json)$|\.postman_collection\.json$/.test(f.path.split("/").pop()))) {
    tiers.push("api");
  }
  if (tiers.length) {
    out.push(
      finding(
        "low",
        "tooling",
        `Plugin tier${tiers.length === 1 ? "" : "s"} worth offering: ${tiers.join(", ")}`,
        "The index shows what this repo is, so these tiers have a use here. Core installs regardless; these are the opt-in ones the repo itself argues for.",
        tiers,
        offer("bundle", tiers),
      ),
    );
  }

  // --- Scoped-brief proposals ----------------------------------------------------------------
  // A directory that already has a brief is done, not a candidate. Re-proposing finished work is
  // how a report teaches people to stop reading it.
  const briefs = briefCandidates(index.files).filter((b) => !has(join(b.dir, "AGENTS.md")));
  if (briefs.length) {
    out.push(
      finding(
        "medium",
        "context",
        `${briefs.length} area${briefs.length === 1 ? "" : "s"} may deserve their own AGENTS.md`,
        "Ranked by size, churn and absence of tests. Each of these would get a scoped brief plus a line in the root routing table, so an agent working there loads narrow context instead of everything.",
        briefs.slice(0, 8).map((b) => `${b.dir} — ${b.reasons.join("; ")}`),
        offer(
          "brief",
          briefs.map((b) => b.dir),
        ),
      ),
    );
  }

  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind),
  );
}

/** Render the findings as the single markdown artifact this pass is allowed to produce. */
export function render(index, findings, { day }) {
  const s = index.stats;
  const langs = Object.entries(s.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  const lines = [
    `# Cortex findings — ${day}`,
    "",
    "Every item below is a **proposal**. Nothing in this repository has been changed.",
    "Pick what you want acted on; Cortex will not act on its own.",
    "",
    "## The repo at a glance",
    "",
    `- **${s.files}** files, **${s.lines.toLocaleString()}** lines, **${s.edges}** resolved imports`,
    `- **${s.tests}** test files`,
    // An empty language map rendered as a bare "- " bullet.
    ...(langs ? [`- ${langs}`] : []),
    `- ${index.areas.length} structural areas`,
    index.commit ? `- indexed at \`${index.commit.slice(0, 7)}\`` : "- not a git repository",
    "",
  ];

  if (!findings.length) {
    lines.push("## Findings", "", "Nothing to report — no gaps matched.", "");
    return lines.join("\n");
  }

  const bySeverity = { critical: [], high: [], medium: [], low: [] };
  for (const f of findings) bySeverity[f.severity].push(f);

  lines.push("## Findings", "");
  for (const sev of ["critical", "high", "medium", "low"]) {
    const group = bySeverity[sev];
    if (!group.length) continue;
    lines.push(`### ${sev[0].toUpperCase()}${sev.slice(1)}`, "");
    for (const f of group) {
      lines.push(`#### ${f.title}`, "", f.detail, "");
      if (f.evidence.length) {
        lines.push("```");
        lines.push(...f.evidence);
        lines.push("```", "");
      }
    }
  }

  // The closing instruction has to match the flow the reader is actually in. Pointing a greenfield
  // repo at "the areas listed above" names areas that do not exist.
  if (isGreenfield(index)) {
    lines.push(
      "## What happens next",
      "",
      "Nothing, until you say so. This is a **greenfield** repo, so scaffolding is the whole job —",
      "run `/cortex-scaffold` to write the context layer (`AGENTS.md`, `CONTEXT.md`, `docs/adr/`).",
      "Scoped briefs and enrichment wait until there is code to describe.",
      "",
    );
    return lines.join("\n");
  }

  lines.push(
    "## What happens next",
    "",
    "Nothing, until you say so. Tell Cortex which findings to act on, or run `/cortex-scaffold`",
    "to add the context layer (`AGENTS.md`, `CONTEXT.md`, `docs/adr/`) and `/cortex-brief` to",
    "create scoped briefs for the areas listed above.",
    "",
  );
  return lines.join("\n");
}
