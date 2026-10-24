// Where Cortex comes from (#622): one value, three shapes, one order of precedence.
//
// The environment is always passed in, never read from `process.env`, so a CORTEX_SOURCE set in the
// shell running the suite cannot move a result. Credential-bearing fixtures are assembled at runtime:
// a realistic literal trips the repo's own secret scan and GitHub push protection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONNECTOR_REL, DEFAULT_MARKETPLACE_SOURCE, DEFAULT_SOURCE, SOURCE_VAR, SourceRefused,
  cloneUrl, connectorSource, isDefaultSource, parseSource, resolveSource,
} from "../source.js";
import { tempDir } from "./tmp.js";

const refused = (fn, re) => assert.throws(fn, (e) => e instanceof SourceRefused && e.code === "source_refused" && re.test(e.message));

test("the default is upstream, in exactly the shape Cortex wrote before sources were configurable", () => {
  assert.equal(DEFAULT_SOURCE, "marinvch/Cortex");
  assert.equal(SOURCE_VAR, "CORTEX_SOURCE");
  assert.equal(JSON.stringify(DEFAULT_MARKETPLACE_SOURCE), '{"source":"github","repo":"marinvch/Cortex"}', "key order included");
  assert.equal(cloneUrl(DEFAULT_MARKETPLACE_SOURCE), "https://github.com/marinvch/Cortex.git");
  assert.ok(isDefaultSource(DEFAULT_MARKETPLACE_SOURCE));
  assert.ok(!isDefaultSource({ source: "github", repo: "acme/cortex" }));
});

test("owner/repo is a GitHub source", () => {
  for (const v of ["acme/cortex", "acme-corp/cortex.plugin", "a/b_c-d.e", "  acme/cortex  "]) {
    assert.deepEqual(parseSource(v), { source: "github", repo: v.trim() }, v);
  }
  assert.equal(cloneUrl(parseSource("acme/cortex")), "https://github.com/acme/cortex.git");
});

test("a git URL is a git source, in the three forms git clones", () => {
  for (const v of ["https://git.example.com/acme/cortex.git", "ssh://git@git.example.com/acme/cortex.git", "git@git.example.com:acme/cortex.git"]) {
    assert.deepEqual(parseSource(v), { source: "git", url: v }, v);
    assert.equal(cloneUrl(parseSource(v)), v, "CI clones the URL itself");
  }
});

test("an absolute path is a directory source, which CI cannot clone", () => {
  for (const v of ["/srv/marketplaces/cortex", "C:\\marketplaces\\cortex", "D:/marketplaces/cortex", "\\\\fileserver\\share\\cortex"]) {
    assert.deepEqual(parseSource(v), { source: "directory", path: v }, v);
    assert.equal(cloneUrl(parseSource(v)), null);
  }
});

test("anything else is refused with a sentence", () => {
  refused(() => parseSource(""), /empty/);
  refused(() => parseSource("   "), /empty/);
  refused(() => parseSource("cortex"), /not an owner\/repo/);
  refused(() => parseSource("acme/cortex extra"), /whitespace/);
  refused(() => parseSource("acme/.."), /names no repository/);
  refused(() => parseSource("./cortex"), /relative path/);
  refused(() => parseSource("../forks/cortex"), /relative path/);
  refused(() => parseSource("forks/acme/cortex"), /relative path/);
  refused(() => parseSource("http://git.example.com/acme/cortex.git"), /does not clone from/);
  refused(() => parseSource("file:///srv/cortex"), /does not clone from/);
  refused(() => parseSource("ftp://git.example.com/cortex"), /does not clone from/);
  refused(() => parseSource("-acme/cortex"), /not an owner\/repo/);
});

