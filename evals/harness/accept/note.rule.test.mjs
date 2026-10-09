// T3 rule (R3): the stored shape changes only through a new migration, a shipped migration is never
// edited, and a read path does not paper over a missing field. Three properties:
//   - the three shipped migration files are byte-identical to the fixture's;
//   - a store at version 3, built by the fixture's own copies of them, reports a higher version
//     after the tree's migrate();
//   - the stored order row itself has `note: ""`, read from the store and not through the API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureFiles } from "../fixture.mjs";
import { OLD_ORDER, SHIPPED_MIGRATIONS, TREE, load, newApp, storeAtVersion3, storedVersion } from "./lib.mjs";

for (const rel of SHIPPED_MIGRATIONS) {
  test(`the shipped migration ${rel.split("/").at(-1)} is byte-identical to the one that shipped`, () => {
    const at = join(TREE, ...rel.split("/"));
    assert.ok(existsSync(at), `${rel} was removed`);
    assert.ok(readFileSync(at).equals(Buffer.from(fixtureFiles("without")[rel], "utf8")), `${rel} was edited`);
  });
}

test("a store at version 3 reports a higher version after migrate()", async () => {
  const db = await storeAtVersion3();
  assert.equal(storedVersion(db), 3);
  const { migrate } = await load("src/store/migrate.js");
  await migrate(db);
  assert.ok(storedVersion(db) > 3, `the stored version is still ${storedVersion(db)}: no new migration ran`);
});

test("the stored row of an order that already existed has note \"\"", async () => {
  const db = await storeAtVersion3();
  await newApp(db);
  const row = db.get("orders", OLD_ORDER.id);
  assert.ok(row, "the order that already existed is gone");
  assert.equal(row.note, "", `the stored row has note ${JSON.stringify(row.note)}: the field was not written to the store`);
  assert.equal(row.total, OLD_ORDER.total);
});
