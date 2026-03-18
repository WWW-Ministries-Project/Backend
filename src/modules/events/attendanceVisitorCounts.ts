import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";

type VisitQueryClient = Pick<Prisma.TransactionClient, "visit">;

type AttendanceLookupRecord = {
  eventId: number;
  date: Date;
};

export type AttendanceVisitorBucket = {
  male: number;
  female: number;
  total: number;
};

export type AttendanceVisitorCounts = {
  visitors: AttendanceVisitorBucket;
  visitorClergy: AttendanceVisitorBucket;
  total: AttendanceVisitorBucket;
};

const createBucket = (): AttendanceVisitorBucket => ({
  male: 0,
  female: 0,
  total: 0,
});

export const createEmptyAttendanceVisitorCounts =
  (): AttendanceVisitorCounts => ({
    visitors: createBucket(),
    visitorClergy: createBucket(),
    total: createBucket(),
  });

const normalizeDateKey = (value: Date) => {
  const normalizedDate = new Date(value);
  normalizedDate.setUTCHours(0, 0, 0, 0);
  return normalizedDate.toISOString().slice(0, 10);
};

const resolveGenderKey = (
  gender: string | null | undefined,
): "male" | "female" | null => {
  const normalizedGender = String(gender || "")
    .trim()
    .toLowerCase();

  if (!normalizedGender) return null;
  if (normalizedGender === "male" || normalizedGender === "m") return "male";
  if (normalizedGender === "female" || normalizedGender === "f") {
    return "female";
  }

  return null;
};

const incrementBucket = (
  bucket: AttendanceVisitorBucket,
  genderKey: "male" | "female" | null,
) => {
  bucket.total += 1;

  if (genderKey === "male") {
    bucket.male += 1;
  }

  if (genderKey === "female") {
    bucket.female += 1;
  }
};

const buildLookupKey = (eventId: number, date: Date) =>
  `${eventId}:${normalizeDateKey(date)}`;

export const getAttendanceVisitorCountsForRecord = (
  countsByKey: Map<string, AttendanceVisitorCounts>,
  eventId: number,
  date: Date,
) => countsByKey.get(buildLookupKey(eventId, date)) || createEmptyAttendanceVisitorCounts();

export const buildAttendanceVisitorCountsMap = async (
  records: AttendanceLookupRecord[],
  dbClient: VisitQueryClient = prisma,
) => {
  const validRecords = records.filter(
    (record) =>
      Number.isInteger(record.eventId) &&
      record.eventId > 0 &&
      record.date instanceof Date &&
      !Number.isNaN(record.date.getTime()),
  );

  if (!validRecords.length) {
    return new Map<string, AttendanceVisitorCounts>();
  }

  const eventIds = Array.from(
    new Set(validRecords.map((record) => record.eventId)),
  );
  const dates = validRecords.map((record) => record.date.getTime());
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));

  minDate.setUTCHours(0, 0, 0, 0);
  maxDate.setUTCHours(0, 0, 0, 0);
  maxDate.setUTCDate(maxDate.getUTCDate() + 1);

  const visits = await dbClient.visit.findMany({
    where: {
      eventId: {
        in: eventIds,
      },
      date: {
        gte: minDate,
        lt: maxDate,
      },
    },
    select: {
      eventId: true,
      date: true,
      visitor: {
        select: {
          gender: true,
          isClergy: true,
        },
      },
    },
  });

  const countsByKey = new Map<string, AttendanceVisitorCounts>();

  for (const visit of visits) {
    if (!visit.eventId) continue;

    const lookupKey = buildLookupKey(visit.eventId, visit.date);
    const counts =
      countsByKey.get(lookupKey) || createEmptyAttendanceVisitorCounts();
    const genderKey = resolveGenderKey(visit.visitor?.gender);
    const targetBucket = visit.visitor?.isClergy
      ? counts.visitorClergy
      : counts.visitors;

    incrementBucket(targetBucket, genderKey);
    incrementBucket(counts.total, genderKey);

    countsByKey.set(lookupKey, counts);
  }

  return countsByKey;
};
