import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import { UserService } from "../user/userService";
import { VisitService } from "./visitService";
import { toSentenceCase } from "../../utils";

const userService = new UserService();
const visitService = new VisitService();
const RESPONSIBLE_MEMBERS_VALIDATION_MESSAGE =
  "Responsible member is optional. If you provide it, send one or more valid member IDs as an array, for example [12] or [12, 34]. Leave it empty if you do not want to assign anyone yet.";
const DUPLICATE_VISIT_VALIDATION_MESSAGE =
  "This visit has already been recorded for the selected visitor and event on that date. Change the date or event, or use the existing visit to continue.";
const INVALID_CONVERSION_EMAIL_MESSAGE =
  "A valid non-temporary email is required to convert a visitor to a login user. Please update the email address and try again.";
const CONVERSION_NAME_VALIDATION_MESSAGE =
  "First name and last name are required to convert a visitor to a member. Please update the visitor details and try again.";
const MEMBERSHIP_TYPE_VALIDATION_MESSAGE =
  "Membership type must be either ONLINE or IN_HOUSE.";

const normalizeOptionalEmail = (email?: string | null) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  return normalizedEmail || null;
};

const isRealEmail = (email?: string | null) => {
  const normalizedEmail = normalizeOptionalEmail(email);
  if (!normalizedEmail) return false;

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return (
    emailPattern.test(normalizedEmail) &&
    !normalizedEmail.endsWith("@temp.com")
  );
};

const hasOwnProperty = (obj: unknown, key: string) =>
  !!obj &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key);

const hasTextValue = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim().length > 0;

const normalizeOptionalText = (value: unknown) => {
  if (!hasTextValue(value)) return null;
  return String(value).trim();
};

const normalizeConversionGender = (value: unknown) => {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) return "Other";

  const normalizedLower = normalizedValue.toLowerCase();
  if (normalizedLower === "male" || normalizedLower === "m") return "Male";
  if (normalizedLower === "female" || normalizedLower === "f") return "Female";
  if (
    normalizedLower === "other" ||
    normalizedLower === "unknown" ||
    normalizedLower === "prefer not to say"
  ) {
    return "Other";
  }

  return toSentenceCase(normalizedValue);
};

const normalizeMembershipType = (value: unknown) => {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) return "IN_HOUSE";

  const normalizedMembershipType = normalizedValue
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (
    normalizedMembershipType === "ONLINE" ||
    normalizedMembershipType === "IN_HOUSE"
  ) {
    return normalizedMembershipType;
  }

  throw new InputValidationError(MEMBERSHIP_TYPE_VALIDATION_MESSAGE);
};

const normalizeResponsibleMembersInput = (responsibleMembers: unknown): unknown[] => {
  if (Array.isArray(responsibleMembers)) {
    return responsibleMembers;
  }

  if (typeof responsibleMembers === "string") {
    const trimmedMembers = responsibleMembers.trim();
    if (!trimmedMembers) return [];

    try {
      const parsedMembers = JSON.parse(trimmedMembers);
      if (Array.isArray(parsedMembers)) {
        return parsedMembers;
      }
    } catch (error) {
      return trimmedMembers
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean);
    }
  }

  return [];
};

const isEmptyResponsibleMembersValue = (responsibleMembers: unknown) => {
  if (responsibleMembers === null || responsibleMembers === undefined) {
    return true;
  }

  if (Array.isArray(responsibleMembers)) {
    return responsibleMembers.length === 0;
  }

  if (typeof responsibleMembers === "string") {
    const trimmedMembers = responsibleMembers.trim();
    if (!trimmedMembers) return true;

    try {
      const parsedMembers = JSON.parse(trimmedMembers);
      return Array.isArray(parsedMembers) && parsedMembers.length === 0;
    } catch (error) {
      return false;
    }
  }

  return false;
};

const serializeResponsibleMemberIds = (memberIds: number[]) =>
  JSON.stringify(
    Array.from(
      new Set(
        memberIds.filter((memberId) => Number.isInteger(memberId) && memberId > 0),
      ),
    ),
  );

