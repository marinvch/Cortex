import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { serve } from "../lib/stdio.js";

// The MCP stdio transport is newline-delimited JSON-RPC 2.0 and nothing more. These tests pin the
// parts an SDK used to provide, because the parts an SDK provides are exactly the parts nobody
// remembers to implement: notifications must not be answered, unknown methods must produce an
// error object rather than a crash, and a message split across two reads must still parse.

/** Run `serve` against in-memory streams; returns a writer and the parsed messages seen so far. */
function harness(handlers = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const seen = [];
  let buf = "";
  output.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) if (line.trim()) seen.push(JSON.parse(line));
  });

  serve({
    name: "cortex",
    version: "9.9.9",
    tools: [{ name: "echo", description: "d", inputSchema: { type: "object" } }],
    call: async (name, args) => {
      if (name === "boom") throw new Error("exploded");
      return { echoed: args };
    },
    ...handlers,
    input,
    output,
  });

  const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));
  return {
    seen,
    async send(msg) {
      input.write(JSON.stringify(msg) + "\n");
      await flush();
    },
    async sendRaw(chunk) {
      input.write(chunk);
      await flush();
    },
  };
}

test("initialize answers with the server identity and a protocol version", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } });

  assert.equal(h.seen.length, 1);
  const res = h.seen[0];
  assert.equal(res.id, 1);
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.result.serverInfo.name, "cortex");
  assert.equal(res.result.serverInfo.version, "9.9.9");
  assert.equal(res.result.protocolVersion, "2024-11-05", "a supported version is echoed back");
  assert.ok(res.result.capabilities.tools, "tools capability must be declared or no tool is offered");
});

test("an unsupported protocol version falls back to one we do support", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.ok(h.seen[0].result.protocolVersion !== "1999-01-01");
  assert.match(h.seen[0].result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test("notifications are never answered", async () => {
  // A reply to a message with no id is a protocol violation, and clients differ in how loudly
  // they fail on it. `notifications/initialized` arrives on every single session.
  const h = harness();
  await h.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await h.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } });
  assert.deepEqual(h.seen, []);
});

test("tools/list returns the declared tools", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(h.seen[0].result.tools.map((t) => t.name), ["echo"]);
});

test("tools/call routes to the handler and wraps the result as content", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } });
  const res = h.seen[0].result;
  assert.equal(res.content[0].type, "text");
  assert.deepEqual(JSON.parse(res.content[0].text), { echoed: { a: 1 } });
  assert.ok(!res.isError);
});

test("a throwing tool becomes an error result, not a dead server", async () => {
  // isError on the result, not a JSON-RPC error: the call was delivered, the tool failed. A throw
  // that escapes the loop would take the whole brain down mid-session.
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } });
  assert.equal(h.seen[0].result.isError, true);
  assert.match(h.seen[0].result.content[0].text, /exploded/);
  await h.send({ jsonrpc: "2.0", id: 5, method: "tools/list" });
  assert.equal(h.seen[1].id, 5, "the server still answers after a tool threw");
});

test("an unknown method returns -32601 rather than silence", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 6, method: "resources/list" });
  assert.equal(h.seen[0].error.code, -32601);
  assert.ok(!("result" in h.seen[0]), "a response carries either result or error, never both");
});

test("ping is answered — clients use it to decide the server is alive", async () => {
  const h = harness();
  await h.send({ jsonrpc: "2.0", id: 7, method: "ping" });
  assert.deepEqual(h.seen[0].result, {});
});

test("a message split across reads is still parsed once complete", async () => {
  const h = harness();
  await h.sendRaw('{"jsonrpc":"2.0","id":8,"me');
  assert.deepEqual(h.seen, [], "a partial line must not be parsed");
  await h.sendRaw('thod":"ping"}\n');
  assert.equal(h.seen[0].id, 8);
});

test("two messages in one read are both handled", async () => {
  const h = harness();
  await h.sendRaw('{"jsonrpc":"2.0","id":9,"method":"ping"}\n{"jsonrpc":"2.0","id":10,"method":"ping"}\n');
  assert.deepEqual(h.seen.map((m) => m.id), [9, 10]);
});

test("unparseable input returns a parse error and the server survives", async () => {
  const h = harness();
  await h.sendRaw("this is not json\n");
  assert.equal(h.seen[0].error.code, -32700);
  await h.send({ jsonrpc: "2.0", id: 11, method: "ping" });
  assert.equal(h.seen[1].id, 11);
});
