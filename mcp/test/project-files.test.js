// Project files in a team-brain: written by `team add`, listed by the brain, removed by one command.
//
// A project file is `projects/<slug>.md` at the top of a team-brain (docs/adr/0024). The format and
// the firewall check are core/project-file.js and are tested there; what is tested here is the
// ACT — that a write reaches the remote, that a refusal leaves both repositories exactly as they
// were, and that a removal cannot be pointed at anything but a project file.
//
// A bare repo on disk is a complete remote, so nothing touches the network. Every name is generic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addProject, listTeamProjects, removeProject, ProjectFileRefused } from "../lib/project-files.js";
import { listProjects } from "../lib/projects.js";
import { initTeamBrain } from "../lib/team.js";
import { validateProjectFile } from "../../core/project-file.js";
import { policyFor } from "../../core/profile.js";
import { OutsideRootError } from "../../core/paths.js";
import { tempDir } from "./tmp.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(MCP_DIR, "ai-os.js");
const SERVER = join(MCP_DIR, "server.js");

const TEAM = "example-team";
const HOME = policyFor("home");
const WORK = policyFor("work");
const LAB = policyFor("lab");
const PUBLIC_ORIGIN = "https://github.com/example-org/storefront.git";
const INTERNAL_ORIGIN = "https://git.example.internal/shop/storefront.git";

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** Every file under `dir`, `.git` included, as one hash. Equal before and after means untouched. */
function fingerprint(dir) {
  const h = createHash("sha256");
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) {
        h.update(`d ${r}\n`);
        walk(p, r);
      } else {
        h.update(`f ${r}\n`);
        h.update(readFileSync(p));
      }
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

// Fixtures are built once and COPIED. A git process is slow on a Windows machine, and a fixture
// needs a dozen of them; a copy needs one, to point the clone at its own copy of the remote. Every
// test still gets directories nobody else touches.
const templates = new Map();
function fromTemplate(name, build) {
  if (!templates.has(name)) templates.set(name, build());
  const src = templates.get(name);
  const base = realpathSync(tempDir("project-files-"));
  cpSync(src.base, base, { recursive: true });
  const f = { base, remote: join(base, "team-brain.git"), vault: join(base, "vault"), repo: join(base, "storefront") };
  f.clone = join(f.vault, "team", TEAM);
  git(f.clone, "remote", "set-url", "origin", f.remote);
  return f;
}

/** A product checkout with one commit and, when given, an `origin`. Never fetched from. */
function productRepo(base, name, origin) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "dev@example.com");
  git(dir, "config", "user.name", "dev");
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "first");
  if (origin) git(dir, "remote", "add", "origin", origin);
  return dir;
}

/**
 * A vault holding a seeded, pushed team-brain clone, its bare remote, and a product checkout.
 * `storefront` has a notes folder from the seed and no project file yet — the state every repo
 * of a team is in the first time `/team-add` runs there after this release.
 */
function fixture({ origin = PUBLIC_ORIGIN } = {}) {
  const f = fromTemplate("bare", () => {
    const base = realpathSync(tempDir("project-files-template-"));
    const remote = join(base, "team-brain.git");
    mkdirSync(remote);
    git(remote, "init", "--bare", "-q", "-b", "master");
    const vault = join(base, "vault");
    mkdirSync(vault);
    initTeamBrain(vault, { name: TEAM, repo: remote, projects: ["storefront"] });
    productRepo(base, "storefront", null);
    return { base };
  });
  if (origin) git(f.repo, "remote", "add", "origin", origin);
  return f;
}

const remoteHead = (f) => git(f.remote, "rev-parse", "master").trim();
const remoteFile = (f, path) => git(f.remote, "show", `master:${path}`);
const remoteHas = (f, path) => git(f.remote, "ls-tree", "-r", "--name-only", "master").split("\n").includes(path);
const add = (f, policy, extra = {}) =>
  addProject(f.vault, { team: TEAM, teamRepo: f.remote, project: "storefront", cwd: f.repo, today: "2026-10-09", policy, ...extra });

/** Put a project file into the clone by hand, committed and pushed, the way a teammate's would arrive. */
function teammateWrote(f, slug, text) {
  writeFileSync(join(f.clone, "projects", `${slug}.md`), text);
  git(f.clone, "add", "projects");
  git(f.clone, "commit", "-qm", `project: add ${slug}`);
  git(f.clone, "push", "-q", "origin", "HEAD");
}

const projectText = (title, repo, extra = "") => `---\ntype: project\ntitle: ${title}\nrepo: ${repo}\n${extra}---\n`;

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