const parseResponsibleMemberIds = (
  responsibleMembers: unknown,
  options: { strict?: boolean } = {},
) => {
  const { strict = true } = options;

  if (responsibleMembers === null || responsibleMembers === undefined) {
    return [];
  }

  const normalizedMembers = normalizeResponsibleMembersInput(responsibleMembers);
  if (!normalizedMembers.length) {
    if (strict && !isEmptyResponsibleMembersValue(responsibleMembers)) {
      throw new InputValidationError(RESPONSIBLE_MEMBERS_VALIDATION_MESSAGE);
    }
    return [];
  }

  const parsedMemberIds = normalizedMembers.map((memberId) => Number(memberId));
  const hasInvalidMemberIds = parsedMemberIds.some(
    (memberId) => !Number.isInteger(memberId) || memberId <= 0,
  );

  if (strict && hasInvalidMemberIds) {
    throw new InputValidationError(RESPONSIBLE_MEMBERS_VALIDATION_MESSAGE);
  }

  return Array.from(
    new Set(
      parsedMemberIds.filter(
        (memberId) => Number.isInteger(memberId) && memberId > 0,
      ),
    ),
  );
};

type ResponsibleMemberDetails = {
  userId: number;
  name: string;
};

const getResponsibleMemberNames = (
  memberIds: number[],
  userMap: Record<number, string>,
) =>
  memberIds
    .map((memberId) => ({
      userId: memberId,
      name: userMap[memberId],
    }))
    .filter(
      (member): member is ResponsibleMemberDetails =>
        typeof member.name === "string" && member.name.length > 0,
    );

const buildMissingResponsibleMembersMessage = (missingMemberIds: number[]) => {
  const pronoun = missingMemberIds.length === 1 ? "it" : "them";
  const memberLabel = missingMemberIds.length === 1 ? "this member" : "these members";

  return `Responsible member is optional. If you provide it, select only existing members. We could not find ${memberLabel}: ${missingMemberIds.join(", ")}. Remove ${pronoun} or choose valid members to continue.`;
};

export class VisitorService {
  private async validateResponsibleMemberIds(responsibleMembers: unknown) {
    const memberIds = parseResponsibleMemberIds(responsibleMembers);

    if (!memberIds.length) {
      return [];
    }

    const existingMembers = await prisma.user.findMany({
      where: {
        id: { in: memberIds },
      },
      select: { id: true },
    });

    const existingMemberIdSet = new Set(existingMembers.map((member) => member.id));
    const missingMemberIds = memberIds.filter((id) => !existingMemberIdSet.has(id));

    if (missingMemberIds.length) {
      throw new InputValidationError(
        buildMissingResponsibleMembersMessage(missingMemberIds),
      );
    }

    return memberIds;
  }

  async deleteVisitor(id: number) {
    return await prisma.visitor.delete({
      where: { id },
    });
  }
  async updateVisitor(id: number, body: any) {
    const {
      personal_info,
      contact_info,
      visit,
      consentToContact,
      membershipWish,
      event,
    } = body;
    const hasResponsibleMembers = hasOwnProperty(body, "responsibleMembers");
    const responsibleMembers = hasResponsibleMembers
      ? await this.validateResponsibleMemberIds(body.responsibleMembers)
      : undefined;

    const visitorData = {
      title: personal_info.title,
      firstName: toSentenceCase(personal_info.first_name),
      lastName: toSentenceCase(personal_info.last_name),
      otherName: toSentenceCase(personal_info.other_name),
      email: contact_info.email.toLowerCase(),
      phone: contact_info.phone?.number ?? null,
      country: contact_info.resident_country,
      country_code: contact_info.phone?.country_code ?? null,
      address: contact_info.address,
      city: contact_info.city,
      state: contact_info.state_region,
      zipCode: null,
      visitDate: new Date(visit.date),
      howHeard: visit.howHeard,
      consentToContact:
        consentToContact === "true" || consentToContact === true,
      membershipWish: membershipWish === "true" || membershipWish === true,
      ...(hasResponsibleMembers
        ? {
            responsibleMembers: serializeResponsibleMemberIds(responsibleMembers || []),
          }
        : {}),
      // is_member is not included here; optionally set it if needed
    };

    const updatedVisitor = await prisma.visitor.update({
      where: { id },
      data: visitorData,
    });

    return {
      ...updatedVisitor,
      responsibleMembers: parseResponsibleMemberIds(
        updatedVisitor.responsibleMembers,
        { strict: false },
      ),
    };
  }
  async getVisitorById(id: number) {
    const visitor = await prisma.visitor.findUnique({
      where: { id },
      include: {
        visits: {
          include: {
            event: {
              include: {
                event: {
                  select: {
                    event_name: true,
                    id: true,
                    event_type: true,
                  },
                },
              },
            },
          },
        },
        notes: true,
        followUps: true,
        prayerRequests: true,
      },
    });

    if (!visitor) return null;

    const responsibleMemberIds = parseResponsibleMemberIds(
      visitor.responsibleMembers,
      {
        strict: false,
      },
    );

    // Get unique assignedTo user IDs
    const assignedToIds = Array.from(
      new Set(visitor.followUps.map((f) => f.assignedTo).filter(Boolean)),
    ) as number[];
    const userIds = Array.from(
      new Set([...assignedToIds, ...responsibleMemberIds]),
    ) as number[];

    // Fetch corresponding user names
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];

