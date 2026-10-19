import test from "node:test";
import assert from "node:assert/strict";
import { parseOtherNumber } from "./otherNumber";

test("absent field leaves value untouched", () => {
  assert.equal(parseOtherNumber(undefined), undefined);
  assert.equal(parseOtherNumber({ email: "a@b.co" }), undefined);
});

test("blank or null clears", () => {
  assert.equal(parseOtherNumber({ other_number: "" }), null);
  assert.equal(parseOtherNumber({ other_number: "   " }), null);
  assert.equal(parseOtherNumber({ other_number: null }), null);
});

test("valid numbers are normalised to digits without trunk 0", () => {
  assert.equal(parseOtherNumber({ other_number: "024 123 4567" }), "241234567");
  assert.equal(parseOtherNumber({ other_number: "+233-24-123-4567" }), "233241234567");
});

test("invalid numbers are rejected", () => {
  assert.throws(() => parseOtherNumber({ other_number: "12ab" }), /valid other phone number/);
  assert.throws(() => parseOtherNumber({ other_number: "1234567890123456" }), /valid other phone number/);
});
