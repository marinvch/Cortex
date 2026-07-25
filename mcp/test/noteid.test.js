// mcp/test/noteid.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { genNoteId, _resetCounter } from "../lib/noteid.js";

test("ids are unique within the same millisecond and pid", () => {
  _resetCounter();
  const frozen = 1_800_000_000_000;
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(genNoteId(frozen, 4242));
  assert.equal(ids.size, 1000, "a repeated id would silently overwrite a team note");
});

test("ids are filesystem-safe", () => {
  _resetCounter();
  for (let i = 0; i < 50; i++) assert.match(genNoteId(), /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/);
});

test("ids sort by capture time", () => {
  _resetCounter();
  const early = genNoteId(1_800_000_000_000, 1);
  const later = genNoteId(1_900_000_000_000, 1);
  assert.ok(early < later);
});
