import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { briefCandidates } from "./layers.mjs";
import { scan } from "../../core/scrub.js";

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

/** Files that nothing imports and that are not entry points, tests, docs or config. */
function orphans(index) {
  return index.files.filter(
    (f) => f.category === "code" && !f.isTest && !f.isEntry && f.inbound === 0 && f.imports.length === 0,
  );
}

/**
 * The bare module name a test file is testing, e.g. `mcp/test/paths.test.js` → `paths`.
 * Tests routinely live in a sibling directory rather than beside the code, so matching on the
 * containing directory reports false positives on the ordinary src/ + test/ layout.
 */
export function testStem(path) {
  let name = path.split("/").pop();
  name = name.replace(/\.[a-z0-9]+$/i, "");
  name = name
    .replace(/\.(test|spec)$/i, "")
    .replace(/_(test|spec)$/i, "")
    .replace(/^(test|spec)_/i, "")
    .replace(/(Test|Tests|Spec|Specs)$/, "");
  return name.toLowerCase();
}

/** Production modules that no test covers, grouped by directory. */
function untestedAreas(index, root) {
  // Three signals, because each alone misreports. Naming catches `paths.js` ← `paths.test.js` even
  // when they sit in different directories; imports catch a module exercised by a test named after
  // something else, which is how most integration tests are organised; mentions catch a CLI run as
  // a subprocess, which neither of the others can see.
  const coveredByName = new Set();
  const testPaths = new Set();
  for (const f of index.files) {
    if (!f.isTest) continue;
    coveredByName.add(testStem(f.path));
    testPaths.add(f.path);
  }
  const coveredByImport = new Set();
  for (const e of index.edges) {
    if (testPaths.has(e.from)) coveredByImport.add(e.to);
  }

  // Third signal: a test that names the file in a string literal. CLIs are routinely tested by
  // spawning them as a subprocess, which is invisible to both signals above — the test neither
  // imports the module nor is named after it. Quoted-only, so a passing mention in a comment does
  // not count as coverage.
  const coveredByMention = new Set();
  if (testPaths.size && root) {
    const basenames = new Map();
    for (const f of index.files) {
      if (f.category === "code" && !f.isTest) basenames.set(f.path.split("/").pop(), f.path);
    }
    for (const t of testPaths) {
      let text;
      try {
        text = readFileSync(join(root, t), "utf8");
      } catch {
        continue;
      }
      for (const [base, path] of basenames) {
        if (text.includes(`"${base}"`) || text.includes(`'${base}'`) || text.includes(`\`${base}\``)) {
          coveredByMention.add(path);
        }
      }
    }
  }

  const byDir = new Map();
  for (const f of index.files) {
    if (f.category !== "code" || f.isTest) continue;
    const stem = testStem(f.path);
    const covered = coveredByName.has(stem) || coveredByImport.has(f.path) || coveredByMention.has(f.path);
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
  let exempted = 0;
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
      exempted++;
      continue;
    }
    leaky.push({ path: f.path, hits });
  }
  if (exempted) {
    out.push(
      finding(
        "low",
        "security",
        `${exempted} file${exempted === 1 ? "" : "s"} exempted from the secret scan`,
        "These carry a `cortex:allow-secrets` marker, so their secret-shaped strings are treated as fixtures. Worth re-reading occasionally: the marker is a claim by whoever added it, not a guarantee.",
      ),
    );
  }
  if (leaky.length) {
    out.push(
      finding(
        "critical",
        "security",
        `Possible secrets in ${leaky.length} file${leaky.length === 1 ? "" : "s"}`,
        "Cortex refuses to write memory containing these patterns, and they should not be in the repo either. Verify each one — some will be test fixtures or examples, which is exactly why this is reported rather than acted on.",
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
            .map((d) => `${d.dir} — ${d.untested}/${d.code} untested, ${d.commits} recent commits: ${d.examples.join(", ")}`),
        ),
      );
    }
  }

  // --- Structure -----------------------------------------------------------------------------
  const orph = orphans(index);
  if (orph.length) {
    out.push(
      finding(
        "low",
        "structure",
        `${orph.length} file${orph.length === 1 ? "" : "s"} appear unreferenced`,
        "No resolvable import points at these, and they import nothing themselves. Cortex resolves imports by convention, so dynamically loaded or framework-discovered files show up here too — treat this as a list to check, not to delete.",
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
        "The files changing most often in the last three months. Effort spent on context, tests or refactoring pays off here first — this is where YAGNI applies to improvement work.",
        hot.map((f) => `${f.path} — ${f.commits} commits`),
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
    `- ${index.layers.length} structural areas`,
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
