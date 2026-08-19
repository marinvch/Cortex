import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProfile, policyFor, profiles, UnknownProfileError, HOME, WORK, LAB } from "../profile.js";

test("defaults to home when nothing is declared", () => {
  const r = resolveProfile({ env: {} });
  assert.equal(r.profile, HOME);
  assert.equal(r.source, "default");
});

test("the default fails safe, not convenient", () => {
  // An undeclared work machine gets the strict-about-employer-content firewall. The worst case is a
  // refused write someone wanted; the opposite default would let a work machine quietly behave like
  // a lab, which is a leak rather than an inconvenience.
  const r = resolveProfile({ env: {} });
  assert.equal(r.policy.refuses, "employer");
  assert.notEqual(r.profile, LAB, "lab must never be reachable by default");
});

test("CORTEX_PROFILE declares the world", () => {
  assert.equal(resolveProfile({ env: { CORTEX_PROFILE: "work" } }).profile, WORK);
  assert.equal(resolveProfile({ env: { CORTEX_PROFILE: "lab" } }).profile, LAB);
  assert.equal(resolveProfile({ env: { CORTEX_PROFILE: "work" } }).source, "CORTEX_PROFILE");
});

test("declaration is case- and whitespace-tolerant", () => {
  assert.equal(resolveProfile({ env: { CORTEX_PROFILE: "  WORK  " } }).profile, WORK);
});

test("empty or whitespace-only is the same as undeclared", () => {
  for (const v of ["", "   ", undefined, null]) {
    assert.equal(resolveProfile({ env: { CORTEX_PROFILE: v } }).profile, HOME);
  }
});

test("an unrecognised value throws instead of falling back", () => {
  // `CORTEX_PROFILE=works` resolving quietly to home would look identical to a correct home install
  // while the user believed the firewall pointed the other way. Failing loudly is the whole point.
  assert.throws(() => resolveProfile({ env: { CORTEX_PROFILE: "works" } }), (e) =>
    e instanceof UnknownProfileError && e.code === "unknown_profile");
  assert.throws(() => resolveProfile({ env: { CORTEX_PROFILE: "personal" } }), UnknownProfileError);
});

test("the error names the value and the valid set, so the fix is obvious", () => {
  try {
    resolveProfile({ env: { CORTEX_PROFILE: "works" } });
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /works/);
    for (const p of profiles()) assert.match(e.message, new RegExp(p));
  }
});

test("home and work refuse opposite things — that is the whole distinction", () => {
  assert.equal(policyFor(HOME).refuses, "employer");
  assert.equal(policyFor(WORK).refuses, "personal");
  assert.notEqual(policyFor(HOME).refuses, policyFor(WORK).refuses);
});

test("lab refuses nothing locally and therefore publishes nothing", () => {
  // These two facts are one decision. If lab ever refuses nothing AND syncs outward, it has become
  // a way to switch the firewall off and keep pushing — the leak with extra steps.
  const lab = policyFor(LAB);
  assert.equal(lab.refuses, "nothing");
  assert.equal(lab.outwardSync, false);
});

test("only lab seals outward sync", () => {
  assert.equal(policyFor(HOME).outwardSync, true);
  assert.equal(policyFor(WORK).outwardSync, true);
});

test("every profile carries a policy a ritual can act on", () => {
  for (const id of profiles()) {
    const p = policyFor(id);
    assert.ok(p.label, `${id} needs a label`);
    assert.ok(p.refuses, `${id} must say what it refuses`);
    assert.equal(typeof p.outwardSync, "boolean", `${id} must decide outward sync`);
    assert.ok(p.summary && p.summary.length > 40, `${id} must explain itself`);
  }
});

test("the profile set is exactly home, work, lab", () => {
  assert.deepEqual(profiles().sort(), ["home", "lab", "work"]);
});

test("policyFor rejects an unknown id for the same reason resolveProfile does", () => {
  assert.throws(() => policyFor("staging"), UnknownProfileError);
});

test("profile is independent of mode and audience", () => {
  // docs/adr/0008 argues mode and audience must not be welded together; the same holds for the third
  // axis. This module reads only CORTEX_PROFILE — nothing about the root, the connector or the cwd
  // can move it, which is what keeps the axes free to vary.
  const a = resolveProfile({ env: { CORTEX_PROFILE: "work", AI_OS_ROOT: "/x/.cortex", CORTEX_AUDIENCE: "server" } });
  const b = resolveProfile({ env: { CORTEX_PROFILE: "work" } });
  assert.equal(a.profile, b.profile);
  assert.equal(a.policy.outwardSync, b.policy.outwardSync);
});
