import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDepartmentPositionId,
  normalizeDepartmentPositions,
} from "./departmentPositionUtils";
import { InputValidationError } from "../../utils/custom-error-handlers";

test("normalizeDepartmentPositionId maps empty values to null, never NaN", () => {
  for (const value of [null, undefined, "", 0, "0", "abc", -1, 1.5]) {
    assert.equal(normalizeDepartmentPositionId(value), null);
  }
  assert.equal(normalizeDepartmentPositionId("7"), 7);
  assert.equal(normalizeDepartmentPositionId(7), 7);
});

test("normalizeDepartmentPositions keeps dates and nulls positions", () => {
  assert.deepEqual(
    normalizeDepartmentPositions([
      { department_id: "3", position_id: "", start_date: "2026-02-01", end_date: null },
      { department_id: 4, position_id: 9 },
    ]),
    [
      { department_id: 3, position_id: null, start_date: new Date("2026-02-01"), end_date: null },
      { department_id: 4, position_id: 9, start_date: null, end_date: null },
    ],
  );
  assert.deepEqual(normalizeDepartmentPositions([]), []);
});

test("normalizeDepartmentPositions rejects bad or duplicate departments", () => {
  assert.throws(() => normalizeDepartmentPositions([{ department_id: "" }]), InputValidationError);
  assert.throws(
    () => normalizeDepartmentPositions([{ department_id: 2 }, { department_id: "2" }]),
    InputValidationError,
  );
});
