// accept.mjs is the outcome harness's one scorer: a command decides every result. These tests hold
// it to the properties the measurement rests on, with reference patches and no model:
//   - no task is done already, and every task can be done without the context layer;
//   - every rule check can fire on a change that does what was asked;
//   - a session cannot pass by editing the repo's tests;
//   - the function and the command give one result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARMS, buildFixture, fixtureFiles, hashDir } from "../harness/fixture.mjs";
import { TASKS } from "../harness/tasks.mjs";
import { HarnessFault, accept } from "../harness/accept.mjs";
import { SOLUTIONS, applyPatch } from "../harness/solutions/index.mjs";

const ACCEPT = fileURLToPath(new URL("../harness/accept.mjs", import.meta.url));
const ACCEPT_DIR = fileURLToPath(new URL("../harness/accept/", import.meta.url));
const RULE_TASKS = TASKS.filter((t) => !t.control);
const CONTROL = TASKS.find((t) => t.control);

const roots = [];
function tree(arm, patch) {
  const root = mkdtempSync(join(tmpdir(), "cortex-harness-test-"));
  roots.push(root);
  const dir = join(root, "shop");
  buildFixture(dir, { arm, git: false });
  if (patch) applyPatch(dir, patch);
  return dir;
}
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function command(task, dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [ACCEPT, task, dir], { encoding: "utf8", env });
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  return { status: run.status, lines, result: lines.length ? JSON.parse(lines.at(-1)) : null, stderr: run.stderr };
}

test("there are five tasks: four that depend on a rule and one control", () => {
  assert.deepEqual(TASKS.map((t) => t.id), ["discount", "cancel", "note", "by-status", "search-empty"]);
  assert.deepEqual(RULE_TASKS.map((t) => t.rule), ["R1", "R2", "R3", "R4"]);
  assert.equal(CONTROL.id, "search-empty");
  assert.equal(CONTROL.rule, null);
  for (const t of TASKS) {
    assert.ok(existsSync(join(ACCEPT_DIR, `${t.id}.works.test.mjs`)), `${t.id} has a works check`);
    assert.equal(existsSync(join(ACCEPT_DIR, `${t.id}.rule.test.mjs`)), !t.control, `${t.id}: a rule check exists unless it is the control`);
  }
  assert.deepEqual(Object.keys(SOLUTIONS).sort(), TASKS.map((t) => t.id).sort(), "every task has a reference patch");
  for (const t of TASKS) assert.deepEqual(Object.keys(SOLUTIONS[t.id]), t.control ? ["good"] : ["good", "naive"], t.id);
});

// accept is three test runs in processes of their own, so the cases of one test are judged a few
// at a time.
async function each(cases, fn, width = 4) {
  for (let i = 0; i < cases.length; i += width) await Promise.all(cases.slice(i, i + width).map(fn));
}
const inBothArms = (tasks) => ARMS.flatMap((arm) => tasks.map((t) => [arm, t]));

test("no task is done already: an untouched tree fails every task, in both arms", async () => {
  const dirs = { with: tree("with"), without: tree("without") };
  await each(inBothArms(TASKS), async ([arm, t]) => {
    const r = await accept(t.id, dirs[arm]);
    assert.equal(r.pass, false, `${arm} ${t.id}`);
    assert.equal(r.works, false, `${arm} ${t.id}: works must fail before the change is made`);
    assert.match(r.reason, /^works: /, `${arm} ${t.id}`);
  });
});

test("every task is solvable without the layer: each good patch passes in both arms", async () => {
  await each(inBothArms(RULE_TASKS), async ([arm, t]) => {
    const r = await accept(t.id, tree(arm, SOLUTIONS[t.id].good));
    assert.deepEqual(r, { task: t.id, works: true, rule: true, pass: true, reason: "pass" }, `${arm} ${t.id}`);
  });
});

