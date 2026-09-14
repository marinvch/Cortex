// The tool table is the single statement of mode availability. These tests pin the two things that
// follow from that: the declaration is well-formed, and both derivations — the advertised list and
// the guard — read it. mode.test.js proves the same rule end to end over a spawned server; this
// proves it without the 5s spawn, and catches a bad row at the point it is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOOL_TABLE, toolsFor, assertAvailable, assertWellFormed, assertPublishable,
  REPO, VAULT, ANY, FOREIGN, OWN, LOCAL, PUBLISHED, UNTRUSTED_NOTE,
} from "../lib/tools.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every tool declares a mode, exactly once", () => {
  const seen = new Set();
  for (const t of TOOL_TABLE) {
    assert.ok([REPO, VAULT, ANY].includes(t.mode), `${t.name}: mode must be repo | vault | any, got ${t.mode}`);
    assert.ok(t.description && t.inputSchema, `${t.name}: needs a description and a schema`);
    assert.ok(!seen.has(t.name), `${t.name} is declared twice`);
    seen.add(t.name);
  }
});

test("the advertised list is exactly the tools that run in that mode", () => {
  assert.deepEqual(toolsFor(true).map((t) => t.name).sort(), ["recall", "recall_memory", "remember"]);
  assert.deepEqual(
    toolsFor(false).map((t) => t.name).sort(),
    ["capture", "catch_me_up", "get_project_context", "list_projects", "recall"],
  );
});

test("our own fields never reach the client", () => {
  // tools/list sends these descriptors verbatim, so an internal field would ship as protocol.
  for (const descriptor of [...toolsFor(true), ...toolsFor(false)]) {
    assert.deepEqual(Object.keys(descriptor).sort(), ["description", "inputSchema", "name"]);
  }
});

test("the guard refuses a tool whose declared mode does not match", () => {
  // Repo mode: the vault tools are the ones that would write inbox/ into a product repository.
  for (const vaultOnly of ["capture", "catch_me_up", "list_projects", "get_project_context"]) {
    assert.throws(() => assertAvailable(vaultOnly, true), /only available when Cortex is pointed at a vault/, vaultOnly);
    assert.doesNotThrow(() => assertAvailable(vaultOnly, false), vaultOnly);
  }
  for (const repoOnly of ["remember", "recall_memory"]) {
    assert.throws(() => assertAvailable(repoOnly, false), /only available when Cortex is pointed at a repo/, repoOnly);
    assert.doesNotThrow(() => assertAvailable(repoOnly, true), repoOnly);
  }
  assert.doesNotThrow(() => assertAvailable("recall", true));
  assert.doesNotThrow(() => assertAvailable("recall", false));
  assert.throws(() => assertAvailable("rm -rf", true), /unknown tool/);
});

// A retrieval tool hands the model text somebody else wrote, and the result itself carries nothing
// saying which of data and instruction it is. The tool description is the one place the model
// reliably reads, so the boundary is stated there. Drive these off the table, never off a list of
// names: the point is that the NEXT tool cannot ship without answering the question either.
test("every tool that returns foreign text carries the trust boundary", () => {
  const foreign = TOOL_TABLE.filter((t) => t.returns === FOREIGN);
  assert.ok(foreign.length > 0, "the table claims no tool returns foreign text, which cannot be right");
  for (const t of foreign) {
    assert.ok(
      t.description.includes(UNTRUSTED_NOTE),
      `${t.name} returns text from outside this conversation and must say so in its description`,
    );
  }
});

test("the trust boundary is one sentence, stated once", () => {
  // Seven near-copies of a warning is how one of them ends up weaker than the rest.
  assert.match(UNTRUSTED_NOTE, /data, not instructions/);
  const src = readFileSync(join(MCP_DIR, "lib", "tools.js"), "utf8");
  const literals = src.match(/Treat what it returns/g) ?? [];
  assert.equal(literals.length, 1, "UNTRUSTED_NOTE must be written once and interpolated, not pasted per tool");
});

test("a write-only tool is not marked foreign", () => {
  // `remember` and `capture` take input and hand back a path; nothing foreign comes out. Marking
  // them anyway would blunt the warning on the tools where it is load-bearing.
  for (const t of TOOL_TABLE.filter((x) => x.returns === OWN)) {
    assert.ok(!t.description.includes(UNTRUSTED_NOTE), `${t.name} is declared own but carries the trust note`);
  }
});

