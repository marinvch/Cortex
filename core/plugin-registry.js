// core/plugin-registry.js — which plugins Claude Code has installed on this machine.
//
// Claude Code keeps one registry, `<home>/.claude/plugins/installed_plugins.json`:
//
//   { "version": 2, "plugins": { "<name>@<marketplace>": [ { "scope": "user", "version": … }, … ] } }
//
// Two callers read it and neither may import the other: `tools/cortex-plugin-check.mjs` asks which
// version of Cortex is installed, and `mcp/lib/setup-plugins.js` asks which plugins of a tier are.
// The path and the shape live here so they are written once.
//
// Read-only. The directory is a parameter so a test hands in its own and never reads the machine's.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Where Claude Code keeps its plugins, under `home`. */
export function pluginsDir(home = homedir()) {
  return join(home, ".claude", "plugins");
}

/**
 * The registry in `dir`, as `{ state, plugins }`.
 *
 * `state` is `read`, `absent` (no file) or `unreadable` (a file that is not a registry). Only
 * `read` says anything about what is installed: with the other two `plugins` is `{}` and means
 * "unknown", never "nothing installed". `plugins` maps each key to its entries, objects only.
 */
export function readRegistry(dir = pluginsDir()) {
  let text;
  try {
    text = readFileSync(join(dir, "installed_plugins.json"), "utf8");
  } catch {
    return { state: "absent", plugins: {} };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { state: "unreadable", plugins: {} };
  }
  const raw = doc && typeof doc === "object" ? doc.plugins : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { state: "unreadable", plugins: {} };
  const plugins = {};
  for (const [key, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;
    plugins[key] = entries.filter((e) => e && typeof e === "object" && !Array.isArray(e));
  }
  return { state: "read", plugins };
}

/** Is `cwd` the directory `projectPath` names, or inside it? */
function within(projectPath, cwd) {
  if (typeof projectPath !== "string" || !projectPath) return false;
  const rel = relative(resolve(projectPath), resolve(cwd));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Is the plugin called `name` installed where a session in `cwd` would load it?
 *
 * A `user` or `managed` entry applies everywhere. A `project` or `local` entry applies in the
 * project it names and below. The marketplace half of the key is not compared: the question is
 * whether the person has the plugin, and a copy from another marketplace is still that.
 */
export function installedHere(plugins, name, cwd = process.cwd()) {
  for (const [key, entries] of Object.entries(plugins)) {
    const at = key.indexOf("@");
    if ((at === -1 ? key : key.slice(0, at)) !== name) continue;
    for (const e of entries) {
      if (e.scope === "user" || e.scope === "managed") return true;
      if ((e.scope === "project" || e.scope === "local") && within(e.projectPath, cwd)) return true;
    }
  }
  return false;
}