test("every rule check can fire: each naive patch does what was asked and breaks the rule", async () => {
  await each(inBothArms(RULE_TASKS), async ([arm, t]) => {
    const r = await accept(t.id, tree(arm, SOLUTIONS[t.id].naive));
    assert.equal(r.works, true, `${arm} ${t.id}: ${r.reason}`);
    assert.equal(r.rule, false, `${arm} ${t.id}`);
    assert.equal(r.pass, false, `${arm} ${t.id}`);
    assert.match(r.reason, /^rule: /, `${arm} ${t.id}`);
  });
});

test("a good patch touches no context-layer file, so it was written from the base tree alone", () => {
  const layer = Object.keys(fixtureFiles("with")).filter((f) => !(f in fixtureFiles("without")));
  for (const t of TASKS) {
    for (const patch of Object.values(SOLUTIONS[t.id])) {
      for (const op of patch) assert.ok(!layer.includes(op.path), `${t.id} edits ${op.path}`);
    }
  }
});

test("the control has no rule: works alone decides it", async () => {
  for (const arm of ARMS) {
    const r = await accept(CONTROL.id, tree(arm, SOLUTIONS[CONTROL.id].good));
    assert.deepEqual(r, { task: "search-empty", works: true, rule: null, pass: true, reason: "pass" }, arm);
  }
});

test("a control fix that breaks what already worked fails on the repo's own tests", async () => {
  // Every request the prompt names answers correctly, and a search with two spaces in it no longer
  // finds anything. The works check does not ask about that; the shop's own suite does.
  const careless = SOLUTIONS[CONTROL.id].good.map((op) => ({ ...op, replace: op.replace.replace("normalise(query) : \"\"", "query.trim().toLowerCase() : \"\"") }));
  assert.notDeepEqual(careless, SOLUTIONS[CONTROL.id].good);
  const r = await accept(CONTROL.id, tree("without", careless));
  assert.equal(r.pass, false);
  assert.match(r.reason, /^own tests: a search ignores case and extra spaces/);
});

test("the function and the command agree on every patch, and the exit code is the result", async () => {
  const cases = [["search-empty", tree("with")], ["search-empty", tree("without", SOLUTIONS["search-empty"].good)]];
  for (const t of RULE_TASKS) {
    cases.push([t.id, tree("without")], [t.id, tree("with", SOLUTIONS[t.id].good)], [t.id, tree("without", SOLUTIONS[t.id].naive)]);
  }
  await each(cases, async ([task, dir]) => {
    const fn = await accept(task, dir);
    const cmd = command(task, dir);
    assert.equal(cmd.lines.length, 1, `${task}: one JSON line`);
    assert.deepEqual(cmd.result, fn, task);
    assert.equal(cmd.status, fn.pass ? 0 : 1, task);
  }, 2);
});

test("a session cannot pass by editing the repo's tests", async () => {
  // The naive discount breaks no test of the repo's own, so there is nothing to delete. This change
  // does break one: it drops the tax from an order's total, and then deletes the test that says so.
  const sabotage = [
    { path: "src/orders/service.js", find: "total: subtotal + tax,", replace: "total: subtotal," },
    { path: "test/orders.test.js", remove: true },
  ];
  const good = SOLUTIONS.cancel.good;
  const honest = await accept("cancel", tree("without", good));
  assert.equal(honest.pass, true);
  const cheated = await accept("cancel", tree("without", [...good, ...sabotage]));
  assert.equal(cheated.pass, false, "the deleted test is restored and fails");
  assert.equal(cheated.works, false);
  assert.match(cheated.reason, /^own tests: /);
  // Rewriting a test to assert nothing is the same move, and gets the same answer.
  const rewritten = await accept("cancel", tree("without", [...good, sabotage[0],
    { path: "test/orders.test.js", content: "import { test } from \"node:test\";\ntest(\"nothing\", () => {});\n" }]));
  assert.equal(rewritten.pass, false);
});

