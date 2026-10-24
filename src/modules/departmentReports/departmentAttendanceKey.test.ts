import assert from "node:assert/strict";
import test from "node:test";

import { deptAttKey, dueOnDayAfter, parseDeptAttKey } from "./departmentAttendanceKey";
import { isoDate, parsePeriod } from "./period";

test("parseDeptAttKey reads dept_att keys only", () => {
  assert.equal(parseDeptAttKey("dept_att:12"), 12);
  assert.equal(parseDeptAttKey(deptAttKey(7)), 7);
  assert.equal(parseDeptAttKey("dept_att:0"), null);
  assert.equal(parseDeptAttKey("dept_att:"), null);
  assert.equal(parseDeptAttKey("dept_att:12x"), null);
  assert.equal(parseDeptAttKey("attendance"), null);
  assert.equal(parseDeptAttKey(undefined), null);
});

test("deptAttKey fits the VARCHAR(32) report_key column", () => {
  assert.ok(deptAttKey(2_147_483_647).length <= 32);
});

test("dueOnDayAfter lands on the configured day of the next month", () => {
  const sep = parsePeriod("MONTHLY", "2026-09");
  assert.equal(isoDate(dueOnDayAfter(sep, 5)), "2026-10-05");
  assert.equal(isoDate(dueOnDayAfter(sep, 1)), "2026-10-01");
  assert.equal(isoDate(dueOnDayAfter(parsePeriod("MONTHLY", "2026-12"), 14)), "2027-01-14");
});
