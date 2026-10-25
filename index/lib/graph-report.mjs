// graph-report.mjs — the graph report, as `index/` reads it.
//
// The computation (hubs, bridges, cycles, untested clusters) is `core/graph.js`, whose header holds
// the rules, because the `graph` MCP tool answers from it too and `mcp/` may not import `index/`.
// This module re-exports it and adds the one line the findings glance prints.

export {
  HUB_MIN_LINKS,
  SCORE,
  SHARED_REACH,
  TOP,
  bridgesOf,
  cyclesOf,
  graphReport,
  hubsOf,
  isProductFile,
  productGraph,
  topBridges,
  untestedClustersOf,
} from "../../core/graph.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The findings glance's one line, or null when the index has no clusters. Information only: it
 * carries no offer and moves no finding (ADR 0006).
 */
export function glanceLine(report) {
  if (!report.clusters) return null;
  const hubs = report.hubs.slice(0, 3).map((h) => `\`${h.path}\``);
  const cycles = report.cycles.length;
  return (
    `- ${plural(report.clusters, "import cluster")}` +
    (hubs.length ? `; most linked: ${hubs.join(", ")}` : "") +
    `; ${cycles ? plural(cycles, "import cycle") : "no import cycles"}`
  );
}
