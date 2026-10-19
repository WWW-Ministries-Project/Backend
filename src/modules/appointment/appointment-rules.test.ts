import test from "node:test";
import assert from "node:assert/strict";
import {
  actionStateViolation,
  actorLabel,
  appendHistory,
  bookingRuleViolation,
  formatSlotLabel,
  formatWaited,
  parseClock,
  readHistory,
  slotInstant,
} from "./appointment-rules";
import {
  DEFAULT_APPOINTMENT_SETTINGS,
  applySettingsPatch,
  mergeStoredMatrix,
} from "./appointment-settings";
import { parseActionBody } from "./appointment-actions";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("parseClock reads 24h and 12h times", () => {
  assert.equal(parseClock("09:30"), 570);
  assert.equal(parseClock("9:30"), 570);
  assert.equal(parseClock("12:00 AM"), 0);
  assert.equal(parseClock("1:15 pm"), 795);
  assert.equal(parseClock("25:00"), null);
  assert.equal(parseClock("noon"), null);
});

test("slotInstant and formatSlotLabel", () => {
  assert.equal(slotInstant("2026-10-22", "10:00")?.toISOString(), "2026-10-22T10:00:00.000Z");
  assert.equal(formatSlotLabel("2026-10-22", "10:00"), "Thu 22 Oct, 10:00 AM");
  assert.equal(formatSlotLabel(day("2026-10-22"), "14:30"), "Thu 22 Oct, 2:30 PM");
  assert.equal(formatWaited(12 * 3_600_000), "12 h");
  assert.equal(formatWaited(72 * 3_600_000), "3 d");
});

test("bookingRuleViolation: paused, time off, notice, book-ahead", () => {
  const now = new Date("2026-10-19T08:00:00.000Z");
  const base = {
    personName: "Pastor Samuel Addo",
    paused: false,
    timeOff: [] as Array<{ from: string; to: string }>,
    settings: { minNoticeHours: 12, bookAheadDays: 60 },
    date: "2026-10-22",
    startTime: "10:00",
    now,
  };
  assert.equal(bookingRuleViolation(base), null);
  assert.match(bookingRuleViolation({ ...base, paused: true })!, /isn't taking new bookings/);
  assert.match(
    bookingRuleViolation({ ...base, timeOff: [{ from: "2026-10-21", to: "2026-10-22" }] })!,
    /away on that day/,
  );
  assert.match(
    bookingRuleViolation({ ...base, date: "2026-10-19", startTime: "15:00" })!,
    /too soon/,
  );
  assert.match(bookingRuleViolation({ ...base, date: "2026-12-30" })!, /too far ahead/);
});

test("actionStateViolation follows the contract's state table", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");
  const booking = (status: any, extra: any = {}) => ({
    status,
    date: day("2026-10-22"),
    startTime: "10:00",
    endTime: "10:30",
    acceptedAt: null,
    ...extra,
  });
  assert.equal(actionStateViolation("accept", booking("PENDING"), now), null);
  assert.equal(
    actionStateViolation("accept", booking("CONFIRMED"), now),
    "This request has already been answered.",
  );
  assert.equal(actionStateViolation("suggest", booking("CONFIRMED"), now), null);
  assert.ok(actionStateViolation("decline", booking("RESCHEDULED"), now));
  assert.equal(actionStateViolation("cancel", booking("RESCHEDULED"), now), null);
  assert.ok(actionStateViolation("cancel", booking("COMPLETED"), now));
  assert.equal(actionStateViolation("complete", booking("CONFIRMED"), now), null);
  assert.match(
    actionStateViolation("no_show", booking("CONFIRMED", { endTime: "13:00" }), now)!,
    /once the appointment has ended/,
  );
  assert.equal(
    actionStateViolation(
      "reopen",
      booking("CONFIRMED", { acceptedAt: new Date(now.getTime() - 5 * 60_000) }),
      now,
    ),
    null,
  );
  assert.match(
    actionStateViolation(
      "reopen",
      booking("CONFIRMED", { acceptedAt: new Date(now.getTime() - 11 * 60_000) }),
      now,
    )!,
    /too late to undo/,
  );
  assert.equal(actionStateViolation("reassign", booking("RESCHEDULED"), now), null);
  assert.ok(actionStateViolation("confirm_proposal", booking("PENDING"), now));
});

