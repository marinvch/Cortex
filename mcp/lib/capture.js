import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInRoot } from "./paths.js";

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function capture(root, { content, project, tags, today }) {
  const rel = project ? `projects/${slugify(project)}.md` : `inbox/${today}.md`;
  const abs = resolveInRoot(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tagLine = tags && tags.length ? " " + tags.map((t) => `#${slugify(t)}`).join(" ") : "";
  const stamp = today;
  const line = `\n- ${stamp} — ${content}${tagLine}\n`;
  if (!existsSync(abs)) appendFileSync(abs, `---\ntype: brain-note\ncreated: ${today}\n---\n`);
  appendFileSync(abs, line);
  return { path: abs, pushed: false };
}
