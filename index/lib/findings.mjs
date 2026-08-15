import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { briefCandidates } from "./layers.mjs";
import { scan } from "../../mcp/lib/scrub.js";

// Findings are PROPOSALS. Nothing here edits a repository — this module returns data and the
// caller writes exactly one report file. The skill that finds things and the skill that changes
// things are deliberately different skills, so "the user decides" is structural rather than a
// promise the model has to keep.

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function finding(severity, kind, title, detail, evidence = []) {
  return { severity, kind, title, detail, evidence };
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

/** Production modules that have no test file named after them, grouped by directory. */
function untestedAreas(index) {
  const covered = new Set();
  for (const f of index.files) if (f.isTest) covered.add(testStem(f.path));

  const byDir = new Map();
  for (const f of index.files) {
    if (f.category !== "code" || f.isTest) continue;
    const stem = testStem(f.path);
    const dir = f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") : ".";
    if (!byDir.has(dir)) byDir.set(dir, { dir, code: 0, untested: 0, commits: 0, examples: [] });
    const d = byDir.get(dir);
    d.code++;
    if (!covered.has(stem)) {
      d.untested++;
      d.commits += f.commits;
      if (d.examples.length < 4) d.examples.push(f.path);
    }
  }

  return [...byDir.values()]
    .filter((d) => d.untested >= 3)
    .sort((a, b) => b.commits - a.commits || b.untested - a.untested);
}

export function analyse(index, root) {
  const out = [];
  const has = (p) => existsSync(join(root, p));

  // --- Context layer: the thing Cortex exists to manage -------------------------------------
  if (!has("AGENTS.md") && !has("CLAUDE.md")) {
    out.push(
      finding(
        "high",
        "context",
        "No agent context file",
        "This repo has no AGENTS.md, so every agent starts from zero and re-derives the same conclusions each session. This is the single highest-leverage file Cortex can add.",
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
      ),
    );
  }

  // --- Secrets: the one thing that blocks committed memory ------------------------------------
  const leaky = [];
  for (const f of index.files) {
    if (f.category === "docs" || f.bytes > 400_000) continue;
    let text;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const hits = scan(text);
    if (hits.length) leaky.push({ path: f.path, hits });
  }
  if (leaky.length) {
    out.push(
      finding(
        "critical",
        "security",
        `Possible secrets in ${leaky.length} file${leaky.length === 1 ? "" : "s"}`,
        "Cortex refuses to write memory containing these patterns, and they should not be in the repo either. Verify each one — some will be test fixtures or examples, which is exactly why this is reported rather than acted on.",
        leaky.slice(0, 20).map((l) => `${l.path}: ${l.hits.map((h) => h.kind).join(", ")}`),
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
    const untested = untestedAreas(index);
    if (untested.length) {
      const total = untested.reduce((a, d) => a + d.untested, 0);
      out.push(
        finding(
          untested[0].commits > 5 ? "high" : "medium",
          "tests",
          `${total} module${total === 1 ? "" : "s"} have no matching test`,
          "Production modules with no test file named after them, anywhere in the repo. Ranked by recent commit activity — the top entries change often and are unverified, which is where regressions come from.",
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
  const briefs = briefCandidates(index.files);
  if (briefs.length) {
    out.push(
      finding(
        "medium",
        "context",
        `${briefs.length} area${briefs.length === 1 ? "" : "s"} may deserve their own AGENTS.md`,
        "Ranked by size, churn and absence of tests. Each of these would get a scoped brief plus a line in the root routing table, so an agent working there loads narrow context instead of everything.",
        briefs.slice(0, 8).map((b) => `${b.dir} — ${b.reasons.join("; ")}`),
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
    `- ${langs}`,
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
