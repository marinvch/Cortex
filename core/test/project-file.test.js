// core/project-file.js — the one module that says what a project file is.
//
// A project file is `projects/<slug>.md` at the top of a team-brain (ADR 0024). Both leaves read it,
// so the format has one owner here, and every rule in the field table has a fixture below that
// breaks exactly that rule. Fixtures are generic on purpose: this repository holds no team's names.
//
// Anything credential-shaped is assembled at run time, the way scrub.test.js does it. A literal
// would set Cortex's own scanner off against this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS,
  WORK_TOOLS,
  carriesCredential,
  employerLinks,
  employerShape,
  isSlug,
  normalizeRepo,
  parseProjectFile,
  profileRefusal,
  renderProjectFile,
  setFrontmatter,
  validateProjectFile,
} from "../project-file.js";
import { policyFor, profiles } from "../profile.js";
import { isClean } from "../scrub.js";

const GOOD = [
  "---",
  "type: project",
  "title: Storefront",
  "repo: https://github.com/example-org/storefront",
  "tracker: https://github.com/example-org/storefront/issues",
  "design: https://design.example.com/file/abc123?node-id=4",
  "docs: https://storefront.example.com/docs",
  "related: billing-api, auth-service",
  "created: 2026-10-09",
  "---",
  "",
  "The customer-facing shop. Calls billing-api for checkout.",
  "",
].join("\n");

/** GOOD with one frontmatter line replaced, removed (null) or added. */
function withLine(key, line) {
  const lines = GOOD.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i === -1) lines.splice(lines.indexOf("---", 1), 0, line);
  else if (line === null) lines.splice(i, 1);
  else lines[i] = line;
  return lines.join("\n");
}

const check = (text, opts = { slug: "storefront" }) => validateProjectFile(text, opts);
const keysOf = (res) => res.errors.map((e) => e.key);

/** Exactly one error, on `key`, carrying the line the key sits on. */
function assertOneError(text, key, pattern, opts) {
  const res = check(text, opts);
  assert.equal(res.ok, false, `expected an error on '${key}'`);
  assert.deepEqual(keysOf(res), [key], JSON.stringify(res.errors));
  if (pattern) assert.match(res.errors[0].msg, pattern);
  assert.equal(typeof res.errors[0].line, "number");
  return res.errors[0];
}

// ---------------------------------------------------------------------------------------------
// The good file
// ---------------------------------------------------------------------------------------------

test("the spec's example validates, and comes back as data", () => {
  const res = check(GOOD);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.ok, true);
  assert.equal(res.isProject, true);
  assert.deepEqual(res.data, {
    type: "project",
    title: "Storefront",
    repo: "https://github.com/example-org/storefront",
    tracker: "https://github.com/example-org/storefront/issues",
    design: "https://design.example.com/file/abc123?node-id=4",
    docs: "https://storefront.example.com/docs",
    related: ["billing-api", "auth-service"],
    created: "2026-10-09",
    prose: "\nThe customer-facing shop. Calls billing-api for checkout.\n",
  });
});

test("only type, title and repo are required", () => {
  const res = check("---\ntype: project\ntitle: Billing API\nrepo: git@github.com:example-org/billing-api.git\n---\n", { slug: "billing-api" });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.data.related, []);
  assert.equal(res.data.tracker, undefined);
});

test("a file with CRLF line endings reads the same", () => {
  const res = check(GOOD.split("\n").join("\r\n"));
  assert.deepEqual(res.errors, []);
  assert.equal(res.data.title, "Storefront");
});

test("validation never throws, whatever it is handed", () => {
  for (const junk of [undefined, null, "", 42, "---", "---\n---", "\u0000", "---\ntype: project\n---\n", {}]) {
    assert.doesNotThrow(() => validateProjectFile(junk, { slug: "x" }));
    assert.doesNotThrow(() => validateProjectFile(junk));
    assert.doesNotThrow(() => parseProjectFile(junk));
  }
});

// ---------------------------------------------------------------------------------------------
// What is not a project file at all
// ---------------------------------------------------------------------------------------------

