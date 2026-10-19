import { appointment_status } from "@prisma/client";
import { AppointmentSettings } from "./appointment-settings";

/*
  Pure helpers for the appointments redesign: church-clock time maths,
  booking rules (pause, time off, notice, book-ahead), action state rules and
  history lines. No database access, so they are unit-tested directly.

  Appointment dates are stored as UTC midnight of the church-calendar day and
  times as "HH:MM" on the church clock. APPOINTMENTS_UTC_OFFSET_MINUTES
  (falling back to RIDES_UTC_OFFSET_MINUTES, default 0 for Ghana) converts
  them to real instants.
*/

export const APPOINTMENT_UTC_OFFSET_MINUTES = (() => {
  const raw =
    process.env.APPOINTMENTS_UTC_OFFSET_MINUTES ??
    process.env.RIDES_UTC_OFFSET_MINUTES;
  const parsed = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(parsed) ? parsed : 0;
})();

export const ALL_APPOINTMENT_STATUSES: appointment_status[] = [
  "PENDING",
  "CONFIRMED",
  "RESCHEDULED",
  "DECLINED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
];

/** Statuses whose slot no longer holds a place. */
export const RELEASED_STATUSES: appointment_status[] = ["CANCELLED", "DECLINED"];

export const DECLINE_REASONS = [
  "Not available then",
  "Better suited to someone else",
  "Outside my ministry area",
  "Other",
] as const;

export const REOPEN_WINDOW_MS = 10 * 60 * 1000;
export const OUTCOME_PROMPT_DELAY_MS = 2 * 60 * 60 * 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Minutes after midnight for "HH:MM", "H:MM", "HH:MM:SS" or "h:mm AM". Null when unreadable. */
export const parseClock = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** "YYYY-MM-DD" of a UTC-midnight date. */
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Parses "YYYY-MM-DD" to UTC midnight, or null when malformed / not a real day. */
export const parseIsoDay = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isoDay(date) === value.trim() ? date : null;
};

/** Today on the church clock, as "YYYY-MM-DD". */
export const churchTodayIso = (now: Date = new Date()): string =>
  isoDay(new Date(now.getTime() + APPOINTMENT_UTC_OFFSET_MINUTES * 60_000));

export const addDaysIso = (day: string, days: number): string => {
  const base = parseIsoDay(day);
  if (!base) return day;
  return isoDay(new Date(base.getTime() + days * 86_400_000));
};

/** The real instant of a church-clock day + "HH:MM". Null when the time is unreadable. */
export const slotInstant = (day: Date | string, clock: unknown): Date | null => {
  const base = typeof day === "string" ? parseIsoDay(day) : day;
  const minutes = parseClock(clock);
  if (!base || minutes === null) return null;
  const dayStart = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  return new Date(dayStart + (minutes - APPOINTMENT_UTC_OFFSET_MINUTES) * 60_000);
};

/** "Thu 22 Oct, 10:00 AM" */
export const formatSlotLabel = (day: Date | string, clock: unknown): string => {
  const base = typeof day === "string" ? parseIsoDay(day) : day;
  if (!base) return String(day);
  const datePart = `${DAYS[base.getUTCDay()]} ${base.getUTCDate()} ${MONTHS[base.getUTCMonth()]}`;
  const minutes = parseClock(clock);
  if (minutes === null) return datePart;
  const hours = Math.floor(minutes / 60);
  const mins = `${minutes % 60}`.padStart(2, "0");
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${datePart}, ${h12}:${mins} ${hours < 12 ? "AM" : "PM"}`;
};

/** "12 h", "3 d" — for history and reminder texts. */
export const formatWaited = (ms: number): string => {
  const hours = Math.max(0, Math.round(ms / 3_600_000));
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
};

export type BookingRuleInput = {
  personName: string;
  paused: boolean;
  timeOff: Array<{ from: string; to: string }>;
  settings: Pick<AppointmentSettings, "minNoticeHours" | "bookAheadDays">;
  date: string;
  startTime: string;
  now?: Date;
};

/**
 * Null when the slot may be booked, otherwise the toast-ready reason.
 * Order: paused, time off, minimum notice, book-ahead limit.
 */
export const bookingRuleViolation = (input: BookingRuleInput): string | null => {
  const now = input.now ?? new Date();
  const name = input.personName || "This person";

  if (input.paused) {
    return `${name} isn't taking new bookings right now.`;
  }

  if (input.timeOff.some((entry) => input.date >= entry.from && input.date <= entry.to)) {
    return `${name} is away on that day. Choose another day or someone else.`;
  }

  const start = slotInstant(input.date, input.startTime);
  if (start && start.getTime() < now.getTime() + input.settings.minNoticeHours * 3_600_000) {
    return `That time is too soon. Bookings need at least ${input.settings.minNoticeHours} hours' notice.`;
  }

  const lastDay = addDaysIso(churchTodayIso(now), input.settings.bookAheadDays);
  if (input.date > lastDay) {
    return `That date is too far ahead. Bookings open ${input.settings.bookAheadDays} days in advance.`;
  }

  return null;
};

