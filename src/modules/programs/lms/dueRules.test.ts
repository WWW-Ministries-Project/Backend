import test from "node:test";
import assert from "node:assert/strict";
import { describeDueRule, dueDateFromRule, parseDueRule } from "./dueRules";

// 2026-09-05 is a Saturday.
const START = "2026-09-05T00:00:00.000Z";

test("parseDueRule accepts day and after rules", () => {
  assert.deepEqual(parseDueRule({ week: 2, mode: "day", day: "Sun" }), { week: 2, mode: "day", day: "Sun" });
  assert.deepEqual(parseDueRule({ week: "4", mode: "after", days: 14 }), { week: 4, mode: "after", days: 14 });
});

test("parseDueRule rejects invalid input", () => {
  assert.equal(parseDueRule(null), null);
  assert.equal(parseDueRule({ week: 0, mode: "day" }), null);
  assert.equal(parseDueRule({ week: 2, mode: "after", days: -1 }), null);
  assert.equal(parseDueRule([1]), null);
});

test("parseDueRule defaults an unknown weekday to Sunday", () => {
  assert.deepEqual(parseDueRule({ week: 1, mode: "day", day: "Xyz" }), { week: 1, mode: "day", day: "Sun" });
});

test("day rule lands on that weekday of week N at 23:59 UTC", () => {
  // Week 1 starts Sat Sep 5; its Sunday is Sep 6.
  assert.equal(
    dueDateFromRule(START, { week: 1, mode: "day", day: "Sun" })?.toISOString(),
    "2026-09-06T23:59:00.000Z",
  );
  // Week 2 starts Sat Sep 12; the same Saturday is due.
  assert.equal(
    dueDateFromRule(START, { week: 2, mode: "day", day: "Sat" })?.toISOString(),
    "2026-09-12T23:59:00.000Z",
  );
  // Week 2's Friday comes after its Saturday start: Fri Sep 18.
  assert.equal(
    dueDateFromRule(START, { week: 2, mode: "day", day: "Fri" })?.toISOString(),
    "2026-09-18T23:59:00.000Z",
  );
});

test("after rule counts days from the start of week N", () => {
  assert.equal(
    dueDateFromRule(START, { week: 4, mode: "after", days: 14 })?.toISOString(),
    "2026-10-10T23:59:00.000Z",
  );
});

test("dueDateFromRule returns null without a rule or a valid start", () => {
  assert.equal(dueDateFromRule(START, null), null);
  assert.equal(dueDateFromRule("not a date", { week: 1, mode: "day", day: "Sun" }), null);
  assert.equal(dueDateFromRule(null, { week: 1, mode: "day", day: "Sun" }), null);
});

test("describeDueRule", () => {
  assert.equal(describeDueRule({ week: 2, mode: "day", day: "Sun" }), "Week 2 · Sun 23:59");
  assert.equal(describeDueRule({ week: 4, mode: "after", days: 14 }), "14 days after week 4 opens");
  assert.equal(describeDueRule(null), "No rule");
});