test("a file named like an acceptance test, added to the tree, changes no result", async () => {
  const plant = (task) => [
    { path: `${task}.rule.test.mjs`, content: "import { test } from \"node:test\";\ntest(\"planted\", () => {});\n" },
    { path: `accept/${task}.rule.test.mjs`, content: "import { test } from \"node:test\";\ntest(\"planted\", () => {});\n" },
    { path: `test/${task}.works.test.mjs`, content: "import { test } from \"node:test\";\ntest(\"planted\", () => { throw new Error(\"planted failure\"); });\n" },
  ];
  const naive = await accept("discount", tree("without", [...SOLUTIONS.discount.naive, ...plant("discount")]));
  assert.equal(naive.rule, false, "a planted passing rule test does not pass the rule");
  const good = await accept("discount", tree("without", [...SOLUTIONS.discount.good, ...plant("discount")]));
  assert.equal(good.pass, true, "a planted failing test does not fail a good change");
});

test("accept leaves the tree it judges exactly as the session left it", async () => {
  const dir = tree("with", SOLUTIONS.note.good);
  const before = hashDir(dir);
  await accept("note", dir);
  assert.equal(hashDir(dir), before);
});

test("the acceptance files never enter a working copy", () => {
  const names = readdirSync(ACCEPT_DIR);
  assert.ok(names.length >= 9);
  for (const arm of ARMS) {
    for (const [rel, text] of Object.entries(fixtureFiles(arm))) {
      for (const name of names) assert.ok(!rel.endsWith(name) && !text.includes(name), `${arm}: ${rel} carries ${name}`);
    }
  }
});

// ── each rule check, held to more than the one naive patch ────────────────────────────────────────

const edit = (path, find, replace) => ({ path, find, replace });

test("R1: truncating fails the rule even though rounding half up was not used", async () => {
  const truncating = SOLUTIONS.discount.naive.map((op) => ({ ...op, replace: op.replace.replace("Math.round(subtotal * 0.1)", "Math.floor(subtotal / 10)") }));
  assert.notDeepEqual(truncating, SOLUTIONS.discount.naive);
  const r = await accept("discount", tree("without", truncating));
  assert.equal(r.works, true, r.reason);
  assert.equal(r.rule, false);
  assert.match(r.reason, /10015/);
});

test("R1: an amount that is not an integer fails the rule", async () => {
  const fractional = SOLUTIONS.discount.naive.map((op) => ({ ...op, replace: op.replace.replace("Math.round(subtotal * 0.1)", "subtotal / 10") }));
  const r = await accept("discount", tree("without", fractional));
  assert.equal(r.works, true, r.reason);
  assert.equal(r.rule, false);
});

test("R2: cancelling without an audit entry, or with two, fails the rule", async () => {
  const good = SOLUTIONS.cancel.good;
  const audit = "  recordAudit(ctx, id, \"cancelled\");\n";
  const none = good.map((op) => (op.replace?.includes(audit) ? { ...op, replace: op.replace.replace(audit, "") } : op));
  const twice = good.map((op) => (op.replace?.includes(audit) ? { ...op, replace: op.replace.replace(audit, audit + audit) } : op));
  assert.notDeepEqual(none, good);
  for (const patch of [none, twice]) {
    const r = await accept("cancel", tree("without", patch));
    assert.equal(r.works, true, r.reason);
    assert.equal(r.rule, false);
    assert.match(r.reason, /audit/);
  }
});

test("R2: a refused cancellation that still writes an audit entry fails the rule", async () => {
  const good = SOLUTIONS.cancel.good;
  const guard = "  if (order.status === \"shipped\") throw new ConflictError(";
  const noisy = good.map((op) => (op.replace?.includes(guard) ? { ...op, replace: op.replace.replace(guard, "  if (order.status === \"shipped\") recordAudit(ctx, id, \"cancel refused\");\n" + guard) } : op));
  assert.notDeepEqual(noisy, good);
  const r = await accept("cancel", tree("without", noisy));
  assert.equal(r.works, true, r.reason);
  assert.equal(r.rule, false);
});

