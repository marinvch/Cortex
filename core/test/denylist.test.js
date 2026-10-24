// The employer denylist (core/denylist.js, docs/adr/0026).
//
// Every name below is invented. Each test that reads a file hands the module its own environment —
// CORTEX_DENYLIST, or a HOME under a temp dir — so no run reads the machine's real denylist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDenylist, loadDenylist, denylistPath, matchDenylist, assertNotDenied, DeniedWriteError,
  denylistProblemNotes,
} from "../denylist.js";
import { RefusedWriteError } from "../scrub.js";
import { policyFor, profiles } from "../profile.js";
import { assertPublished } from "../gate.js";
import { tempDir } from "./tmp.js";

const LIST = [
  "# employer and clients — never committed anywhere",
  "org: Example Corp",
  "domain: corp.example",
  "owner: example-corp",
  "ticket: EXC-\\d+",
  "pattern: project\\s+bluebird",
  "",
].join("\n");

const parsed = parseDenylist(LIST);
const hitsOf = (text) => matchDenylist(text, parsed).map((h) => `${h.kind}:${h.line}`);

function homeWith(text) {
  const home = tempDir("cortex-deny-");
  if (text !== undefined) {
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(join(home, ".cortex", "employer-denylist"), text);
  }
  return { HOME: home, USERPROFILE: home };
}

test("parses every kind, skipping comments and blank lines, with each entry's line", () => {
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.entries.map((e) => `${e.kind}:${e.line}`), ["org:2", "domain:3", "owner:4", "ticket:5", "pattern:6"]);
});

test("matches each kind the way its name says", () => {
  assert.deepEqual(hitsOf("met with example corp today"), ["org:2"], "an org is case-insensitive");
  assert.deepEqual(hitsOf("met with Example\n Corp"), ["org:2"], "and spans whitespace");
  assert.deepEqual(hitsOf("see wiki.corp.example/page"), ["domain:3"], "a subdomain is the domain");
  assert.deepEqual(hitsOf("mail someone@corp.example"), ["domain:3"], "so is an address at it");
  assert.deepEqual(hitsOf("github.com/example-corp/api"), ["owner:4"]);
  assert.deepEqual(hitsOf("fixes EXC-4521"), ["ticket:5"]);
  assert.deepEqual(hitsOf("the Project  Bluebird launch"), ["pattern:6"]);
});

test("a whole word only: a longer name, a neighbouring domain, a lower-case key do not match", () => {
  for (const s of [
    "Example Corporation is a different company",
    "see corp.examples and corp.example.org",
    "github.com/example-corp-labs/api",
    "exc-4521 in prose, and EXC-4521x",
    "nothing at all",
  ]) assert.deepEqual(hitsOf(s), [], s);
});

test("a bad line is reported with its line number, and the good lines still apply", () => {
  const l = parseDenylist("org: Example Corp\nticket: EXC-(\\d+\nnonsense line\ncolour: blue\nowner:\npattern: x*\n");
  assert.deepEqual(l.entries.map((e) => e.line), [1]);
  assert.deepEqual(l.problems.map((p) => p.line), [2, 3, 4, 5, 6]);
  assert.match(l.problems[0].why, /not a valid regular expression/);
  assert.match(l.problems[4].why, /matches empty text/);
  const notes = denylistProblemNotes(l.problems);
  assert.match(notes[0], /^employer denylist line 2 /);
  assert.ok(!notes.join(" ").includes("EXC-("), "a note never repeats the line");
  assert.deepEqual(matchDenylist("Example Corp", l).map((h) => h.line), [1]);
});

test("the path: CORTEX_DENYLIST, else ~/.cortex/employer-denylist", () => {
  assert.deepEqual(denylistPath({ env: { CORTEX_DENYLIST: " /x/list " } }), { path: "/x/list", from: "CORTEX_DENYLIST" });
  assert.equal(denylistPath({ env: { HOME: "/h" } }).path, join("/h", ".cortex", "employer-denylist"));
  assert.equal(denylistPath({ env: { CORTEX_DENYLIST: "", HOME: "/h" } }).from, "default");
});

test("no file at the default path is no check, and says so", () => {
  const l = loadDenylist({ env: homeWith(undefined) });
  assert.equal(l.state, "absent");
  assert.deepEqual(assertNotDenied("Example Corp", { policy: policyFor("home"), env: homeWith(undefined) }), { applied: false, problems: [] });
});

test("a CORTEX_DENYLIST naming no file refuses on home: a typo must not switch the check off", () => {
  const env = { CORTEX_DENYLIST: join(tempDir("cortex-deny-"), "no-such-file") };
  assert.equal(loadDenylist({ env }).state, "missing");
  assert.throws(() => assertNotDenied("anything", { policy: policyFor("home"), env }), (e) => e instanceof DeniedWriteError && /names no readable file/.test(e.message));
  assert.doesNotThrow(() => assertNotDenied("anything", { policy: policyFor("work"), env }));
});

test("home refuses a match, naming the entry's kind and line and never the text", () => {
  const env = homeWith(LIST);
  let err;
  try { assertNotDenied("standup notes\nEXC-4521 is blocked", { policy: policyFor("home"), env }); } catch (e) { err = e; }
  assert.ok(err instanceof DeniedWriteError);
  assert.ok(err instanceof RefusedWriteError, "every caller that handles a refusal handles this one");
  assert.equal(err.code, "employer_denylist");
  assert.match(err.message, /line 5 of your employer denylist \(a ticket key\)/);
  assert.ok(!err.message.includes("EXC-4521") && !err.message.includes("EXC-\\d"), "neither the text nor the entry");
});

test("work and lab do not apply it; home is the only profile that refuses employer material", () => {
  const env = homeWith(LIST);
  for (const p of profiles()) {
    const run = () => assertNotDenied("Example Corp", { policy: policyFor(p), env });
    if (policyFor(p).refuses === "employer") assert.throws(run, DeniedWriteError, p);
    else assert.deepEqual(run(), { applied: false, problems: [] }, p);
  }
});

test("a missing policy throws: it is never read as refuses-nothing", () => {
  assert.throws(() => assertNotDenied("x", {}), TypeError);
});

test("a malformed line on home is passed on as a warning by the publish gate, not a crash", () => {
  const env = { ...homeWith("org: Example Corp\nticket: EXC-(\n"), CORTEX_PII: "off" };
  const r = assertPublished("an ordinary note", { policy: policyFor("home"), env });
  assert.deepEqual(r.warnings, ["employer denylist line 2 is not a valid regular expression, so it is skipped."]);
  assert.throws(() => assertPublished("Example Corp", { policy: policyFor("home"), env }), DeniedWriteError);
});
