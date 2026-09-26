// cortex-output-passes.test.mjs — everything /cortex writes into a repo passes Cortex's own checker.
//
// Stamping is done by the model following skills/cortex/SKILL.md, not by code, so this test does
// what the skill says: it reads the skill's "Template | Lands at" table, copies each template in
// templates/loop/ to where the table says it lands, adds the root brief and its CLAUDE.md shim, and
// commits the lot into a fresh git repo. Then it indexes that repo and runs claudeSetupFindings over
// it with the real readers — disk, git's recorded mode — and expects nothing.
//
// The class of bug this catches shipped once already: settings.hooks.json ran a format-changed.sh
// that templates/loop/ did not have, so every repo /cortex stamped carried a hook that failed on each
// edit and blocked nothing. The second test pins that the check would have seen it.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "../lib/build.mjs";
import { claudeSetupFindings } from "../lib/claude-setup.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const LOOP = join(REPO, "templates", "loop");

/** [{ template, dest, mode: "write" | "append" | "merge" }] from the /cortex skill's table. */
function destinations() {
  const skill = readFileSync(join(REPO, "skills", "cortex", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const table = skill.slice(skill.indexOf("| Template | Lands at |"), skill.indexOf("**Never invent a command.**"));
  const out = [];
  for (const line of table.split("\n").slice(2)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const templates = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const lands = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const mode = /^appended/.test(cells[1]) ? "append" : /^merged/.test(cells[1]) ? "merge" : "write";
    templates.forEach((t, i) => {
      let dest;
      if (/repo root/.test(cells[1])) dest = t;
      else if (lands.length === 1 && lands[0].endsWith("/")) dest = posix.join(lands[0], t);
      else if (lands.length === templates.length) dest = lands[i];
      else dest = lands[0];
      out.push({ template: t, dest, mode });
    });
  }
  return out;
}

/** Placeholders get a plain value; a shell template's list placeholders are left empty. */
function fill(text, template) {
  return template.endsWith(".sh") ? text.replace(/\{\{[A-Z_]+\}\}/g, "") : text.replace(/\{\{[^}]+\}\}/g, "value");
}

function stamp({ skip = [] } = {}) {
  const root = tempDir("cortex-stamp-");
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  const put = (rel, body) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  // A repo worth stamping: some code, and the root brief /cortex-scaffold writes with its shim.
  put("package.json", JSON.stringify({ name: "demo", scripts: { test: "node --test" } }, null, 2));
  put("src/app.js", "export const app = () => 1;\n");
  put("AGENTS.md", fill(readFileSync(join(REPO, "templates", "target-AGENTS.md"), "utf8"), "target-AGENTS.md"));
  put("CLAUDE.md", "@AGENTS.md\n");

  const rows = destinations();
  assert.ok(rows.length >= 10, `parsed only ${rows.length} rows from the /cortex skill's table`);
  const executables = [];
  for (const { template, dest, mode } of rows) {
    if (skip.includes(template)) continue;
    const body = fill(readFileSync(join(LOOP, template), "utf8"), template);
    if (mode === "append") appendFileSync(join(root, dest), `\n${body}`);
    else put(dest, body); // merge into a repo with no settings.json is a write
    if (dest.endsWith(".sh")) executables.push(dest);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  // The executable bit the stamp sets (step 2), recorded in git so it holds on Windows too.
  for (const p of executables) execFileSync("git", ["update-index", "--chmod=+x", p], { cwd: root });
  execFileSync("git", ["commit", "-qm", "stamp"], { cwd: root });
  return { root, rows };
}

test("the /cortex skill's table covers every loop template", () => {
  const named = new Set(destinations().map((r) => r.template));
  for (const t of ["settings.hooks.json", "protected-paths.sh", "format-changed.sh", "verifier.md", "verification.md"]) {
    assert.ok(named.has(t), `the table no longer places ${t}`);
  }
});

test("everything /cortex writes passes the claude-setup checker", () => {
  const { root } = stamp();
  const index = buildIndex(root);
  const found = claudeSetupFindings(index, root);
  assert.deepEqual(
    found.map((f) => `${f.kind}: ${f.evidence.join(" | ")}`),
    [],
    "a template /cortex stamps breaks a rule it is checked against",
  );
});

test("a stamped hook whose script is missing is caught — the bug this test exists for", () => {
  const { root } = stamp({ skip: ["format-changed.sh"] });
  const found = claudeSetupFindings(buildIndex(root), root);
  const missing = found.find((f) => f.kind === "claude-setup/hook-script-missing");
  assert.ok(missing, `expected hook-script-missing, got ${found.map((f) => f.kind).join(", ") || "none"}`);
  assert.match(missing.evidence.join("\n"), /format-changed\.sh not found/);
});
