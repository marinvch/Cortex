import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveInRoot } from "./paths.js";

export function listProjects(root) {
  const dir = join(root, "projects");
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.name === "README.md") continue;
    if (e.isFile() && e.name.endsWith(".md")) out.push({ slug: e.name.replace(/\.md$/, ""), path: join(dir, e.name) });
    else if (e.isDirectory() && !e.name.startsWith(".")) out.push({ slug: e.name, path: join(dir, e.name) });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function getProjectContext(root, slug) {
  // `slug` is caller-supplied, so both candidate paths go through the root guard.
  // Without this, a slug like `../../secret` reads any file on disk (see projects.test.js).
  const file = resolveInRoot(root, join("projects", `${slug}.md`));
  const dir = resolveInRoot(root, join("projects", slug));
  if (existsSync(file) && statSync(file).isFile()) {
    return { slug, path: file, content: readFileSync(file, "utf8") };
  }
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const notes = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    const content = notes.map((n) => readFileSync(join(dir, n), "utf8")).join("\n\n---\n\n");
    return { slug, path: dir, content };
  }
  const err = new Error(`project not found: ${slug}`);
  err.code = "not_found";
  throw err;
}
