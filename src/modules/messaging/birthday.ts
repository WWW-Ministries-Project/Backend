/**
 * Birthday rules. Pure: no Prisma, no I/O.
 *
 * Dates of birth are compared on their UTC month/day — the dashboard stores
 * them as midnight UTC, so local-time getters would shift a day west of UTC.
 */

export type LocalParts = { date: string; year: number; month: number; day: number; minutes: number };

/** Wall-clock fields of `now` in an IANA timezone. */
export const localParts = (now: Date, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, year, month, day, minutes: get("hour") * 60 + get("minute") };
};

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const isBirthdayOn = (
  dateOfBirth: Date,
  today: { year: number; month: number; day: number },
): boolean => {
  const month = dateOfBirth.getUTCMonth() + 1;
  const day = dateOfBirth.getUTCDate();
  if (month === today.month && day === today.day) return true;
  return month === 2 && day === 29 && today.month === 2 && today.day === 28 && !isLeapYear(today.year);
};

/** Age reached during `year` — correct on (or after) the birthday itself, which is the only place it is used. */
export const ageOn = (dateOfBirth: Date, year: number): number | null => {
  const age = year - dateOfBirth.getUTCFullYear();
  return age > 0 && age < 130 ? age : null;
};

const toMinutes = (clock: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 7 * 60;
};

export const isBirthdayRunDue = (
  settings: { birthday_send_time: string; timezone: string; last_birthday_run_date: string | null },
  now: Date,
): boolean => {
  const local = localParts(now, settings.timezone);
  return local.minutes >= toMinutes(settings.birthday_send_time) && settings.last_birthday_run_date !== local.date;
};