    const userMap = Object.fromEntries(
      users.map((user) => [user.id, user.name]),
    );

    return {
      ...visitor,
      responsibleMembers: responsibleMemberIds,
      responsibleMembersNames: getResponsibleMemberNames(
        responsibleMemberIds,
        userMap,
      ),
      visits: visitor.visits.map(({ event, ...v }) => ({
        ...v,
        eventId: event?.event.id,
        eventName: event?.event.event_name,
        eventType: event?.event.event_type || null,
      })),
      followUps: visitor.followUps.map((f: any) => ({
        ...f,
        assignedTo: f.assignedTo ? userMap[f.assignedTo] || null : null,
      })),
    };
  }
  async getAllVisitors(
    query: {
      search?: string;
      createdMonth?: string;
      visitMonth?: string;
      eventId?: string;
      page?: string;
      limit?: string;
      take?: string;
    },
    scope?: {
      mode?: "all" | "responsible";
      memberId?: number;
    },
  ) {
    const {
      search,
      createdMonth,
      visitMonth,
      eventId,
      page = "1",
      limit = "10",
      take,
    } = query;

    const parsedPageNumber = Number(page);
    const pageNumber =
      Number.isInteger(parsedPageNumber) && parsedPageNumber > 0
        ? parsedPageNumber
        : 1;
    const resolvedTake = take ?? limit;
    const parsedPageSize = Number(resolvedTake);
    const pageSize =
      Number.isInteger(parsedPageSize) && parsedPageSize > 0
        ? parsedPageSize
        : 10;
    const skip = (pageNumber - 1) * pageSize;

    const where: any = {};

    if (search) {
      where.OR = [
        { firstName: { contains: toSentenceCase(search) } },
        { lastName: { contains: toSentenceCase(search) } },
        { otherName: { contains: toSentenceCase(search) } },
        { email: { contains: toSentenceCase(search) } },
        { phone: { contains: toSentenceCase(search) } },
      ];
    }

    if (createdMonth) {
      const { start, end } = this.getMonthRange(createdMonth);
      where.createdAt = { gte: start, lt: end };
    }

    /* 📅 VISIT MONTH */
    if (visitMonth) {
      const { start, end } = this.getMonthRange(visitMonth);
      where.visits = {
        some: {
          date: { gte: start, lt: end },
        },
      };
    }

    /* 🎯 EVENT REFERRAL */
    if (eventId) {
      where.visits = {
        ...(where.visits || {}),
        some: {
          ...(where.visits?.some || {}),
          eventId: Number(eventId),
        },
      };
    }

    const shouldScopeByResponsibleMember =
      scope?.mode === "responsible" &&
      Number.isInteger(Number(scope?.memberId)) &&
      Number(scope?.memberId) > 0;
    const scopedResponsibleMemberId = shouldScopeByResponsibleMember
      ? Number(scope?.memberId)
      : null;

    const rawVisitors = await prisma.visitor.findMany({
      where,
      include: {
        visits: {
          include: {
            event: {
              include: {
                event: {
                  select: {
                    id: true,
                    event_name: true,
                  },
                },
              },
            },
          },
        },
        followUps: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const visitors = shouldScopeByResponsibleMember
      ? rawVisitors.filter((visitor) =>
          parseResponsibleMemberIds(visitor.responsibleMembers, {
            strict: false,
          }).includes(scopedResponsibleMemberId as number),
        )
      : rawVisitors;

    const total = visitors.length;
    const paginatedVisitors = visitors.slice(skip, skip + pageSize);
    const allResponsibleMemberIds = Array.from(
      new Set(
        paginatedVisitors.flatMap((visitor) =>
          parseResponsibleMemberIds(visitor.responsibleMembers, {
            strict: false,
          }),
        ),
      ),
    );
    const responsibleMembers = allResponsibleMemberIds.length
      ? await prisma.user.findMany({
          where: { id: { in: allResponsibleMemberIds } },
          select: { id: true, name: true },
        })
      : [];
    const responsibleMemberMap = Object.fromEntries(
      responsibleMembers.map((member) => [member.id, member.name]),
    );

    const data = paginatedVisitors.map(({ visits, followUps, ...visitor }) => {
      const responsibleMemberIds = parseResponsibleMemberIds(
        visitor.responsibleMembers,
        { strict: false },
      );

      return {
        ...visitor,
        responsibleMembers: responsibleMemberIds,
        responsibleMembersNames: getResponsibleMemberNames(
          responsibleMemberIds,
          responsibleMemberMap,
        ),
        eventId: visits[0]?.event?.event.id || null,
        eventName: visits[0]?.event?.event.event_name || null,
        visitCount: visits.length,
        followUp: followUps[0]?.date || null,
      };
    });

    return {
      data,
      meta: {
        total,
        page: pageNumber,
        limit: pageSize,
        take: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async createVisitor(body: any) {
    const {
      personal_info,
      contact_info,
      visit,
      consentToContact,
      membershipWish,
    } = body;
    const hasResponsibleMembers = hasOwnProperty(body, "responsibleMembers");
    const responsibleMembers = hasResponsibleMembers
      ? await this.validateResponsibleMemberIds(body.responsibleMembers)
      : [];

    const visitDate = new Date(visit.date);
    const email = contact_info.email;

    const event_id =
      isNaN(parseInt(visit.eventId)) || parseInt(visit.eventId) === 0
        ? null
        : parseInt(visit.eventId);

    // Check if the visitor already exists
    const existingVisitor = await prisma.visitor.findUnique({
      where: { email },
    });

    if (existingVisitor) {
      const existingVisit = await prisma.visit.findFirst({
        where: {
          visitorId: existingVisitor.id,
          eventId: event_id,
          date: visitDate,
        },
      });

      if (existingVisit) {
        throw new InputValidationError(DUPLICATE_VISIT_VALIDATION_MESSAGE);
      }

      const updatedExistingVisitor = hasResponsibleMembers
        ? await prisma.visitor.update({
            where: { id: existingVisitor.id },
            data: {
              responsibleMembers: serializeResponsibleMemberIds(responsibleMembers),
            },
          })
        : existingVisitor;

      const newVisit = await visitService.createVisit({
        visitorId: existingVisitor.id,
        date: visitDate,
        eventId: event_id,
      });

      return {
        visitor: {
          ...updatedExistingVisitor,
          responsibleMembers: parseResponsibleMemberIds(
            updatedExistingVisitor.responsibleMembers,
            { strict: false },
          ),
        },
        createdVisit: newVisit,
      };
    }

    // Prepare new visitor data
    const newVisitorData = {
      title: personal_info.title,
      firstName: toSentenceCase(personal_info.first_name),
      lastName: toSentenceCase(personal_info.last_name),
      otherName: toSentenceCase(personal_info.other_name),
      email: contact_info.email.toLowerCase(),
      phone: contact_info.phone?.number ?? null,
      country: contact_info.resident_country,
      country_code: contact_info.phone?.country_code ?? null,
      address: contact_info.address,
      city: contact_info.city,
      state: contact_info.state_region,
      zipCode: null,
      visitDate,
      howHeard: visit.howHeard,
      consentToContact:
        consentToContact === "true" || consentToContact === true,
      membershipWish: membershipWish === "true" || membershipWish === true,
      responsibleMembers: serializeResponsibleMemberIds(responsibleMembers),
      is_member: false,
    };

    const createdVisitor = await prisma.visitor.create({
      data: newVisitorData,
    });

    const newVisit = await visitService.createVisit({
      visitorId: createdVisitor.id,
      date: visitDate,
      eventId: event_id,
    });

    return {
      visitor: {
        ...createdVisitor,
        responsibleMembers: parseResponsibleMemberIds(
          createdVisitor.responsibleMembers,
          { strict: false },
        ),
      },
      createdVisit: newVisit,
    };
  }

  private getMonthRange(month: string) {
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
  }

  async changeVisitorStatusToMember(id: number, payload: any = {}) {
    const visitor = await this.getVisitorById(id);
    if (!visitor) throw new NotFoundError("Visitor not found");

    const personalInfoPayload = payload?.personal_info || {};
    const contactInfoPayload = payload?.contact_info || {};
    const churchInfoPayload = payload?.church_info || {};
    const contactPhonePayload = contactInfoPayload?.phone || {};
    const resolvedFirstName = normalizeOptionalText(
      personalInfoPayload.first_name ?? payload?.first_name ?? visitor.firstName,
    );
    const resolvedLastName = normalizeOptionalText(
      personalInfoPayload.last_name ?? payload?.last_name ?? visitor.lastName,
    );
    const resolvedOtherName =
      normalizeOptionalText(
        personalInfoPayload.other_name ?? payload?.other_name ?? visitor.otherName,
      ) || "";
    const resolvedTitle = normalizeOptionalText(
      personalInfoPayload.title ?? payload?.title ?? visitor.title,
    );
    const resolvedEmail = normalizeOptionalEmail(
      contactInfoPayload.email ?? payload?.email ?? visitor.email,
    );
    const resolvedCountry = normalizeOptionalText(
      contactInfoPayload.resident_country ??
        payload?.resident_country ??
        payload?.country ??
        visitor.country,
    );
    const resolvedCountryCode = normalizeOptionalText(
      contactPhonePayload.country_code ??
        payload?.country_code ??
        visitor.country_code,
    );
    const resolvedPrimaryNumber = normalizeOptionalText(
      contactPhonePayload.number ?? payload?.primary_number ?? visitor.phone,
    );
    const resolvedStateRegion = normalizeOptionalText(
      contactInfoPayload.state_region ?? payload?.state_region ?? visitor.state,
    );
    const resolvedCity = normalizeOptionalText(
      contactInfoPayload.city ?? payload?.city ?? visitor.city,
    );
    const resolvedGender = normalizeConversionGender(
      personalInfoPayload.gender ?? payload?.gender,
    );
    const resolvedMembershipType = normalizeMembershipType(
      churchInfoPayload.membership_type ?? payload?.membership_type,
    );
    const resolvedMemberSince =
      churchInfoPayload.member_since ?? payload?.member_since ?? new Date();
    const resolvedDateOfBirth =
      personalInfoPayload.date_of_birth ?? payload?.date_of_birth ?? null;
    const resolvedMaritalStatus =
      personalInfoPayload.marital_status ?? payload?.marital_status ?? null;
    const resolvedNationality =
      normalizeOptionalText(
        personalInfoPayload.nationality ?? payload?.nationality ?? resolvedCountry,
      ) || resolvedCountry;

    if (!resolvedFirstName || !resolvedLastName) {
      throw new InputValidationError(CONVERSION_NAME_VALIDATION_MESSAGE);
    }

    if (!isRealEmail(resolvedEmail)) {
      throw new InputValidationError(INVALID_CONVERSION_EMAIL_MESSAGE);
    }

    const loginEmail = resolvedEmail as string;

    const existingUser = await prisma.user.findUnique({
      where: { email: loginEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new Error(
        `A user with the email ${loginEmail} already exists. Use a different email address or sign in with the existing account.`,
      );
    }

    const userData = {
      personal_info: {
        title: resolvedTitle,
        first_name: resolvedFirstName,
        last_name: resolvedLastName,
        other_name: resolvedOtherName,
        gender: resolvedGender,
        date_of_birth: resolvedDateOfBirth,
        marital_status: resolvedMaritalStatus,
        nationality: resolvedNationality,
        has_children: false,
      },
      contact_info: {
        email: loginEmail,
        resident_country: resolvedCountry,
        state_region: resolvedStateRegion,
        city: resolvedCity,
        phone: {
          country_code: resolvedCountryCode,
          number: resolvedPrimaryNumber,
        },
      },
      work_info: {},
      emergency_contact: {},
      church_info: {
        membership_type: resolvedMembershipType,
        department_id: null,
        position_id: null,
        member_since: resolvedMemberSince,
      },
      picture: {},
      children: [],
      status: "CONFIRMED",
      password: "123456", // default or auto-generated
      is_user: true,
    };

    // Register user using the data
    const newUser = await userService.registerUser(userData);

    await prisma.visitor.update({
      where: { id },
      data: {
        is_member: true,
      },
    });

    return newUser;
  }
}
