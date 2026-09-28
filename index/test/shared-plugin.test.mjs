import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CORTEX_MARKETPLACE, CORTEX_PLUGIN, SETTINGS_REL, mergeSharedPlugin, sharedPluginStatus, teamServed,
} from "../lib/shared-plugin.mjs";
import { tempDir } from "./tmp.mjs";

// What a merge must add, as parsed JSON: the entry shapes are the documented ones
// (code.claude.com/docs/en/settings-reference, `extraKnownMarketplaces` and `enabledPlugins`).
const OURS = {
  extraKnownMarketplaces: { cortex: { source: { source: "github", repo: "marinvch/Cortex" } } },
  enabledPlugins: { "cortex@cortex": true },
};

// A settings.json a team already has: hooks, permissions, a marketplace and a plugin of their own.
const TEAM = `{
  "permissions": {
    "allow": ["Bash(npm test)", "Read(./src/**)"],
    "deny": ["Read(./.env)"]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "echo \\"}\\" && bash .claude/hooks/format.sh" }]
      }
    ]
  },
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": { "source": "github", "repo": "acme-corp/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "code-formatter@acme-tools": true,
    "experimental@personal": false
  },
  "model": "sonnet"
}
`;

/**
 * Every line of `before`, in order, is still a line of `after` — a merge only ever inserts. The one
 * change JSON forces is a comma after what used to be an object's last member.
 */
function onlyInserted(before, after) {
  const got = after.split(/\r?\n/);
  let j = 0;
  for (const line of before.split(/\r?\n/)) {
    while (j < got.length && got[j] !== line && got[j] !== line + ",") j++;
    assert.ok(j < got.length, `line kept verbatim: ${JSON.stringify(line)}`);
    j++;
  }
}

// --- the merge ----------------------------------------------------------------------------------

test("with no settings file, the merge writes the two documented entries and nothing else", () => {
  const r = mergeSharedPlugin(null);
  assert.equal(r.text, JSON.stringify(OURS, null, 2) + "\n");
  assert.deepEqual(r.added, ["extraKnownMarketplaces.cortex", "enabledPlugins.cortex@cortex"]);
  assert.deepEqual(r.kept, []);
});

test("the entry shapes are the documented ones", () => {
  assert.deepEqual(CORTEX_MARKETPLACE, { name: "cortex", entry: { source: { source: "github", repo: "marinvch/Cortex" } } });
  assert.equal(CORTEX_PLUGIN, "cortex@cortex");
  assert.equal(SETTINGS_REL, ".claude/settings.json");
});

test("a team's settings keep every key, marketplace and plugin they had — the merge only inserts", () => {
  const r = mergeSharedPlugin(TEAM);
  const want = JSON.parse(TEAM);
  want.extraKnownMarketplaces.cortex = OURS.extraKnownMarketplaces.cortex;
  want.enabledPlugins["cortex@cortex"] = true;
  assert.deepEqual(JSON.parse(r.text), want);
  onlyInserted(TEAM, r.text);
  assert.deepEqual(r.added, ["extraKnownMarketplaces.cortex", "enabledPlugins.cortex@cortex"]);
  // Inserted at the indentation the file already uses, so the diff is two small hunks.
  assert.match(r.text, /\n    "acme-tools": \{[\s\S]*\n    },\n    "cortex": \{\n      "source": \{\n        "source": "github",/);
  assert.match(r.text, /"experimental@personal": false,\n    "cortex@cortex": true\n  },\n  "model": "sonnet"\n}\n$/);
});

test("a second run changes nothing, byte for byte", () => {
  const once = mergeSharedPlugin(TEAM).text;
  const twice = mergeSharedPlugin(once);
  assert.equal(twice.text, once);
  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.kept, ["extraKnownMarketplaces.cortex", "enabledPlugins.cortex@cortex"]);
});

