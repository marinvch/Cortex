// What /cortex stamps into someone else's repo has to pass THAT repo's checks.
//
// Found on pmndrs/zustand: after one install its own `pnpm test` failed, because
// `prettier --list-different` flagged ten files Cortex had written — CRLF templates copied from a
// Windows checkout, and no step that ran the repo's formatter over what was written. Its CI review
// convention flagged the stamped workflow too: an unpinned `actions/checkout@v4` that left the job
// token in the checkout, in a repo where every workflow pins by commit and persists no credentials.
// These tests pin the properties, not the one file each was found in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATES = join(REPO, "templates");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const rel = (abs) => relative(REPO, abs).split("\\").join("/");
const templateFiles = walk(TEMPLATES).map(rel).sort();
const read = (p) => readFileSync(join(REPO, p), "utf8");

// A stamped workflow is any template GitHub would run: YAML with a top-level `jobs:`.
const workflows = templateFiles.filter((p) => /\.ya?ml$/.test(p) && /^jobs:/m.test(read(p)));

test("every template is checked out with LF endings, on every platform", () => {
  // `text=auto` left them CRLF in a Windows working copy, and /cortex copies them byte-for-byte. The
  // property is the attribute git applies, not the bytes on this machine: a checkout made before the
  // rule existed keeps its old endings until the file changes, and CI checks out LF regardless.
  assert.ok(templateFiles.length >= 20, `found only ${templateFiles.length} templates`);
  const out = execFileSync("git", ["check-attr", "eol", "--", ...templateFiles], { cwd: REPO, encoding: "utf8" });
  const notLf = out.trim().split("\n").filter((l) => !l.endsWith(": eol: lf"));
  assert.deepEqual(notLf, [], "templates without eol=lf");
});

test("there is at least one stamped workflow to check", () => {
  assert.ok(workflows.includes("templates/loop/agent-evals.yml"), `workflows found: ${workflows.join(", ")}`);
});

