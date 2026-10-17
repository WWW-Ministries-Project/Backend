import test from "node:test";
import assert from "node:assert/strict";
import { isSessionActive } from "./authorization";

test("isSessionActive", () => {
  assert.equal(isSessionActive(null), false);
  assert.equal(isSessionActive({ currentUser: { is_active: false } }), false);
  assert.equal(isSessionActive({ currentUser: { is_active: true } }), true);
  assert.equal(isSessionActive({ currentUser: {} }), true);
});
