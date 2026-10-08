// agent-answers.test.mjs — what a developer answered about an agent already here, kept across runs.
//
// The failure this pins is #548's third: five agents answered "not a role" in one /cortex pass were
// all asked about again on the next, because the answer lived in one command's arguments. The other
// half is the direction of error: a damaged or stale file may only ever ASK again — it never maps an
// agent, and a write never drops answers it could not read.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ANSWERS_REL, readAgentAnswers, rememberAgentAnswers } from "../lib/agent-answers.mjs";

const A = ".claude/agents/a.md";
const B = ".claude/agents/b.md";
const fileOf = (root) => join(root, ...ANSWERS_REL.split("/"));
const put = (root, text) => {
  mkdirSync(join(root, ".cortex"), { recursive: true });
  writeFileSync(fileOf(root), text);
};

test("a repo with no answers reads as none, and reading creates nothing", () => {
  const root = tempDir("cortex-answers-");
  assert.deepEqual(readAgentAnswers(root), {});
  assert.equal(existsSync(join(root, ".cortex")), false);
});

test("an answer written is the answer read: a role, and null for not a role", () => {
  const root = tempDir("cortex-answers-");
  rememberAgentAnswers(root, { [B]: "tester", [A]: null });
  assert.deepEqual(readAgentAnswers(root), { [A]: null, [B]: "tester" });
  const text = readFileSync(fileOf(root), "utf8");
  assert.deepEqual(JSON.parse(text), { format: 1, answers: { [A]: "none", [B]: "tester" } });
  assert.ok(text.endsWith("}\n") && !text.includes("\r"), "LF, one trailing newline, paths sorted");
});

test("a later answer replaces the earlier one and keeps the rest; `undefined` forgets one", () => {
  const root = tempDir("cortex-answers-");
  rememberAgentAnswers(root, { [A]: null, [B]: null });
  rememberAgentAnswers(root, { [A]: "reviewer" });
  assert.deepEqual(readAgentAnswers(root), { [A]: "reviewer", [B]: null });
  rememberAgentAnswers(root, { [B]: undefined });
  assert.deepEqual(readAgentAnswers(root), { [A]: "reviewer" });
});

test("a file that cannot be read asks again rather than mapping anything", () => {
  const root = tempDir("cortex-answers-");
  for (const text of ["{ not json", "[]", '{"format":2,"answers":{".claude/agents/a.md":"none"}}', '{"format":1,"answers":[]}']) {
    put(root, text);
    assert.deepEqual(readAgentAnswers(root), {}, text);
  }
});

test("one bad entry is dropped and the others are kept", () => {
  const root = tempDir("cortex-answers-");
  put(root, JSON.stringify({ format: 1, answers: { [A]: "none", [B]: "boss", "../x.md": "none", "c.md": 3 } }));
  assert.deepEqual(readAgentAnswers(root), { [A]: null });
});

test("a write over a file it cannot read is refused, and the file is left as it was", () => {
  const root = tempDir("cortex-answers-");
  put(root, "{ not json");
  assert.throws(() => rememberAgentAnswers(root, { [A]: null }), /agents\.json/);
  assert.equal(readFileSync(fileOf(root), "utf8"), "{ not json");
});

test("an answer that is no role, or a path outside the repo, is refused before anything is written", () => {
  const root = tempDir("cortex-answers-");
  assert.throws(() => rememberAgentAnswers(root, { [A]: "boss" }), /not a role/);
  assert.throws(() => rememberAgentAnswers(root, { "../a.md": null }), /relative|segments/);
  assert.equal(existsSync(fileOf(root)), false);
});