test("an entry already there is left alone, whatever it says", () => {
  // The team turned Cortex off on purpose, and registered a fork under the same name: both stand.
  const text = JSON.stringify({
    extraKnownMarketplaces: { cortex: { source: { source: "directory", path: "../cortex-fork" } } },
    enabledPlugins: { "cortex@cortex": false },
  }, null, 2) + "\n";
  const r = mergeSharedPlugin(text);
  assert.equal(r.text, text);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.kept, ["extraKnownMarketplaces.cortex", "enabledPlugins.cortex@cortex"]);
});

test("only the missing half is added", () => {
  const text = '{\n  "enabledPlugins": {\n    "cortex@cortex": true\n  }\n}\n';
  const r = mergeSharedPlugin(text);
  assert.deepEqual(r.added, ["extraKnownMarketplaces.cortex"]);
  assert.deepEqual(JSON.parse(r.text), { enabledPlugins: { "cortex@cortex": true }, extraKnownMarketplaces: OURS.extraKnownMarketplaces });
});

test("a file that spells the key additionalMarketplaces gets the entry there, not a second key", () => {
  const text = '{\n  "additionalMarketplaces": {\n    "acme": { "source": { "source": "github", "repo": "a/b" } }\n  }\n}\n';
  const r = mergeSharedPlugin(text);
  const got = JSON.parse(r.text);
  assert.equal(got.extraKnownMarketplaces, undefined, "no second spelling beside the one the team uses");
  assert.deepEqual(got.additionalMarketplaces.cortex, OURS.extraKnownMarketplaces.cortex);
  assert.deepEqual(r.added, ["additionalMarketplaces.cortex", "enabledPlugins.cortex@cortex"]);
  assert.deepEqual(mergeSharedPlugin(r.text).added, [], "and a re-run sees it there");
});

test("a key written twice gets the entry in the copy Claude Code reads — the last", () => {
  // JSON.parse, and so Claude Code, keeps the last of two same-named keys. Writing into the first
  // would add an entry nobody reads and report it as done.
  const text = '{\n  "enabledPlugins": {\n    "a@x": true\n  },\n  "enabledPlugins": {\n    "b@x": true\n  }\n}\n';
  const r = mergeSharedPlugin(text);
  assert.deepEqual(JSON.parse(r.text).enabledPlugins, { "b@x": true, "cortex@cortex": true });
  assert.match(r.text, /^\{\n  "enabledPlugins": \{\n    "a@x": true\n  \},/, "the first copy is untouched");
});

test("CRLF, four-space and tab-indented files are written back in their own style", () => {
  const crlf = '{\r\n    "model": "sonnet"\r\n}\r\n';
  const a = mergeSharedPlugin(crlf).text;
  assert.ok(!/[^\r]\n/.test(a), "every line ending stays CRLF");
  assert.match(a, /\r\n    "enabledPlugins": \{\r\n        "cortex@cortex": true\r\n    \}\r\n\}\r\n$/);
  const tabs = '{\n\t"model": "sonnet"\n}\n';
  assert.match(mergeSharedPlugin(tabs).text, /\n\t"enabledPlugins": \{\n\t\t"cortex@cortex": true\n\t\}\n\}\n$/);
});

test("an empty object, a one-line file, a missing final newline and a BOM all merge to valid JSON", () => {
  for (const text of ["{}", "{}\n", '{"model":"sonnet"}', '{ "model": "sonnet" }\n', '{\n  "model": "sonnet"\n}', '\uFEFF{\n  "model": "sonnet"\n}\n']) {
    const r = mergeSharedPlugin(text);
    const body = r.text.replace(/^\uFEFF/, "");
    assert.deepEqual(JSON.parse(body), { ...JSON.parse(text.replace(/^\uFEFF/, "")), ...OURS }, JSON.stringify(text));
    assert.equal(r.text.startsWith("\uFEFF"), text.startsWith("\uFEFF"), "a BOM is kept exactly when it was there");
    assert.equal(/\n$/.test(r.text), /\n$/.test(text), "the final newline is kept as it was");
    assert.equal(mergeSharedPlugin(r.text).text, r.text, "and it is stable");
  }
  assert.equal(mergeSharedPlugin("{}\n").text, JSON.stringify(OURS, null, 2) + "\n");
  assert.equal(
    mergeSharedPlugin('{ "model": "sonnet" }\n').text,
    '{ "model": "sonnet", "extraKnownMarketplaces": {"cortex":{"source":{"source":"github","repo":"marinvch/Cortex"}}}, "enabledPlugins": {"cortex@cortex":true} }\n',
    "a one-line file stays one line",
  );
});

