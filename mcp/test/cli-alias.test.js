// `ai-os.js` is the CLI's old name, kept until 4.0.0 because stamped sync workflows call that path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MCP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (file, args) => spawnSync(process.execPath, [join(MCP_DIR, file), ...args], { encoding: "utf8" });

for (const args of [["help"], ["no-such-command"]]) {
  test(`the alias answers \`${args[0]}\` exactly as the CLI does`, () => {
    const cli = run("cortex.js", args);
    const alias = run("ai-os.js", args);
    assert.equal(alias.status, cli.status);
    assert.equal(alias.stdout, cli.stdout);
    assert.equal(alias.stderr, cli.stderr);
  });
}

test("the alias holds no logic of its own", () => {
  const code = readFileSync(join(MCP_DIR, "ai-os.js"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#!") && !l.startsWith("//"));
  assert.deepEqual(code, ['import "./cortex.js";']);
});

test("both command names are declared", () => {
  const { name, bin } = JSON.parse(readFileSync(join(MCP_DIR, "package.json"), "utf8"));
  assert.equal(name, "cortex-mcp");
  assert.equal(bin.cortex, "cortex.js");
  assert.equal(bin["ai-os"], "ai-os.js");
  assert.equal(bin["cortex-mcp"], "server.js");
  assert.equal(bin["ai-os-mcp"], "server.js");
});
