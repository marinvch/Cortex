import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(readFileSync(join(REPO_ROOT, p), "utf8"));

// "Installable as a plugin" is the headline claim of v2.0.0, and a plugin fails to install for
// dull structural reasons: a manifest in the wrong place, a skill with no frontmatter, an
// mcpServers entry pointing at a file that was moved. None of that shows up in a unit test of
// application logic, so it gets its own.

test("the plugin manifests are where Claude Code looks for them", () => {
  assert.ok(existsSync(join(REPO_ROOT, ".claude-plugin", "plugin.json")));
  assert.ok(existsSync(join(REPO_ROOT, ".claude-plugin", "marketplace.json")));
});

test("plugin.json declares a name, a version and a description", () => {
  const p = read(".claude-plugin/plugin.json");
  assert.equal(p.name, "cortex");
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.ok(p.description && p.description.length > 20, "a description is what users see when choosing");
});

test("the marketplace offers the plugin from a source that exists", () => {
  const m = read(".claude-plugin/marketplace.json");
  assert.ok(Array.isArray(m.plugins) && m.plugins.length, "marketplace.json must list plugins");
  const cortex = m.plugins.find((p) => p.name === "cortex");
  assert.ok(cortex, "the marketplace must offer 'cortex' — /plugin install cortex resolves by name");
  assert.equal(cortex.source, "./", "the plugin lives at the repo root");
  assert.ok(m.owner?.name, "an owner is shown in the install dialog");
});

test("every mcpServers entry points at a file that exists", () => {
  const p = read(".claude-plugin/plugin.json");
  for (const [name, server] of Object.entries(p.mcpServers ?? {})) {
    const args = server.args ?? [];
    const scriptArg = args.find((a) => a.includes("${CLAUDE_PLUGIN_ROOT}"));
    assert.ok(scriptArg, `${name}: expected an arg rooted at \${CLAUDE_PLUGIN_ROOT}`);
    // ${CLAUDE_PLUGIN_ROOT} resolves to this repo once installed.
    const rel = scriptArg.replace("${CLAUDE_PLUGIN_ROOT}/", "");
    assert.ok(
      existsSync(join(REPO_ROOT, rel)),
      `${name}: points at '${rel}', which does not exist — a moved file breaks the server silently`,
    );
  }
});

test("every skill has usable frontmatter", () => {
  const skillsDir = join(REPO_ROOT, "skills");
  const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());
  assert.ok(names.length > 10, "expected the ritual set to be present");

  const problems = [];
  for (const name of names) {
    const file = join(skillsDir, name, "SKILL.md");
    if (!existsSync(file)) {
      problems.push(`${name}: no SKILL.md`);
      continue;
    }
    const src = readFileSync(file, "utf8");
    const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) {
      problems.push(`${name}: no frontmatter block`);
      continue;
    }
    const body = fm[1];
    const declared = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (!declared) problems.push(`${name}: no name:`);
    else if (declared !== name) problems.push(`${name}: declares name '${declared}' — must match its directory`);
    const desc = body.match(/^description:\s*([\s\S]+?)(?:\n[a-z-]+:|$)/m)?.[1]?.trim();
    if (!desc) problems.push(`${name}: no description:`);
    else if (desc.length < 40) problems.push(`${name}: description is too short to trigger on`);
  }
  assert.deepEqual(problems, []);
});

