import {
  addDays,
  addMonths,
  differenceInCalendarWeeks,
  startOfDay,
} from "date-fns";

const WEEK_STARTS_ON = 1;
const WEEK_DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function toValidDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return startOfDay(date);
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function toWeekDayIndex(value: unknown): number | null {
  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue in WEEK_DAY_NAME_TO_INDEX) {
      return WEEK_DAY_NAME_TO_INDEX[normalizedValue];
    }
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  // New mapping from client payload: Monday=1 ... Sunday=7.
  if (parsed >= 1 && parsed <= 7) {
    return parsed === 7 ? 0 : parsed;
  }

  // Backward compatibility with JavaScript's Sunday=0 ... Saturday=6.
  if (parsed >= 0 && parsed <= 6) {
    return parsed;
  }

  return null;
}

function normalizeWeekDays(daysOfWeek: unknown): number[] {
  const mappedDays = asArray(daysOfWeek)
    .map((day) => toWeekDayIndex(day))
    .filter((day): day is number => day !== null);

  return Array.from(new Set(mappedDays));
}

function normalizeMonthDays(dayOfMonth: unknown): number[] {
  const mappedDays = asArray(dayOfMonth)
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);

  return Array.from(new Set(mappedDays));
}

function buildDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  let currentDate = startOfDay(startDate);

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate = addDays(currentDate, 1);
  }

  return dates;
}

export function generateRecurringDates(
  startDate: string | Date,
  endDate: string | Date,
  recurring: any,
): any {
  const safeRecurring = recurring ?? {};
  const frequency = String(safeRecurring?.frequency ?? "").toLowerCase();
  const interval = toPositiveInteger(safeRecurring?.interval, 1);
  const weekDays = normalizeWeekDays(safeRecurring?.daysOfWeek);
  const monthDays = normalizeMonthDays(safeRecurring?.dayOfMonth);

  const parsedStartDate = toValidDate(startDate);
  const parsedEndDate = toValidDate(endDate);
  if (!parsedStartDate || !parsedEndDate || parsedStartDate > parsedEndDate) {
    return [];
  }

  const dates: Date[] = [];

  if (!frequency) {
    if (weekDays.length) {
      return buildDateRange(parsedStartDate, parsedEndDate).filter((date) =>
        weekDays.includes(date.getDay()),
      );
    }

    // Backward compatibility for older clients that sent a scalar day count.
    const legacyDaySpan = toPositiveInteger(safeRecurring?.daysOfWeek, 0);
    if (legacyDaySpan > 0) {
      const legacyEndDate = addDays(parsedStartDate, legacyDaySpan - 1);
      const boundedEndDate =
        legacyEndDate <= parsedEndDate ? legacyEndDate : parsedEndDate;
      return buildDateRange(parsedStartDate, boundedEndDate);
    }

    return buildDateRange(parsedStartDate, parsedEndDate);
  }

  if (frequency === "daily") {
    let currentDate = new Date(parsedStartDate);
    while (currentDate <= parsedEndDate) {
      dates.push(new Date(currentDate));
      currentDate = addDays(currentDate, interval);
    }
    return dates;
  }

  if (frequency === "weekly") {
    const targetDays = weekDays.length ? weekDays : [parsedStartDate.getDay()];
    let currentDate = new Date(parsedStartDate);

    while (currentDate <= parsedEndDate) {
      const weekDelta = differenceInCalendarWeeks(currentDate, parsedStartDate, {
        weekStartsOn: WEEK_STARTS_ON,
      });

      if (
        weekDelta % interval === 0 &&
        targetDays.includes(currentDate.getDay())
      ) {
        dates.push(new Date(currentDate));
      }

      currentDate = addDays(currentDate, 1);
    }

    return dates;
  }

  if (frequency === "monthly") {
    const targetMonthDays = monthDays.length
      ? monthDays
      : [parsedStartDate.getDate()];
    let currentMonthDate = new Date(
      parsedStartDate.getFullYear(),
      parsedStartDate.getMonth(),
      1,
    );

    while (currentMonthDate <= parsedEndDate) {
      targetMonthDays.forEach((day) => {
        const candidateDate = new Date(
          currentMonthDate.getFullYear(),
          currentMonthDate.getMonth(),
          day,
        );

        if (
          candidateDate.getMonth() === currentMonthDate.getMonth() &&
          candidateDate >= parsedStartDate &&
          candidateDate <= parsedEndDate
        ) {
          dates.push(startOfDay(candidateDate));
        }
      });

      currentMonthDate = addMonths(currentMonthDate, interval);
    }

    return dates;
  }

  return buildDateRange(parsedStartDate, parsedEndDate);
}
