import { test } from "node:test";
import assert from "node:assert/strict";
import { callReaches, normalizeRoutePath, routeSegments } from "../route-path.js";

test("every variable spelling folds to {}, and origin, query and trailing slash go", () => {
  assert.equal(normalizeRoutePath("/items/:id/"), "/items/{}");
  assert.equal(normalizeRoutePath("/items/{itemId}"), "/items/{}");
  assert.equal(normalizeRoutePath("/items/{id:\\d+}"), "/items/{}");
  assert.equal(normalizeRoutePath("/items/${}"), "/items/{}");
  assert.equal(normalizeRoutePath("https://api.example.com/v1//items?key=x#y"), "/v1/items");
  assert.equal(normalizeRoutePath("https://api.example.com"), "/");
  assert.equal(normalizeRoutePath("items"), null);
  assert.equal(normalizeRoutePath(42), null);
  assert.deepEqual(routeSegments("/"), []);
});

test("a call's literal reaches an endpoint's variable, never the other way round", () => {
  assert.equal(callReaches("/items/42", "/items/{}"), true);
  assert.equal(callReaches("/items/{}", "/items/{}"), true);
  assert.equal(callReaches("/items/{}", "/items/export"), false, "some id is no evidence of /items/export");
  assert.equal(callReaches("/items", "/items/{}"), false);
});
