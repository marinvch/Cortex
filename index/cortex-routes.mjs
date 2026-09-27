#!/usr/bin/env node
// cortex-routes.mjs — who serves this call? The FE ↔ BE route map, across one workspace.
//
//   node index/cortex-routes.mjs [root]                  # one repo — a monorepo with both halves
//   node index/cortex-routes.mjs <dir> --workspace       # every git repo directly under <dir>
//   node index/cortex-routes.mjs <dir> --workspace --json
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/. Each repo's stored
// index is used when it carries `routes`; otherwise one is built in memory and the output says so.
//
// Every "no call reaches this" is a FLOOR. URLs built at runtime, back-end-to-back-end clients and
// generated controllers are invisible to regex extraction, so an unused endpoint is "worth checking",
// never "safe to delete". Design: docs/specs/2026-09-27-route-map-design.md.

import { basename, isAbsolute, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { defaultIndexPath, openTarget, readIndex } from "./lib/open.mjs";
import { resolveRoutes, workspaceRepos } from "./lib/routes.mjs";

const usage = "usage: node index/cortex-routes.mjs [root] [--workspace] [--index FILE] [--json]";
// With --workspace the root is a directory of checkouts rather than a repo. Either way the front door
// checks it is a directory, which is the whole of what the two cases share.
const { root, args } = openTarget(process.argv.slice(2), {
  usage,
  flags: { "--workspace": "boolean", "--index": "value", "--json": "boolean" },
  root: "positional",
  // Declared "none" because this command decides per repo: a workspace has one index per member,
  // and a missing or pre-route-map one is rebuilt in memory rather than refused.
  index: "none",
});

const refuse = (text, code) => {
  process.stderr.write(`${text}\n${usage}\n`);
  process.exit(code);
};

if (args.workspace && args.index) refuse("--index names one repo's index; a workspace reads each member's own", 1);

let members;
if (args.workspace) {
  members = workspaceRepos(root);
  if (!members.length) {
    refuse(`no git repositories directly under ${root} — a workspace is a directory of repo checkouts`, 2);
  }
} else {
  members = [{ name: basename(root), root, index: args.index ? (isAbsolute(args.index) ? args.index : resolve(args.index)) : null }];
}

const notes = [];
const repos = members.map((m) => {
  const path = m.index ?? defaultIndexPath(m.root);
  const read = readIndex(path);
  if (read.index && read.index.routes) return { name: m.name, routes: read.index.routes, source: "stored" };
  // An index named explicitly is one the user meant; answering from something else would be the
  // confident wrong answer the front door exists to refuse.
  if (m.index && read.problem) refuse(read.problem.trim(), 2);
  if (read.index) notes.push(`${m.name}: its index predates the route map — built one in memory. Re-run cortex-index to store it.`);
  else if (read.kind !== "absent") notes.push(`${m.name}: ${read.problem.split("\n")[0]} — built one in memory instead.`);
  return { name: m.name, routes: buildIndex(m.root).routes, source: "memory" };
});

const map = resolveRoutes(repos);

if (args.json) {
  const sources = Object.fromEntries(repos.map((r) => [r.name, r.source]));
  process.stdout.write(`${JSON.stringify({ ...map, sources }, null, 2)}\n`);
  process.exit(0);
}

for (const n of notes) process.stderr.write(`Note: ${n}\n`);

const s = map.stats;
const out = [];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
out.push(`Route map — ${plural(repos.length, "repo")}: ${repos.map((r) => `${r.name}${r.source === "memory" ? " (built in memory)" : ""}`).join(", ")}`);
out.push(
  `Found ${plural(s.calls, "front-end call")}, ${plural(s.gateways, "gateway route")}, ${plural(s.handlers, "Spring handler")}` +
    (s.unread.calls || s.unread.handlers
      ? `; ${s.unread.calls + s.unread.handlers} more built at runtime and not read (${s.unread.calls} call${s.unread.calls === 1 ? "" : "s"}, ${s.unread.handlers} handler${s.unread.handlers === 1 ? "" : "s"})`
      : ""),
);

if (!s.calls && !s.handlers && !s.gateways) {
  out.push("");
  out.push("No routes in reach: no fetch/axios-style call, gateway route table or Spring mapping was found.");
  out.push("That is a statement about what Cortex reads (docs/specs/2026-09-27-route-map-design.md), not proof there are none.");
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(0);
}

const where = (x) => `${x.repo}/${x.file}:${x.line}`;

if (map.links.length) {
  out.push("");
  out.push(`Calls (${s.linked} of ${s.calls} reach a handler):`);
  for (const l of map.links) {
    const c = l.call;
    out.push(`  ${(c.method ?? "ANY").padEnd(6)} ${c.path}   ${where(c)}`);
    if (!l.targets.length) {
      out.push(c.host ? `         → another host (${c.host}) — not in this workspace` : "         → no handler Cortex can see");
      continue;
    }
    for (const t of l.targets) {
      const via = t.gateway ? `via ${t.gateway.prefix} (${where(t.gateway)}) ` : "";
      out.push(`         → ${via}${where(t.handler)}${t.handler.name ? `  ${t.handler.name}()` : ""}`);
    }
  }
}

if (map.gatewayRoutes.length) {
  out.push("");
  out.push(`Gateway routes (${s.gatewaysServing} of ${s.gateways} reach a handler):`);
  for (const g of map.gatewayRoutes) {
    const served = [...new Set(g.handlers.map((h) => h.repo))];
    out.push(
      `  ${g.gateway.prefix} → ${g.gateway.rewrite ?? "(as is)"} on ${g.gateway.target}   ${where(g.gateway)}\n` +
        `         ${served.length ? `served by ${served.join(", ")} (${plural(g.handlers.length, "handler")})` : "served by nothing Cortex can see"}` +
        (g.narrowed === "unresolved" ? " — the target named none of these repos, so all are listed" : ""),
    );
  }
}

out.push("");
if (map.findings.length) {
  out.push(`Findings (${map.findings.length}, all low — worth checking, not failures):`);
  for (const f of map.findings) {
    out.push(`  - ${f.title}`);
    out.push(`    ${f.detail}`);
  }
} else {
  out.push("Findings: none — every call reached a handler and every handler was reached.");
}
if (!s.calls && s.handlers) out.push("No front-end call was found, so no endpoint is reported as unused — there was nothing to reach it.");
if (!s.handlers && !s.gateways && s.calls) out.push("No gateway route or Spring handler was found, so no call is reported as unmatched — there was nothing to match it against.");
if (s.external) out.push(`${plural(s.external, "call")} to another host ${s.external === 1 ? "was" : "were"} left unresolved and not reported.`);
out.push("");
out.push("A floor, not a total: runtime-built URLs, service-to-service clients and generated controllers are not read.");
process.stdout.write(`${out.join("\n")}\n`);