test("the once-only rituals stay user-invocable only", () => {
  // These are destructive or one-time. The flag is easy to drop in an unrelated frontmatter edit,
  // and nothing else would notice until an agent auto-fired /migrate-engine on someone's repo.
  for (const name of ["onboard", "migrate-engine", "team-init", "connect-brain"]) {
    const src = readFileSync(join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
    assert.match(src, /^disable-model-invocation:\s*true$/m, `${name} must not be model-invocable`);
  }
});

test("/cortex-install is model-invocable, and its consent gate is what protects the repo", () => {
  // It carried disable-model-invocation alongside the destructive rituals above, with no stated
  // reason — it only reads. The flag was inherited, and it blocked the sequence from ever starting
  // on its own. What protects a repo is not the flag but the gate: nothing is written until the
  // user says yes. See docs/adr/0005-the-install-sequence-may-start-itself.md.
  const src = readFileSync(join(REPO_ROOT, "skills", "cortex-install", "SKILL.md"), "utf8");
  assert.doesNotMatch(
    src,
    /^disable-model-invocation:\s*true$/m,
    "cortex-install must stay model-invocable — the consent gate is the control, not the flag",
  );
  assert.match(
    src,
    /ask before writing anything/i,
    "the consent gate must be stated in the skill, since it replaces the flag as the protection",
  );

  // The other half of ADR 0005's bargain. Letting an agent start the sequence is only tolerable
  // because the sequence asks first and writes once — the offers are walked with nothing on disk,
  // then a single playback gates every write. Drop the playback and "model-invocable" stops being
  // a convenience and becomes an agent editing a repo it wandered into, so the two are tested
  // together and fail together.
  assert.match(
    src,
    /Take \*\*one\*\* confirmation for the whole set/,
    "the single-confirmation playback must be stated — it is what makes walking the offers safe",
  );
  assert.match(
    src,
    /prints the \*\*ranked worklist\*\*[\s\S]*writes nothing at all/,
    "the offer walk must state that it writes nothing; a wizard that already wrote is not asking",
  );
});

test("skills referenced by other skills exist", () => {
  // A ritual that hands off to a skill nobody wrote is a broken promise in output users read —
  // exactly how /cortex-scaffold came to be referenced before it existed.
  const skillsDir = join(REPO_ROOT, "skills");
  const present = new Set(readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory()));
  const missing = new Set();
  for (const name of present) {
    const src = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    for (const m of src.matchAll(/`\/(cortex-[a-z-]+|dream|scaffold)`/g)) {
      const ref = m[1];
      if (!present.has(ref)) missing.add(`${name} → /${ref}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("every ritual declares a capability floor", () => {
  // Self-hosted and small-model setups were a stated audience with nothing to consult: a ritual that
  // needs multi-round judgment looked exactly like one that appends a line to a file. The failure is
  // not a crash — a weak model runs /cortex-enrich and writes plausible, wrong summaries into recall,
  // and nobody notices. Declaring the floor is what lets a setup decide before running, rather than
  // discovering afterwards.
  //
  // Asserted for EVERY skill rather than a named list, so a new ritual cannot ship undeclared.
  const skillsDir = join(REPO_ROOT, "skills");
  const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());
  const VALID = new Set(["mechanical", "judgment", "strong"]);
  const bad = [];

  for (const name of names) {
    const src = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const m = src.match(/^capability:\s*(\S+)\s*$/m);
    if (!m) { bad.push(`${name}: no capability declared`); continue; }
    if (!VALID.has(m[1])) bad.push(`${name}: unknown capability "${m[1]}"`);
    // The key must live in the frontmatter, not in the body where nothing can read it.
    const fmEnd = src.indexOf("\n---", 4);
    if (fmEnd === -1 || src.indexOf(m[0]) > fmEnd) bad.push(`${name}: capability is outside the frontmatter`);
  }

  assert.deepEqual(bad, [], `capability floor problems:\n${bad.join("\n")}`);
});

test("a ritual above the mechanical floor says what to do when the floor is not met", () => {
  // A declared floor that offers no alternative is a wall. `strong` rituals are the ones a
  // self-hosted setup is most likely to fail, so each must either degrade or say plainly that it
  // cannot — silence leaves the user to find out by reading bad output.
  const skillsDir = join(REPO_ROOT, "skills");
  const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());
  const missing = [];

  for (const name of names) {
    const src = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    if (!/^capability:\s*strong\s*$/m.test(src)) continue;
    if (!/## When the floor is not met/m.test(src)) missing.push(name);
  }

  assert.deepEqual(missing, [], `these declare capability: strong but never say what a weaker setup should do:\n${missing.join("\n")}`);
});

test("a skill invokes Cortex's own scripts through the plugin root, never a repo-relative path", () => {
  // Rituals run INSIDE a target repo, where `index/` does not exist — the plugin lives in the
  // plugin cache. A skill telling the agent to run `node index/cortex-impact.mjs` fails with
  // MODULE_NOT_FOUND, and the agent that does not silently substitute an absolute path reports the
  // ritual as broken. Five skills carried 21 of these; two were added the same week, which is why
  // this is a test and not a note. The check is on the invocation, so a prose mention of a filename
  // is unaffected.
  const skillsDir = join(REPO_ROOT, "skills");
  const offenders = [];
  for (const name of readdirSync(skillsDir)) {
    const file = join(skillsDir, name, "SKILL.md");
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue; // not a skill directory
    }
    src.split(/\r?\n/).forEach((line, i) => {
      // `node <dir>/x.mjs` where <dir> is one of ours and the path is not rooted at the plugin.
      const m = line.match(/node\s+"?(?!\$\{CLAUDE_PLUGIN_ROOT\})(index|core|mcp|tools)\/[\w.-]+\.(mjs|js)/);
      if (m) offenders.push(`${name}/SKILL.md:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these invoke a Cortex script by a path that does not exist inside a target repo:\n${offenders.join("\n")}`,
  );
});

test("every skill that can create .cortex/ states the consent gate", () => {
  // ADR 0005 moved the protection from an invocation flag to "a consent gate on the first write",
  // and says plainly that the missing flag "is only safe while the gate is present". The gate was
  // written into /cortex-install and nowhere else, while /cortex-brief, /cortex-skills and
  // /cortex-enrich can all reach that first write on a repo where nothing has run — and one of them
  // did, creating .cortex/ on a user who was never asked.
  //
  // The .gitignore half now happens in code (index/lib/generated.mjs), because a machine can be
  // relied on to remember it. The asking cannot be, so it is checked here instead.
  const skillsDir = join(REPO_ROOT, "skills");
  const GATE = /`\.cortex\/` does not exist|never creates `\.cortex\/`/;
  const silent = [];
  for (const name of readdirSync(skillsDir)) {
    const file = join(skillsDir, name, "SKILL.md");
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Anything that runs the indexer, or writes under .cortex/ itself, can be the first write.
    const canCreate = /cortex-index\.mjs|writes `\.cortex\//.test(src);
    if (canCreate && !GATE.test(src)) silent.push(name);
  }
  assert.deepEqual(
    silent,
    [],
    `these can create .cortex/ without saying the user must be asked first:\n${silent.join("\n")}`,
  );
});
