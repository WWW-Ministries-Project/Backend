import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

/*
  Appointment rules and the notification matrix (GET/PUT /appointment/settings).
  Stored as one row (id = 1) in appointment_settings; until an admin saves,
  the defaults below apply. Validation is pure so it can be unit-tested.
*/

export const APPOINTMENT_CHANNELS = ["push", "sms", "email"] as const;
export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

export const APPOINTMENT_AUDIENCES = ["attendee", "requester", "admins"] as const;
export type AppointmentAudience = (typeof APPOINTMENT_AUDIENCES)[number];

export const APPOINTMENT_EVENTS = [
  "new",
  "nudge",
  "overdue",
  "accepted",
  "suggested",
  "declined",
  "cancelled",
  "reminder",
  "outcome",
] as const;
export type AppointmentEvent = (typeof APPOINTMENT_EVENTS)[number];

export type AppointmentNotificationMatrix = Record<
  AppointmentEvent,
  Record<AppointmentAudience, AppointmentChannel[]>
>;

export type AppointmentSettings = {
  replyDeadlineHours: number;
  unansweredAfterHours: number;
  minNoticeHours: number;
  bookAheadDays: number;
  reminderHours: number;
  cancelCutoffHours: number;
  notifications: AppointmentNotificationMatrix;
};

type NumericSettingKey = Exclude<keyof AppointmentSettings, "notifications">;

export const ALLOWED_SETTING_VALUES: Record<NumericSettingKey, number[]> = {
  replyDeadlineHours: [4, 12, 24, 48],
  unansweredAfterHours: [0, 48, 72],
  minNoticeHours: [2, 12, 24, 48],
  bookAheadDays: [14, 30, 60, 90],
  reminderHours: [2, 24, 48],
  cancelCutoffHours: [2, 12, 24],
};

const SETTING_LABELS: Record<NumericSettingKey, { label: string; unit: string }> = {
  replyDeadlineHours: { label: "Reply deadline", unit: "hours" },
  unansweredAfterHours: { label: "Unanswered after", unit: "hours" },
  minNoticeHours: { label: "Minimum notice", unit: "hours" },
  bookAheadDays: { label: "Book up to", unit: "days" },
  reminderHours: { label: "Reminder", unit: "hours" },
  cancelCutoffHours: { label: "Cancel cutoff", unit: "hours" },
};

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  replyDeadlineHours: 24,
  unansweredAfterHours: 72,
  minNoticeHours: 12,
  bookAheadDays: 60,
  reminderHours: 24,
  cancelCutoffHours: 12,
  notifications: {
    new: { attendee: ["push", "sms"], requester: ["push"], admins: [] },
    nudge: { attendee: ["push", "sms"], requester: [], admins: [] },
    overdue: { attendee: ["push"], requester: ["push"], admins: ["push", "email"] },
    accepted: { attendee: [], requester: ["push", "sms"], admins: [] },
    suggested: { attendee: [], requester: ["push", "sms"], admins: [] },
    declined: { attendee: [], requester: ["push", "sms"], admins: ["email"] },
    cancelled: { attendee: ["push", "sms"], requester: ["push", "sms"], admins: [] },
    reminder: { attendee: ["push"], requester: ["push", "sms"], admins: [] },
    outcome: { attendee: ["push"], requester: [], admins: [] },
  },
};

const cloneMatrix = (
  matrix: AppointmentNotificationMatrix,
): AppointmentNotificationMatrix =>
  JSON.parse(JSON.stringify(matrix)) as AppointmentNotificationMatrix;

const joinOr = (values: Array<string | number>) =>
  values.length <= 1
    ? values.join("")
    : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A channel list, de-duplicated and in canonical order. Throws on unknown values. */
export const parseChannelList = (
  value: unknown,
  where: string,
): AppointmentChannel[] => {
  if (!Array.isArray(value)) {
    throw new InputValidationError(
      `Channels for ${where} have to be a list of push, sms or email.`,
    );
  }
  for (const entry of value) {
    if (!APPOINTMENT_CHANNELS.includes(entry as AppointmentChannel)) {
      throw new InputValidationError(
        `"${String(entry)}" isn't a channel. Use push, sms or email.`,
      );
    }
  }
  return APPOINTMENT_CHANNELS.filter((channel) => value.includes(channel));
};

/**
 * Merges a stored (possibly partial or stale) matrix over the defaults,
 * dropping anything unknown. Never throws: bad stored data falls back.
 */
