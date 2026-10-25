// Approved destinations (core/destinations.js, docs/adr/0030).
//
// Every host and owner below is invented. Each test that reads a file hands the module its own
// environment — CORTEX_DESTINATIONS, or a HOME under a temp dir — so no run reads the machine's list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTarget, parseDestinations, loadDestinations, destinationsPath, matchDestination,
  assertDestination, DestinationRefusedError, destinationStatus, destinationNotes, describeTarget,
} from "../destinations.js";
import { RefusedWriteError } from "../scrub.js";
import { policyFor, profiles } from "../profile.js";
import { tempDir } from "./tmp.js";

const LIST = [
  "# approved by the company — deployed by IT, never committed anywhere",
  "git: github.com/acme",
  "git: gitlab.acme.internal",
  "https: acme.service-now.com",
  "https: api.anthropic.com",
  "npm: registry.npmjs.org",
  "",
].join("\n");

const list = { path: "/x/allowed-destinations", from: "default", state: "ok", ...parseDestinations(LIST) };
const WORK = policyFor("work");
const HOME = policyFor("home");
const LAB = policyFor("lab");

const allowed = (target, kind = "git", opts = {}) => {
  try {
    assertDestination(target, { kind, policy: WORK, list, ...opts });
    return true;
  } catch (e) {
    if (e instanceof DestinationRefusedError) return false;
    throw e;
  }
};

function homeWith(text) {
  const home = tempDir("cortex-dest-");
  if (text !== undefined) {
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(join(home, ".cortex", "allowed-destinations"), text);
  }
  return { HOME: home, USERPROFILE: home };
}

// --- the policy ------------------------------------------------------------------------------------

test("each profile says where an outward call may go, and lab's seal is the same decision twice", () => {
  assert.equal(HOME.destinations, "any");
  assert.equal(WORK.destinations, "approved");
  assert.equal(LAB.destinations, "none");
  for (const p of profiles()) {
    const pol = policyFor(p);
    assert.equal(pol.outwardSync === false, pol.destinations === "none", `${p}: a sealed profile is sealed in both fields`);
  }
});

test("each profile names its personal-data mode; work refuses", () => {
  assert.equal(HOME.pii, "warn");
  assert.equal(WORK.pii, "refuse");
  assert.equal(LAB.pii, "warn");
});

test("the policy is required: a missing one, or one with no destinations, is never read as any", () => {
  for (const policy of [undefined, null, {}, { outwardSync: true }, { destinations: "anything" }]) {
    assert.throws(() => assertDestination("https://github.com/acme/brain", { kind: "git", policy, list }), TypeError);
  }
  assert.throws(() => assertDestination("https://github.com/acme/brain", { kind: "ftp", policy: WORK, list }), TypeError);
});

// --- reading an address ---------------------------------------------------------------------------

test("every git URL form normalises to host/path", () => {
  const cases = {
    "https://github.com/acme/brain.git": "github.com/acme/brain",
    "https://github.com/acme/brain": "github.com/acme/brain",
    "https://github.com/acme/brain/": "github.com/acme/brain",
    "HTTPS://GitHub.COM/Acme/Brain.git": "github.com/acme/brain",
    "http://github.com/acme/brain.git": "github.com/acme/brain",
    "https://someone:pa55word@github.com/acme/brain.git": "github.com/acme/brain",
    "https://x-access-token@github.com/acme/brain.git": "github.com/acme/brain",
    "ssh://git@github.com/acme/brain.git": "github.com/acme/brain",
    "ssh://git@gitlab.acme.internal:2222/team/brain": "gitlab.acme.internal/team/brain",
    "git://github.com/acme/brain.git": "github.com/acme/brain",
    "git@github.com:acme/brain.git": "github.com/acme/brain",
    "github.com:acme/brain": "github.com/acme/brain",
    "git@github.com.:acme/brain.git": "github.com/acme/brain",
    "\\\\fileserver\\share\\brain.git": "fileserver/share/brain",
    "//fileserver/share/brain": "fileserver/share/brain",
    "file://fileserver/share/brain": "fileserver/share/brain",
  };
  for (const [url, want] of Object.entries(cases)) assert.equal(describeTarget(parseTarget(url)), want, url);
});

test("a path on this machine and a file:// URL are local", () => {
  for (const p of ["/srv/brain.git", "./brain", "../remote.git", "brain", "C:\\brains\\team.git", "C:/brains/team.git", "D:", "file:///srv/brain.git", "file://localhost/srv/brain", "\\\\?\\C:\\brains\\team"]) {
    assert.equal(parseTarget(p)?.local, true, p);
  }
});

test("an address that cannot be read is null, never a guess", () => {
  for (const s of ["", "   ", "https://", "https://github.com/acme/%E0%A4%A", "git@:acme/brain", "https://github.com/acme/..%2F..%2Fevil"]) {
    assert.equal(parseTarget(s), null, JSON.stringify(s));
  }
});

// --- the list ---------------------------------------------------------------------------------------

