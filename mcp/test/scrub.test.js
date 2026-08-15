import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, isClean, redact, assertWritable, RefusedWriteError } from "../lib/scrub.js";

// Cortex memory is COMMITTED, so this gate is the only thing standing between a developer's note
// and a secret in the repository's history. Each rule gets a test.
//
// Every fixture below is ASSEMBLED AT RUNTIME rather than written as a literal. These strings are
// fake, but they are shaped exactly like the real thing — which is the point — and a literal in
// the source trips GitHub push protection and every other scanner pointed at this repo. Joining
// the pieces keeps the test honest without shipping something that reads as a live credential.
const fake = (...parts) => parts.join("");

const AWS_KEY = fake("AKIA", "IOSFODNN7", "EXAMPLE");
const GH_TOKEN = fake("ghp_", "aBcDeFgHiJkLmNoPqRsTuVwXyZ", "0123456");
const SLACK_TOKEN = fake("xox", "b-", "123456789012-", "abcdefghijklmnop");
const GOOGLE_KEY = fake("AIza", "a".repeat(35));
const STRIPE_KEY = fake("sk_", "live_", "abcdefghijklmnop1234");
const OPENAI_KEY = fake("sk-", "proj-", "abcdefghijklmnopqrstuvwx");
const ANTHROPIC_KEY = fake("sk-", "ant-", "abcdefghijklmnopqrstuvwx");
const JWT = fake(
  "eyJhbGciOiJIUzI1NiJ9.",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0.",
  "dBjftJeZ4CVPmB92K27uhbUJU1p1r",
);

test("clean prose passes", () => {
  assert.equal(isClean("Decided to split the billing module. See docs/adr/0003.md."), true);
  assert.deepEqual(scan(""), []);
  assert.deepEqual(scan(null), []);
});

test("catches provider keys", () => {
  const cases = [
    ["AWS", AWS_KEY],
    ["GitHub", GH_TOKEN],
    ["Slack", SLACK_TOKEN],
    ["Google", GOOGLE_KEY],
    ["Stripe", STRIPE_KEY],
    ["OpenAI", OPENAI_KEY],
    ["Anthropic", ANTHROPIC_KEY],
  ];
  for (const [name, secret] of cases) {
    assert.equal(isClean(`token is ${secret}`), false, `${name} key should be caught`);
  }
});

test("catches private keys, JWTs and credential URLs", () => {
  assert.equal(isClean(`${fake("-----BEGIN ", "RSA ", "PRIVATE KEY-----")}\nMIIE...\n`), false);
  assert.equal(isClean(JWT), false);
  assert.equal(isClean(fake("postgres://admin:", "hunter2", "@db.internal:5432/app")), false);
});

test("catches assigned secrets in config-shaped lines", () => {
  assert.equal(isClean('api_key = "abcd1234efgh5678"'), false);
  assert.equal(isClean("password: 'correcthorsebattery'"), false);
  assert.equal(isClean('AUTH_TOKEN="s3cr3t-value-here"'), false);
});

test("reports the kind and line, never the secret itself", () => {
  const found = scan(`line one\nline two\naws = ${AWS_KEY}\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "AWS access key id");
  assert.equal(found[0].line, 3);
  assert.ok(!found[0].match.includes("IOSFODNN7EXAMP"), "the match must be redacted");
  assert.match(found[0].match, /\*{8}/);
});

test("redact keeps only the ends, and never lengthens the string", () => {
  assert.equal(redact("short"), "*****");
  const long = redact("abcdefghijklmnopqrst");
  assert.match(long, /^abcd\*{8}qrst$/);
});

test("assertWritable throws a coded, non-leaking error", () => {
  assert.equal(assertWritable("a perfectly ordinary note"), true);
  try {
    assertWritable(`key ${AWS_KEY} here`);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof RefusedWriteError);
    assert.equal(e.code, "refused_write");
    assert.match(e.message, /AWS access key id/);
    assert.ok(!e.message.includes(AWS_KEY), "the error must not echo the secret");
  }
});

test("a line of ordinary code is not mistaken for a secret", () => {
  assert.equal(isClean("const tokenCount = countTokens(text);"), true);
  assert.equal(isClean("// the password field is validated below"), true);
  assert.equal(isClean("secret: process.env.SECRET"), true);
});