test("team add writes the project file, commits it, and pushes it", () => {
  const f = fixture();
  const before = remoteHead(f);
  const res = add(f, HOME);

  assert.equal(res.file.action, "written");
  assert.equal(res.file.committed, true);
  assert.equal(res.file.pushed, true);
  assert.match(res.file.path, /team[\\/]example-team[\\/]projects[\\/]storefront\.md$/);

  assert.notEqual(remoteHead(f), before, "the commit reached the remote");
  assert.equal(git(f.remote, "log", "-1", "--format=%s", "master").trim(), "project: add storefront");
  const text = remoteFile(f, "projects/storefront.md");
  assert.equal(text, readFileSync(res.file.path, "utf8"));
  const v = validateProjectFile(text, { slug: "storefront" });
  assert.deepEqual(v.errors, []);
  assert.equal(v.data.repo, PUBLIC_ORIGIN, "the repo is the checkout's origin when no flag names one");
  assert.equal(v.data.title, "storefront", "the title falls back to the slug");
  assert.equal(v.data.created, "2026-10-09");
  assert.ok(remoteHas(f, "projects/storefront/.gitkeep"), "the notes folder sits beside the file");
});

test("the field flags fill the file, and --project-repo wins over origin", () => {
  const f = fixture();
  const res = add(f, HOME, {
    fields: {
      title: "Storefront",
      repo: "git@github.com:example-org/shop.git",
      tracker: "https://github.com/example-org/shop/issues",
      design: "https://design.example.com/file/abc?node-id=1",
      docs: "https://storefront.example.com/docs",
      related: "billing-api, auth-service",
    },
  });
  assert.equal(res.file.pushed, true);
  const v = validateProjectFile(remoteFile(f, "projects/storefront.md"), { slug: "storefront" });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(
    { ...v.data, prose: undefined },
    {
      type: "project",
      title: "Storefront",
      repo: "git@github.com:example-org/shop.git",
      tracker: "https://github.com/example-org/shop/issues",
      design: "https://design.example.com/file/abc?node-id=1",
      docs: "https://storefront.example.com/docs",
      related: ["billing-api", "auth-service"],
      created: "2026-10-09",
      prose: undefined,
    },
  );
  // Relations to projects nobody has registered yet are a warning for the person running it.
  assert.ok(res.file.warnings.some((w) => /billing-api/.test(w.msg)), JSON.stringify(res.file.warnings));
});

test("an existing project file is left byte for byte", () => {
  const f = fixture();
  const handWritten = projectText("Storefront", "https://github.com/example-org/storefront", "docs: https://storefront.example.com/docs\n") +
    "\nWritten by hand,  with odd   spacing.\r\n";
  teammateWrote(f, "storefront", handWritten);
  const head = remoteHead(f);

  // A second developer joins from a checkout whose origin is spelt differently.
  const other = productRepo(f.base, "storefront-2", "git@github.com:example-org/storefront.git");
  const res = add(f, HOME, { cwd: other });

  assert.equal(res.file.action, "unchanged");
  assert.equal(res.file.committed, false);
  assert.equal(res.file.status, "valid", "the command says what it joined, having read it and not rewritten it");
  assert.equal(readFileSync(join(f.clone, "projects", "storefront.md"), "utf8"), handWritten);
  assert.equal(remoteHead(f), head, "no commit was made for a file nobody changed");
});

test("a field flag on an existing file changes that line and leaves the prose", () => {
  const f = fixture();
  const prose = "\nWritten by hand,  with odd   spacing.\r\n\r\n---\ntitle: not frontmatter\n";
  teammateWrote(f, "storefront", projectText("Storefront", "https://github.com/example-org/storefront") + prose);

  const res = add(f, HOME, { fields: { tracker: "https://github.com/example-org/storefront/issues" } });

  assert.equal(res.file.action, "updated");
  assert.equal(res.file.pushed, true);
  assert.match(remoteFile(f, "projects/storefront.md"), /^tracker: https:\/\/github\.com\/example-org\/storefront\/issues$/m);
  // The working file, not the blob: git may normalise line endings on the way in, and the promise
  // is about the bytes this command wrote.
  const text = readFileSync(join(f.clone, "projects", "storefront.md"), "utf8");
  assert.ok(text.endsWith(prose), "the prose is untouched");
  assert.equal(
    text.slice(0, -prose.length),
    "---\ntype: project\ntitle: Storefront\nrepo: https://github.com/example-org/storefront\ntracker: https://github.com/example-org/storefront/issues\n---\n",
  );
});

test("a flag that makes an existing file invalid is refused and the file is not changed", () => {
  const f = fixture();
  const text = projectText("Storefront", "https://github.com/example-org/storefront");
  teammateWrote(f, "storefront", text);
  const head = remoteHead(f);
  assert.throws(() => add(f, HOME, { fields: { related: "storefront" } }), (e) => e instanceof ProjectFileRefused && e.code === "invalid" && /own/.test(e.message));
  assert.equal(readFileSync(join(f.clone, "projects", "storefront.md"), "utf8"), text);
  assert.equal(remoteHead(f), head);
});

// ---------------------------------------------------------------------------------------------
// The firewall: home refuses, work pushes, lab keeps it local
// ---------------------------------------------------------------------------------------------