test("a file with no frontmatter is not a project file", () => {
  const res = check("# Projects\n\nA README that happens to live in projects/.\n");
  assert.equal(res.isProject, false);
  assert.equal(res.ok, false);
  assert.deepEqual(keysOf(res), ["type"]);
});

test("a note is not a project file — `type` must be exactly `project`", () => {
  for (const type of ["brain-note", "Project", "projects", "\"project \""]) {
    const res = check(withLine("type", `type: ${type}`));
    assert.equal(res.isProject, false, type);
    assert.equal(res.ok, false, type);
    assert.deepEqual(keysOf(res), ["type"], type);
  }
});

test("a file with no `type` line is not a project file", () => {
  const res = check(withLine("type", null));
  assert.equal(res.isProject, false);
  assert.equal(res.ok, false);
});

test("frontmatter that is never closed is not a project file", () => {
  const res = check("---\ntype: project\ntitle: Storefront\nrepo: https://github.com/example-org/storefront\n");
  assert.equal(res.isProject, false);
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------------------------------------
// The grammar: flat `key: value`, one per line
// ---------------------------------------------------------------------------------------------

test("an unknown key is an error that names the keys a project file has", () => {
  const e = assertOneError(withLine("trakcer", "trakcer: https://github.com/example-org/storefront/issues"), "trakcer");
  for (const k of KEYS) assert.ok(e.msg.includes(k), `the message must name '${k}': ${e.msg}`);
  assert.equal(e.line, 10);
});

test("`status` and `path` are unknown keys, not quietly accepted ones", () => {
  assertOneError(withLine("status", "status: retired"), "status");
  assertOneError(withLine("path", "path: /home/dev/storefront"), "path");
});

test("a repeated key is an error", () => {
  const e = assertOneError(withLine("zz", "title: Another"), "title", /repeated|duplicate/i);
  assert.equal(e.line, 10);
});

test("an indented line is an error — there is no nesting", () => {
  const res = check(withLine("zz", "  nested: value"));
  assert.equal(res.ok, false);
  assert.match(res.errors[0].msg, /indent|flat/i);
});

test("list syntax is an error, as a dash line and as a flow list", () => {
  const dash = check(withLine("related", "related:\n- billing-api"));
  assert.equal(dash.ok, false);
  assert.ok(dash.errors.some((e) => /list/i.test(e.msg)), JSON.stringify(dash.errors));
  assertOneError(withLine("related", "related: [billing-api, auth-service]"), "related", /list|indicator|\[/i);
});

test("a block scalar is an error", () => {
  for (const ind of ["|", ">-", ">"]) assertOneError(withLine("title", `title: ${ind}`), "title", /block scalar/);
});

test("a line that is not `key: value` is an error", () => {
  const res = check(withLine("zz", "just some words"));
  assert.equal(res.ok, false);
  assert.match(res.errors[0].msg, /key: value/);
  assert.equal(res.errors[0].line, 10);
});

test("an unquoted value holding `: ` or ` #` is an error, and the quoted one is read whole", () => {
  assertOneError(withLine("title", "title: Storefront: the shop"), "title", /quote/);
  assertOneError(withLine("title", "title: Storefront #1"), "title", /quote/);
  assert.equal(check(withLine("title", 'title: "Storefront: the shop #1"')).data.title, "Storefront: the shop #1");
  assert.equal(check(withLine("title", "title: 'The shop''s front'")).data.title, "The shop's front");
});

test("a quote that never closes is an error", () => {
  assertOneError(withLine("title", 'title: "Storefront'), "title", /quote/);
  assertOneError(withLine("title", "title: 'Storefront"), "title", /quote/);
});

test("blank lines and comment lines in the frontmatter are skipped", () => {
  const res = check(withLine("zz", "\n# a note for whoever edits this"));
  assert.deepEqual(res.errors, []);
});

// ---------------------------------------------------------------------------------------------
// The slug
// ---------------------------------------------------------------------------------------------

test("a slug is lower-case words joined by single dashes, 64 characters at most", () => {
  for (const ok of ["storefront", "billing-api", "a", "app2", "a-b-c", "x".repeat(64)]) assert.equal(isSlug(ok), true, ok);
  for (const bad of ["", "Storefront", "billing_api", "-api", "api-", "a--b", "a b", "../x", "a/b", "a.b", "x".repeat(65), null, undefined, 7]) {
    assert.equal(isSlug(bad), false, String(bad));
  }
});

test("a file whose name is not a slug is an error on `slug`", () => {
  assertOneError(GOOD, "slug", /slug/, { slug: "Storefront" });
  assertOneError(GOOD, "slug", /64/, { slug: "x".repeat(65) });
});

test("with no slug given, the filename rule is not applied", () => {
  assert.equal(validateProjectFile(GOOD).ok, true);
});

// ---------------------------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------------------------

test("title is required, one line, 1 to 80 characters", () => {
  assertOneError(withLine("title", null), "title", /required/);
  assertOneError(withLine("title", "title:"), "title", /1 to 80/);
  assertOneError(withLine("title", 'title: "   "'), "title", /1 to 80/);
  assertOneError(withLine("title", `title: ${"x".repeat(81)}`), "title", /1 to 80/);
  assert.equal(check(withLine("title", `title: ${"x".repeat(80)}`)).ok, true);
  assertOneError(withLine("title", 'title: "two\\nlines"'), "title", /one line/);
});

// ---------------------------------------------------------------------------------------------
// repo
// ---------------------------------------------------------------------------------------------

test("repo is required", () => {
  const e = assertOneError(withLine("repo", null), "repo", /required/);
  assert.equal(e.line, 1);
});

test("repo takes https:// or the user@host:path form, and nothing else", () => {
  for (const ok of [
    "https://github.com/example-org/storefront",
    "https://github.com/example-org/storefront.git",
    "git@github.com:example-org/storefront.git",
    "git@git.example.com:group/sub/storefront",
  ]) assert.deepEqual(check(withLine("repo", `repo: ${ok}`)).errors, [], ok);

  for (const bad of [
    "http://github.com/example-org/storefront",
    "ssh://git@github.com/example-org/storefront.git",
    "git://github.com/example-org/storefront.git",
    "file:///srv/git/storefront.git",
    "github.com/example-org/storefront",
    "/srv/git/storefront.git",
    "storefront",
    "https://",
  ]) assertOneError(withLine("repo", `repo: ${bad}`), "repo", null);
});

test("repo holds no query and no fragment", () => {
  assertOneError(withLine("repo", "repo: https://github.com/example-org/storefront?tab=readme"), "repo", /query/);
  assertOneError(withLine("repo", "repo: https://github.com/example-org/storefront#readme"), "repo", /fragment/);
});

test("repo holds no user, password or token", () => {
  const pass = ["https://deploy", "not-a-real-pass"].join(":") + "@github.com/example-org/storefront";
  const token = "https://" + "x-access-holder" + "@github.com/example-org/storefront";
  for (const bad of [pass, token]) {
    const e = assertOneError(withLine("repo", `repo: ${bad}`), "repo", /credential/);
    assert.ok(!e.msg.includes("not-a-real-pass"), "an error never echoes the secret");
    assert.ok(!e.msg.includes("x-access-holder"), "an error never echoes the secret");
  }
});

test("an SSH-form repo carrying a token as its user is refused", () => {
  const ghToken = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
  assertOneError(withLine("repo", `repo: ${ghToken}@github.com:example-org/storefront.git`), "repo", /credential/);
});

// ---------------------------------------------------------------------------------------------
// tracker, design, docs
// ---------------------------------------------------------------------------------------------

for (const key of ["tracker", "design", "docs"]) {
  test(`${key} is optional and takes http:// or https://`, () => {
    assert.deepEqual(check(withLine(key, null)).errors, []);
    assert.deepEqual(check(withLine(key, `${key}: http://docs.example.com/x?page=2#top`)).errors, []);
    for (const bad of ["ftp://docs.example.com/x", "docs.example.com/x", "git@github.com:example-org/x.git", "javascript:alert(1)", "https://exa mple.com"]) {
      // The last one holds a space, which the grammar reads as part of the value.
      assertOneError(withLine(key, `${key}: ${bad}`), key, null);
    }
  });

  test(`${key} holds no password and no token`, () => {
    const pass = ["https://deploy", "not-a-real-pass"].join(":") + "@tracker.example.com/x";
    const user = "https://" + "someone" + "@tracker.example.com/x";
    const param = "https://tracker.example.com/x?access_" + "token=abc123";
    const frag = "https://tracker.example.com/x#to" + "ken=abc123";
    const jwt = "https://tracker.example.com/x?s=" + ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N"].join(".");
    for (const bad of [pass, user, param, frag, jwt]) assertOneError(withLine(key, `${key}: ${bad}`), key, /credential/);
  });
}

// ---------------------------------------------------------------------------------------------
// related, created
// ---------------------------------------------------------------------------------------------

test("related is slugs separated by commas", () => {
  assert.deepEqual(check(withLine("related", "related: billing-api")).data.related, ["billing-api"]);
  assert.deepEqual(check(withLine("related", "related: billing-api,auth-service ,  docs-site")).data.related, ["billing-api", "auth-service", "docs-site"]);
  assert.deepEqual(check(withLine("related", "related:")).data.related, []);
  assertOneError(withLine("related", "related: Billing API"), "related", /slug/);
  assertOneError(withLine("related", "related: billing-api,, auth-service"), "related", /slug/);
  assertOneError(withLine("related", "related: billing-api,"), "related", /slug/);
});

test("related names no slug twice", () => {
  assertOneError(withLine("related", "related: billing-api, auth-service, billing-api"), "related", /twice|repeated/);
});

test("related never names the file's own slug", () => {
  assertOneError(withLine("related", "related: billing-api, storefront"), "related", /own/);
  // Without a slug there is no "own", so the same line is fine.
  assert.equal(validateProjectFile(withLine("related", "related: billing-api, storefront")).ok, true);
});

test("created is YYYY-MM-DD and a real day when present", () => {
  assert.deepEqual(check(withLine("created", null)).errors, []);
  for (const bad of ["2026-10-9", "09-10-2026", "2026/10/09", "yesterday", "2026-13-01", "2026-02-30", "2026-10-09T10:00"]) {
    assertOneError(withLine("created", `created: ${bad}`), "created", /YYYY-MM-DD/);
  }
});

// ---------------------------------------------------------------------------------------------
// The two warnings another file causes
// ---------------------------------------------------------------------------------------------

test("a related slug with no project file is a warning, not an error", () => {
  const others = [{ slug: "billing-api", repo: "https://github.com/example-org/billing-api" }];
  const res = check(GOOD, { slug: "storefront", others });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings.map((w) => w.key), ["related"]);
  assert.match(res.warnings[0].msg, /auth-service/);
  assert.doesNotMatch(res.warnings[0].msg, /billing-api/);
  assert.equal(res.warnings[0].line, 8);
});

test("two files naming the same repo is a warning on both readings of one URL", () => {
  for (const same of [
    "https://github.com/example-org/storefront",
    "https://GitHub.com/example-org/storefront.git/",
    "git@github.com:example-org/storefront.git",
  ]) {
    const others = [
      { slug: "billing-api", repo: "https://github.com/example-org/billing-api" },
      { slug: "auth-service", repo: "https://github.com/example-org/auth-service" },
      { slug: "shop", repo: same },
    ];
    const res = check(GOOD, { slug: "storefront", others });
    assert.equal(res.ok, true);
    assert.deepEqual(res.warnings.map((w) => w.key), ["repo"], same);
    assert.match(res.warnings[0].msg, /shop/);
  }
});

test("a file is never warned about itself, and no `others` means no cross-file warning", () => {
  const self = [
    { slug: "storefront", repo: "https://github.com/example-org/storefront" },
    { slug: "billing-api", repo: "https://github.com/example-org/billing-api" },
    { slug: "auth-service", repo: "https://github.com/example-org/auth-service" },
  ];
  assert.deepEqual(check(GOOD, { slug: "storefront", others: self }).warnings, []);
  assert.deepEqual(check(GOOD).warnings, []);
});

test("normalizeRepo drops the scheme, the user, the case of the host, `.git` and a trailing slash", () => {
  const want = "github.com/example-org/storefront";
  for (const spelling of [
    "https://github.com/example-org/storefront",
    "https://github.com/example-org/storefront/",
    "https://GITHUB.com/example-org/storefront.git",
    "git@github.com:example-org/storefront.git",
    "ssh://git@github.com/example-org/storefront.git",
  ]) assert.equal(normalizeRepo(spelling), want, spelling);
  // The path keeps its case: two repos that differ only there are two repos on most forges.
  assert.notEqual(normalizeRepo("https://github.com/example-org/Storefront"), want);
});

// ---------------------------------------------------------------------------------------------
// Links are characters. Nothing is fetched.
// ---------------------------------------------------------------------------------------------

test("validating a file makes no request", async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called++; throw new Error("a link was fetched"); };
  try {
    check(GOOD);
    employerLinks(check(GOOD).data);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, 0);
  const src = (await import("node:fs")).readFileSync(new URL("../project-file.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /node:(https?|net|dns|tls|dgram|child_process|fs)/, "text in, a result out: no I/O in this module");
  assert.doesNotMatch(src, /\bfetch\s*\(|process\.env/);
});

// ---------------------------------------------------------------------------------------------
// The employer-shaped link
// ---------------------------------------------------------------------------------------------

test("a private-network host is employer-shaped", () => {
  for (const link of [
    "https://tracker.internal/browse/SHOP-12",
    "https://git.example.internal/storefront",
    "https://wiki.corp/x",
    "https://build.lan/x",
    "https://docs.intranet/x",
    "http://tracker.local/x",
    "http://nas.home.arpa/x",
    "https://tracker/browse/SHOP-12",
    "http://localhost:8080/x",
    "http://10.2.3.4/x",
    "http://172.16.0.9/x",
    "http://172.31.255.1/x",
    "http://192.168.1.20:3000/x",
    "http://169.254.10.10/x",
    "http://[fd12:3456:789a::1]/x",
    "http://[fe80::1]/x",
    "git@git.internal:shop/storefront.git",
    "git@gitbox:shop/storefront.git",
    "https://TRACKER.INTERNAL/x",
  ]) assert.equal(employerShape(link)?.shape, "private-network", link);
});

test("a public host is not employer-shaped", () => {
  for (const link of [
    "https://github.com/example-org/storefront",
    "git@github.com:example-org/storefront.git",
    "https://storefront.example.com/docs",
    "https://internal.example.com/x",
    "https://corp.example.com/x",
    "https://example.com/internal/x",
    "https://notinternal.example/x",
    "http://172.15.0.1/x",
    "http://172.32.0.1/x",
    "http://11.0.0.1/x",
    "http://192.169.1.1/x",
    "http://8.8.8.8/x",
    "http://[2001:db8::1]/x",
    "not a link at all",
    "",
  ]) assert.equal(employerShape(link), null, link);
});

test("a trailing dot on the host hides neither shape", () => {
  // `tenant.atlassian.net.` is the same host to a browser and to git. Read literally it ends in
  // `.net.`, matches no suffix, validates as a link, and would be written on a home install.
  for (const link of [
    "https://tenant.atlassian.net./browse/SHOP-12",
    "https://dev.azure.com./tenant/shop/_git/storefront",
    "git@tenant.visualstudio.com.:v3/tenant/shop/storefront",
  ]) assert.equal(employerShape(link)?.shape, "work-tool-tenant", link);
  for (const link of ["https://tracker.internal./x", "git@git.internal.:shop/storefront.git"]) {
    assert.equal(employerShape(link)?.shape, "private-network", link);
  }
  for (const link of ["https://www.atlassian.net./x", "https://github.com./example-org/storefront"]) {
    assert.equal(employerShape(link), null, link);
  }
  const res = check(withLine("tracker", "tracker: https://tenant.atlassian.net./browse/SHOP-12"));
  assert.equal(res.ok, true, "it is a valid link, so only the profile check stands between it and a write");
  assert.ok(profileRefusal(res.data, policyFor("home")));
});

test("a link with no scheme is still read for its host", () => {
  // Such a value fails validation, so no writer writes it. A reader still meets it in a file a
  // teammate committed, and on a profile that refuses employer material it must withhold the file
  // and not print the link beside its errors.
  for (const link of ["tracker.internal/browse/SHOP-12", "10.2.3.4/x", "git.internal:shop/storefront.git", "tracker.internal"]) {
    assert.equal(employerShape(link)?.shape, "private-network", link);
  }
  assert.equal(employerShape("tenant.atlassian.net/browse/SHOP-12")?.shape, "work-tool-tenant");
  // A bare word is not a host: `example-org/storefront` is a path somebody shortened, not a
  // single-label machine name.
  for (const link of ["example-org/storefront", "storefront.example.com/docs", "storefront", "docs/readme.md"]) {
    assert.equal(employerShape(link), null, link);
  }
  const res = check(withLine("tracker", "tracker: tracker.internal/browse/SHOP-12"));
  assert.equal(res.ok, false);
  assert.deepEqual(employerLinks(res.data), [{ field: "tracker", shape: "private-network" }]);
});

// One test per row of the table. A row with no example here fails the test after these, so a
// suffix cannot be added without saying what it catches and what it lets through.
const ROW_EXAMPLES = {
  "atlassian.net": {
    hit: ["https://tenant.atlassian.net/browse/SHOP-12", "https://tenant.atlassian.net/wiki/spaces/SHOP"],
    miss: ["https://atlassian.net/", "https://www.atlassian.net/x", "https://atlassian.net.example.com/x", "https://notatlassian.net/x"],
  },
  "sharepoint.com": {
    hit: ["https://tenant.sharepoint.com/sites/shop/Shared%20Documents"],
    miss: ["https://sharepoint.com/", "https://www.sharepoint.com/x"],
  },
  "visualstudio.com": {
    hit: ["https://tenant.visualstudio.com/shop/_git/storefront", "git@tenant.visualstudio.com:v3/tenant/shop/storefront"],
    miss: ["https://visualstudio.com/", "https://marketplace.visualstudio.com/items", "https://www.visualstudio.com/"],
  },
  "dev.azure.com": {
    hit: ["https://dev.azure.com/tenant/shop/_git/storefront", "https://dev.azure.com/tenant"],
    miss: ["https://dev.azure.com/", "https://dev.azure.com", "https://azure.com/tenant"],
  },
  "slack.com": {
    hit: ["https://tenant.slack.com/archives/C0123"],
    miss: ["https://slack.com/help", "https://api.slack.com/methods", "https://app.slack.com/client", "https://status.slack.com/"],
  },
  "service-now.com": {
    hit: ["https://tenant.service-now.com/nav_to.do"],
    miss: ["https://service-now.com/", "https://developer.service-now.com/x", "https://support.service-now.com/x"],
  },
};

for (const row of WORK_TOOLS) {
  test(`hosted work tool: ${row.suffix} puts the tenant in the ${row.tenant}`, () => {
    const ex = ROW_EXAMPLES[row.suffix];
    assert.ok(ex, `no example for the row '${row.suffix}' — add one to ROW_EXAMPLES`);
    for (const link of ex.hit) assert.equal(employerShape(link)?.shape, "work-tool-tenant", link);
    for (const link of ex.miss) assert.equal(employerShape(link), null, link);
  });
}

test("the suffix table is data, short, and every row is tested", () => {
  assert.deepEqual(WORK_TOOLS.map((r) => r.suffix).sort(), Object.keys(ROW_EXAMPLES).sort());
  assert.ok(Object.isFrozen(WORK_TOOLS));
  assert.ok(WORK_TOOLS.length <= 8, "a longer list refuses more personal projects; argue for the row in the spec first");
  for (const r of WORK_TOOLS) {
    assert.ok(["subdomain", "path"].includes(r.tenant), r.suffix);
    assert.equal(r.suffix, r.suffix.toLowerCase());
  }
});

test("a public forge is never in the table — an organisation there has the shape of a person", () => {
  for (const link of ["https://github.com/example-org/storefront", "https://gitlab.com/example-org/storefront", "https://bitbucket.org/example-org/storefront"]) {
    assert.equal(employerShape(link), null, link);
  }
});

test("all four link fields are checked, repo included", () => {
  for (const key of ["repo", "tracker", "design", "docs"]) {
    const link = key === "repo" ? "https://git.example.internal/storefront" : "https://tools.example.internal/x";
    const res = check(withLine(key, `${key}: ${link}`));
    assert.equal(res.ok, true, "an employer-shaped link is a valid link; the profile decides, not the validator");
    assert.deepEqual(employerLinks(res.data).map((l) => l.field), [key]);
  }
  assert.deepEqual(employerLinks(check(GOOD).data), []);
});

// ---------------------------------------------------------------------------------------------
// The refusal reads the policy, never a profile name
// ---------------------------------------------------------------------------------------------

const EMPLOYER = check(withLine("tracker", "tracker: https://tenant.atlassian.net/browse/SHOP-12")).data;
const CLEAN = check(GOOD).data;

test("home refuses a file with an employer-shaped link; work and lab accept it", () => {
  const refusal = profileRefusal(EMPLOYER, policyFor("home"));
  assert.equal(refusal.code, "employer_shaped_link");
  assert.deepEqual(refusal.links, [{ field: "tracker", shape: "work-tool-tenant" }]);
  assert.equal(profileRefusal(EMPLOYER, policyFor("work")), null);
  assert.equal(profileRefusal(EMPLOYER, policyFor("lab")), null);
});

test("no profile refuses a file with no employer-shaped link", () => {
  for (const p of profiles()) assert.equal(profileRefusal(CLEAN, policyFor(p)), null, p);
});

test("the refusal follows policy.refuses, not the profile's name", () => {
  // A fourth profile that refuses employer material is refused here with no call site changed,
  // and a profile merely CALLED home that refuses nothing is not.
  assert.ok(profileRefusal(EMPLOYER, { label: "contractor", refuses: "employer", outwardSync: true }));
  assert.equal(profileRefusal(EMPLOYER, { label: "home", refuses: "nothing", outwardSync: true }), null);
  assert.equal(profileRefusal(EMPLOYER, { label: "home", refuses: "personal", outwardSync: true }), null);
});

test("a missing policy is a caller's bug, not a pass", () => {
  assert.throws(() => profileRefusal(EMPLOYER), TypeError);
  assert.throws(() => profileRefusal(EMPLOYER, {}), TypeError);
  assert.throws(() => profileRefusal(EMPLOYER, "home"), TypeError);
});

test("the message names the field and the shape, says where it belongs, and says it is a floor", () => {
  const both = check(withLine("repo", "repo: https://git.example.internal/storefront").replace(
    "tracker: https://github.com/example-org/storefront/issues",
    "tracker: https://tenant.atlassian.net/browse/SHOP-12",
  )).data;
  const r = profileRefusal(both, policyFor("home"));
  assert.match(r.message, /`repo`/);
  assert.match(r.message, /private-network host/);
  assert.match(r.message, /`tracker`/);
  assert.match(r.message, /hosted work tool/);
  assert.match(r.message, /work install/);
  assert.match(r.message, /floor/);
  assert.match(r.message, /no override/);
  // The reason travels to a reader that withholds the links, so it may not carry one.
  assert.doesNotMatch(r.reason, /example\.internal|atlassian|https?:/);
  assert.doesNotMatch(r.message, /example\.internal|tenant\.atlassian/);
});

// ---------------------------------------------------------------------------------------------
// Writing: render, and change a line
// ---------------------------------------------------------------------------------------------

test("a rendered file validates and reads back as the fields it was given", () => {
  const fields = {
    title: "Storefront: the shop #1",
    repo: "https://github.com/example-org/storefront",
    tracker: "https://github.com/example-org/storefront/issues",
    related: ["billing-api", "auth-service"],
    created: "2026-10-09",
  };
  const text = renderProjectFile(fields, "The customer-facing shop.");
  const res = check(text);
  assert.deepEqual(res.errors, []);
  assert.equal(res.data.title, fields.title);
  assert.equal(res.data.repo, fields.repo);
  assert.deepEqual(res.data.related, fields.related);
  assert.equal(res.data.design, undefined);
  assert.equal(res.data.prose.trim(), "The customer-facing shop.");
  assert.ok(text.startsWith("---\ntype: project\ntitle: "));
  assert.ok(text.endsWith("\n"));
});

test("a rendered file with nothing optional is three keys and no prose", () => {
  assert.equal(
    renderProjectFile({ title: "Billing API", repo: "git@github.com:example-org/billing-api.git" }),
    "---\ntype: project\ntitle: Billing API\nrepo: git@github.com:example-org/billing-api.git\n---\n",
  );
});

test("rendering does not launder a bad field — the result still fails validation", () => {
  assert.equal(check(renderProjectFile({ title: "Storefront", repo: "http://github.com/example-org/storefront" })).ok, false);
  assert.equal(check(renderProjectFile({ title: "", repo: "https://github.com/example-org/storefront" })).ok, false);
});

test("setFrontmatter changes only the lines it is given, and never the prose", () => {
  const prose = "\r\nProse with  odd   spacing.\n\n---\n\ntitle: not frontmatter\r\n";
  const before = GOOD.slice(0, GOOD.indexOf("\nThe customer")) + prose;
  const after = setFrontmatter(before, { tracker: "https://tracker.example.com/shop", title: "Shop: front" });
  assert.ok(after.endsWith(prose), "the prose is byte for byte what it was");
  const a = before.split("\n");
  const b = after.split("\n");
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? null : b[i])).filter(Boolean);
  assert.deepEqual(changed, ['title: "Shop: front"', "tracker: https://tracker.example.com/shop"]);
  assert.equal(check(after).data.title, "Shop: front");
});

test("setFrontmatter adds a key the file did not have, inside the frontmatter", () => {
  const start = renderProjectFile({ title: "Storefront", repo: "https://github.com/example-org/storefront" }, "Prose.");
  const after = setFrontmatter(start, { docs: "https://storefront.example.com/docs", related: ["billing-api"] });
  const res = check(after);
  assert.deepEqual(res.errors, []);
  assert.equal(res.data.docs, "https://storefront.example.com/docs");
  assert.deepEqual(res.data.related, ["billing-api"]);
  assert.equal(res.data.prose.trim(), "Prose.");
});

test("setFrontmatter keeps CRLF endings in a CRLF file", () => {
  const crlf = GOOD.split("\n").join("\r\n");
  const after = setFrontmatter(crlf, { title: "Shop", design: "https://design.example.com/f/2" });
  assert.ok(!/[^\r]\n/.test(after), "no bare LF was introduced");
  assert.equal(check(after).data.title, "Shop");
});

test("setFrontmatter leaves a file with no frontmatter alone", () => {
  const readme = "# Projects\n\ntitle: nope\n";
  assert.equal(setFrontmatter(readme, { title: "X" }), readme);
});

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

test("carriesCredential sees a password, a token before the host, and a credential parameter", () => {
  const withPass = ["https://deploy", "not-a-real-pass"].join(":") + "@github.com/example-org/storefront.git";
  const sshPass = ["ssh://git", "not-a-real-pass"].join(":") + "@git.example.com/storefront.git";
  assert.equal(carriesCredential(withPass), true);
  assert.equal(carriesCredential(sshPass), true);
  assert.equal(carriesCredential("https://" + "holder" + "@github.com/example-org/storefront.git"), true);
  assert.equal(carriesCredential("https://tracker.example.com/x?api_" + "key=abc"), true);
  // A placeholder in the password slot is not a secret, so the secret gate lets it by. It is still
  // not a repository's plain address, and this rule is the only one that says so.
  assert.equal(carriesCredential("ssh://git:" + "${GIT_PASS}" + "@git.example.com/storefront.git"), true);
  for (const fine of [
    "https://github.com/example-org/storefront.git",
    "git@github.com:example-org/storefront.git",
    "ssh://git@github.com/example-org/storefront.git",
    "https://design.example.com/file/abc123?node-id=4",
    "https://tracker.example.com/x?monkey=1&author=me",
  ]) assert.equal(carriesCredential(fine), false, fine);
});

test("the example file is clean by the secret gate's own measure", () => {
  assert.equal(isClean(GOOD), true);
});