test("history helpers and actor label", () => {
  const at = new Date("2026-10-19T08:00:00.000Z");
  const history = appendHistory(null, "Requested by Yaw Boateng in the app", "neutral", at);
  assert.deepEqual(history, [
    { at: "2026-10-19T08:00:00.000Z", text: "Requested by Yaw Boateng in the app", tone: "neutral" },
  ]);
  assert.deepEqual(readHistory([{ at: "x", text: "y", tone: "loud" }, "junk"]), [
    { at: "x", text: "y", tone: "neutral" },
  ]);
  assert.equal(
    actorLabel({ actorId: 2, actorName: "Kwame Mensah", attendeeId: 9, attendeeName: "Pastor Samuel Addo" }),
    "Kwame Mensah for Pastor Samuel Addo",
  );
  assert.equal(
    actorLabel({ actorId: 9, actorName: "Pastor Samuel Addo", attendeeId: 9, attendeeName: "Pastor Samuel Addo" }),
    "Pastor Samuel Addo",
  );
});

test("parseActionBody validates each action's fields", () => {
  assert.deepEqual(parseActionBody({ action: "accept" }), { action: "accept" });
  assert.throws(() => parseActionBody({ action: "explode" }), /Choose an action/);
  assert.throws(() => parseActionBody({ action: "decline", reason: "Busy" }), /Choose a reason/);
  assert.equal(
    (parseActionBody({ action: "decline", reason: "Other", message: "  " }) as any).message,
    null,
  );
  assert.throws(
    () => parseActionBody({ action: "suggest", date: "2026-10-22", startTime: "11:00", endTime: "10:00" }),
    /end time has to be after/,
  );
  assert.throws(() => parseActionBody({ action: "reassign" }), /reassign the request/);
});

test("settings: defaults, partial PUT, allowed values and channels", () => {
  const next = applySettingsPatch(DEFAULT_APPOINTMENT_SETTINGS, {
    replyDeadlineHours: 12,
    notifications: { declined: { admins: ["sms", "email", "email"] } },
  });
  assert.equal(next.replyDeadlineHours, 12);
  assert.equal(next.minNoticeHours, 12);
  assert.deepEqual(next.notifications.declined, {
    attendee: [],
    requester: ["push", "sms"],
    admins: ["sms", "email"],
  });
  // Defaults untouched
  assert.equal(DEFAULT_APPOINTMENT_SETTINGS.replyDeadlineHours, 24);
  assert.deepEqual(DEFAULT_APPOINTMENT_SETTINGS.notifications.declined.admins, ["email"]);

  assert.throws(() => applySettingsPatch(DEFAULT_APPOINTMENT_SETTINGS, { bookAheadDays: 45 }), /14, 30, 60 or 90 days/);
  assert.throws(
    () => applySettingsPatch(DEFAULT_APPOINTMENT_SETTINGS, { notifications: { new: { attendee: ["fax"] } } }),
    /isn't a channel/,
  );
  assert.throws(
    () => applySettingsPatch(DEFAULT_APPOINTMENT_SETTINGS, { notifications: { party: {} } }),
    /isn't an appointment event/,
  );
  assert.equal(applySettingsPatch(DEFAULT_APPOINTMENT_SETTINGS, { unansweredAfterHours: 0 }).unansweredAfterHours, 0);

  const merged = mergeStoredMatrix({ nudge: { attendee: ["email", "bogus"] } });
  assert.deepEqual(merged.nudge.attendee, ["email"]);
  assert.deepEqual(merged.overdue.admins, ["push", "email"]);
});
