// json-text.js — the text insertion both JSON writers share (index/lib/shared-plugin.mjs and
// tools/cortex-setup.mjs). What matters is that only the inserted entry changes: every other byte,
// the file's indentation and its line endings stay what they were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { insertUnder, objectAt, skipWs, textStyle } from "../json-text.js";

const add = (t, key, name, value) => {
  const root = skipWs(t, 0);
  return insertUnder(t, root, key, name, value, textStyle(t, root));
};

test("a new top-level key goes at the end of the root, in the file's own indent", () => {
  const t = '{\n    "a": [1, 2, 3],\n    "b": "x"\n}\n';
  const out = add(t, "servers", "cortex", { command: "node" });
  assert.equal(out, '{\n    "a": [1, 2, 3],\n    "b": "x",\n    "servers": {\n        "cortex": {\n            "command": "node"\n        }\n    }\n}\n');
  assert.deepEqual(JSON.parse(out), { a: [1, 2, 3], b: "x", servers: { cortex: { command: "node" } } });
});

test("an existing key gains the entry as its last member; its other members are untouched", () => {
  const t = '{\r\n  "servers": {\r\n    "other": { "command": "x", "args": [ "a",  "b" ] }\r\n  }\r\n}\r\n';
  const out = add(t, "servers", "cortex", { command: "node" });
  assert.ok(out.startsWith('{\r\n  "servers": {\r\n    "other": { "command": "x", "args": [ "a",  "b" ] },'), "the inline object keeps its spacing");
  assert.ok(!out.replace(/\r\n/g, "").includes("\n"), "CRLF stays CRLF");
  assert.deepEqual(Object.keys(JSON.parse(out).servers), ["other", "cortex"]);
});

test("a one-line object stays one line, and an empty one is opened up", () => {
  assert.equal(add('{"a": 1}', "s", "c", 1), '{"a": 1, "s": {"c":1}}');
  assert.deepEqual(JSON.parse(add("{}\n", "s", "c", { x: 1 })), { s: { c: { x: 1 } } });
  assert.deepEqual(JSON.parse(add('{ "s": {} }', "s", "c", 2)), { s: { c: 2 } });
});

test("a key written twice gains the entry in the occurrence JSON.parse keeps — the last", () => {
  const t = '{\n  "s": { "a": 1 },\n  "s": { "b": 2 }\n}\n';
  assert.deepEqual(JSON.parse(add(t, "s", "c", 3)).s, { b: 2, c: 3 });
});

test("strings holding braces, quotes and escapes do not move the scanner", () => {
  const t = '{\n  "k": "a } \\" { ]",\n  "s": { "x": "}" }\n}\n';
  const members = objectAt(t, 0).members.map((m) => m.key);
  assert.deepEqual(members, ["k", "s"]);
  assert.deepEqual(JSON.parse(add(t, "s", "c", true)).s, { x: "}", c: true });
});
