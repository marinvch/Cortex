// Asks between roles across repos (#620) — the acceptance, on real git repositories.
//
// One team-brain (a bare remote on disk, so no network), two product repos in repo mode, as a
// plugin install runs them: CORTEX_ROOT is each repo's `.cortex/`, and the team-brain is cloned on
// first use from the connector's `teamBrainRepo`. An agent in repo A asks the role `backend`; the
// member holding `backend` sees it from repo B without naming A, answers, and A's inbox shows the
// answer and the status.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAsk, renderAsk, placeCaller, resolveAddressee, AskRefused } from "../lib/asks.js";
import { checkMember, parseRoster, setMember, RosterError } from "../lib/roster.js";
import { tempDir } from "./tmp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.js");
const CLI = join(HERE, "..", "ai-os.js");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const FAKE_AWS_KEY = ["AKIA", "Q7X2M4N8P1R5T9V3"].join("");

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

const MEMBERS = [
  { handle: "dev-fe", roles: ["frontend"], projects: ["web-a"] },
  { handle: "dev-be", roles: ["backend"], projects: ["svc-b"] },
];

/** A team-brain with a roster and two projects, pushed to a bare remote on master. */
function teamBrainRemote() {
  const remote = tempDir("asks-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("asks-seed-");
  git(seed, "clone", "-q", remote, ".");
  for (const p of ["web-a", "svc-b"]) {
    mkdirSync(join(seed, "projects", p), { recursive: true });
    writeFileSync(join(seed, "projects", p, ".gitkeep"), "");
  }
  writeFileSync(join(seed, "team.md"), "# Team: harbor\n");
  writeFileSync(join(seed, "team.json"), JSON.stringify({ source: "example-org/cortex", members: MEMBERS }, null, 2) + "\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "seed");
  git(seed, "branch", "-M", "master");
  git(seed, "push", "-q", "-u", "origin", "master");
  return remote;
}

/** A product repo joined to the team: its connector names the team, the project and the remote. */
function productRepo(prefix, project, remote) {
  const repo = tempDir(prefix);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "harbor", project, teamBrainRepo: remote }, null, 2) + "\n");
  return repo;
}

function setup() {
  const remote = teamBrainRemote();
  return { remote, repoA: productRepo("web-a-", "web-a", remote), repoB: productRepo("svc-b-", "svc-b", remote) };
}

function env(repo, extra = {}) {
  const e = { ...process.env, AI_OS_ROOT: "", CORTEX_ROOT: join(repo, ".cortex") };
  delete e.CORTEX_PROFILE;
  delete e.CORTEX_AUDIENCE;
  return { ...e, ...extra };
}

/**
 * Start the server in `repo` as `author`, send initialize and then each call, and resolve to the
 * initialize result and each tools/call result in order.
 */
function session(repo, author, calls = [], extra = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd: repo, env: env(repo, { CORTEX_AUTHOR: author, ...extra }) });
  let buf = "";
  let errBuf = "";
  const got = new Map();
  const want = calls.length + 1;
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        got.set(m.id, m.result);
        if (got.size === want) resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => { if (code) reject(new Error(`server exited ${code}\n${errBuf}`)); });
    setTimeout(() => reject(new Error(`timed out\n${errBuf}`)), 20000);
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  calls.forEach(([name, args], i) => send({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name, arguments: args } }));
  return done.then(() => {
    child.kill();
    return { init: got.get(0), results: calls.map((_, i) => got.get(i + 1)) };
  });
}

const json = (r) => {
  assert.notEqual(r.isError, true, r.content[0].text);
  return JSON.parse(r.content[0].text);
};

function cli(repo, author, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: env(repo, { CORTEX_AUTHOR: author }), encoding: "utf8" });
}

// ---------------------------------------------------------------------------------------------
// The acceptance
// ---------------------------------------------------------------------------------------------

