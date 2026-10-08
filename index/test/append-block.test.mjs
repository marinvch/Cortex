// append-block.test.mjs — a block Cortex appends to a file the team also writes takes that file's
// line endings (#548, item 9).
//
// /cortex appends the verification block and the team playbook to `CLAUDE.md`. Its templates are LF,
// and on a `core.autocrlf` checkout the target is CRLF on disk, so an append as-is left one file with
// two kinds of line ending and the developer converted the block by hand. The property pinned here is
// the whole file's, not the block's: after an append no line ends differently from the rest, and
// every byte that was there before is still there, in place.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { appendBlock, SectionRefused } from "../lib/section.mjs";
import { blockAppend } from "../lib/sections.mjs";
import { mergeSharedPlugin } from "../lib/shared-plugin.mjs";

const CLI = fileURLToPath(new URL("../cortex-section.mjs", import.meta.url));
const BLOCK = "## Working as a team\n\nThis repo has agents.\n\n1. Ask first.\n";
const bareLf = (s) => (s.match(/(?<!\r)\n/g) ?? []).length;
const crlf = (s) => (s.match(/\r\n/g) ?? []).length;

test("appending to a CRLF file leaves no LF line in it, and every earlier byte where it was", () => {
  const before = "@AGENTS.md\r\n\r\n## Verifying your work\r\n\r\nRun the tests.\r\n";
  const after = appendBlock(before, BLOCK);
  assert.ok(after.startsWith(before), "nothing before the block changed");
  assert.equal(bareLf(after), 0);
  assert.equal(after, before + "\r\n" + BLOCK.replace(/\n/g, "\r\n"));
});

test("appending to an LF file leaves no CRLF in it, even when the block arrives as CRLF", () => {
  const before = "@AGENTS.md\n";
  const after = appendBlock(before, BLOCK.replace(/\n/g, "\r\n"));
  assert.equal(crlf(after), 0);
  assert.equal(after, before + "\n" + BLOCK);
});

test("one blank line separates the block, whatever the file ended with, and the file ends with one newline", () => {
  for (const [before, sep] of [["a\n", "\n"], ["a", "\n\n"], ["a\n\n", ""], ["a\n\n\n", ""], ["a\r\n", "\r\n"], ["a\r\n\r\n", ""]]) {
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    const after = appendBlock(before, "\n\n" + BLOCK + "\n\n");
    assert.equal(after, before + sep + BLOCK.replace(/\n/g, eol), JSON.stringify(before));
  }
});

test("a new or empty file gets the block alone, with LF", () => {
  assert.equal(appendBlock(null, BLOCK.replace(/\n/g, "\r\n")), BLOCK);
  assert.equal(appendBlock("", BLOCK), BLOCK);
});

test("a file with both endings takes the one most of its lines have, and an LF file is not turned by one stray CRLF", () => {
  const mostlyCrlf = "a\r\nb\r\nc\n";
  assert.equal(bareLf(appendBlock(mostlyCrlf, BLOCK).slice(mostlyCrlf.length)), 0);
  const mostlyLf = "a\nb\nc\r\n";
  assert.equal(crlf(appendBlock(mostlyLf, BLOCK).slice(mostlyLf.length)), 0);
});

test("a BOM and the last line's text are left as they are", () => {
  const before = "﻿# Notes\r\nlast line, no newline";
  const after = appendBlock(before, BLOCK);
  assert.ok(after.startsWith(before));
  assert.equal(bareLf(after), 0);
});

test("an empty block is refused", () => {
  assert.throws(() => appendBlock("a\n", " \n\n"), SectionRefused);
});

// --- the write ---------------------------------------------------------------------------------------

function world(files = {}) {
  const root = tempDir("cortex-append-");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test("blockAppend writes the file with its own endings and says which", () => {
  const root = world({ "CLAUDE.md": "@AGENTS.md\r\n" });
  const r = blockAppend(root, "CLAUDE.md", BLOCK);
  assert.deepEqual({ written: r.written, path: r.path, eol: r.eol }, { written: true, path: "CLAUDE.md", eol: "CRLF" });
  const text = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.equal(bareLf(text), 0);
  assert.ok(text.endsWith("1. Ask first.\r\n"));
});

test("blockAppend creates a file that is not there, with LF", () => {
  const root = world();
  assert.equal(blockAppend(root, "CLAUDE.md", BLOCK).eol, "LF");
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), BLOCK);
});

test("a block whose heading is already a section of the file is refused, and the file is untouched", () => {
  const before = "@AGENTS.md\n\n## Working as a team\n\nThe team's own text.\n";
  const root = world({ "CLAUDE.md": before });
  assert.throws(() => blockAppend(root, "CLAUDE.md", BLOCK), (e) => e instanceof SectionRefused && e.code === 2 && /already has a section/.test(e.message));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), before);
});

test("only a markdown file inside the repo is appended to", () => {
  const root = world({ "src/a.js": "x\n" });
  assert.throws(() => blockAppend(root, "src/a.js", BLOCK), (e) => e instanceof SectionRefused && e.code === 1);
  assert.throws(() => blockAppend(root, "../outside.md", BLOCK), (e) => e instanceof SectionRefused && e.code === 1);
  assert.equal(readFileSync(join(root, "src/a.js"), "utf8"), "x\n");
});

test("a markdown path that is a link out of the repo is refused", (t) => {
  const outside = world({ "notes.md": "outside\n" });
  const root = world();
  try {
    symlinkSync(join(outside, "notes.md"), join(root, "CLAUDE.md"));
  } catch {
    return t.skip("this machine cannot create a symlink");
  }
  assert.throws(() => blockAppend(root, "CLAUDE.md", BLOCK), SectionRefused);
  assert.equal(readFileSync(join(outside, "notes.md"), "utf8"), "outside\n");
});

test("the CLI appends from a file, reports the endings, and refuses without --from", () => {
  const root = world({ "CLAUDE.md": "@AGENTS.md\r\n", "block.md": BLOCK });
  const run = (...args) => spawnSync(process.execPath, [CLI, root, ...args], { encoding: "utf8" });
  const bad = run("--append", "CLAUDE.md");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--from/);
  const ok = run("--append", "CLAUDE.md", "--from", join(root, "block.md"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Appended to CLAUDE\.md with its own line endings \(CRLF\)/);
  assert.equal(bareLf(readFileSync(join(root, "CLAUDE.md"), "utf8")), 0);
  const again = run("--append", "CLAUDE.md", "--from", join(root, "block.md"));
  assert.equal(again.status, 2);
  assert.match(again.stderr, /Nothing was written/);
});

// --- the other merge into a team's file ---------------------------------------------------------------

test("the settings merge keeps a CRLF file CRLF", () => {
  const before = '{\r\n  "permissions": {\r\n    "allow": ["Bash(npm test)"]\r\n  }\r\n}\r\n';
  const r = mergeSharedPlugin(before, {});
  const text = typeof r === "string" ? r : r.text;
  assert.ok(text.includes('"enabledPlugins"'));
  assert.equal(bareLf(text), 0);
});
