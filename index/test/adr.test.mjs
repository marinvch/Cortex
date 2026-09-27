import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ADR_DIRS, adrLocation, docsSite, isAdrPath, isAdrRecord } from "../lib/adr.mjs";
import { isContextDoc } from "../lib/context-docs.mjs";
import { readState } from "../lib/next.mjs";
import { citationDrift } from "../lib/review.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "cortex-adr-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

// The shape found on pmndrs/zustand: nothing in the repo is a site config — the generator lives in
// another repo's reusable workflow — and the only evidence is a Pages deploy naming `docs`.
const ZUSTAND_DOCS_YML = `name: Build documentation and deploy to GitHub Pages
# see https://docs.github.com/en/actions/using-workflows
jobs:
  build:
    uses: pmndrs/docs/.github/workflows/build.yml@v4
    with:
      mdx: 'docs'
  deploy:
    permissions:
      pages: write
    steps:
      - uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
`;

test("every ADR location is accepted by the path predicates, at the root and nested", () => {
  for (const dir of ADR_DIRS) {
    assert.ok(isAdrPath(`${dir}/0001-x.md`), dir);
    assert.ok(isAdrPath(`${dir}/TEMPLATE.md`), `${dir} template`);
    assert.ok(isAdrRecord(`${dir}/0001-x.md`), `${dir} record`);
    assert.ok(!isAdrRecord(`${dir}/TEMPLATE.md`), "the template is not a record");
    assert.ok(isContextDoc(`${dir}/0001-x.md`), `isContextDoc accepts ${dir}`);
  }
  assert.ok(isAdrPath("packages/api/docs/adr/0001-x.md"), "a package's own ADRs");
  assert.ok(!isAdrPath("src/adrenaline.md"));
  assert.ok(!isAdrPath("docs/adr.md"), "a page about ADRs is not an ADR");
});

test("review treats an ADR in adr/ as historical, the same as one in docs/adr/", () => {
  // A record names paths that were true when it was written. Flagging them as drift is how a check
  // gets switched off; the `adr/` home must not lose that exemption.
  const text = "`src/gone.js` was the old entry point\n";
  for (const doc of ["docs/adr/0001-x.md", "adr/0001-x.md"]) {
    const r = citationDrift({ files: [{ path: doc }] }, { readText: (p) => (p === doc ? text : null) });
    assert.equal(r.findings.length, 1, doc);
    assert.equal(r.findings[0].class, "historical", `${doc} is a historical record`);
  }
});

test("a repo with no docs site gets docs/adr/", () => {
  const root = repo({ "src/a.js": "", "docs/guide.md": "# guide\n" });
  const loc = adrLocation(root);
  assert.equal(loc.dir, "docs/adr");
  assert.equal(loc.existing, false);
  assert.equal(loc.docsSite, null);
  rmSync(root, { recursive: true, force: true });
});

test("each docs-site generator config moves the proposal to adr/, and names its evidence", () => {
  for (const cfg of ["docs/.vitepress/config.mts", "docusaurus.config.ts", "mkdocs.yml", "docs/conf.py", "docs/_config.yml", "docs/package.json"]) {
    const root = repo({ "docs/index.md": "# home\n", [cfg]: "" });
    const loc = adrLocation(root);
    assert.equal(loc.dir, "adr", `${cfg} makes docs/ a site`);
    assert.ok(loc.docsSite?.evidence && cfg.startsWith(loc.docsSite.evidence), `${cfg}: evidence is ${loc.docsSite?.evidence}`);
    assert.match(loc.why, /published/);
    rmSync(root, { recursive: true, force: true });
  }
});

test("zustand's shape — a Pages workflow building docs/ — is a site", () => {
  const root = repo({ "docs/index.md": "# home\n", ".github/workflows/docs.yml": ZUSTAND_DOCS_YML });
  assert.deepEqual(docsSite(root), { evidence: ".github/workflows/docs.yml" });
  assert.equal(adrLocation(root).dir, "adr");
  rmSync(root, { recursive: true, force: true });
});

test("a workflow that only mentions docs in a URL or another repo's path is not evidence", () => {
  // `pmndrs/docs/...` and `docs.github.com` both contain the word; neither says THIS repo's docs/
  // is published. A deploy with no docs path, and a docs path with no deploy, are not either.
  const urlsOnly = ZUSTAND_DOCS_YML.replace("mdx: 'docs'", "mdx: 'site'");
  const noDeploy = "jobs:\n  lint:\n    steps:\n      - run: markdownlint docs/\n";
  for (const [name, body] of [["urls", urlsOnly], ["no-deploy", noDeploy]]) {
    const root = repo({ "docs/index.md": "# home\n", ".github/workflows/w.yml": body });
    assert.equal(docsSite(root), null, name);
    assert.equal(adrLocation(root).dir, "docs/adr", name);
    rmSync(root, { recursive: true, force: true });
  }
});

test("no docs/ directory means no docs site, whatever the workflows say", () => {
  const root = repo({ ".github/workflows/docs.yml": ZUSTAND_DOCS_YML, "mkdocs.yml": "" });
  assert.equal(docsSite(root), null);
  rmSync(root, { recursive: true, force: true });
});

test("ADRs already on disk stay where they are — and a published home is still said out loud", () => {
  const inAdr = repo({ "adr/0001-x.md": "# x\n" });
  assert.deepEqual(
    [adrLocation(inAdr).dir, adrLocation(inAdr).existing],
    ["adr", true],
  );
  rmSync(inAdr, { recursive: true, force: true });

  // Never moved by a heuristic — that is the user's call — but a user whose records are being
  // published should hear it.
  const published = repo({ "docs/adr/0001-x.md": "# x\n", "mkdocs.yml": "" });
  const loc = adrLocation(published);
  assert.equal(loc.dir, "docs/adr");
  assert.equal(loc.existing, true);
  assert.equal(loc.docsSite?.evidence, "mkdocs.yml");
  assert.match(loc.why, /user's call/);
  rmSync(published, { recursive: true, force: true });
});

test("readState reads ADRs from the location adr.mjs chose, and carries it for the scaffold", () => {
  const root = repo({ "adr/0001-x.md": "# x\n", "adr/TEMPLATE.md": "# t\n" });
  const s = readState(root);
  assert.equal(s.adrDir, "adr");
  assert.deepEqual(s.adrs, ["0001-x.md", "TEMPLATE.md"]);
  rmSync(root, { recursive: true, force: true });

  const site = repo({ "docs/index.md": "", "mkdocs.yml": "" });
  const t = readState(site);
  assert.equal(t.adrDir, "adr", "a site repo's scaffold is told to propose adr/");
  assert.match(t.adrWhy, /mkdocs\.yml/);
  rmSync(site, { recursive: true, force: true });
});
