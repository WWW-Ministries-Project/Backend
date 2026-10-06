/**
 * Pure helpers for Ride to church: the service-date calendar, "HH:MM" clock
 * arithmetic and member name formatting. No Prisma, no I/O.
 */

/**
 * Minutes the church's local clock is ahead of UTC. Accra keeps UTC all year
 * (no DST), so the default is 0; set RIDES_UTC_OFFSET_MINUTES for a branch in
 * another timezone.
 */
const CHURCH_UTC_OFFSET_MINUTES = (() => {
  const parsed = Number(process.env.RIDES_UTC_OFFSET_MINUTES);
  return Number.isFinite(parsed) ? parsed : 0;
})();

/** Rides for a Sunday stay "this Sunday" until the service is well over. */
const SERVICE_DAY_CUTOFF_HOUR = 13;

export const SERVICE_LABEL = "Sunday Service";
export const DEPART_TIMES = ["07:00", "07:15", "07:30", "07:45"];
export const MIN_SEATS = 1;
export const MAX_SEATS = 6;
/** How long before the driver sets off everyone on the ride is reminded. */
export const REMINDER_LEAD_MINUTES = 30;
/** Gap assumed between a stop that is not on the area's usual route and the one before it. */
const OFF_ROUTE_STOP_GAP_MINUTES = 5;

export const DECLINE_REASONS = [
  "I'll have passed that pickup point",
  "My car is now full",
  "That pickup is off my route",
  "My plans have changed",
];

export const REPORT_REASONS = [
  "Unsafe driving",
  "Made me uncomfortable",
  "Didn't show up",
  "Something else",
];

/** "Now" as wall-clock fields on the church's local clock, held in a UTC Date. */
export const churchNow = (now: Date = new Date()): Date =>
  new Date(now.getTime() + CHURCH_UTC_OFFSET_MINUTES * 60_000);

/** Midnight UTC of a church-local calendar day — the value a `@db.Date` column stores. */
const dayOf = (local: Date): Date =>
  new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));

/**
 * The Sunday rides are currently being arranged for: today until the service
 * is over, otherwise the coming Sunday.
 */
export const currentServiceDate = (now: Date = new Date()): Date => {
  const local = churchNow(now);
  const today = dayOf(local);
  const weekday = local.getUTCDay();
  if (weekday === 0 && local.getUTCHours() < SERVICE_DAY_CUTOFF_HOUR) {
    return today;
  }
  const daysAhead = weekday === 0 ? 7 : 7 - weekday;
  return new Date(today.getTime() + daysAhead * 86_400_000);
};

/** Today's date on the church's clock (midnight UTC). */
export const churchToday = (now: Date = new Date()): Date => dayOf(churchNow(now));

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isClockTime = (value: unknown): value is string =>
  typeof value === "string" && CLOCK.test(value);

export const clockToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export const minutesToClock = (total: number): string => {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const addMinutes = (clock: string, minutes: number): string =>
  minutesToClock(clockToMinutes(clock) + minutes);

/** Minutes past local midnight right now on the church clock. */
export const churchMinutesNow = (now: Date = new Date()): number => {
  const local = churchNow(now);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

/**
 * Orders a driver's chosen pickup points and works out when they will be at
 * each: points on the area's usual route keep their route order and typical
 * minutes; any others follow, a few minutes apart.
 */
export const planStops = (
  departTime: string,
  pickupPointIds: number[],
  route: Map<number, { position: number; minutes: number }>,
): { pickup_point_id: number; position: number; pickup_time: string }[] => {
  const onRoute = pickupPointIds
    .filter((id) => route.has(id))
    .sort((a, b) => route.get(a)!.position - route.get(b)!.position);
  const offRoute = pickupPointIds.filter((id) => !route.has(id));

  let lastMinutes = 0;
  return [...onRoute, ...offRoute].map((id, index) => {
    const known = route.get(id);
    const minutes = known ? known.minutes : lastMinutes + OFF_ROUTE_STOP_GAP_MINUTES * (index === 0 ? 2 : 1);
    lastMinutes = Math.max(lastMinutes, minutes);
    return { pickup_point_id: id, position: index + 1, pickup_time: addMinutes(departTime, minutes) };
  });
};

export const firstNameOf = (name?: string | null): string =>
  String(name ?? "").trim().split(/\s+/)[0] || "A member";

export const initialsOf = (name?: string | null): string =>
  String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

/** "7:25 AM" for notification copy. */
export const displayClock = (clock: string): string => {
  const total = clockToMinutes(clock);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`;
};

export const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