export const mergeStoredMatrix = (stored: unknown): AppointmentNotificationMatrix => {
  const matrix = cloneMatrix(DEFAULT_APPOINTMENT_SETTINGS.notifications);
  if (!isPlainObject(stored)) return matrix;
  for (const event of APPOINTMENT_EVENTS) {
    const row = stored[event];
    if (!isPlainObject(row)) continue;
    for (const audience of APPOINTMENT_AUDIENCES) {
      const channels = row[audience];
      if (!Array.isArray(channels)) continue;
      matrix[event][audience] = APPOINTMENT_CHANNELS.filter((channel) =>
        channels.includes(channel),
      );
    }
  }
  return matrix;
};

/**
 * Validates a PUT body (any subset) and returns the full next settings.
 * Throws InputValidationError with a toast-ready message on bad values.
 */
export const applySettingsPatch = (
  current: AppointmentSettings,
  patch: unknown,
): AppointmentSettings => {
  if (!isPlainObject(patch)) {
    throw new InputValidationError("Send the settings to change as an object.");
  }

  const next: AppointmentSettings = {
    ...current,
    notifications: cloneMatrix(current.notifications),
  };

  for (const key of Object.keys(ALLOWED_SETTING_VALUES) as NumericSettingKey[]) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    const allowed = ALLOWED_SETTING_VALUES[key];
    if (!Number.isInteger(value) || !allowed.includes(value)) {
      const { label, unit } = SETTING_LABELS[key];
      throw new InputValidationError(
        `${label} has to be ${joinOr(allowed)} ${unit}.`,
      );
    }
    next[key] = value;
  }

  if (patch.notifications !== undefined) {
    if (!isPlainObject(patch.notifications)) {
      throw new InputValidationError(
        "Notifications have to be grouped by event, then by who receives them.",
      );
    }
    for (const [event, row] of Object.entries(patch.notifications)) {
      if (!APPOINTMENT_EVENTS.includes(event as AppointmentEvent)) {
        throw new InputValidationError(`"${event}" isn't an appointment event.`);
      }
      if (!isPlainObject(row)) {
        throw new InputValidationError(
          `Notifications for "${event}" have to list attendee, requester or admins.`,
        );
      }
      for (const [audience, channels] of Object.entries(row)) {
        if (!APPOINTMENT_AUDIENCES.includes(audience as AppointmentAudience)) {
          throw new InputValidationError(
            `"${audience}" isn't a recipient. Use attendee, requester or admins.`,
          );
        }
        next.notifications[event as AppointmentEvent][
          audience as AppointmentAudience
        ] = parseChannelList(channels, `${event} → ${audience}`);
      }
    }
  }

  return next;
};

const SETTINGS_ROW_ID = 1;

const fromRow = (row: {
  reply_deadline_hours: number;
  unanswered_after_hours: number;
  min_notice_hours: number;
  book_ahead_days: number;
  reminder_hours: number;
  cancel_cutoff_hours: number;
  notifications: Prisma.JsonValue | null;
}): AppointmentSettings => ({
  replyDeadlineHours: row.reply_deadline_hours,
  unansweredAfterHours: row.unanswered_after_hours,
  minNoticeHours: row.min_notice_hours,
  bookAheadDays: row.book_ahead_days,
  reminderHours: row.reminder_hours,
  cancelCutoffHours: row.cancel_cutoff_hours,
  notifications: mergeStoredMatrix(row.notifications),
});

export const AppointmentSettingsService = {
  async get(): Promise<AppointmentSettings> {
    const row = await prisma.appointment_settings.findUnique({
      where: { id: SETTINGS_ROW_ID },
    });
    if (!row) {
      return {
        ...DEFAULT_APPOINTMENT_SETTINGS,
        notifications: cloneMatrix(DEFAULT_APPOINTMENT_SETTINGS.notifications),
      };
    }
    return fromRow(row);
  },

  async update(patch: unknown, actorId?: number | null): Promise<AppointmentSettings> {
    const current = await AppointmentSettingsService.get();
    const next = applySettingsPatch(current, patch);
    const data = {
      reply_deadline_hours: next.replyDeadlineHours,
      unanswered_after_hours: next.unansweredAfterHours,
      min_notice_hours: next.minNoticeHours,
      book_ahead_days: next.bookAheadDays,
      reminder_hours: next.reminderHours,
      cancel_cutoff_hours: next.cancelCutoffHours,
      notifications: next.notifications as unknown as Prisma.InputJsonValue,
      updated_by: actorId ?? null,
    };
    const saved = await prisma.appointment_settings.upsert({
      where: { id: SETTINGS_ROW_ID },
      create: { id: SETTINGS_ROW_ID, ...data },
      update: data,
    });
    return fromRow(saved);
  },
};