test("home refuses a project whose repo is employer-shaped, and both repositories are untouched", () => {
  const f = fixture({ origin: INTERNAL_ORIGIN });
  const before = { remote: fingerprint(f.remote), clone: fingerprint(f.clone), repo: fingerprint(f.repo) };

  assert.throws(
    () => add(f, HOME),
    (e) => {
      assert.ok(e instanceof ProjectFileRefused);
      assert.equal(e.code, "employer_shaped_link");
      assert.match(e.message, /`repo`/);
      assert.match(e.message, /private-network host/);
      assert.match(e.message, /work install/);
      assert.match(e.message, /floor/);
      assert.doesNotMatch(e.message, /example\.internal/, "the refusal does not repeat the link");
      return true;
    },
  );

  assert.equal(fingerprint(f.remote), before.remote, "the team-brain remote");
  assert.equal(fingerprint(f.clone), before.clone, "the team-brain clone");
  assert.equal(fingerprint(f.repo), before.repo, "the product repo");
  assert.equal(existsSync(join(f.repo, ".cortex")), false);
});

test("the same input is written and pushed on work", () => {
  const f = fixture({ origin: INTERNAL_ORIGIN });
  const res = add(f, WORK);
  assert.equal(res.file.action, "written");
  assert.equal(res.file.pushed, true);
  assert.equal(validateProjectFile(remoteFile(f, "projects/storefront.md")).data.repo, INTERNAL_ORIGIN);
});

test("the same input is written and committed on lab, and never pushed", () => {
  const f = fixture({ origin: INTERNAL_ORIGIN });
  const before = fingerprint(f.remote);
  const res = add(f, LAB);
  assert.equal(res.file.action, "written");
  assert.equal(res.file.committed, true);
  assert.equal(res.file.pushed, false);
  assert.equal(res.file.error, "outward_sync_disabled");
  assert.equal(git(f.clone, "log", "-1", "--format=%s").trim(), "project: add storefront");
  assert.equal(git(f.clone, "status", "--porcelain").trim(), "", "committed, not left lying in the tree");
  assert.equal(fingerprint(f.remote), before, "nothing may reach the remote on a sealed profile");
});

test("the refusal follows policy.refuses, not a profile's name", () => {
  const f = fixture({ origin: INTERNAL_ORIGIN });
  assert.throws(() => add(f, { label: "contractor", refuses: "employer", outwardSync: true }), (e) => e.code === "employer_shaped_link");
  const res = add(f, { label: "home", refuses: "nothing", outwardSync: true });
  assert.equal(res.file.pushed, true);
});

test("home refuses an employer-shaped link in any of the four fields", () => {
  for (const key of ["repo", "tracker", "design", "docs"]) {
    const f = fixture();
    const before = fingerprint(f.remote);
    assert.throws(() => add(f, HOME, { fields: { [key]: "https://tenant.atlassian.net/browse/SHOP-12" } }), (e) => e.code === "employer_shaped_link" && e.message.includes(`\`${key}\``), key);
    assert.equal(fingerprint(f.remote), before, key);
  }
});

test("a home refusal happens before the team-brain is even cloned", () => {
  const base = realpathSync(tempDir("project-files-fresh-"));
  const remote = join(base, "team-brain.git");
  mkdirSync(remote);
  git(remote, "init", "--bare", "-q", "-b", "master");
  const vault = join(base, "vault");
  mkdirSync(vault);
  const repo = productRepo(base, "storefront", INTERNAL_ORIGIN);
  assert.throws(() => addProject(vault, { team: TEAM, teamRepo: remote, project: "storefront", cwd: repo, today: "2026-10-09", policy: HOME }), (e) => e.code === "employer_shaped_link");
  assert.deepEqual(readdirSync(vault), [], "nothing was cloned into the vault");
});

test("home refuses to add a flag to a file that already holds an employer-shaped link", () => {
  const f = fixture();
  const text = projectText("Storefront", "https://github.com/example-org/storefront", "tracker: https://tracker.internal/browse/SHOP\n");
  teammateWrote(f, "storefront", text);
  const head = remoteHead(f);
  assert.throws(() => add(f, HOME, { fields: { docs: "https://storefront.example.com/docs" } }), (e) => e.code === "employer_shaped_link");
  assert.equal(readFileSync(join(f.clone, "projects", "storefront.md"), "utf8"), text);
  assert.equal(remoteHead(f), head);
});

// ---------------------------------------------------------------------------------------------
// Credentials are refused, never stripped
// ---------------------------------------------------------------------------------------------

test("an origin carrying a password is refused with a request for --project-repo, and not stripped", () => {
  const secret = "not-a-real-pass";
  const f = fixture({ origin: ["https://deploy", secret].join(":") + "@github.com/example-org/storefront.git" });
  const before = { remote: fingerprint(f.remote), clone: fingerprint(f.clone), repo: fingerprint(f.repo) };
  for (const policy of [HOME, WORK, LAB]) {
    assert.throws(
      () => add(f, policy),
      (e) => e instanceof ProjectFileRefused && e.code === "origin_has_credential" && /--project-repo/.test(e.message) && !e.message.includes(secret),
    );
  }
  assert.deepEqual({ remote: fingerprint(f.remote), clone: fingerprint(f.clone), repo: fingerprint(f.repo) }, before);
});

