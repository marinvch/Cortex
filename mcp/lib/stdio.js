// A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, no dependencies.
//
// This replaced `@modelcontextprotocol/sdk`, which was 22 MB across ~90 packages (express, zod,
// jose, hono) for the four symbols Cortex used. The size was not the problem. The problem was that
// Cortex ships as a Claude plugin, a plugin install CLONES the repository, and nothing runs
// `npm install` — so the brain died with ERR_MODULE_NOT_FOUND on every machine that was not this
// one. A dependency the installer cannot satisfy is not a dependency, it is an outage.
//
// The protocol surface Cortex needs is small enough to own: initialize, tools/list, tools/call,
// ping. See docs/adr/0004-no-runtime-dependencies.md.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PREFERRED = PROTOCOL_VERSIONS[0];

const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;

/**
 * The most text one tool result may carry. Claude Code warns at 10,000 tokens of MCP output and
 * cuts at 25,000 by default, and `recall_memory` and `get_project_context` return whole files —
 * a long-lived memory directory or a big project brief sailed past both. 40,000 characters is about
 * 10,000 tokens of prose and stays under 14,000 even at a pessimistic 3 characters per token (code,
 * JSON escapes), so a capped result is never the one Claude Code truncates for us, silently.
 *
 * Capped here, in the transport, rather than per tool: every tool's result passes through this one
 * line, so a tool added next year is capped without anyone remembering to.
 */
export const MAX_RESULT_CHARS = 40_000;

/**
 * `text` as-is when it fits; otherwise a smaller JSON document that says it was truncated, by how
 * much, and how to get the rest. Never a silent cut — a reader handed half a memory file with no
 * marker would treat the missing days as days nothing happened.
 */
export function capResult(text, max = MAX_RESULT_CHARS) {
  if (text.length <= max) return text;
  const note = {
    truncated: true,
    totalChars: text.length,
    shownChars: 0,
    hint:
      `The full result is ${text.length} characters, over the ${max} one call returns so it stays ` +
      "inside Claude Code's MCP output limit. Narrow the request to see the rest — fewer days, a " +
      "smaller limit, one project.",
    partial: "",
  };
  // Leave room for the wrapper itself, which JSON-escapes the partial text and so can grow it.
  let keep = Math.max(0, max - JSON.stringify(note, null, 2).length - 64);
  for (;;) {
    let partial = text.slice(0, keep);
    // Never end on half a surrogate pair; the client would render a replacement character.
    if (/[\uD800-\uDBFF]$/.test(partial)) partial = partial.slice(0, -1);
    const out = JSON.stringify({ ...note, shownChars: partial.length, partial }, null, 2);
    if (out.length <= max || keep === 0) return out;
    keep = Math.floor(keep * 0.9); // escapes grew it past the cap; shrink and try again
  }
}

/**
 * Serve MCP over a pair of streams.
 *
 * @param {object} opts
 * @param {string} opts.name              server name reported to the client
 * @param {string} opts.version           server version reported to the client
 * @param {object[]} opts.tools           tool descriptors, as sent verbatim in tools/list
 * @param {(name: string, args: object) => Promise<unknown>} opts.call
 *        Runs a tool and resolves to plain data, which is serialized into a text content block.
 *        Throwing marks the result `isError` — the call was delivered and the tool refused, which
 *        is a different thing from the transport failing.
 * @param {number} [opts.maxResultChars]  the cap `capResult` applies; tests pass a small one
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output]
 */
export function serve({ name, version, tools, call, maxResultChars = MAX_RESULT_CHARS, input = process.stdin, output = process.stdout }) {
  // Only protocol messages may ever reach stdout — a stray console.log corrupts the stream and the
  // client reports something unrelated. Diagnostics go to stderr.
  const send = (msg) => output.write(JSON.stringify(msg) + "\n");
  const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
  const failWith = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  async function dispatch(msg) {
    // No id means a notification: the spec forbids a response, and `notifications/initialized`
    // arrives on every session.
    const isNotification = msg.id === undefined || msg.id === null;

    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return respond(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PREFERRED,
          capabilities: { tools: {} },
          serverInfo: { name, version },
        });
      }
      case "ping":
        return respond(msg.id, {});
      case "tools/list":
        return respond(msg.id, { tools });
      case "tools/call": {
        const { name: tool, arguments: args = {} } = msg.params ?? {};
        try {
          const data = await call(tool, args);
          const text = capResult(JSON.stringify(data, null, 2) ?? "null", maxResultChars);
          return respond(msg.id, { content: [{ type: "text", text }] });
        } catch (e) {
          const text = e?.code ? `${e.code}: ${e.message}` : String(e?.message ?? e);
          return respond(msg.id, { content: [{ type: "text", text }], isError: true });
        }
      }
      default:
        if (isNotification) return; // an unknown notification is ignored, not an error
        return failWith(msg.id, METHOD_NOT_FOUND, `unknown method: ${msg.method}`);
    }
  }

  // Messages are newline-delimited, but a read can split one or carry several.
  let buffer = "";
  // Handling is async while input is not: without a queue, two messages arriving together can
  // interleave and respond out of order.
  let queue = Promise.resolve();

  input.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // the tail is a partial message until its newline arrives
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        failWith(null, PARSE_ERROR, "invalid JSON");
        continue;
      }
      const isNotification = msg.id === undefined || msg.id === null;
      queue = queue.then(() => dispatch(msg)).catch((e) => {
        // A bug in dispatch must not kill the session or leave the client waiting forever.
        if (!isNotification) failWith(msg.id, -32603, `internal error: ${e?.message ?? e}`);
      });
    }
  });

  input.on("error", (e) => {
    process.stderr.write(`cortex: stdin error: ${e?.message ?? e}\n`);
  });

  if (typeof input.resume === "function") input.resume();
}
