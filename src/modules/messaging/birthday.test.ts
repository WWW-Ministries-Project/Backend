import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, isBirthdayOn, ageOn, isBirthdayRunDue } from "./birthday";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));

test("localParts in Accra (UTC+0) and Lagos (UTC+1)", () => {
  assert.deepEqual(localParts(utc(2026, 10, 10, 23, 30), "Africa/Accra"), { date: "2026-10-10", year: 2026, month: 10, day: 10, minutes: 23 * 60 + 30 });
  assert.deepEqual(localParts(utc(2026, 10, 10, 23, 30), "Africa/Lagos"), { date: "2026-10-11", year: 2026, month: 10, day: 11, minutes: 30 });
});

test("isBirthdayOn matches month/day using UTC fields of DOB", () => {
  assert.equal(isBirthdayOn(utc(1990, 10, 10), { year: 2026, month: 10, day: 10 }), true);
  assert.equal(isBirthdayOn(utc(1990, 10, 11), { year: 2026, month: 10, day: 10 }), false);
});

test("Feb 29 birthdays fall on Feb 28 in non-leap years only", () => {
  const leapling = utc(2000, 2, 29);
  assert.equal(isBirthdayOn(leapling, { year: 2027, month: 2, day: 28 }), true);
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 2, day: 28 }), false);
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 2, day: 29 }), true);
});

test("ageOn", () => {
  assert.equal(ageOn(utc(1990, 10, 10), 2026), 36);
  assert.equal(ageOn(utc(2030, 1, 1), 2026), null);
});

test("isBirthdayRunDue: after send time, once per local day", () => {
  const settings = { birthday_send_time: "07:00", timezone: "Africa/Accra", last_birthday_run_date: null as string | null };
  assert.equal(isBirthdayRunDue(settings, utc(2026, 10, 10, 6, 59)), false);
  assert.equal(isBirthdayRunDue(settings, utc(2026, 10, 10, 7, 0)), true);
  assert.equal(isBirthdayRunDue({ ...settings, last_birthday_run_date: "2026-10-10" }, utc(2026, 10, 10, 9, 0)), false);
  assert.equal(isBirthdayRunDue({ ...settings, last_birthday_run_date: "2026-10-09" }, utc(2026, 10, 10, 15, 0)), true);
});