test("a URL carrying a credential is refused, and the message never repeats it", () => {
  const pass = "s3cr" + "etvalue";
  const token = "gh" + "p_" + "A".repeat(36);
  const cases = [
    `https://deploy:${pass}@git.example.com/acme/cortex.git`,
    `https://${token}@github.com/acme/cortex.git`,
    `https://holder@github.com/acme/cortex.git`,
    `ssh://git:${pass}@git.example.com/acme/cortex.git`,
    `https://git.example.com/acme/cortex.git?access_token=${pass}`,
  ];
  for (const v of cases) {
    assert.throws(() => parseSource(v, "CORTEX_SOURCE"), (e) => {
      assert.ok(e instanceof SourceRefused);
      assert.match(e.message, /^CORTEX_SOURCE carries a credential/);
      assert.ok(!e.message.includes(pass) && !e.message.includes(token) && !e.message.includes("holder"), "the value is not echoed");
      return true;
    });
  }
});

test("cloneUrl refuses something that is not a source", () => {
  assert.throws(() => cloneUrl({ source: "npm", package: "x" }), TypeError);
  assert.throws(() => cloneUrl(null), TypeError);
});

test("precedence: argument, then CORTEX_SOURCE, then the connector, then the default", () => {
  const env = { CORTEX_SOURCE: "env-org/cortex" };
  const connector = "conn-org/cortex";
  assert.deepEqual(resolveSource({ argument: "arg-org/cortex", env, connector }), {
    text: "arg-org/cortex", from: "argument", source: { source: "github", repo: "arg-org/cortex" }, isDefault: false,
  });
  assert.equal(resolveSource({ env, connector }).from, "CORTEX_SOURCE");
  assert.equal(resolveSource({ env, connector }).text, "env-org/cortex");
  assert.equal(resolveSource({ connector }).from, "connector");
  assert.deepEqual(resolveSource({}), { text: DEFAULT_SOURCE, from: "default", source: { source: "github", repo: DEFAULT_SOURCE }, isDefault: true });
  assert.deepEqual(resolveSource(), resolveSource({}));
});

test("an empty or blank value is unset at every step", () => {
  assert.equal(resolveSource({ argument: "", env: { CORTEX_SOURCE: "  " }, connector: "conn-org/cortex" }).from, "connector");
  assert.equal(resolveSource({ argument: "  ", env: { CORTEX_SOURCE: "" }, connector: "" }).from, "default");
});

test("a value that is set and wrong is refused, never skipped for the one below it", () => {
  // A fork that misspelt its source must not quietly be handed upstream.
  refused(() => resolveSource({ env: { CORTEX_SOURCE: "not a source" }, connector: "conn-org/cortex" }), /^CORTEX_SOURCE /);
  refused(() => resolveSource({ argument: "nope" }), /^--source /);
  refused(() => resolveSource({ connector: "nope" }), /connector\.json/);
});

test("naming the default explicitly is still the default", () => {
  const r = resolveSource({ env: { CORTEX_SOURCE: "marinvch/Cortex" } });
  assert.equal(r.isDefault, true);
  assert.equal(r.from, "CORTEX_SOURCE");
});

test("connectorSource reads the connector's source field and nothing else", () => {
  const repo = (body) => {
    const root = tempDir("cortex-source-");
    if (body !== undefined) {
      mkdirSync(join(root, ".cortex"), { recursive: true });
      writeFileSync(join(root, ...CONNECTOR_REL.split("/")), body);
    }
    return root;
  };
  assert.equal(connectorSource(repo()), null, "no connector");
  assert.equal(connectorSource(repo("{ bad")), null, "a connector that does not parse");
  assert.equal(connectorSource(repo(JSON.stringify({ team: "t", project: "p", teamBrainRepo: "git@example.com:t/b.git" }))), null, "no source field");
  assert.equal(connectorSource(repo(JSON.stringify({ team: "t", source: "  " }))), null, "a blank one");
  assert.equal(connectorSource(repo(JSON.stringify({ team: "t", source: 42 }))), null, "a non-string one");
  assert.equal(connectorSource(repo(JSON.stringify({ team: "t", source: "acme/cortex" }))), "acme/cortex");
});
