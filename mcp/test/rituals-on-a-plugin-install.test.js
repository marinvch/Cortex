// The rituals that shell out to `ai-os.js` must work where Cortex is actually installed.
//
// A plugin install is a clone under `~/.claude/plugins/cache/cortex/cortex/<version>/` and nothing
// else: no vault checkout, no AI_OS_ROOT, and a cwd that is somebody's plain git repository.
// `/setup-plugins` and `/catch-me-up` both told the agent to run `node <vault>/mcp/ai-os.js`, a
// path that does not exist there — and even pointed at the plugin, `catch-up` demanded
// AI_OS_ROOT and exited 1 before reading anything.
//
// So these tests run the command EACH SKILL PRINTS, lifted out of its SKILL.md, from a copy of the
// plugin laid out the way the plugin cache lays it out. Testing `ai-os.js` directly would pass
// happily while the prose kept pointing somewhere else — the same failure through the other door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./tmp.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WIN = process.platform === "win32";

/** The `ai-os.js` command lines a skill tells the agent to run, from its fenced blocks and inline code. */
function commandsIn(skill) {
  const text = readFileSync(join(REPO, "skills", skill, "SKILL.md"), "utf8");
  const found = [];
  for (const m of text.matchAll(/```bash\r?\n([\s\S]*?)```/g)) {
    for (const line of m[1].split(/\r?\n/)) if (/ai-os\.js/.test(line)) found.push(line.trim());
  }
  for (const m of text.matchAll(/`(node [^`]*ai-os\.js[^`]*)`/g)) found.push(m[1].trim());
  return { text, found };
}

/** Turn a documented command into argv: substitute the plugin root and placeholders, drop quotes. */
function argvOf(line, pluginRoot, subs = {}) {
  let s = line.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
  for (const [k, v] of Object.entries(subs)) s = s.split(k).join(v);
  const parts = s.match(/"[^"]*"|\S+/g).map((p) => p.replace(/^"|"$/g, ""));
  assert.equal(parts[0], "node");
  return parts.slice(1);
}

/** The plugin cache's layout, copied from this checkout. Tests are not shipped runtime, so skip them. */
function pluginInstall(base) {
  const root = join(base, "plugins", "cache", "cortex", "cortex", "0.0.0");
  mkdirSync(root, { recursive: true });
  const skipTests = (src) => !src.split(sep).includes("test");
  for (const d of ["mcp", "core", "plugins"]) cpSync(join(REPO, d), join(root, d), { recursive: true, filter: skipTests });
  cpSync(join(REPO, "VERSION"), join(root, "VERSION"));
  return root;
}

function isolatedEnv(home, extra = {}) {
  const e = { ...process.env, HOME: home, USERPROFILE: home,
    GIT_CONFIG_GLOBAL: join(home, "gitconfig-absent"), GIT_CONFIG_SYSTEM: join(home, "gitsystem-absent") };
  delete e.AI_OS_ROOT;
  delete e.CORTEX_ROOT;
  delete e.CORTEX_AUDIENCE;
  delete e.CORTEX_PROFILE;
  return Object.assign(e, extra);
}

/** A plain product repo: one commit, two committed memory days far apart, no vault anywhere. */
function fixture() {
  const base = tempDir("plugin-install-");
  const home = join(base, "home");
  const proj = join(base, "product");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(proj, ".cortex", "memory"), { recursive: true });
  mkdirSync(join(proj, "src", "deep"), { recursive: true });
  writeFileSync(join(proj, ".cortex", "memory", "2026-09-01.md"), "# 2026-09-01\n\n## 10:00 · note\n\nmoved auth to the edge\n");
  writeFileSync(join(proj, ".cortex", "memory", "1999-01-01.md"), "# 1999-01-01\n\n## 10:00 · note\n\nancient history\n");
  const git = (...a) => execFileSync("git", a, { cwd: proj, env: isolatedEnv(home), stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(proj, "README.md"), "# product\n");
  git("add", ".");
  git("commit", "-qm", "rate-limit the login endpoint");
  return { base, home, proj, cwd: join(proj, "src", "deep"), pluginRoot: pluginInstall(base) };
}

function run(f, argv, { cwd = f.cwd, env = {} } = {}) {
  return spawnSync(process.execPath, argv, { cwd, env: isolatedEnv(f.home, env), encoding: "utf8" });
}