test("--project-repo is the way past a credentialed origin", () => {
  const f = fixture({ origin: "https://" + "holder" + "@github.com/example-org/storefront.git" });
  const res = add(f, HOME, { fields: { repo: "https://github.com/example-org/storefront" } });
  assert.equal(res.file.pushed, true);
  const text = remoteFile(f, "projects/storefront.md");
  assert.doesNotMatch(text, /holder/);
});

test("a link flag carrying a credential is refused with nothing written", () => {
  const f = fixture();
  const before = fingerprint(f.remote);
  const tracker = "https://tracker.example.com/x?access_" + "token=abc123";
  assert.throws(() => add(f, WORK, { fields: { tracker } }), (e) => e.code === "invalid" && /tracker/.test(e.message) && /credential/.test(e.message) && !e.message.includes("abc123"));
  assert.equal(fingerprint(f.remote), before);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
});

test("a file that validates but carries a secret elsewhere is refused by the secret gate", () => {
  // A title is free text, so no link rule looks at it. The file is about to be pushed, so
  // core/scrub.js does — and it refuses, it does not blank the value.
  const f = fixture();
  const before = fingerprint(f.remote);
  const title = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
  assert.throws(() => add(f, WORK, { fields: { title } }), (e) => e.code === "refused_write" && !e.message.includes(title));
  assert.equal(fingerprint(f.remote), before);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
});

// ---------------------------------------------------------------------------------------------
// What is not written
// ---------------------------------------------------------------------------------------------

test("a checkout with no origin still joins, and its project is left unregistered", () => {
  const f = fixture({ origin: null });
  const head = remoteHead(f);
  const res = add(f, HOME);
  assert.equal(res.file.action, "skipped");
  assert.match(res.file.reason, /--project-repo/);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false, "no file is written without a repo");
  assert.equal(remoteHead(f), head);
});

test("an origin that is a path on this machine is never written into a shared file", () => {
  const f = fixture({ origin: null });
  git(f.repo, "remote", "add", "origin", f.remote);
  const res = add(f, HOME);
  assert.equal(res.file.action, "skipped");
  assert.match(res.file.reason, /--project-repo/);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
});

test("an invalid field flag is refused, naming the key", () => {
  const f = fixture();
  const before = fingerprint(f.remote);
  assert.throws(() => add(f, WORK, { fields: { tracker: "ftp://tracker.example.com/x" } }), (e) => e.code === "invalid" && /'tracker'/.test(e.message));
  assert.throws(() => add(f, WORK, { fields: { repo: "http://github.com/example-org/storefront" } }), (e) => e.code === "invalid" && /'repo'/.test(e.message));
  assert.throws(() => add(f, WORK, { fields: { title: "x".repeat(81) } }), (e) => e.code === "invalid" && /'title'/.test(e.message));
  assert.equal(fingerprint(f.remote), before);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
});

test("a project name that is not a slug is refused before anything is touched", () => {
  const f = fixture();
  const before = { remote: fingerprint(f.remote), clone: fingerprint(f.clone) };
  for (const project of ["My App", "../x", "storefront/notes", "Storefront", ""]) {
    assert.throws(() => add(f, WORK, { project }), (e) => e instanceof ProjectFileRefused && e.code === "invalid_slug", project);
  }
  assert.deepEqual({ remote: fingerprint(f.remote), clone: fingerprint(f.clone) }, before);
});

// ---------------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------------

/** A workspace of three files, a README, a top-level note, and one folder nobody registered. */
function workspace() {
  return fromTemplate("workspace", () => {
    const f = fixture();
    add(f, WORK, { fields: { title: "Storefront", tracker: "https://github.com/example-org/storefront/issues", related: "billing-api, auth-service" } });
    writeFileSync(join(f.clone, "projects", "billing-api.md"), projectText("Billing API", "git@github.com:example-org/billing-api.git", "docs: https://billing.example.com/docs\n") + "\nTakes payments.\n");
    writeFileSync(join(f.clone, "projects", "README.md"), "# Projects\n\nOne file per project.\n");
    teammateWrote(f, "2026-10-01-loose", "---\ntype: brain-note\ncreated: 2026-10-01\n---\n\nA note filed one level too high.\n");
    mkdirSync(join(f.clone, "projects", "docs-site"));
    writeFileSync(join(f.clone, "projects", "docs-site", "2026-10-02-abc.md"), "---\ntype: brain-note\ncreated: 2026-10-02\n---\n\nA note.\n");
    mkdirSync(join(f.vault, "projects"));
    writeFileSync(join(f.vault, "projects", "garden.md"), "# Garden\n");
    return f;
  });
}