test("a settings file that is not JSON, or not an object, is refused with a sentence and never rewritten", () => {
  const cases = [
    ["{ not json", /not valid JSON/],
    ["", /not valid JSON/],
    ["// comment\n{}", /not valid JSON/],
    ["[]", /not a JSON object/],
    ["null", /not a JSON object/],
    ['{ "enabledPlugins": ["cortex@cortex"] }', /`enabledPlugins` is not an object/],
    ['{ "extraKnownMarketplaces": "cortex" }', /`extraKnownMarketplaces` is not an object/],
  ];
  for (const [text, why] of cases) {
    assert.throws(() => mergeSharedPlugin(text), (e) => e.code === "settings_unreadable" && why.test(e.message), JSON.stringify(text));
  }
});

// --- which repos are a team's -------------------------------------------------------------------

function repoWith(files = {}) {
  const root = tempDir("cortex-team-");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test("the work profile makes a repo a team's, and says so", () => {
  const t = teamServed(repoWith(), { CORTEX_PROFILE: "work" });
  assert.equal(t.team, true);
  assert.match(t.why, /CORTEX_PROFILE=work/);
});

test("a team-brain connector makes a repo a team's on any profile, naming the team", () => {
  const root = repoWith({ ".cortex/connector.json": JSON.stringify({ team: "platform", project: "api", teamBrainRepo: "git@example.com:t/brain.git" }) });
  for (const env of [{}, { CORTEX_PROFILE: "home" }, { CORTEX_PROFILE: "lab" }]) {
    const t = teamServed(root, env);
    assert.equal(t.team, true, JSON.stringify(env));
    assert.match(t.why, /\.cortex\/connector\.json/);
    assert.match(t.why, /platform/);
  }
  // An older connector shape, or one that does not parse, is still a connector.
  assert.equal(teamServed(repoWith({ ".cortex/connector.json": "{ bad" }), {}).team, true);
});

test("home and lab with no connector are not a team's — nothing is offered", () => {
  for (const env of [{}, { CORTEX_PROFILE: "home" }, { CORTEX_PROFILE: "lab" }, { CORTEX_PROFILE: "" }]) {
    assert.deepEqual(teamServed(repoWith(), env), { team: false, why: null }, JSON.stringify(env));
  }
});

test("a profile value that is not one of the three is not read as work, and does not throw", () => {
  assert.equal(teamServed(repoWith(), { CORTEX_PROFILE: "works" }).team, false);
  assert.equal(teamServed(repoWith(), { CORTEX_PROFILE: " WORK " }).team, true, "resolveProfile's own normalising");
});

// --- what is on disk now ------------------------------------------------------------------------

test("status reads the settings file: absent, served, half-served, or unreadable", () => {
  assert.deepEqual(sharedPluginStatus(repoWith()), { settings: "absent", served: false, problem: null, missing: ["extraKnownMarketplaces.cortex", "enabledPlugins.cortex@cortex"] });
  const served = repoWith({ [SETTINGS_REL]: mergeSharedPlugin(TEAM).text });
  assert.deepEqual(sharedPluginStatus(served), { settings: "ok", served: true, problem: null, missing: [] });
  const half = repoWith({ [SETTINGS_REL]: '{ "enabledPlugins": { "cortex@cortex": false } }' });
  assert.deepEqual(sharedPluginStatus(half), { settings: "ok", served: false, problem: null, missing: ["extraKnownMarketplaces.cortex"] });
  const bad = sharedPluginStatus(repoWith({ [SETTINGS_REL]: "{ nope" }));
  assert.equal(bad.settings, "unreadable");
  assert.equal(bad.served, false);
  assert.match(bad.problem, /not valid JSON/);
});
