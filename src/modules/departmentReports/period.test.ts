import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultPeriodKey,
  dueDate,
  isoDate,
  parsePeriod,
  periodOptions,
  previousRange,
  trendBuckets,
  weekBuckets,
  yoyRange,
} from "./period";

test("monthly periods cover the calendar month", () => {
  const range = parsePeriod("MONTHLY", "2026-09");
  assert.equal(isoDate(range.from), "2026-09-01");
  assert.equal(isoDate(range.to), "2026-10-01");
  assert.equal(range.label, "September 2026");
  assert.equal(previousRange(range).label, "Aug 2026");
  assert.equal(yoyRange(range).label, "Sep 2025");
  assert.equal(isoDate(dueDate(range)), "2026-10-05");
});

test("ISO weeks start on Monday", () => {
  const range = parsePeriod("WEEKLY", "2026-W42");
  assert.equal(isoDate(range.from), "2026-10-12");
  assert.equal(isoDate(range.to), "2026-10-19");
  assert.equal(isoDate(previousRange(range).from), "2026-10-05");
});

test("weeks spanning a year boundary resolve to the right ISO year", () => {
  // 1 Jan 2027 is a Friday, so it belongs to ISO week 53 of 2026.
  const range = parsePeriod("WEEKLY", "2026-W53");
  assert.equal(isoDate(range.from), "2026-12-28");
  assert.equal(defaultPeriodKey("WEEKLY", new Date("2027-01-06T12:00:00Z")), "2026-W53");
});

test("quarters and years", () => {
  const q = parsePeriod("QUARTERLY", "2026-Q3");
  assert.equal(isoDate(q.from), "2026-07-01");
  assert.equal(isoDate(q.to), "2026-10-01");
  assert.equal(previousRange(q).label, "Q2 2026");
  const y = parsePeriod("ANNUAL", "2025");
  assert.equal(isoDate(y.to), "2026-01-01");
});

test("custom ranges include the end date and compare to the span before", () => {
  const range = parsePeriod("CUSTOM", "2026-08-01_2026-09-30");
  assert.equal(isoDate(range.to), "2026-10-01");
  assert.equal(isoDate(previousRange(range).from), "2026-06-01");
  assert.throws(() => parsePeriod("CUSTOM", "2026-09-30_2026-08-01"));
});

test("the default period is the last completed one", () => {
  const now = new Date("2026-10-21T09:00:00Z");
  assert.equal(defaultPeriodKey("MONTHLY", now), "2026-09");
  assert.equal(defaultPeriodKey("QUARTERLY", now), "2026-Q3");
  assert.equal(defaultPeriodKey("ANNUAL", now), "2025");
  const options = periodOptions("MONTHLY", now);
  assert.equal(options[0].key, "2026-09");
  assert.equal(options[1].key, "2026-10");
  assert.equal(options[1].in_progress, true);
});

test("trend buckets end with the selected period", () => {
  const monthly = trendBuckets(parsePeriod("MONTHLY", "2026-09"));
  assert.equal(monthly.length, 12);
  assert.equal(monthly[11].label, "Sep");
  assert.equal(isoDate(monthly[0].from), "2025-10-01");
  const weekly = trendBuckets(parsePeriod("WEEKLY", "2026-W42"));
  assert.equal(weekly.length, 13);
  assert.equal(isoDate(weekly[12].from), "2026-10-12");
  assert.equal(weekBuckets(parsePeriod("MONTHLY", "2026-09")).length, 5);
  // ANNUAL keeps the latest 26 weeks, and drops weeks that have not started.
  const annual = weekBuckets(parsePeriod("ANNUAL", "2025"));
  assert.equal(annual.length, 26);
  assert.equal(isoDate(annual[25].from), "2025-12-29");
  const inProgress = weekBuckets(parsePeriod("ANNUAL", "2026"), new Date("2026-10-21T09:00:00Z"));
  assert.equal(isoDate(inProgress[inProgress.length - 1].from), "2026-10-19");
});

test("malformed keys are rejected", () => {
  assert.throws(() => parsePeriod("MONTHLY", "2026-9"));
  assert.throws(() => parsePeriod("DAILY", "2026-09-01"));
});