test("list_projects keeps the vault's entries and marks where each came from", () => {
  const f = workspace();
  assert.deepEqual(listProjects(f.vault), [{ slug: "garden", path: join(f.vault, "projects", "garden.md"), source: "vault" }]);
});

test("list_projects gains one entry per project file when the brain has a team clone", () => {
  const f = workspace();
  const all = listProjects(f.vault, { team: TEAM, policy: WORK });
  assert.deepEqual(all.map((p) => `${p.source}:${p.slug}`), ["team:billing-api", "team:docs-site", "vault:garden", "team:storefront"]);

  const shop = all.find((p) => p.slug === "storefront");
  assert.deepEqual(shop, {
    slug: "storefront",
    path: join(f.clone, "projects", "storefront.md"),
    source: "team",
    title: "Storefront",
    repo: PUBLIC_ORIGIN,
    links: { tracker: "https://github.com/example-org/storefront/issues" },
    related: ["billing-api", "auth-service"],
    errors: [],
    warnings: shop.warnings,
  });
  assert.deepEqual(shop.warnings.map((w) => w.key), ["related"]);
  assert.match(shop.warnings[0].msg, /auth-service/);
  assert.doesNotMatch(shop.warnings[0].msg, /billing-api/, "billing-api has a file");

  const billing = all.find((p) => p.slug === "billing-api");
  assert.deepEqual(billing.links, { docs: "https://billing.example.com/docs" });
  assert.equal(JSON.stringify(billing).includes("Takes payments"), false, "the listing carries no prose");
});

test("a folder with no project file beside it is listed as unregistered", () => {
  const f = workspace();
  const all = listProjects(f.vault, { team: TEAM, policy: WORK });
  assert.deepEqual(all.find((p) => p.slug === "docs-site"), {
    slug: "docs-site", path: join(f.clone, "projects", "docs-site"), source: "team", unregistered: true,
  });
  assert.equal(all.filter((p) => p.slug === "storefront").length, 1, "a folder beside its file is that project's notes, not a second entry");
});

test("a README or a note in projects/ is skipped and counted, never an error", () => {
  const f = workspace();
  const { projects, skipped } = listTeamProjects(f.vault, { team: TEAM, policy: WORK });
  assert.equal(skipped, 2);
  assert.ok(!projects.some((p) => /README|loose/.test(p.slug)));
});

test("an invalid project file is listed with its errors, and two files on one repo are warned", () => {
  const f = workspace();
  teammateWrote(f, "auth-service", "---\ntype: project\ntitle: Auth\nrepo: http://github.com/example-org/auth\ntrakcer: https://example.com/x\n---\n");
  teammateWrote(f, "shop", projectText("Shop", "git@github.com:example-org/storefront.git"));
  const all = listProjects(f.vault, { team: TEAM, policy: WORK });
  const auth = all.find((p) => p.slug === "auth-service");
  assert.deepEqual(auth.errors.map((e) => e.key).sort(), ["repo", "trakcer"]);
  assert.ok(auth.errors.every((e) => typeof e.line === "number" && e.msg));
  assert.deepEqual(all.find((p) => p.slug === "shop").warnings.map((w) => w.key), ["repo"]);
  assert.deepEqual(all.find((p) => p.slug === "storefront").warnings.map((w) => w.key), ["repo"], "related now resolves; the shared repo is what is left");
});

test("on home, a file with an employer-shaped link is listed by slug and reason and nothing else", () => {
  const f = workspace();
  teammateWrote(f, "ledger", projectText("Quarterly Ledger", "https://github.com/example-org/ledger", "tracker: https://tenant.atlassian.net/browse/LED-1\ndocs: https://ledger.example.com/handbook\n") + "\nProse about the ledger.\n");
  const before = fingerprint(f.clone);

  const onHome = listProjects(f.vault, { team: TEAM, policy: HOME }).find((p) => p.slug === "ledger");
  assert.deepEqual(Object.keys(onHome).sort(), ["path", "slug", "source", "withheld"]);
  assert.match(onHome.withheld, /`tracker`/);
  assert.match(onHome.withheld, /hosted work tool/);
  const shown = JSON.stringify(onHome);
  for (const hidden of ["Quarterly", "atlassian", "handbook", "example-org/ledger", "Prose about"]) {
    assert.equal(shown.includes(hidden), false, `'${hidden}' must be withheld`);
  }
  assert.equal(fingerprint(f.clone), before, "a reader reports the file; it never deletes or moves it");

  for (const policy of [WORK, LAB]) {
    const full = listProjects(f.vault, { team: TEAM, policy }).find((p) => p.slug === "ledger");
    assert.equal(full.title, "Quarterly Ledger");
    assert.equal(full.links.tracker, "https://tenant.atlassian.net/browse/LED-1");
    assert.equal(full.withheld, undefined);
  }
});

