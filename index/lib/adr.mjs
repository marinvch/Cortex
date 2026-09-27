// adr.mjs — where a repo keeps its architecture decision records.
//
// `docs/adr/` was written into every repo, and on `pmndrs/zustand` that is a mistake with an
// audience: `docs/` there is the source of the public documentation site (`.github/workflows/
// docs.yml` builds `mdx: 'docs'` and deploys it to Pages), so the ADR template and every record
// after it would have been published beside the user guide. Internal reasoning, rejected
// alternatives and all.
//
// So the location is a question with two answers, and every reader of ADRs accepts both:
//
//   docs/adr/   the convention, and the default
//   adr/        where they go when docs/ is a published site
//
// Not `.cortex/adr/`: the walker skips `.cortex/` (walk.mjs), so records there would never reach
// the index, and `/cortex-review` — the one thing that reads ADRs back — would never see them.
//
// A repo that already keeps ADRs in either place keeps them there. Moving someone's records to
// satisfy a heuristic is the clobber the scaffold refuses everywhere else.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every location an ADR may live in, default first. */
export const ADR_DIRS = ["docs/adr", "adr"];

/** Is this repo-relative path an ADR (or the ADR template), at any depth? */
export function isAdrPath(path) {
  return /(^|\/)(docs\/)?adr\/.+\.md$/i.test(path);
}

/** A numbered record — `0001-slug.md` — in one of the ADR locations at the repo root. */
export function isAdrRecord(path) {
  return /^(docs\/)?adr\/\d{4}-.+\.md$/.test(path);
}

function mdFiles(root, rel) {
  try {
    return readdirSync(join(root, rel)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

// Config files a docs-site generator reads, and where it reads them. Each names a generator that
// builds `docs/` into pages — Docusaurus and VitePress conventionally, MkDocs by default
// (`docs_dir: docs`), Sphinx, Jekyll (GitHub Pages' own), Hugo, Astro and a docs/ package of its own.
const SITE_CONFIGS = [
  "docs/.vitepress",
  "docs/docusaurus.config.js", "docs/docusaurus.config.ts", "docs/docusaurus.config.mjs",
  "docusaurus.config.js", "docusaurus.config.ts", "docusaurus.config.mjs", "docusaurus.config.cjs",
  "mkdocs.yml", "mkdocs.yaml",
  "docs/conf.py",
  "docs/_config.yml",
  "docs/hugo.toml", "docs/hugo.yaml", "docs/config.toml",
  "docs/astro.config.mjs", "docs/astro.config.ts",
  "docs/package.json",
];

// A workflow that publishes pages and names `docs` as a path — zustand's shape, where the site
// generator lives in another repo's reusable workflow and nothing in this one is a config file.
// "Names docs as a path" is a bare `docs` token: `mdx: 'docs'`, `path: docs/dist`, `cd docs`.
// `pmndrs/docs/.github/...` and `docs.github.com` are not — the first is preceded by a slash, the
// second followed by a dot.
const PUBLISHES = /deploy-pages|upload-pages-artifact|actions-gh-pages|gh-pages|pages:\s*write|mkdocs\s+gh-deploy/i;
const DOCS_PATH = /(^|[\s'"=:(,])(\.\/)?docs(\/|['"\s,)]|$)/m;

/**
 * Is `docs/` the source of a published site? Returns the evidence — the file that says so — or null.
 * Deterministic and read-only: config files and workflow text, never a network call.
 */
export function docsSite(root) {
  if (!existsSync(join(root, "docs"))) return null;
  const config = SITE_CONFIGS.find((f) => existsSync(join(root, f)));
  if (config) return { evidence: config };
  const wf = ".github/workflows";
  let names = [];
  try {
    names = readdirSync(join(root, wf)).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    let text = "";
    try {
      text = readFileSync(join(root, wf, name), "utf8");
    } catch {
      continue;
    }
    if (PUBLISHES.test(text) && DOCS_PATH.test(text)) return { evidence: `${wf}/${name}` };
  }
  return null;
}

/**
 * Where this repo's ADRs live, or should.
 *
 *   { dir, existing, docsSite, why }
 *
 * `existing` is true when records (or the template) are already on disk there — that location wins,
 * whatever else is true. Otherwise `adr/` when `docs/` is a published site, else `docs/adr/`.
 */
export function adrLocation(root) {
  const site = docsSite(root);
  for (const dir of ADR_DIRS) {
    if (mdFiles(root, dir).length) {
      // Still reported: a user whose records are being published should hear it once. Moving them
      // is their call, never the scaffold's.
      const published = site && dir.startsWith("docs/");
      return {
        dir,
        existing: true,
        docsSite: published ? site : null,
        why: published
          ? `${dir}/ already holds ADRs, and docs/ is published as a site (${site.evidence}) — they are published with it; moving them to adr/ is the user's call`
          : `${dir}/ already holds ADRs — they stay where they are`,
      };
    }
  }
  if (site) {
    return {
      dir: "adr",
      existing: false,
      docsSite: site,
      why: `docs/ is published as a site (${site.evidence}), so an ADR under docs/adr/ would be published with it`,
    };
  }
  return { dir: "docs/adr", existing: false, docsSite: null, why: "the conventional home; docs/ is not a published site" };
}