export const APPOINTMENT_ACTIONS = [
  "accept",
  "reopen",
  "suggest",
  "decline",
  "cancel",
  "complete",
  "no_show",
  "remind",
  "reassign",
  "confirm_proposal",
] as const;
export type AppointmentAction = (typeof APPOINTMENT_ACTIONS)[number];

export const ACTION_RULES: Record<
  AppointmentAction,
  { from: appointment_status[]; manageOnly: boolean }
> = {
  accept: { from: ["PENDING"], manageOnly: false },
  reopen: { from: ["CONFIRMED"], manageOnly: false },
  suggest: { from: ["PENDING", "CONFIRMED"], manageOnly: false },
  decline: { from: ["PENDING"], manageOnly: false },
  cancel: { from: ["PENDING", "CONFIRMED", "RESCHEDULED"], manageOnly: false },
  complete: { from: ["CONFIRMED"], manageOnly: false },
  no_show: { from: ["CONFIRMED"], manageOnly: false },
  remind: { from: ["PENDING"], manageOnly: true },
  reassign: { from: ["PENDING", "RESCHEDULED"], manageOnly: true },
  confirm_proposal: { from: ["RESCHEDULED"], manageOnly: true },
};

export const isAppointmentAction = (value: unknown): value is AppointmentAction =>
  typeof value === "string" && (APPOINTMENT_ACTIONS as readonly string[]).includes(value);

const STATUS_MESSAGES: Record<appointment_status, string> = {
  PENDING: "This request is still waiting for a reply.",
  CONFIRMED: "This appointment is already confirmed.",
  RESCHEDULED: "A new time has already been suggested for this appointment.",
  DECLINED: "This request has already been declined.",
  CANCELLED: "This appointment was cancelled.",
  COMPLETED: "This appointment is already marked as completed.",
  NO_SHOW: "This appointment is already marked as a no-show.",
};

/**
 * Null when `action` may run on a booking in this state, otherwise the
 * toast-ready reason. Time-based rules (reopen window, outcome after the end)
 * are checked here too.
 */
export const actionStateViolation = (
  action: AppointmentAction,
  booking: {
    status: appointment_status;
    acceptedAt?: Date | null;
    date: Date;
    endTime: string;
    startTime: string;
  },
  now: Date = new Date(),
): string | null => {
  const { status } = booking;
  const allowed = ACTION_RULES[action].from.includes(status);

  if (!allowed) {
    if (
      (action === "accept" || action === "decline" || action === "remind") &&
      (status === "CONFIRMED" || status === "RESCHEDULED" || status === "DECLINED")
    ) {
      return "This request has already been answered.";
    }
    if (action === "confirm_proposal") {
      return status === "CANCELLED"
        ? STATUS_MESSAGES.CANCELLED
        : "There's no suggested time to confirm on this appointment.";
    }
    if (action === "reopen" && status === "PENDING") {
      return STATUS_MESSAGES.PENDING;
    }
    if (action === "cancel") {
      return status === "CANCELLED"
        ? "This appointment is already cancelled."
        : "This appointment can't be cancelled any more.";
    }
    return STATUS_MESSAGES[status];
  }

  if (action === "reopen") {
    const acceptedAt = booking.acceptedAt?.getTime();
    if (!acceptedAt || now.getTime() - acceptedAt > REOPEN_WINDOW_MS) {
      return "It's too late to undo. Suggest a new time or cancel instead.";
    }
  }

  if (action === "complete" || action === "no_show") {
    const end = slotInstant(booking.date, booking.endTime) ?? slotInstant(booking.date, booking.startTime);
    if (end && end.getTime() > now.getTime()) {
      return "You can record how it went once the appointment has ended.";
    }
  }

  return null;
};

export type HistoryTone = "neutral" | "info" | "success" | "warning" | "danger";
export type HistoryEntry = { at: string; text: string; tone: HistoryTone };

const HISTORY_TONES: HistoryTone[] = ["neutral", "info", "success", "warning", "danger"];

/** Reads a stored history column defensively: always an array of valid entries. */
export const readHistory = (value: unknown): HistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      at: String(entry.at ?? ""),
      text: String(entry.text ?? ""),
      tone: HISTORY_TONES.includes(entry.tone as HistoryTone) ? (entry.tone as HistoryTone) : "neutral",
    }))
    .filter((entry) => entry.at && entry.text);
};

export const appendHistory = (
  existing: unknown,
  text: string,
  tone: HistoryTone = "neutral",
  at: Date = new Date(),
): HistoryEntry[] => [...readHistory(existing), { at: at.toISOString(), text, tone }];

/**
 * Who acted, for history lines. The person booked acting for themselves is
 * just their name; anyone else acting on the booking is "Admin for Attendee".
 */
export const actorLabel = (args: {
  actorId: number;
  actorName: string;
  attendeeId: number;
  attendeeName: string;
}): string =>
  args.actorId === args.attendeeId
    ? args.attendeeName
    : `${args.actorName} for ${args.attendeeName}`;
