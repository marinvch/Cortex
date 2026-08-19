// mcp/test/capture.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/capture.js";

test("captures to projects/<slug>.md when project given", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "PingID cookies", project: "unis", today: "2026-07-01" });
  assert.match(path, /projects[\\/]unis\.md$/);
  assert.match(readFileSync(path, "utf8"), /PingID cookies/);
});

test("captures to inbox/<date>.md when no project", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "stray idea", today: "2026-07-01" });
  assert.match(path, /inbox[\\/]2026-07-01\.md$/);
  assert.match(readFileSync(path, "utf8"), /stray idea/);
});

test("appends, does not overwrite", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  capture(root, { content: "first", today: "2026-07-01" });
  const { path } = capture(root, { content: "second", today: "2026-07-01" });
  const body = readFileSync(path, "utf8");
  assert.match(body, /first/);
  assert.match(body, /second/);
});

test("writes tags when provided", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "x", tags: ["auth", "unis"], today: "2026-07-01" });
  assert.match(readFileSync(path, "utf8"), /#auth #unis/);
});

test("a lab profile writes the team note but does not push it", () => {
  // core/profile.js: lab refuses nothing locally, so it must publish nothing. The note is still
  // written — sealing outward sync must not lose work — and the caller is told why it did not go,
  // rather than being handed a silent success.
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const res = capture(root, {
    content: "an experiment", project: "unis", team: "acme",
    today: "2026-07-01", noteId: "lab1", outwardSync: false,
  });
  assert.equal(res.pushed, false);
  assert.equal(res.error, "outward_sync_disabled");
  assert.ok(existsSync(res.path), "the note is written, not discarded");
  assert.match(readFileSync(res.path, "utf8"), /an experiment/);
});