test("an ask to a role reaches the member who holds it in another repo, and the answer comes back", async () => {
  const { remote, repoA, repoB } = setup();

  // Repo A, the frontend developer, asks the role — not a person and not a repo.
  const sent = json((await session(repoA, "dev-fe", [["ask", { to: "backend", content: "Is there an endpoint for order history?", links: ["https://example.com/spec"] }]])).results[0]);
  assert.equal(sent.toKind, "role");
  assert.equal(sent.status, "open");
  assert.equal(sent.pushed, true, JSON.stringify(sent));
  assert.ok(git(remote, "ls-tree", "-r", "--name-only", "master").includes(`asks/${sent.id}.md`), "the ask reached the remote");

  // The clone inside repo A is ignored there, so it never shows up as an embedded repository.
  assert.match(readFileSync(join(repoA, ".gitignore"), "utf8"), /^\.cortex\/team\/$/m);
  assert.ok(!git(repoA, "status", "--porcelain", "--untracked-files=all").includes(".cortex/team"), "the clone is not untracked work in the product repo");

  // Repo B, the backend developer, never names repo A.
  const inboxB = json((await session(repoB, "dev-be", [["inbox", {}]])).results[0]);
  assert.deepEqual(inboxB.pull, { ok: true });
  assert.equal(inboxB.me.placed, true);
  assert.deepEqual(inboxB.waiting.map((a) => a.id), [sent.id]);
  const ask = inboxB.waiting[0];
  assert.equal(ask.from, "dev-fe");
  assert.equal(ask.fromProject, "web-a");
  assert.equal(ask.question, "Is there an endpoint for order history?");
  assert.deepEqual(ask.links, ["https://example.com/spec"]);

  // A new session in B learns the count at initialize, from the local clone, with no tool call.
  const { init } = await session(repoB, "dev-be");
  assert.match(init.instructions, /1 ask is open for you \(dev-be\)/);
  assert.match(init.instructions, /`inbox`/);

  const answered = json((await session(repoB, "dev-be", [["answer", { id: sent.id, content: "Yes: GET /orders?customer=. See the PR." }]])).results[0]);
  assert.equal(answered.status, "answered");
  assert.equal(answered.pushed, true, JSON.stringify(answered));

  // Back in A: the answer and the status, under the asks A sent.
  const inboxA = json((await session(repoA, "dev-fe", [["inbox", {}]])).results[0]);
  const mine = inboxA.sent.find((a) => a.id === sent.id);
  assert.equal(mine.status, "answered");
  assert.equal(mine.answers.length, 1);
  assert.equal(mine.answers[0].handle, "dev-be");
  assert.match(mine.answers[0].text, /GET \/orders/);
  assert.deepEqual(inboxA.waiting, [], "an ask to backend is not waiting for the frontend");

  // Answered asks are no longer counted as waiting.
  const after = await session(repoB, "dev-be");
  assert.match(after.init.instructions, /0 asks are open for you/);
});

test("an ask to a role nobody holds is refused with the roles and projects that exist, and nothing is written", async () => {
  const { remote, repoA } = setup();
  const r = (await session(repoA, "dev-fe", [["ask", { to: "dba", content: "Who owns the schema?" }]])).results[0];
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^unknown_addressee: /);
  assert.match(r.content[0].text, /Roles: backend, frontend\. Projects: svc-b, web-a\./);
  assert.ok(!git(remote, "ls-tree", "-r", "--name-only", "master").includes("asks/"), "nothing reached the remote");
  assert.ok(!existsSync(join(repoA, ".cortex", "team", "harbor", "asks")), "nothing was written in the clone");
});

test("a credential in an ask is refused by the gate over the spawned server, before anything is cloned", async () => {
  const { remote, repoA } = setup();
  const { results } = await session(repoA, "dev-fe", [
    ["ask", { to: "backend", content: `the staging key is ${FAKE_AWS_KEY}` }],
    ["ask", { to: "backend", content: "a clean question", title: `key ${FAKE_AWS_KEY}` }],
    ["ask", { to: "backend", content: "a clean question", links: [`https://example.com/?k=${FAKE_AWS_KEY}`] }],
  ]);
  for (const r of results) {
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /refused_write/);
    assert.ok(!r.content[0].text.includes(FAKE_AWS_KEY), "the refusal echoed the credential");
  }
  assert.ok(!existsSync(join(repoA, ".cortex", "team")), "a refused ask clones nothing");
  assert.ok(!git(remote, "ls-tree", "-r", "--name-only", "master").includes("asks/"));
});

test("a caller who is not in the roster reads the asks for this repo's project, and is told what to set", async () => {
  const { repoA, repoB } = setup();
  const toRole = json((await session(repoA, "dev-fe", [["ask", { to: "backend", content: "for the role" }]])).results[0]);
  const toProject = json((await session(repoA, "dev-fe", [["ask", { to: "svc-b", content: "for the project" }]])).results[0]);
  assert.equal(toProject.toKind, "project");

  const inbox = json((await session(repoB, "newcomer", [["inbox", {}]])).results[0]);
  assert.equal(inbox.me.placed, false);
  assert.match(inbox.notice, /CORTEX_AUTHOR/);
  assert.match(inbox.notice, /'newcomer' is not a member/);
  assert.deepEqual(inbox.waiting.map((a) => a.id), [toProject.id], "the project's ask, not the role's");
  assert.ok(!inbox.waiting.some((a) => a.id === toRole.id));
});