test("parses every kind, skipping comments and blank lines, with each entry's line", () => {
  assert.deepEqual(
    list.entries.map((e) => `${e.kind}:${e.host}/${e.segments.join("/")}:${e.line}`),
    ["git:github.com/acme:2", "git:gitlab.acme.internal/:3", "https:acme.service-now.com/:4", "https:api.anthropic.com/:5", "npm:registry.npmjs.org/:6"],
  );
  assert.deepEqual(list.problems, []);
});

test("a bad line is a problem with its line number; the good lines still apply", () => {
  const { entries, problems } = parseDestinations([
    "git: github.com/acme",   // 1 good
    "github.com/acme",        // 2 no kind
    "ftp: files.acme.example", // 3 unknown kind
    "git:",                   // 4 no value
    "git: https://github.com/acme", // 5 a scheme
    "git: *.acme.example",    // 6 a wildcard
    "git: gitlab.acme.example:8443", // 7 a port
    "git: someone@github.com/acme", // 8 a user
    "git: github.com/acme/../evil", // 9 a dot segment
    "https: not a host",      // 10
  ].join("\n"));
  assert.equal(entries.length, 1);
  assert.deepEqual(problems.map((p) => p.line), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const notes = destinationNotes(problems);
  assert.equal(notes.length, 9);
  assert.match(notes[0], /^approved-destinations line 2 /);
  assert.ok(!notes.some((n) => n.includes("evil") || n.includes("someone")), "a note never repeats the line");
});

test("the path is CORTEX_DESTINATIONS, else ~/.cortex/allowed-destinations; an empty value is unset", () => {
  assert.deepEqual(destinationsPath({ env: { CORTEX_DESTINATIONS: "/etc/acme/dest" } }), { path: "/etc/acme/dest", from: "CORTEX_DESTINATIONS" });
  const d = destinationsPath({ env: { CORTEX_DESTINATIONS: "  ", HOME: "/h" } });
  assert.equal(d.from, "default");
  assert.equal(d.path, join("/h", ".cortex", "allowed-destinations"));
});

test("states: absent at the default path, missing when CORTEX_DESTINATIONS names nothing, ok when read", () => {
  assert.equal(loadDestinations({ env: homeWith() }).state, "absent");
  assert.equal(loadDestinations({ env: { ...homeWith(), CORTEX_DESTINATIONS: join(tempDir("cortex-dest-"), "nope") } }).state, "missing");
  const dir = tempDir("cortex-dest-");
  assert.equal(loadDestinations({ env: { ...homeWith(), CORTEX_DESTINATIONS: dir } }).state, "missing", "a directory is not a list");
  const read = loadDestinations({ env: homeWith(LIST) });
  assert.equal(read.state, "ok");
  assert.equal(read.entries.length, 5);
});

// --- matching ---------------------------------------------------------------------------------------

test("an approved owner allows its repositories in every URL form", () => {
  for (const url of [
    "https://github.com/acme/brain.git",
    "https://github.com/ACME/brain",
    "git@github.com:acme/brain.git",
    "ssh://git@github.com/acme/team/brain",
    "https://ci:t0ken@github.com/acme/brain.git",
    "ssh://git@gitlab.acme.internal:2222/anything/at/all",
  ]) assert.ok(allowed(url), url);
});

test("the host must match exactly: no suffix, no prefix, no lookalike", () => {
  for (const url of [
    "https://evilgithub.com/acme/brain",
    "https://github.com.evil.example/acme/brain",
    "https://gist.github.com/acme/brain",
    "git@github.co:acme/brain",
    "https://github.com@evil.example/acme/brain",
    "https://evil.example/github.com/acme/brain",
    "https://notgitlab.acme.internal/team/brain",
    "https://gitlab.acme.internal.evil.example/team/brain",
  ]) assert.ok(!allowed(url), url);
});

test("a path prefix matches whole segments only", () => {
  for (const url of [
    "https://github.com/acme-evil/brain",
    "https://github.com/acmecorp/brain",
    "https://github.com/someone/acme",
    "https://github.com/someone/brain.git",
    "https://github.com/",
    "https://github.com/acme/../someone/brain",
    "git@github.com:acme/../someone/brain",
    "https://github.com/acme%2F..%2Fsomeone/brain",
  ]) assert.ok(!allowed(url), url);
});

test("a kind is approved for its kind alone; an https endpoint is https", () => {
  assert.ok(allowed("https://acme.service-now.com/api/now/table/incident", "https"));
  assert.ok(!allowed("https://acme.service-now.com/x.git", "git"), "an https entry is not a git remote");
  assert.ok(!allowed("http://acme.service-now.com/api", "https"), "the approved endpoint over plain http is not the endpoint");
  assert.ok(allowed("https://registry.npmjs.org/", "npm"));
  assert.ok(!allowed("https://registry.npmjs.org/", "https"));
  assert.ok(!allowed("https://api.anthropic.com.evil.example/v1/messages", "https"));
  assert.equal(matchDestination(parseTarget("https://api.anthropic.com/v1/messages"), "https", list).line, 5);
});

test("the same machine is always allowed, on every profile and with no list", () => {
  const noList = { path: "/none", from: "default", state: "absent", entries: [], problems: [] };
  for (const p of profiles()) {
    const policy = policyFor(p);
    for (const t of ["/srv/brain.git", "C:\\brains\\team.git", "file:///srv/brain.git", "http://127.0.0.1:4321/api", "http://localhost:8080/x", "https://[::1]:9/x"]) {
      for (const kind of ["git", "https"]) {
        assert.equal(assertDestination(t, { kind, policy, list: noList }).allowed, true, `${p} ${kind} ${t}`);
      }
    }
  }
});

test("a UNC path is another machine: its server is the host", () => {
  assert.ok(!allowed("\\\\fileserver\\share\\brain.git"));
  assert.ok(!allowed("//fileserver/share/brain.git"));
  assert.ok(!allowed("file://fileserver/share/brain.git"));
  const shares = { ...list, ...parseDestinations("git: fileserver/share") };
  assert.equal(assertDestination("\\\\fileserver\\share\\brain.git", { kind: "git", policy: WORK, list: shares }).why, "approved");
  assert.ok(!allowed("ssh://git@localhost/acme/brain"), "loopback is allowed for http(s) only");
});

// --- the modes --------------------------------------------------------------------------------------

test("home allows any destination, with no list", () => {
  assert.equal(assertDestination("https://evilgithub.com/x/y", { kind: "git", policy: HOME, env: homeWith() }).why, "any");
});

test("lab refuses every outward call and allows a pull or a clone", () => {
  assert.throws(
    () => assertDestination("https://github.com/acme/brain", { kind: "git", policy: LAB, list }),
    (e) => e instanceof DestinationRefusedError && e.reason === "sealed" && /lab profile sends nothing/.test(e.message),
  );
  assert.equal(assertDestination("https://github.com/acme/brain", { kind: "git", policy: LAB, list, inbound: true }).why, "inbound");
});

test("work with no list fails closed, and says how to set the file up", () => {
  const env = homeWith();
  let err;
  try { assertDestination("https://github.com/acme/brain.git", { kind: "git", policy: WORK, env }); } catch (e) { err = e; }
  assert.ok(err instanceof DestinationRefusedError);
  assert.ok(err instanceof RefusedWriteError, "a handler written for the publish gate still stops it");
  assert.equal(err.code, "unapproved_destination");
  assert.equal(err.reason, "no_list");
  assert.match(err.message, /allowed-destinations/);
  assert.match(err.message, /git: github\.com\/your-org/);
  assert.throws(() => assertDestination("https://github.com/acme/brain.git", { kind: "git", policy: WORK, env, inbound: true }), DestinationRefusedError, "inbound is checked on work too");
});

test("work with CORTEX_DESTINATIONS naming no file refuses, and names the variable", () => {
  const env = { ...homeWith(LIST), CORTEX_DESTINATIONS: join(tempDir("cortex-dest-"), "typo") };
  assert.throws(
    () => assertDestination("https://github.com/acme/brain.git", { kind: "git", policy: WORK, env }),
    (e) => e.reason === "missing_list" && /CORTEX_DESTINATIONS names/.test(e.message),
  );
});

test("work with a list reads the file, and allows what it approves", () => {
  const env = homeWith(LIST);
  const ok = assertDestination("git@github.com:acme/brain.git", { kind: "git", policy: WORK, env });
  assert.equal(ok.why, "approved");
  assert.deepEqual(ok.entry, { kind: "git", line: 2 });
  assert.throws(() => assertDestination("https://github.com/someone/brain.git", { kind: "git", policy: WORK, env }), (e) => e.reason === "unlisted");
});

test("work refuses an address it cannot read rather than guessing", () => {
  assert.throws(() => assertDestination("git@:acme/brain", { kind: "git", policy: WORK, list }), (e) => e.reason === "unreadable" && !e.message.includes("git@"));
});

test("a refusal names the host and path, never the userinfo or a credential", () => {
  const secret = ["s3cr3t", "pa55", "value"].join("-");
  let err;
  try { assertDestination(`https://someone:${secret}@github.com/elsewhere/brain.git`, { kind: "git", policy: WORK, list }); } catch (e) { err = e; }
  assert.ok(err instanceof DestinationRefusedError);
  assert.ok(err.message.includes("github.com/elsewhere/brain"), err.message);
  assert.ok(!err.message.includes(secret) && !err.message.includes("someone"), err.message);
  assert.equal(err.host, "github.com");
  assert.equal(err.path, "elsewhere/brain");
  assert.ok(!JSON.stringify({ ...err, message: err.message }).includes(secret));
});

test("destinationStatus reports the mode, the state and the problems; it requires a policy", () => {
  const s = destinationStatus({ policy: WORK, env: homeWith(LIST + "ftp: nope\n") });
  assert.equal(s.mode, "approved");
  assert.equal(s.applies, true);
  assert.equal(s.state, "ok");
  assert.equal(s.entries, 5);
  assert.deepEqual(s.kinds, { git: 2, https: 2, npm: 1 });
  assert.equal(s.problems.length, 1);
  assert.equal(destinationStatus({ policy: HOME, env: homeWith() }).applies, false);
  assert.throws(() => destinationStatus({}), TypeError);
});
