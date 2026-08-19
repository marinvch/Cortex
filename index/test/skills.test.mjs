import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeSkills, partitionExisting, SKILL_CANDIDATES } from "../lib/skills.mjs";

const ix = (stack = {}, stats = {}) => ({
  stack: { languages: [], frameworks: [], data: [], services: [], test: [], delivery: [], manifests: [], ...stack },
  stats: { files: 50, tests: 0, ...stats },
});

const ids = (r) => r.map((p) => p.id);

test("a Next.js + Prisma + Stripe repo with no tests gets the skills that stack implies", () => {
  const r = proposeSkills(ix(
    { languages: ["typescript"], frameworks: ["next", "react"], data: ["prisma"], services: ["stripe", "nextauth"], manifests: ["package.json"] },
    { files: 193, tests: 0 },
  ));
  assert.deepEqual(ids(r), ["write-first-test", "verify-webhook", "add-migration", "add-route", "check-auth", "type-check"]);
});

test("a different stack gets different skills — this is the whole point", () => {
  // The bug this module exists to fix: every repo got the same two skills. If a Go repo and a
  // Next.js repo ever propose the same set again, that regression is back.
  const nextish = proposeSkills(ix({ frameworks: ["next"], data: ["prisma"], services: ["stripe"] }));
  const goish = proposeSkills(ix({ languages: ["go"], delivery: ["docker"] }, { tests: 12 }));
  assert.notDeepEqual(ids(nextish), ids(goish));
  assert.ok(ids(nextish).includes("verify-webhook"), "Stripe repo gets the webhook skill");
  assert.ok(!ids(goish).includes("verify-webhook"), "a repo with no Stripe does not");
  assert.ok(ids(goish).includes("ship-it"), "a Docker repo gets the delivery skill");
});

test("no webhook skill without a payment provider", () => {
  assert.ok(!ids(proposeSkills(ix({ frameworks: ["next"] }))).includes("verify-webhook"));
});

test("a repo WITH tests is asked to extend them, not to start over", () => {
  const r = proposeSkills(ix({ test: ["vitest"] }, { tests: 40 }));
  assert.ok(ids(r).includes("add-test"));
  assert.ok(!ids(r).includes("write-first-test"), "do not propose a first test to a tested repo");
});

test("a repo with a runner and zero tests is told to write the first one, accurately", () => {
  // A scaffold that ships jest in devDependencies and no test files — create-expo-app, CRA, most
  // starters. This case fell between the two candidates: add-test fired and told the reader
  // "jest already set up — new work should extend it", when there was no convention to extend.
  //
  // The earlier version of this test forbade write-first-test here, and it was right about the
  // reason: its title said "Set up a test runner", which is visibly wrong to someone whose manifest
  // already names one, and a report wrong on the part you CAN check is not trusted on the parts you
  // cannot. The fix was to make the offer honest rather than to withhold it — so the assertion now
  // pins the wording instead of the absence.
  const r = proposeSkills(ix({ test: ["jest"] }, { tests: 0 }));
  assert.ok(ids(r).includes("write-first-test"), "zero tests is the trigger, runner or not");
  assert.ok(!ids(r).includes("add-test"), "there is no existing convention to extend");

  const first = r.find((c) => c.id === "write-first-test");
  assert.match(first.why, /jest/, "the evidence names the runner it actually found");
  assert.doesNotMatch(first.why, /no test runner/, "and never claims the runner is missing");
  assert.doesNotMatch(first.title, /[Ss]et up a test runner/, "nor does the title");
});

test("a tiny repo is not lectured about tests", () => {
  const r = proposeSkills(ix({}, { files: 3, tests: 0 }));
  assert.ok(!ids(r).includes("write-first-test"), "a 3-file repo has nothing to test yet");
});

test("an empty stack proposes nothing rather than guessing", () => {
  assert.deepEqual(proposeSkills(ix({}, { files: 2, tests: 0 })), []);
});

test("an index with no stack at all does not throw", () => {
  // Indexes written before stack detection existed have no `stack` key. Reading one must degrade
  // to "propose nothing", never crash the caller.
  assert.deepEqual(proposeSkills({ stats: { files: 10, tests: 0 } }), []);
  assert.deepEqual(proposeSkills({}), []);
});

test("every proposal carries evidence naming what was detected", () => {
  const r = proposeSkills(ix(
    { languages: ["typescript"], frameworks: ["next"], data: ["prisma"], services: ["stripe"], delivery: ["docker"] },
    { files: 100, tests: 0 },
  ));
  for (const p of r) {
    assert.ok(p.why && p.why.length > 15, `${p.id} must say why it was surfaced`);
    assert.ok(p.brief && p.brief.length > 40, `${p.id} must tell the writer what belongs in the body`);
    assert.ok(p.title, `${p.id} must have a title`);
  }
});

test("ranking is deterministic and drives the interview order", () => {
  // ADR 0006: the wizard walks this top-down, so rank is control flow, not presentation.
  const args = ix({ languages: ["typescript"], frameworks: ["next"], data: ["prisma"], services: ["stripe"] }, { tests: 0 });
  assert.deepEqual(ids(proposeSkills(args)), ids(proposeSkills(args)));
  const r = proposeSkills(args);
  assert.deepEqual([...r].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((p) => p.id), ids(r));
});

test("candidate ids are unique and directory-safe", () => {
  const all = SKILL_CANDIDATES.map((c) => c.id);
  assert.equal(new Set(all).size, all.length, "duplicate id would collide on disk");
  for (const id of all) assert.match(id, /^[a-z][a-z0-9-]*$/, `${id} must be a safe directory name`);
});

test("a predicate that throws drops only its own candidate", () => {
  const bad = { id: "boom", title: "t", rank: 1, when: () => { throw new Error("x"); }, why: () => "w", brief: "b" };
  SKILL_CANDIDATES.unshift(bad);
  try {
    const r = proposeSkills(ix({ languages: ["typescript"] }));
    assert.ok(!ids(r).includes("boom"));
    assert.ok(ids(r).includes("type-check"), "the rest of the proposal survives");
  } finally {
    SKILL_CANDIDATES.shift();
  }
});

test("skills already in the repo are reported, not silently dropped", () => {
  // Filtering them away looks like Cortex judged them unnecessary, when they are the ones already
  // doing their job.
  const r = proposeSkills(ix({ languages: ["typescript"], data: ["prisma"] }));
  const { missing, present } = partitionExisting(r, ["type-check"]);
  assert.deepEqual(ids(present), ["type-check"]);
  assert.ok(!ids(missing).includes("type-check"));
  assert.ok(ids(missing).includes("add-migration"));
});

test("partitionExisting tolerates a missing list", () => {
  const r = proposeSkills(ix({ languages: ["typescript"] }));
  assert.deepEqual(ids(partitionExisting(r, undefined).missing), ids(r));
});