test("on a solo brain the ask tools refuse in one sentence naming /team-add, and write nothing", async () => {
  const repo = tempDir("solo-");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  const { results } = await session(repo, "dev-a", [["inbox", {}], ["ask", { to: "backend", content: "x" }], ["answer", { id: "abc", content: "x" }]]);
  for (const r of results) {
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /^no_team: .*\/team-add/);
  }
  assert.deepEqual(readdirSync(join(repo, ".cortex")), []);
  assert.equal(existsSync(join(repo, ".gitignore")), false);
});

test("on lab an ask is committed in the clone and not pushed", async () => {
  const { remote, repoA } = setup();
  const r = json((await session(repoA, "dev-fe", [["ask", { to: "backend", content: "sealed?" }]], { CORTEX_PROFILE: "lab" })).results[0]);
  assert.equal(r.pushed, false);
  assert.equal(r.committed, true);
  assert.equal(r.error, "outward_sync_disabled");
  assert.ok(!git(remote, "ls-tree", "-r", "--name-only", "master").includes("asks/"), "nothing left the machine");
});

test("the CLI sends, lists and answers the same asks, and `team member` writes team.json keeping the source", () => {
  const { remote, repoA, repoB } = setup();

  const add = cli(repoB, "dev-db", "team", "member", "--roles", "dba,backend", "--projects", "svc-b");
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /Member added in team\.json — dev-db: roles dba, backend; projects svc-b, committed and pushed\./);
  const seed = tempDir("asks-check-");
  git(seed, "clone", "-q", remote, ".");
  const doc = JSON.parse(readFileSync(join(seed, "team.json"), "utf8"));
  assert.equal(doc.source, "example-org/cortex", "the #622 source survives");
  assert.deepEqual(doc.members.map((m) => m.handle), ["dev-fe", "dev-be", "dev-db"]);

  const ask = cli(repoA, "dev-fe", "ask", "--to", "dba", "--title", "Schema owner", "--body", "Who migrates orders?");
  assert.equal(ask.status, 0, ask.stderr);
  const id = ask.stdout.match(/^Ask (\S+) sent to role 'dba'/m)?.[1];
  assert.ok(id, ask.stdout);

  const inbox = cli(repoB, "dev-db", "inbox", "--json");
  assert.equal(inbox.status, 0, inbox.stderr);
  const got = JSON.parse(inbox.stdout);
  assert.deepEqual(got.waiting.map((a) => [a.id, a.title]), [[id, "Schema owner"]]);

  const answer = cli(repoB, "dev-db", "answer", "--id", id, "--body", "We do.", "--status", "decided");
  assert.equal(answer.status, 0, answer.stderr);
  const back = JSON.parse(cli(repoA, "dev-fe", "inbox", "--json").stdout);
  assert.equal(back.sent.find((a) => a.id === id).status, "decided");

  const leak = cli(repoA, "dev-fe", "ask", "--to", "dba", "--body", `key ${FAKE_AWS_KEY}`);
  assert.equal(leak.status, 1);
  assert.match(leak.stderr, /AWS access key id/);
  assert.ok(!leak.stderr.includes(FAKE_AWS_KEY));

  const bad = cli(repoA, "dev-fe", "answer", "--id", id, "--body", "x", "--status", "closed");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /status must be one of answered \| decided \| wontfix/);
});

// ---------------------------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------------------------

test("an ask file round-trips, and a question that mentions an answer header keeps its text", () => {
  const meta = { id: "abc-1", title: "Two\nlines", from: "dev-fe", fromProject: "web-a", to: "backend", toKind: "role", status: "open", created: "2026-10-24", updated: "2026-10-24", links: ["https://example.com/a"] };
  const text = renderAsk(meta, "Does `## Answer · soon` count?\n\nSecond paragraph.");
  const parsed = parseAsk(text);
  assert.equal(parsed.meta.title, "Two lines", "a title is one line");
  assert.deepEqual(parsed.meta.links, ["https://example.com/a"]);
  assert.equal(parsed.question, "Does `## Answer · soon` count?\n\nSecond paragraph.");
  assert.deepEqual(parsed.answers, []);

  const answered = text + "\n## Answer · 2026-10-25 · dev-be · decided\n\nUse the queue.\n";
  const p2 = parseAsk(answered.replace(/\n/g, "\r\n"));
  assert.deepEqual(p2.answers, [{ date: "2026-10-25", handle: "dev-be", status: "decided", text: "Use the queue." }]);
  assert.equal(parseAsk("# not an ask\n"), null);
});