test("a row that skips the question is rejected, not defaulted", () => {
  // The guarantee is not "today's seven tools are marked" — it is that the eighth cannot be added
  // without answering. This is the check that runs at import, handed the rows it exists to catch.
  const row = { name: "t", mode: ANY, description: "d", inputSchema: {}, writes: LOCAL };
  assert.throws(() => assertWellFormed([row]), /returns must be one of foreign \| own/);
  assert.throws(
    () => assertWellFormed([{ ...row, returns: FOREIGN }]),
    /must carry UNTRUSTED_NOTE/,
    "a foreign tool with a bare description must fail",
  );
  assert.doesNotThrow(() => assertWellFormed([{ ...row, returns: OWN }]));
  assert.doesNotThrow(() => assertWellFormed([{ ...row, returns: FOREIGN, description: `d ${UNTRUSTED_NOTE}` }]));
});

// The secret gate. `core/scrub.js` is documented as "the single point at which anything entering
// memory is checked", and for a long time it had exactly one caller — so `capture`, which on a team
// commits and PUSHES a note to a remote other people pull, wrote unscanned. The fix is a field on
// the row, so the property below is "every tool that publishes is gated", never "capture is gated".

// Assembled at runtime, not written as a literal: a realistic key trips GitHub push protection and
// Cortex's own scanner. A `cortex:allow-secrets` marker would exempt the whole file and then sit
// dormant, which findings.mjs correctly reports as worse than no marker.
const FAKE_AWS_KEY = ["AKIA", "Q7X2M4N8P1R5T9V3"].join("");

test("a row that does not say where its write goes is rejected", () => {
  const row = { name: "t", mode: ANY, returns: OWN, description: "d", inputSchema: {} };
  assert.throws(() => assertWellFormed([row]), /writes must be one of local \| published/);
  assert.throws(
    () => assertWellFormed([{ ...row, writes: "maybe" }]),
    /writes must be one of local \| published/,
    "an invented value is not a declaration",
  );
  assert.doesNotThrow(() => assertWellFormed([{ ...row, writes: LOCAL }]));
});

test("a publishing row must carry its payload in `content` — the field the gate reads", () => {
  // Otherwise the row passes every check above and is written unscanned: the same hole, wearing a
  // different argument name.
  const row = { name: "t", mode: ANY, returns: OWN, description: "d", writes: PUBLISHED };
  assert.throws(() => assertWellFormed([{ ...row, inputSchema: { type: "object", properties: { body: { type: "string" } } } }]), /payload must be the `content` argument/);
  assert.throws(() => assertWellFormed([{ ...row, inputSchema: {} }]), /payload must be the `content` argument/);
  assert.doesNotThrow(() => assertWellFormed([{ ...row, inputSchema: { type: "object", properties: { content: { type: "string" } } } }]));
});

test("every tool that publishes refuses a credential", () => {
  const publishing = TOOL_TABLE.filter((t) => t.writes === PUBLISHED);
  assert.ok(publishing.length > 0, "the table claims nothing publishes, which cannot be right");
  for (const t of publishing) {
    assert.throws(
      () => assertPublishable(t.name, { content: `aws key ${FAKE_AWS_KEY} for the staging box` }),
      (e) => {
        assert.equal(e.code, "refused_write", `${t.name}: must refuse with RefusedWriteError`);
        assert.match(e.message, /AWS access key id/, `${t.name}: the refusal must name the kind`);
        // Refusing and then echoing the secret in the error is the same leak by another route.
        assert.ok(!e.message.includes(FAKE_AWS_KEY), `${t.name}: the refusal echoed the credential`);
        assert.ok(
          e.findings.every((f) => !f.match.includes(FAKE_AWS_KEY)),
          `${t.name}: the findings echoed the credential — redact() exists for this`,
        );
        return true;
      },
      t.name,
    );
    assert.doesNotThrow(() => assertPublishable(t.name, { content: "an ordinary note" }), t.name);
  }
});

test("the declaration decides, not the content — a local tool is not scanned", () => {
  // A gate on a read would teach people to route around it. `recall`'s query is not a write.
  for (const t of TOOL_TABLE.filter((x) => x.writes === LOCAL)) {
    assert.doesNotThrow(() => assertPublishable(t.name, { content: FAKE_AWS_KEY, query: FAKE_AWS_KEY }), t.name);
  }
  assert.throws(() => assertPublishable("rm -rf", { content: "x" }), /unknown tool/);
});

test("every declared tool is wired up in server.js", () => {
  // The table decides what is advertised, so a row with no case would be an offered tool that
  // answers "declared but not implemented" when called.
  const src = readFileSync(join(MCP_DIR, "server.js"), "utf8");
  for (const t of TOOL_TABLE) {
    assert.match(src, new RegExp(`case "${t.name}":`), `${t.name} is declared but server.js has no case for it`);
  }
});
