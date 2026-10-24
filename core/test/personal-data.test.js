// The personal-data scan in core/scrub.js (docs/adr/0027).
//
// Every fixture below is invented or a published test value: the IBAN is the ISO 13616 example and
// the card number is a network test number. They are assembled from parts anyway, so nothing here
// reads as a real record to a scanner that does not know better.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanPersonal, gatePersonal, piiMode, ibanValid, luhnValid,
  PersonalDataError, RefusedWriteError, UnknownPiiModeError, PII_DEFAULT,
} from "../scrub.js";

const EMAIL = ["jane.roe", "mailhost.dev"].join("@");
const IBAN = ["GB82", "WEST", "1234", "5698", "7654", "32"].join(" ");
const CARD = ["4111", "1111", "1111", "1111"].join(" ");
const PHONE_INTL = ["+44", "20", "7946", "0958"].join(" ");

const kinds = (text) => scanPersonal(text).map((f) => f.kind);

test("finds an email address, a phone number, an IBAN and a card number, by kind and line", () => {
  const text = `first line\nwrite to ${EMAIL}\ncall ${PHONE_INTL}\npay ${IBAN}\ncard ${CARD}\n`;
  assert.deepEqual(scanPersonal(text), [
    { kind: "email address", line: 2 },
    { kind: "phone number", line: 3 },
    { kind: "IBAN", line: 4 },
    { kind: "payment card number", line: 5 },
  ]);
});

test("a finding never carries the value, not even redacted", () => {
  for (const f of scanPersonal(`${EMAIL} ${IBAN} ${CARD}`)) assert.deepEqual(Object.keys(f).sort(), ["kind", "line"]);
});

test("national phone shapes: a bracketed area code, and the North American dashed or dotted form", () => {
  assert.deepEqual(kinds("ring (555) 123-4567 today"), ["phone number"]);
  assert.deepEqual(kinds("ring 555-123-4567 today"), ["phone number"]);
  assert.deepEqual(kinds("ring 555.123.4567 today"), ["phone number"]);
});

test("conservative: versions, dates, IPs, ids and timestamps are not personal data", () => {
  const clean = [
    "released v2.44.1 and 1.2.3-beta.4 on 2026-10-24",
    "the host is 192.168.100.200, port 8080",
    "epoch 1729789200000 ms, build 20261024.1",
    "id 123e4567-e89b-12d3-a456-426614174000",
    "+4412345678 at the start of a diff line is an added line, not a phone",
    "semver build metadata 1.0.0+20130313144700",
    "ask ops@ about the cut-over, or the #infra channel",
    "a table: 555 123 4567",
    "range 2020-2024, issue #4521, PR 1234",
    "account 12345678 and sort code 12-34-56",
  ];
  for (const s of clean) assert.deepEqual(kinds(s), [], s);
});

test("an address that names nobody is not personal data", () => {
  for (const s of [
    "user@example.com", "someone@corp.example", "a@b.test", "x@y.invalid",
    "git@github.com:owner/repo.git", "1234+name@users.noreply.github.com", "noreply@service.dev",
    "icon@2x.png", "logo@3x.webp",
  ]) assert.deepEqual(kinds(s), [], s);
});

test("the checksums decide: a wrong IBAN digit or a Luhn-invalid card is not reported", () => {
  assert.equal(ibanValid(IBAN), true);
  assert.equal(ibanValid(IBAN.replace("82", "83")), false);
  assert.deepEqual(kinds(`pay ${IBAN.replace("82", "83")}`), []);
  assert.equal(luhnValid(CARD.replace(/\s/g, "")), true);
  assert.deepEqual(kinds(`card ${CARD.slice(0, -1)}2`), []);
});

test("CORTEX_PII: unset is warn; refuse, warn and off are read; anything else throws", () => {
  assert.equal(PII_DEFAULT, "warn");
  assert.equal(piiMode({ env: {} }), "warn");
  assert.equal(piiMode({ env: { CORTEX_PII: "  " } }), "warn");
  assert.equal(piiMode({ env: { CORTEX_PII: "Refuse" } }), "refuse");
  assert.equal(piiMode({ env: { CORTEX_PII: "off" } }), "off");
  assert.throws(() => piiMode({ env: { CORTEX_PII: "refuses" } }), UnknownPiiModeError);
});

test("warn: the write passes, and the warning names kind and line, never the value", () => {
  const r = gatePersonal(`note\nmail ${EMAIL}`, { env: {} });
  assert.equal(r.mode, "warn");
  assert.match(r.warning, /email address \(line 2\)/);
  assert.ok(!r.warning.includes(EMAIL));
  assert.equal(gatePersonal("nothing personal here", { env: {} }).warning, null);
});

test("refuse: a PersonalDataError, which is a RefusedWriteError, naming kinds and lines only", () => {
  let err;
  try { gatePersonal(`pay ${IBAN}`, { env: { CORTEX_PII: "refuse" } }); } catch (e) { err = e; }
  assert.ok(err instanceof PersonalDataError);
  assert.ok(err instanceof RefusedWriteError);
  assert.equal(err.code, "personal_data");
  assert.match(err.message, /IBAN, line 1/);
  assert.ok(!err.message.includes(IBAN.replace(/\s/g, "")) && !err.message.includes(IBAN));
});

test("off: nothing is scanned", () => {
  assert.deepEqual(gatePersonal(`mail ${EMAIL}`, { env: { CORTEX_PII: "off" } }), { mode: "off", findings: [], warning: null });
});