test("a member is checked: a handle is an author slug, roles and projects are names, and nothing echoes a value", () => {
  assert.deepEqual(checkMember({ handle: "dev-a", roles: ["backend", "backend"], projects: [] }).member, { handle: "dev-a", roles: ["backend"], projects: [] });
  assert.equal(checkMember({ handle: "Dev A", roles: [] }).member, null, "the slug form, not a display name");
  const bad = checkMember({ handle: "dev-a", roles: ["Back End"], github: "not a login!" });
  assert.equal(bad.member, null);
  assert.equal(bad.errors.length, 2);
  assert.ok(!bad.errors.join(" ").includes("Back End"));

  const r = parseRoster(JSON.stringify({ members: [{ handle: "dev-a" }, { handle: "dev-a" }, { handle: "../x" }] }));
  assert.deepEqual(r.members.map((m) => m.handle), ["dev-a"]);
  assert.equal(r.errors.length, 2);
  assert.throws(() => parseRoster("{"), RosterError);
  assert.throws(() => parseRoster("[]"), RosterError);
});

test("setMember adds, updates and leaves alone, keeping every other key", () => {
  const clone = tempDir("roster-");
  writeFileSync(join(clone, "team.json"), JSON.stringify({ source: "example-org/cortex" }) + "\n");
  assert.equal(setMember(clone, { handle: "dev-a", roles: ["backend"] }).action, "added");
  assert.equal(setMember(clone, { handle: "dev-a", roles: ["backend"] }).action, "unchanged");
  assert.equal(setMember(clone, { handle: "dev-a", roles: ["backend", "architect"] }).action, "updated");
  const doc = JSON.parse(readFileSync(join(clone, "team.json"), "utf8"));
  assert.deepEqual(doc, { source: "example-org/cortex", members: [{ handle: "dev-a", roles: ["backend", "architect"], projects: [] }] });
  assert.throws(() => setMember(clone, { handle: "Not A Slug" }), RosterError);
});

test("an addressee resolves to a role first, then a project, and is refused otherwise", () => {
  const clone = tempDir("addr-");
  mkdirSync(join(clone, "projects", "gateway"), { recursive: true });
  writeFileSync(join(clone, "projects", "billing.md"), "---\ntype: project\n---\n");
  const members = [{ handle: "a", roles: ["gateway", "backend"], projects: [] }];
  assert.deepEqual(resolveAddressee(clone, "Backend", members), { to: "backend", toKind: "role" });
  assert.deepEqual(resolveAddressee(clone, "gateway", members), { to: "gateway", toKind: "role" }, "a role wins a tie");
  assert.deepEqual(resolveAddressee(clone, "billing", members), { to: "billing", toKind: "project" });
  assert.throws(() => resolveAddressee(clone, "dba", members), (e) => e instanceof AskRefused && /Roles: backend, gateway\. Projects: billing, gateway\./.test(e.message));
});

test("placing a caller: a member gets their roles and projects plus this repo's; anyone else gets this repo's", () => {
  const members = [{ handle: "dev-be", roles: ["backend"], projects: ["svc-b"] }];
  const me = placeCaller({ slug: "dev-be" }, members, "svc-c");
  assert.deepEqual([me.placed, me.roles, me.projects, me.notice], [true, ["backend"], ["svc-b", "svc-c"], undefined]);
  const nobody = placeCaller({ slug: null, why: "git has no user.name here and CORTEX_AUTHOR is not set" }, members, "svc-c");
  assert.deepEqual([nobody.placed, nobody.roles, nobody.projects], [false, [], ["svc-c"]]);
  assert.match(nobody.notice, /CORTEX_AUTHOR/);
});

test("every team command is reachable from the CLI, and `help` lists each one (R16, #623)", () => {
  const bare = { ...process.env, CORTEX_ROOT: "", AI_OS_ROOT: "" };
  const r = spawnSync(process.execPath, [CLI, "help"], { encoding: "utf8", env: bare });
  assert.equal(r.status, 0, r.stderr);
  for (const cmd of ["team init", "team add", "team member", "ask --to", "inbox", "answer --id", "contract publish|show|who-calls|list", "catch-up"]) {
    assert.ok(r.stdout.includes(cmd), `help names ${cmd}`);
  }
  for (const flag of ["--help", "-h"]) assert.equal(spawnSync(process.execPath, [CLI, flag], { encoding: "utf8", env: bare }).status, 0, flag);
  // Each command `help` names is one the CLI dispatches: it fails on its root or flags, never as unknown.
  for (const cmd of ["ask", "inbox", "answer", "contract", "team"]) {
    const u = spawnSync(process.execPath, [CLI, cmd], { encoding: "utf8", env: bare });
    assert.doesNotMatch(u.stderr, /usage: ai-os </, cmd);
  }
});