test("every action a stamped workflow uses is pinned to a full commit SHA, with the release named", () => {
  // A tag can be moved to different code after review; a commit cannot. The trailing comment is what
  // lets a person — or Dependabot — see which release the SHA is.
  for (const wf of workflows) {
    const uses = [...read(wf).matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length, `${wf} uses no actions — the regex is not seeing them`);
    for (const [, ref, rest] of uses) {
      if (ref.startsWith("./")) continue; // a local action is this repo's own code
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${wf}: ${ref} is not pinned to a commit`);
      assert.match(rest, /#\s*v\d/, `${wf}: ${ref} does not name its release in a trailing comment`);
    }
  }
});

test("every checkout in a stamped workflow persists no credentials", () => {
  // The agent runs in the steps after checkout. A token left in the git config is one it can use.
  for (const wf of workflows) {
    const lines = read(wf).split("\n");
    lines.forEach((line, i) => {
      if (!/uses:\s*actions\/checkout@/.test(line)) return;
      const indent = line.search(/\S/);
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && l.search(/\S/) <= indent) break;
        block.push(l);
      }
      assert.match(block.join("\n"), /persist-credentials:\s*false/, `${wf}:${i + 1} checkout keeps its credentials`);
    });
  }
});

// --- the rituals that write files format them with the repo's own formatter --------------------------
//
// ADR 0016: a promise that needs judgment stays in prose, and the prose is tested for. Running "the
// repo's formatter" needs the repo's command and the list of files just written, so it is a step each
// writing ritual must carry — and the first real install showed what happens when none does.

const WRITERS = ["cortex", "cortex-scaffold", "cortex-brief", "cortex-skills"];

test("every ritual that writes into a target repo formats exactly what it wrote, then runs the repo's check", () => {
  for (const name of WRITERS) {
    const body = read(`skills/${name}/SKILL.md`);
    assert.match(body, /formatter/i, `${name} never mentions the repo's formatter`);
    assert.match(body, /files you (just )?wrote|what you wrote/i, `${name} does not scope formatting to the files it wrote`);
    assert.match(body, /(lint|format)[^.\n]*check|check[^.\n]*(lint|format)/i, `${name} does not run the repo's own lint/format check afterwards`);
  }
});

test("/cortex says the indexer's first run also edits .gitignore", () => {
  // It said "writes only .cortex/index/index.json" while `ensureGitignored` appended three lines to
  // the target's .gitignore. A consent gate that under-describes the write is not a consent gate.
  const body = read("skills/cortex/SKILL.md");
  assert.doesNotMatch(body, /Writes only `\.cortex\/index\/index\.json`/);
  assert.match(body, /\.gitignore/);
});

test("/cortex renders and records every whole-file loop file, and updates only through the CLI", () => {
  // The stamp record is only as good as the step that writes it, and that step is prose: a model
  // following skills/cortex/SKILL.md. So the prose is pinned — render, record after formatting,
  // update and diff through cortex-stamps, the two shared-file templates left out on purpose, and
  // the .gitignore fix written only when the user picks it.
  const body = read("skills/cortex/SKILL.md");
  for (const cmd of ["render", "record", "update", "diff", "adopt"]) {
    assert.match(body, new RegExp(`cortex-stamps\\.mjs"? ${cmd}\\b`), `/cortex never runs cortex-stamps ${cmd}`);
  }
  assert.match(body, /cortex-stamps\.mjs"? \. --json/, "/cortex reads the stamp status on a re-run");
  assert.match(body, /`verification\.md`[^\n]*`settings\.hooks\.json`[^\n]*not recorded|not recorded[^\n]*`verification\.md`/i,
    "/cortex says the appended and merged templates stay out of the record");
  assert.match(body, /never re-render[^.\n]*yourself/i, "/cortex never re-renders a file by hand");
  assert.match(body, /\.gitignore[^.\n]*only (?:if|when)[^.\n]*pick/i, "the record's .gitignore fix is written only when picked");
  // An older plugin reads every untouched file as `update`. The CLI refuses the update, but a model
  // that offered the row first has already told the team something false.
  assert.match(body, /`olderPlugin`[^\n]*\n?[^\n]*`advice`[^.]*no stamp row/i, "/cortex offers no stamp row on an older plugin");
});

test("the placeholder check and the renderer share one definition of a placeholder", () => {
  // tools/cortex-placeholders.mjs says which placeholders a stamped file still holds; the renderer in
  // index/lib/placeholders.mjs fills them on an update. A private copy of the rule in either would
  // agree today and disagree the first time one of them learns something.
  const tool = read("tools/cortex-placeholders.mjs");
  assert.match(tool, /import \{[^}]*placeholdersOf[^}]*\} from "\.\.\/index\/lib\/placeholders\.mjs"/);
  assert.doesNotMatch(tool, /function placeholdersOf|const placeholdersOf/, "the tool keeps no copy of its own");
});

test("a placeholder in a prose template is a phrase, never a bare identifier", () => {
  // `tools/cortex-placeholders.mjs` reports a hit only for a template's exact placeholder text. That
  // is zero false hits only if no placeholder is also something a repo writes on purpose — and
  // `{{test}}` is a Handlebars, Vue and Jinja expression. A phrase with a space is none of those.
  for (const t of ["templates/target-AGENTS.md", "templates/CONTEXT.md"]) {
    const text = read(t).replace(/<!--[\s\S]*?-->/, ""); // the opening comment is dropped when stamped
    const bare = [...text.matchAll(/(?<!\$)\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]).filter((p) => !/\s/.test(p.trim()));
    assert.deepEqual(bare, [], `${t} has identifier placeholders`);
  }
});

test("the scaffold's placeholder check is the tool, not a grep with known false hits", () => {
  const body = read("skills/cortex-scaffold/SKILL.md");
  assert.doesNotMatch(body, /Grep for `\{\{`/);
  assert.match(body, /cortex-placeholders\.mjs/);
});

test("the scaffold and /cortex agree about what CLAUDE.md holds", () => {
  // Scaffold said "one line — nothing else", /cortex appends the verification block to it.
  const scaffold = read("skills/cortex-scaffold/SKILL.md");
  assert.doesNotMatch(scaffold, /one line each: `@AGENTS\.md`\. Nothing else/);
  assert.match(scaffold, /Verifying your work/);
});

test("every ritual that names the ADR directory knows it may be adr/", () => {
  // Hard-coding docs/adr/ publishes ADRs on a repo whose docs/ is a site. Where a writing ritual
  // names the location, it must name the alternative too.
  for (const name of ["cortex-scaffold", "cortex", "cortex-install"]) {
    const body = read(`skills/${name}/SKILL.md`);
    assert.match(body, /`adr\/`/, `${name} names docs/adr/ and never adr/`);
  }
});
