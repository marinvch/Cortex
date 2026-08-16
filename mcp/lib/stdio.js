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
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output]
 */
export function serve({ name, version, tools, call, input = process.stdin, output = process.stdout }) {
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
          return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
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
