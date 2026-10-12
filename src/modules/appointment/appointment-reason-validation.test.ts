import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateLabel,
  normalizeReasonDescription,
  normalizeReasonLabel,
  parseReasonCreate,
  parseReasonId,
  parseReasonUpdate,
  parseReorderIds,
  serializeReason,
} from "./appointment-reason-validation";

test("normalizeReasonLabel trims and collapses whitespace", () => {
  assert.equal(normalizeReasonLabel("  Marriage   &  family "), "Marriage & family");
});

test("normalizeReasonLabel enforces 2-120 chars and a string", () => {
  assert.throws(() => normalizeReasonLabel(" a "), /at least 2/);
  assert.throws(() => normalizeReasonLabel(""), /at least 2/);
  assert.throws(() => normalizeReasonLabel(undefined), /required/);
  assert.throws(() => normalizeReasonLabel(42), /required/);
  assert.equal(normalizeReasonLabel("ab"), "ab");
  assert.equal(normalizeReasonLabel("x".repeat(120)).length, 120);
  assert.throws(() => normalizeReasonLabel("x".repeat(121)), /at most 120/);
});

test("normalizeReasonDescription: optional, trimmed, max 255", () => {
  assert.equal(normalizeReasonDescription(undefined), null);
  assert.equal(normalizeReasonDescription(null), null);
  assert.equal(normalizeReasonDescription("   "), null);
  assert.equal(normalizeReasonDescription(" Talk it over "), "Talk it over");
  assert.equal(normalizeReasonDescription("d".repeat(255))?.length, 255);
  assert.throws(() => normalizeReasonDescription("d".repeat(256)), /at most 255/);
  assert.throws(() => normalizeReasonDescription(5), /text/);
});

test("parseReasonCreate requires label, defaults is_active to true", () => {
  assert.deepEqual(parseReasonCreate({ label: " Prayer " }), {
    label: "Prayer",
    description: null,
    is_active: true,
  });
  assert.equal(parseReasonCreate({ label: "Prayer", is_active: false }).is_active, false);
  assert.throws(() => parseReasonCreate({}), /required/);
  assert.throws(() => parseReasonCreate(null), /required/);
  assert.throws(() => parseReasonCreate({ label: "Prayer", is_active: "maybe" }), /boolean/);
});

test("parseReasonUpdate returns only provided keys and rejects empty bodies", () => {
  assert.deepEqual(parseReasonUpdate({ is_active: false }), { is_active: false });
  assert.deepEqual(parseReasonUpdate({ description: "" }), { description: null });
  assert.deepEqual(parseReasonUpdate({ label: " New " }), { label: "New" });
  assert.throws(() => parseReasonUpdate({}), /at least one/);
  assert.throws(() => parseReasonUpdate({ label: "x" }), /at least 2/);
});

test("parseReasonId", () => {
  assert.equal(parseReasonId("7"), 7);
  assert.throws(() => parseReasonId("0"));
  assert.throws(() => parseReasonId("abc"));
  assert.throws(() => parseReasonId("1.5"));
});

test("parseReorderIds: non-empty, positive ints, no duplicates", () => {
  assert.deepEqual(parseReorderIds({ ids: [3, "1", 2] }), [3, 1, 2]);
  assert.throws(() => parseReorderIds({ ids: [] }), /non-empty/);
  assert.throws(() => parseReorderIds({}), /non-empty/);
  assert.throws(() => parseReorderIds({ ids: [1, 0] }), /positive/);
  assert.throws(() => parseReorderIds({ ids: [1, ""] }), /positive/);
  assert.throws(() => parseReorderIds({ ids: [1, 1.5] }), /positive/);
  assert.throws(() => parseReorderIds({ ids: [1, 1] }), /duplicates/);
  assert.throws(
    () => parseReorderIds({ ids: Array.from({ length: 501 }, (_, i) => i + 1) }),
    /at most 500/,
  );
});

test("findDuplicateLabel is case-insensitive and ignores the edited row", () => {
  const rows = [
    { id: 1, label: "Marriage & family" },
    { id: 2, label: "Spiritual guidance" },
  ];
  assert.equal(findDuplicateLabel("marriage & FAMILY", rows), true);
  assert.equal(findDuplicateLabel("Marriage & Family", rows, 1), false);
  assert.equal(findDuplicateLabel("Marriage & Family", rows, 2), true);
  assert.equal(findDuplicateLabel("Ministry & serving", rows), false);
});

test("serializeReason emits snake_case with ISO dates", () => {
  const at = new Date("2026-10-12T12:00:00.000Z");
  assert.deepEqual(
    serializeReason({
      id: 1,
      label: "Prayer",
      description: null,
      sort_order: 0,
      is_active: true,
      created_at: at,
      updated_at: at,
    }),
    {
      id: 1,
      label: "Prayer",
      description: null,
      sort_order: 0,
      is_active: true,
      created_at: "2026-10-12T12:00:00.000Z",
      updated_at: "2026-10-12T12:00:00.000Z",
    },
  );
});