test("a team with no clone lists nothing for the team, and does not throw", () => {
  const vault = realpathSync(tempDir("project-files-noclone-"));
  assert.deepEqual(listProjects(vault, { team: TEAM, policy: HOME }), []);
});

// ---------------------------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------------------------

test("project remove deletes the file, commits, pushes, and says what it left behind", () => {
  const f = workspace();
  writeFileSync(join(f.clone, "projects", "storefront", "2026-10-03-abc.md"), "---\ntype: brain-note\ncreated: 2026-10-03\n---\n\nA note.\n");
  teammateWrote(f, "billing-api", projectText("Billing API", "git@github.com:example-org/billing-api.git", "related: storefront\n"));

  const res = removeProject(f.vault, { team: TEAM, project: "storefront", policy: WORK });

  assert.equal(res.committed, true);
  assert.equal(res.pushed, true);
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
  assert.equal(remoteHas(f, "projects/storefront.md"), false, "the removal reached the remote");
  assert.equal(git(f.remote, "log", "-1", "--format=%s", "master").trim(), "project: remove storefront");
  assert.equal(git(f.remote, "log", "-1", "--format=%s", "--diff-filter=D", "master", "--", "projects/storefront.md").trim(), "project: remove storefront");

  // Memory is never deleted, and nobody else's file is rewritten.
  assert.ok(existsSync(join(f.clone, "projects", "storefront", "2026-10-03-abc.md")));
  assert.equal(res.left.notes, join(f.clone, "projects", "storefront"));
  assert.deepEqual(res.left.relatedIn, ["billing-api"]);
  assert.match(readFileSync(join(f.clone, "projects", "billing-api.md"), "utf8"), /related: storefront/);
  assert.match(res.left.connector, /connector\.json/);

  // The file that still declares the relation validates, with a warning.
  const billing = listProjects(f.vault, { team: TEAM, policy: WORK }).find((p) => p.slug === "billing-api");
  assert.deepEqual(billing.errors, []);
  assert.deepEqual(billing.warnings.map((w) => w.key), ["related"]);
  assert.ok(listProjects(f.vault, { team: TEAM, policy: WORK }).find((p) => p.slug === "storefront").unregistered, "the notes folder is now unregistered");
});

test("project remove refuses a slug that climbs out of projects/, at the root guard", () => {
  const f = workspace();
  // Both targets are real project files, so only the guard stands between the command and them.
  writeFileSync(join(f.clone, "x.md"), projectText("X", "https://github.com/example-org/x"));
  writeFileSync(join(f.vault, "y.md"), projectText("Y", "https://github.com/example-org/y"));
  const before = fingerprint(f.clone);
  for (const project of ["../x", "../../../y", "storefront/../../x"]) {
    assert.throws(
      () => removeProject(f.vault, { team: TEAM, project, policy: WORK }),
      (e) => e instanceof OutsideRootError && e.code === "outside_root",
      project,
    );
  }
  assert.equal(fingerprint(f.clone), before);
  assert.ok(existsSync(join(f.clone, "x.md")));
  assert.ok(existsSync(join(f.vault, "y.md")));
});

test("project remove cannot be pointed at a note", () => {
  const f = workspace();
  const before = fingerprint(f.clone);
  // A note inside a project's folder: a path under projects/, but not a slug.
  assert.throws(() => removeProject(f.vault, { team: TEAM, project: "docs-site/2026-10-02-abc", policy: WORK }), (e) => e.code === "invalid_slug");
  // A top-level file with a slug-shaped name that is not `type: project`.
  assert.throws(() => removeProject(f.vault, { team: TEAM, project: "2026-10-01-loose", policy: WORK }), (e) => e.code === "not_a_project_file");
  // A folder.
  assert.throws(() => removeProject(f.vault, { team: TEAM, project: "docs-site", policy: WORK }), (e) => e.code === "not_found");
  assert.equal(fingerprint(f.clone), before);
});

test("project remove says a project that is not there is not there", () => {
  const f = workspace();
  const head = remoteHead(f);
  assert.throws(() => removeProject(f.vault, { team: TEAM, project: "ghost", policy: WORK }), (e) => e instanceof ProjectFileRefused && e.code === "not_found");
  assert.throws(() => removeProject(f.vault, { team: "no-such-team", project: "storefront", policy: WORK }), (e) => e.code === "no_team_clone");
  assert.equal(remoteHead(f), head);
});

test("project remove says so when a teammate already removed the project upstream", () => {
  const f = workspace();
  const teammate = join(f.base, "teammate-clone");
  git(f.base, "clone", "-q", f.remote, teammate);
  git(teammate, "config", "user.email", "mate@example.com");
  git(teammate, "config", "user.name", "mate");
  git(teammate, "rm", "-q", "projects/storefront.md");
  git(teammate, "commit", "-qm", "project: remove storefront");
  git(teammate, "push", "-q", "origin", "HEAD");
  const head = remoteHead(f);

  assert.throws(
    () => removeProject(f.vault, { team: TEAM, project: "storefront", policy: WORK }),
    (e) => e instanceof ProjectFileRefused && e.code === "not_found" && /upstream/.test(e.message),
  );
  assert.equal(remoteHead(f), head, "no second removal commit");
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false, "the pull brought the removal in");
  assert.equal(git(f.clone, "rev-parse", "HEAD").trim(), head, "and the pull is all that happened to the clone");
});