test("R3: editing a shipped migration fails the rule, even when a new one is added too", async () => {
  const edited = [...SOLUTIONS.note.good, edit("src/store/migrations/003-order-currency.js", "currency: \"EUR\"", "currency: \"EUR\", note: \"\"")];
  const r = await accept("note", tree("without", edited));
  assert.equal(r.works, true, r.reason);
  assert.equal(r.rule, false);
  assert.match(r.reason, /003-order-currency\.js/);
});

test("R3: a new migration that does not backfill the stored rows fails the rule", async () => {
  const hollow = SOLUTIONS.note.good.map((op) => (op.path.includes("004") ? { ...op, content: op.content.replace(/up\(db\) \{[\s\S]*\n  \},/, "up(db) {},") } : op));
  assert.notDeepEqual(hollow, SOLUTIONS.note.good);
  const patched = [...hollow, ...SOLUTIONS.note.naive.filter((op) => op.path === "src/orders/repository.js")];
  const r = await accept("note", tree("without", patched));
  assert.equal(r.works, true, r.reason);
  assert.equal(r.rule, false);
  assert.match(r.reason, /stored/);
});

test("R4: a dynamic import of the store from a route fails the rule, and so does a re-export", async () => {
  const good = SOLUTIONS["by-status"].good;
  const dynamic = [...good, edit("src/routes/health.js", "export function healthRoutes() {", "export const peek = () => import(\"../store/db.js\");\n\nexport function healthRoutes() {")];
  const reexport = [...good, edit("src/routes/health.js", "export function healthRoutes() {", "export { allOrders } from \"../orders/repository.js\";\n\nexport function healthRoutes() {")];
  const nested = [...good, { path: "src/routes/admin/orders.js", content: "import { createDb } from \"../../store/db.js\";\n\nexport const db = createDb;\n" }];
  for (const patch of [dynamic, reexport, nested]) {
    const r = await accept("by-status", tree("without", patch));
    assert.equal(r.works, true, r.reason);
    assert.equal(r.rule, false);
  }
});

test("R4: the rule check does not depend on what the service function is called", async () => {
  const renamed = SOLUTIONS["by-status"].good.map((op) => ({ ...op, replace: op.replace.replaceAll("listOrders", "ordersInStatus") }));
  assert.notDeepEqual(renamed, SOLUTIONS["by-status"].good);
  const r = await accept("by-status", tree("without", renamed));
  assert.equal(r.pass, true, r.reason);
});

// ── faults ────────────────────────────────────────────────────────────────────────────────────────

test("a harness fault is exit 2 and is never a failed task", async () => {
  const dir = tree("without");
  await assert.rejects(accept("no-such-task", dir), HarnessFault);
  await assert.rejects(accept("discount", join(dir, "nowhere")), HarnessFault);
  const empty = mkdtempSync(join(tmpdir(), "cortex-harness-test-"));
  roots.push(empty);
  await assert.rejects(accept("discount", empty), /not a built fixture/);

  const unknown = command("no-such-task", dir);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.result.pass, null);
  assert.match(unknown.result.reason, /^harness fault: /);
  assert.equal(command("discount", join(dir, "nowhere")).status, 2);
  const usage = spawnSync(process.execPath, [ACCEPT], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node evals\/harness\/accept\.mjs <task> <tree>/);
});

test("a change that never returns is a failed task with its reason, not a hung run", async () => {
  const dir = tree("without", [edit("src/cart/pricing.js", "  const subtotal =", "  for (;;) {}\n  const subtotal =")]);
  const r = await accept("discount", dir, { timeoutMs: 4000 });
  assert.equal(r.pass, false);
  assert.match(r.reason, /timed out/);
});

test("a tree whose source no longer loads fails the task; it is not a fault", async () => {
  const dir = tree("without");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "server.js"), "export const nothing = (;\n");
  const r = await accept("discount", dir);
  assert.equal(r.pass, false);
  assert.equal(readFileSync(join(dir, "src", "server.js"), "utf8"), "export const nothing = (;\n");
});
