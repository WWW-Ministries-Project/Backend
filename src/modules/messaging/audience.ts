/**
 * General-message audiences: validation (pure) and resolution to people.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { departmentMemberIds } from "../community/communityQueries";
import { Audience, Person } from "./types";

const MAX_ID = 2147483647;
const MAX_RECIPIENT_IDS = 2000;

const toId = (v: unknown): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_ID ? n : null;
};

const toIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const ids = Array.from(
    new Set(value.map(toId).filter((n): n is number => n !== null)),
  );
  if (ids.length > MAX_RECIPIENT_IDS) {
    throw new InputValidationError("Too many recipients selected (max 2000)");
  }
  return ids;
};

export const parseAudience = (raw: unknown): Audience => {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const scope = record.scope;
  if (scope !== "CHURCH" && scope !== "DEPARTMENTS" && scope !== "PEOPLE") {
    throw new InputValidationError("audience.scope must be CHURCH, DEPARTMENTS or PEOPLE");
  }
  const departmentIds = scope === "DEPARTMENTS" ? toIds(record.departmentIds) : [];
  const userIds = scope === "PEOPLE" ? toIds(record.userIds) : [];
  if (scope === "DEPARTMENTS" && !departmentIds.length) {
    throw new InputValidationError("Choose at least one department");
  }
  if (scope === "PEOPLE" && !userIds.length) {
    throw new InputValidationError("Choose at least one person");
  }
  const isChurch = scope === "CHURCH";
  return {
    scope,
    departmentIds,
    userIds,
    includeGuests: isChurch && record.includeGuests === true,
    includeVisitors: isChurch && record.includeVisitors === true,
  };
};

const activeWhere: Prisma.userWhereInput = { OR: [{ is_active: true }, { is_active: null }] };
const memberWhere: Prisma.userWhereInput = { OR: [{ is_guest: false }, { is_guest: null }] };

const userSelect = {
  id: true,
  email: true,
  user_info: {
    select: {
      first_name: true,
      last_name: true,
      title: true,
      email: true,
      primary_number: true,
      country_code: true,
      date_of_birth: true,
    },
  },
} satisfies Prisma.userSelect;

type UserRow = Prisma.userGetPayload<{ select: typeof userSelect }>;

export const userToPerson = (u: UserRow): Person => ({
  userId: u.id,
  visitorId: null,
  firstName: u.user_info?.first_name ?? null,
  lastName: u.user_info?.last_name ?? null,
  title: u.user_info?.title ?? null,
  email: u.user_info?.email || u.email || null,
  phone: u.user_info?.primary_number ?? null,
  countryCode: u.user_info?.country_code ?? null,
  dateOfBirth: u.user_info?.date_of_birth ?? null,
});

const visitorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  title: true,
  email: true,
  phone: true,
  country_code: true,
} satisfies Prisma.visitorSelect;

type VisitorRow = Prisma.visitorGetPayload<{ select: typeof visitorSelect }>;

export const visitorToPerson = (v: VisitorRow): Person => ({
  userId: null,
  visitorId: v.id,
  firstName: v.firstName || null,
  lastName: v.lastName || null,
  title: v.title ?? null,
  email: v.email ?? null,
  phone: v.phone ?? null,
  countryCode: v.country_code ?? null,
  dateOfBirth: null,
});

export const findUsers = async (where: Prisma.userWhereInput): Promise<Person[]> =>
  (await prisma.user.findMany({ where, select: userSelect })).map(userToPerson);

export const findVisitorPerson = async (visitorId: number): Promise<Person | null> => {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId }, select: visitorSelect });
  return v ? visitorToPerson(v) : null;
};

/** Resolves an audience to people. De-duplication happens in buildRecipientRows. */
export const resolveAudience = async (audience: Audience): Promise<Person[]> => {
  if (audience.scope === "PEOPLE") {
    return findUsers({ AND: [activeWhere, { id: { in: audience.userIds } }] });
  }

  if (audience.scope === "DEPARTMENTS") {
    const byDept = await departmentMemberIds(audience.departmentIds);
    const ids = Array.from(new Set(Array.from(byDept.values()).flat()));
    return ids.length ? findUsers({ AND: [activeWhere, memberWhere, { id: { in: ids } }] }) : [];
  }

  const users = await findUsers(
    audience.includeGuests ? activeWhere : { AND: [activeWhere, memberWhere] },
  );
  if (!audience.includeVisitors) return users;

  // Converted visitors (is_member) already appear as users.
  const visitors = await prisma.visitor.findMany({
    where: { consentToContact: true, is_member: false },
    select: visitorSelect,
  });
  // Visitors whose email belongs to any user account are either already
  // messaged as users or were deliberately excluded (inactive accounts).
  const emails = visitors.flatMap((v) => (v.email ? [v.email.toLowerCase()] : []));
  const accounts = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
    : [];
  const taken = new Set(accounts.flatMap((u) => (u.email ? [u.email.toLowerCase()] : [])));
  const remaining = visitors.filter((v) => !v.email || !taken.has(v.email.toLowerCase()));
  return [...users, ...remaining.map(visitorToPerson)];
};