test("project remove on lab commits locally and pushes nothing", () => {
  const f = workspace();
  const before = fingerprint(f.remote);
  const res = removeProject(f.vault, { team: TEAM, project: "storefront", policy: LAB });
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.equal(res.error, "outward_sync_disabled");
  assert.equal(existsSync(join(f.clone, "projects", "storefront.md")), false);
  assert.equal(git(f.clone, "log", "-1", "--format=%s").trim(), "project: remove storefront");
  assert.equal(fingerprint(f.remote), before);
});

test("project remove can delete a file that is invalid, as long as it is a project file", () => {
  const f = workspace();
  teammateWrote(f, "broken", "---\ntype: project\ntitle: Broken\n---\n");
  const res = removeProject(f.vault, { team: TEAM, project: "broken", policy: WORK });
  assert.equal(res.pushed, true);
  assert.equal(remoteHas(f, "projects/broken.md"), false);
});

// ---------------------------------------------------------------------------------------------
// The two adapters
// ---------------------------------------------------------------------------------------------

function envFor(f, extra = {}) {
  const home = join(f.base, "home");
  mkdirSync(home, { recursive: true });
  // No global git config: the commands must work for a member whose machine has no identity set.
  const e = {
    ...process.env, AI_OS_ROOT: f.vault, HOME: home, USERPROFILE: home,
    GIT_CONFIG_GLOBAL: join(home, "gitconfig-absent"), GIT_CONFIG_SYSTEM: join(home, "gitsystem-absent"),
  };
  delete e.CORTEX_AUDIENCE;
  delete e.CORTEX_PROFILE;
  return Object.assign(e, extra);
}

const cli = (f, argv, extra = {}, cwd = f.repo) =>
  spawnSync(process.execPath, [CLI, ...argv], { cwd, env: envFor(f, extra), encoding: "utf8" });

test("ai-os team add writes the project file and then the connector", () => {
  const f = fixture();
  const r = cli(f, ["team", "add", "--name", TEAM, "--repo", f.remote, "--project", "storefront",
    "--title", "Storefront", "--tracker", "https://github.com/example-org/storefront/issues", "--related", "billing-api"]);
  assert.equal(r.status, 0, r.stderr);
  const v = validateProjectFile(remoteFile(f, "projects/storefront.md"), { slug: "storefront" });
  assert.deepEqual(v.errors, []);
  assert.equal(v.data.title, "Storefront");
  assert.equal(v.data.repo, PUBLIC_ORIGIN);
  assert.deepEqual(v.data.related, ["billing-api"]);
  assert.match(r.stdout, /projects[\\/]storefront\.md/);
  assert.match(r.stdout, /pushed/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.repo, ".cortex", "connector.json"), "utf8")), { team: TEAM, project: "storefront", teamBrainRepo: f.remote });
  assert.equal(git(f.repo, "log", "--oneline").trim().split("\n").length, 1, "the product repo is never committed for the user");
});

