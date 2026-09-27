import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

type EventReportExclusionDb = Pick<
  Prisma.TransactionClient,
  "event_report_exclusion"
>;

export type EventReportExcludedUser = {
  id: number;
  name: string;
  email: string | null;
  member_id: string | null;
  excluded_at: string;
};

export type EventReportExclusionsResponse = {
  users: EventReportExcludedUser[];
  total: number;
};

const normalizeUserIds = (payload: unknown): number[] => {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  if (!Array.isArray(record.user_ids)) {
    throw new InputValidationError("user_ids must be an array of user ids");
  }

  const userIds = record.user_ids.map((value) => Number(value));
  if (userIds.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new InputValidationError("user_ids must contain positive whole numbers");
  }

  return Array.from(new Set(userIds));
};

/** User ids hidden from event reports. */
export const getEventReportExcludedUserIds = async (
  db: EventReportExclusionDb = prisma,
): Promise<Set<number>> => {
  const rows = await db.event_report_exclusion.findMany({
    select: { user_id: true },
  });

  return new Set(rows.map((row) => row.user_id));
};

export class EventReportExclusionService {
  async list(): Promise<EventReportExclusionsResponse> {
    const rows = await prisma.event_report_exclusion.findMany({
      orderBy: { user: { name: "asc" } },
      select: {
        created_at: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            member_id: true,
          },
        },
      },
    });

    const users = rows.map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email ?? null,
      member_id: row.user.member_id ?? null,
      excluded_at: row.created_at.toISOString(),
    }));

    return { users, total: users.length };
  }

  /** Replaces the whole exclusion list with `payload.user_ids`. */
  async replace(
    payload: unknown,
    updatedByUserId: number,
  ): Promise<EventReportExclusionsResponse> {
    const userIds = normalizeUserIds(payload);

    if (userIds.length) {
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });
      const existingIds = new Set(existingUsers.map((user) => user.id));
      const missingIds = userIds.filter((id) => !existingIds.has(id));

      if (missingIds.length) {
        throw new InputValidationError(
          `Unknown user id(s): ${missingIds.join(", ")}`,
        );
      }
    }

    await prisma.$transaction([
      prisma.event_report_exclusion.deleteMany({
        where: userIds.length ? { user_id: { notIn: userIds } } : {},
      }),
      prisma.event_report_exclusion.createMany({
        data: userIds.map((userId) => ({
          user_id: userId,
          created_by_user_id: updatedByUserId,
        })),
        skipDuplicates: true,
      }),
    ]);

    return this.list();
  }
}

export const eventReportExclusionService = new EventReportExclusionService();
