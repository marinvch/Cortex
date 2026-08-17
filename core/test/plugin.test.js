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