test("ai-os team add on home refuses an employer-shaped origin and writes no connector", () => {
  const f = fixture({ origin: INTERNAL_ORIGIN });
  const before = { remote: fingerprint(f.remote), repo: fingerprint(f.repo) };
  const r = cli(f, ["team", "add", "--name", TEAM, "--repo", f.remote, "--project", "storefront"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /private-network host/);
  assert.match(r.stderr, /work install/);
  assert.deepEqual({ remote: fingerprint(f.remote), repo: fingerprint(f.repo) }, before);

  const onWork = cli(f, ["team", "add", "--name", TEAM, "--repo", f.remote, "--project", "storefront"], { CORTEX_PROFILE: "work" });
  assert.equal(onWork.status, 0, onWork.stderr);
  assert.ok(remoteHas(f, "projects/storefront.md"));

  const g = fixture({ origin: INTERNAL_ORIGIN });
  const head = remoteHead(g);
  const onLab = cli(g, ["team", "add", "--name", TEAM, "--repo", g.remote, "--project", "storefront"], { CORTEX_PROFILE: "lab" });
  assert.equal(onLab.status, 0, onLab.stderr);
  assert.match(onLab.stdout, /NOT pushed: outward_sync_disabled/);
  assert.ok(existsSync(join(g.clone, "projects", "storefront.md")));
  assert.equal(remoteHead(g), head);
});

test("ai-os project list prints what list_projects returns", async () => {
  const f = workspace();
  cli(f, ["team", "add", "--name", TEAM, "--repo", f.remote, "--project", "storefront"], { CORTEX_PROFILE: "work" });

  const r = cli(f, ["project", "list"], { CORTEX_PROFILE: "work" });
  assert.equal(r.status, 0, r.stderr);
  const viaCli = JSON.parse(r.stdout);
  assert.deepEqual(viaCli, listProjects(f.vault, { team: TEAM, policy: WORK }));
  assert.match(r.stderr, /2 other \.md files/);

  const viaServer = await callTool(f, "list_projects", {}, { CORTEX_PROFILE: "work" });
  assert.deepEqual(viaServer, viaCli, "the same inputs give the same answer in both adapters");
  assert.ok(viaServer.some((p) => p.source === "team" && p.slug === "storefront" && p.title === "Storefront"));

  // And the withholding is the server's too, not only the library's.
  const onHome = await callTool(workspaceWithLedger(f), "list_projects", {});
  const ledger = onHome.find((p) => p.slug === "ledger");
  assert.deepEqual(Object.keys(ledger).sort(), ["path", "slug", "source", "withheld"]);
});

function workspaceWithLedger(f) {
  teammateWrote(f, "ledger", projectText("Quarterly Ledger", "https://github.com/example-org/ledger", "tracker: https://tenant.atlassian.net/browse/LED-1\n"));
  return f;
}

/** Spawn the real server from the connected repo and call one tool. */
function callTool(f, tool, args, extra = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd: f.repo, env: envFor(f, extra) });
  let buf = "";
  let errBuf = "";
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 2) resolve(m); } catch { /* a partial line */ }
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => { if (code !== 0 && code !== null) reject(new Error(`server exited ${code}\n${errBuf.trim()}`)); });
    setTimeout(() => reject(new Error(`timed out\n${errBuf.trim()}`)), 8000);
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
  return got.then((res) => {
    child.kill();
    assert.ok(!res.result.isError, res.result.content?.[0]?.text);
    return JSON.parse(res.result.content[0].text);
  });
}

test("ai-os project check exits non-zero on an error, and on a withheld file", () => {
  const f = workspace();
  const clean = cli(f, ["project", "check", "--team", TEAM], { CORTEX_PROFILE: "work" });
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);
  assert.match(clean.stdout, /storefront/);
  assert.match(clean.stdout, /warning.*auth-service/);

  teammateWrote(f, "auth-service", "---\ntype: project\ntitle: Auth\nrepo: http://github.com/example-org/auth\n---\n");
  const bad = cli(f, ["project", "check", "--team", TEAM], { CORTEX_PROFILE: "work" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /auth-service\.md:4: 'repo'/);

  const g = workspaceWithLedger(workspace());
  assert.equal(cli(g, ["project", "check", "--team", TEAM], { CORTEX_PROFILE: "work" }).status, 0);
  const onHome = cli(g, ["project", "check", "--team", TEAM]);
  assert.equal(onHome.status, 1);
  assert.match(onHome.stdout, /ledger.*withheld/);
  assert.doesNotMatch(onHome.stdout, /atlassian|Quarterly/);
});

test("ai-os project remove removes, and prints what it left", () => {
  const f = workspace();
  cli(f, ["team", "add", "--name", TEAM, "--repo", f.remote, "--project", "storefront"], { CORTEX_PROFILE: "work" });
  // From inside the joined repo, the team comes from the connector.
  const r = cli(f, ["project", "remove", "--project", "storefront"], { CORTEX_PROFILE: "work" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(remoteHas(f, "projects/storefront.md"), false);
  assert.match(r.stdout, /Removed/);
  assert.match(r.stdout, /projects[\\/]storefront\b.*notes/s);
  assert.match(r.stdout, /connector\.json/);

  const again = cli(f, ["project", "remove", "--project", "storefront"], { CORTEX_PROFILE: "work" });
  assert.equal(again.status, 1);
  const escape = cli(f, ["project", "remove", "--project", "../x"], { CORTEX_PROFILE: "work" });
  assert.equal(escape.status, 1);
  assert.match(escape.stderr, /escapes/);
  const usage = cli(f, ["project", "remove"], { CORTEX_PROFILE: "work" });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /usage: ai-os project remove --project <slug>/);
});

test("the project commands do not exist in repo mode", () => {
  const f = workspace();
  for (const sub of ["list", "check", "remove"]) {
    const r = cli(f, ["project", sub, "--project", "storefront", "--team", TEAM], { AI_OS_ROOT: join(f.repo, ".cortex") });
    assert.equal(r.status, 1, sub);
    assert.match(r.stderr, /vault/, sub);
  }
  assert.ok(existsSync(join(f.clone, "projects", "storefront.md")));
});

test("the usage line names the project command", () => {
  const f = fixture();
  const r = cli(f, ["nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: ai-os <[^>]*\bproject\b[^>]*>/);
  assert.match(cli(f, ["project"]).stderr, /usage: ai-os project list\|check\|remove/);
});