// ---------------------------------------------------------------------------------------------
// The prose
// ---------------------------------------------------------------------------------------------

for (const skill of ["setup-plugins", "cortex-install", "catch-me-up", "team-add", "team-init"]) {
  test(`/${skill} reaches ai-os.js through the plugin root, never a vault path`, () => {
    const { text, found } = commandsIn(skill);
    assert.ok(found.length > 0, `${skill} names no ai-os.js command`);
    assert.doesNotMatch(text, /<vault>\/mcp\//, "a plugin install has no vault checkout to find mcp/ in");
    for (const c of found) assert.match(c, /"\$\{CLAUDE_PLUGIN_ROOT\}\/mcp\/ai-os\.js"/, c);
  });
}

// The rule, not the list above: /team-add, /team-init and /connect-brain carried the same
// `<vault>/mcp/` path a release after /catch-me-up was fixed, because the fix named two skills.
// The code lives in the plugin (mcp/, tools/); a vault holds notes. No ritual may look for code there.
test("no ritual looks for Cortex's code inside a vault", () => {
  const offenders = [];
  for (const d of readdirSync(join(REPO, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const text = readFileSync(join(REPO, "skills", d.name, "SKILL.md"), "utf8");
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (/<vault>\/(mcp|tools|core|index)\//.test(line)) offenders.push(`skills/${d.name}/SKILL.md:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "use ${CLAUDE_PLUGIN_ROOT}/…, and CORTEX_ROOT for the vault itself");
});

test("/connect-brain registers the plugin's server, not a vault path", () => {
  const text = readFileSync(join(REPO, "skills", "connect-brain", "SKILL.md"), "utf8");
  assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/mcp\/server\.js"/);
  assert.match(text, /CORTEX_ROOT=<vault>/, "the vault is still named, as CORTEX_ROOT");
  // #552: the registration is `cortex`, so the tools read `mcp__cortex__…`, and the skill tells a
  // user who registered `ai-os` earlier that theirs keeps working.
  assert.match(text, /claude mcp add --scope user cortex /);
  assert.doesNotMatch(text, /claude mcp add --scope user ai-os /);
  assert.match(text, /AI_OS_ROOT/, "the older name is mentioned for the reader who has it");
});

test("the README registers the server as cortex, by CORTEX_ROOT, and says an ai-os registration keeps working", () => {
  // #552. The README is where a person copies the registration from, so it is where the old name
  // came back from every time. The section, not the file: `.ai-os/` is named elsewhere on purpose.
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const start = readme.indexOf("## Connect the live brain");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
  assert.ok(start > 0 && section.length > 300, "the section was found");
  assert.match(section, /claude mcp add --scope user cortex --env CORTEX_ROOT=\S+ -- node \S+\/mcp\/server\.js/);
  assert.match(section, /\{ "cortex": \{[^\n]*"env": \{ "CORTEX_ROOT": /, "the JSON form carries the same two names");
  assert.doesNotMatch(section, /mcp add[^\n]* ai-os /, "no command registers under the old name");
  assert.doesNotMatch(section, /\/path\/to\/ai-os/, "the clone in the examples is /path/to/cortex");
  assert.match(section, /`ai-os`[\s\S]{0,200}keeps working/, "an existing ai-os registration is said to keep working");
  assert.match(section, /`AI_OS_ROOT` is still read/, "and so is its variable");
  assert.match(section, /mcp\/ai-os\.js/, "what was not renamed is said where the new name is introduced");
});

// ---------------------------------------------------------------------------------------------
// The commands, as printed, on a plugin install
// ---------------------------------------------------------------------------------------------

test("/catch-me-up's command reads a plain repo with no vault and no root set", () => {
  const f = fixture();
  const [line] = commandsIn("catch-me-up").found;
  const r = run(f, argvOf(line, f.pluginRoot, { "<date>": "2026-01-01" }));
  assert.equal(r.status, 0, `catch-up failed on a plugin install:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.repo, "the repo half is the whole point on a plugin install");
  assert.equal(out.repo.memory.length, 1, "only the memory days on or after --since");
  assert.match(out.repo.memory[0].content, /moved auth to the edge/);
  assert.ok(out.repo.commits.some((c) => /rate-limit the login endpoint/.test(c)), out.repo.commits.join("\n"));
  assert.match(out.skipped, /CORTEX_ROOT is not set/, "an absent vault is said, not implied by an empty list");
  assert.deepEqual(out.notes, []);
});

test("/catch-me-up's command with a vault adds its notes to the repo's own history", () => {
  const f = fixture();
  const vault = join(f.base, "vault");
  mkdirSync(join(vault, "projects", "product"), { recursive: true });
  writeFileSync(join(vault, "projects", "product", "n1.md"), "product: decided to drop the legacy API");
  const [line] = commandsIn("catch-me-up").found;
  const argv = [...argvOf(line, f.pluginRoot, { "<date>": "1990-01-01" }), "--project", "product"];
  const r = run(f, argv, { env: { CORTEX_ROOT:vault } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.notes.some((n) => /legacy API/.test(n.snippet)), "the vault half");
  assert.equal(out.repo.memory.length, 2, "the repo half, both days since 1990");
  assert.equal(out.skipped, undefined);
});

test("catch-up with CORTEX_ROOT at a repo's .cortex reads that repo, from any cwd", () => {
  // Repo mode — what the plugin's own MCP server is configured with. The repo is the root's
  // parent; the cwd need not be inside it, and a project slug is not needed to name it.
  const f = fixture();
  const elsewhere = tempDir("elsewhere-");
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "catch-up", "--since", "2026-01-01"], { cwd: elsewhere, env: { CORTEX_ROOT:join(f.proj, ".cortex") } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.repo.memory.length, 1);
  assert.ok(out.repo.commits.some((c) => /rate-limit/.test(c)));
});

test("catch-up with neither a repo nor a vault says so and exits 1", () => {
  const f = fixture();
  const nowhere = tempDir("no-repo-");
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "catch-up", "--since", "2026-01-01"], { cwd: nowhere });
  // If the OS temp dir happens to sit inside a git work tree, this case cannot be built here.
  if (r.status === 0) return;
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not inside a git repository and CORTEX_ROOT is not set/);
});

test("catch-up without a root still refuses a misspelt CORTEX_PROFILE", () => {
  // A missing root is a degradation for catch-up; an unknown profile is not, and it must not ride
  // along because the root error used to be thrown first.
  const f = fixture();
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "catch-up", "--since", "2026-01-01"], { env: { CORTEX_PROFILE: "works" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown CORTEX_PROFILE/);
});

test("catch-up writes nothing to the repo it reads", () => {
  const f = fixture();
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const status = () => execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: f.proj, env: isolatedEnv(f.home) }).toString();
  const before = status();
  const r = run(f, [cli, "catch-up", "--since", "2000-01-01"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(status(), before);
});

test("/setup-plugins' command runs on a plugin install with no root set", () => {
  // A `claude` stub that fails `--version` sits first on PATH, so the command takes its degrade
  // path and prints the install commands — a test must never actually install plugins.
  const f = fixture();
  const bin = join(f.base, "bin");
  mkdirSync(bin, { recursive: true });
  if (WIN) writeFileSync(join(bin, "claude.cmd"), "@exit /b 1\r\n");
  else { writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 1\n"); chmodSync(join(bin, "claude"), 0o755); }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env = { [pathKey]: [bin, dirname(process.execPath)].join(WIN ? ";" : ":") };

  const [line] = commandsIn("setup-plugins").found;
  const r = run(f, argvOf(line, f.pluginRoot), { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude plugin install superpowers@/);
  assert.doesNotMatch(r.stderr, /CORTEX_ROOT|AI_OS_ROOT/);
});

// --- the tier status, as the two rituals print it (#548, item 11) ---------------------------------
//
// `/cortex-install` and `/setup-plugins` ask it before they offer a tier. The home directory is the
// fixture's, so the registry read is the one written here and never this machine's.

/** The status command a skill prints: the one line among its `ai-os.js` commands carrying `--status`. */
function statusCommand(skill) {
  const lines = commandsIn(skill).found.filter((c) => /--status/.test(c));
  assert.equal(lines.length, 1, `${skill} prints exactly one status command`);
  return lines[0];
}

/** Write a plugin registry into the fixture's home; `null` leaves the home with none. */
function registryIn(f, plugins) {
  const dir = join(f.home, ".claude", "plugins");
  mkdirSync(dir, { recursive: true });
  if (plugins !== null) writeFileSync(join(dir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
  return dir;
}

/** Every file under `dir` with its bytes, so "it wrote nothing" is checked over the whole tree. */
function fingerprint(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) { out.push(`${p}/`); walk(p); }
      else out.push(`${p}\n${readFileSync(p, "base64")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}

/** A PATH whose `claude` leaves a file behind when anything starts it. */
function claudeThatTells(f) {
  const bin = join(f.base, "bin-status");
  const told = join(f.base, "claude-was-started");
  mkdirSync(bin, { recursive: true });
  if (WIN) writeFileSync(join(bin, "claude.cmd"), `@echo x> "${told}"\r\n@exit /b 0\r\n`);
  else { writeFileSync(join(bin, "claude"), `#!/bin/sh\necho x > "${told}"\nexit 0\n`); chmodSync(join(bin, "claude"), 0o755); }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { told, env: { [pathKey]: [bin, dirname(process.execPath)].join(WIN ? ";" : ":") } };
}

for (const skill of ["cortex-install", "setup-plugins"]) {
  test(`/${skill}'s status command says which tiers are installed, starts no claude and writes nothing`, () => {
    const f = fixture();
    registryIn(f, {
      "playwright@claude-plugins-official": [{ scope: "user", version: "1.0.0" }],
      "chrome-devtools-mcp@claude-plugins-official": [{ scope: "user", version: "1.0.0" }],
      "typescript-lsp@claude-plugins-official": [{ scope: "user", version: "1.0.0" }],
    });
    const { told, env } = claudeThatTells(f);
    const before = fingerprint(f.base);
    const r = run(f, argvOf(statusCommand(skill), f.pluginRoot), { env });
    assert.equal(r.status, 0, r.stderr);
    const status = JSON.parse(r.stdout);
    const state = Object.fromEntries(status.tiers.map((t) => [t.tier, t.state]));
    assert.equal(status.registry, "read");
    assert.equal(state["browser-qa"], "installed", "both of its plugins are in the registry");
    assert.equal(state["dev-tools"], "partial", "one of two");
    assert.equal(state.api, "missing");
    assert.deepEqual(
      status.tiers.find((t) => t.tier === "dev-tools").plugins.filter((p) => !p.installed).map((p) => p.plugin),
      ["github@claude-plugins-official"],
      "a partial tier names what it lacks",
    );
    assert.equal(existsSync(told), false, "a status must never start the claude CLI");
    assert.equal(fingerprint(f.base), before, "and it leaves the home, the repo and the plugin byte-identical");
    assert.doesNotMatch(r.stderr, /CORTEX_ROOT|AI_OS_ROOT/, "no root is needed to read a registry");
  });

  test(`/${skill}'s status command says unknown on a machine with no plugin registry`, () => {
    const f = fixture();
    const r = run(f, argvOf(statusCommand(skill), f.pluginRoot));
    assert.equal(r.status, 0, r.stderr);
    const status = JSON.parse(r.stdout);
    assert.equal(status.registry, "absent");
    for (const t of status.tiers) assert.equal(t.state, "unknown", t.tier);
  });
}

test("setup-plugins --status reads the directory --plugins-dir names, and prints lines without --json", () => {
  const f = fixture();
  registryIn(f, {}); // the home's registry says nothing is installed
  const other = join(f.base, "other-plugins");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "postman@claude-plugins-official": [{ scope: "user" }] } }));
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "setup-plugins", "--status", "--plugins-dir", other]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^api\s+installed$/m);
  assert.match(r.stdout, /^core\s+missing$/m);
  assert.match(r.stdout, /^\s+postman@claude-plugins-official\s+installed$/m);

  const one = run(f, [cli, "setup-plugins", "--status", "--tier", "api", "--json", "--plugins-dir", other]);
  assert.deepEqual(JSON.parse(one.stdout).tiers.map((t) => t.tier), ["api"], "--tier limits the status to one tier");
});

test("setup-plugins --status refuses a --plugins-dir with no value, and an unknown tier", () => {
  // Falling back to the real registry would answer about this machine a caller that meant another.
  const f = fixture();
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "setup-plugins", "--status", "--plugins-dir"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--plugins-dir needs a directory/);
  const t = run(f, [cli, "setup-plugins", "--status", "--tier", "nope"]);
  assert.equal(t.status, 1);
  assert.match(t.stderr, /unknown tier/);
});

test("an unreadable registry is unknown, and the printed status says where it looked", () => {
  const f = fixture();
  const dir = registryIn(f, null);
  writeFileSync(join(dir, "installed_plugins.json"), "{ not json");
  const cli = join(f.pluginRoot, "mcp", "ai-os.js");
  const r = run(f, [cli, "setup-plugins", "--status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.split(/\r?\n/)[0], /could not be read/);
  assert.ok(r.stdout.includes(dir), "the directory is named, so the person can look");
  assert.doesNotMatch(r.stdout, /not installed|missing/);
});

test("/team-add's command joins a team-brain from a plugin install, cloning into the vault", () => {
  // A bare repo on disk is a complete remote, so no network. The script comes from the plugin; the
  // vault is only where the clone lands — which is what the skill now says, and what it runs.
  const f = fixture();
  const vault = join(f.base, "vault");
  mkdirSync(vault, { recursive: true });
  const remote = join(f.base, "team-brain.git");
  execFileSync("git", ["init", "-q", "--bare", remote], { env: isolatedEnv(f.home) });
  const [line] = commandsIn("team-add").found;
  const argv = argvOf(line, f.pluginRoot, { "<team>": "core", "<team-brain-git-url>": remote, "<this-project-slug>": "product" });
  const r = run(f, argv, { cwd: f.proj, env: { CORTEX_ROOT:vault } });
  assert.equal(r.status, 0, `team add failed on a plugin install:\n${r.stderr}`);
  assert.ok(existsSync(join(vault, "team", "core", ".git")), "the team-brain is cloned under the vault");
  const conn = JSON.parse(readFileSync(join(f.proj, ".cortex", "connector.json"), "utf8"));
  assert.deepEqual(conn, { team: "core", project: "product", teamBrainRepo: remote });
  // This checkout has no `origin`, so it joins unregistered: no project file without a repo.
  assert.match(r.stdout, /No project file written/);
  assert.match(r.stdout, /--project-repo/);
  assert.equal(existsSync(join(vault, "team", "core", "projects", "product.md")), false);
});

test("/team-add's command registers the project when the checkout has an origin", () => {
  // The same printed command, on a machine with no git identity and against a team-brain remote
  // that is still empty — the first repo of a team to join. The file must reach the remote.
  const f = fixture();
  const vault = join(f.base, "vault");
  mkdirSync(vault, { recursive: true });
  const remote = join(f.base, "team-brain.git");
  execFileSync("git", ["init", "-q", "--bare", remote], { env: isolatedEnv(f.home) });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example-org/product.git"], { cwd: f.proj, env: isolatedEnv(f.home) });
  const [line] = commandsIn("team-add").found;
  const argv = argvOf(line, f.pluginRoot, { "<team>": "core", "<team-brain-git-url>": remote, "<this-project-slug>": "product" });
  const r = run(f, [...argv, "--title", "Product"], { cwd: f.proj, env: { CORTEX_ROOT: vault } });
  assert.equal(r.status, 0, `team add failed on a plugin install:\n${r.stderr}`);
  assert.match(r.stdout, /committed and pushed/, r.stdout);
  const pushed = execFileSync("git", ["show", "HEAD:projects/product.md"], { cwd: remote, env: isolatedEnv(f.home) }).toString();
  assert.match(pushed, /^type: project$/m);
  assert.match(pushed, /^title: Product$/m);
  assert.match(pushed, /^repo: https:\/\/github\.com\/example-org\/product\.git$/m);
  assert.ok(existsSync(join(f.proj, ".cortex", "connector.json")));
});

test("/team-add names the removal command, and it runs from the plugin root", () => {
  const { text, found } = commandsIn("team-add");
  const remove = found.find((c) => / project remove /.test(c));
  assert.ok(remove, "the skill must name `ai-os project remove`");
  assert.match(text, /Ask before running/i, "removal pushes a deletion the whole team pulls");
  const f = fixture();
  const vault = join(f.base, "vault");
  mkdirSync(vault, { recursive: true });
  // No team-brain is joined here, so the command must refuse cleanly rather than crash.
  const r = run(f, argvOf(remove, f.pluginRoot, { "<slug>": "product" }), { cwd: f.proj, env: { CORTEX_ROOT: vault } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no team/);
});
