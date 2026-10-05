import crypto from "crypto";
import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import { prisma } from "../../Models/context";
import { hashPassword, sendEmail } from "../../utils";
import { selfRegistrationTemplate } from "../../utils/mail_templates/selfRegistrationTemplate";
import { getBranchScopedWhere, resolveBranchIdOrDefault } from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";
import { issueSessionTokenForUser } from "./userController";
import { UserService } from "./userService";
import {
  buildPersistedWorkInfoData,
  getMissingRequiredWorkFields,
  hasAnyWorkInfoPayload,
} from "./workInfoUtils";

/*
 * Member self-service from the mobile app:
 *   - self-registration as a member or a guest (public);
 *   - a guest's request to become a member, and the dashboard's queue for it;
 *   - the Guests list under Visitors;
 *   - a member updating their own profile.
 *
 * Registration deliberately does NOT reuse `registerUser`: that endpoint takes
 * `status`, `is_user` and positions from the body, which a public caller must
 * never control. Everything privileged is fixed here.
 */

const JWT_SECRET: any = process.env.JWT_SECRET;
const userService = new UserService();

export const REGISTRATION_SOURCE_MOBILE = "MOBILE_APP";
const SET_PASSWORD_EXPIRY = "72h";
const SET_PASSWORD_EXPIRY_LABEL = "72 hours";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MARITAL_STATUSES = new Set(["SINGLE", "MARRIED", "DIVORCED", "WIDOW", "WIDOWER"]);

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const text = (value: unknown, max = 191): string | null => {
  if (!hasValue(value)) return null;
  return String(value).trim().slice(0, max);
};

const normalizeEmail = (value: unknown) => {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL_PATTERN.test(email) && !email.endsWith("@temp.com") ? email : null;
};

/** Digits only, without a leading trunk 0 — the dashboard stores numbers that way. */
const normalizePhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D+/g, "").replace(/^0+/, "");
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
};

const normalizeCountryCode = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits ? `+${digits}` : null;
};

const normalizeGender = (value: unknown) => {
  const gender = String(value ?? "").trim().toLowerCase();
  if (gender === "male" || gender === "m") return "Male";
  if (gender === "female" || gender === "f") return "Female";
  return null;
};

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getRequestUserId = (req: Request) => toPositiveInt((req as any)?.user?.id);

const fail = (res: Response, status: number, message: string, code?: string) =>
  res.status(status).json({ message, code: code ?? null, data: null });

/**
 * A link to the dashboard's reset-password page that sets the first password.
 * Signed the same way as forgot-password (secret + current hash), so it stops
 * working the moment a password is set.
 */
const buildSetPasswordLink = (userId: number, email: string, passwordHash: string) => {
  const token = JWT.sign({ id: userId, email }, JWT_SECRET + passwordHash, {
    expiresIn: SET_PASSWORD_EXPIRY,
  });
  return `${process.env.Frontend_URL}/reset-password/?id=${userId}&token=${token}`;
};

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

/**
 * POST /user/self-register — public, rate limited.
 * Body: { account_type: "member" | "guest", title?, first_name, other_name?,
 *         last_name, email, country_code?, phone }
 *
 * Creates an active, non-admin account and returns a session token so the app
 * can sign the person straight in. A member lands in the Member Confirmation
 * unconfirmed queue; a guest is listed under Visitors > Guests. Either way the
 * person is emailed a link to set their password.
 *
 * 409 with code ALREADY_REGISTERED when the email already has an account.
 */
export const selfRegister = async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const accountType = String(body.account_type ?? "member").trim().toLowerCase();
    if (accountType !== "member" && accountType !== "guest") {
      return fail(res, 400, "account_type must be member or guest.");
    }
    const isGuest = accountType === "guest";

    const firstName = text(body.first_name, 100);
    const lastName = text(body.last_name, 100);
    const otherName = text(body.other_name, 100);
    const title = text(body.title, 30);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone ?? body.primary_number);
    const countryCode = normalizeCountryCode(body.country_code) ?? "+233";

    const missing = [
      !firstName ? "first name" : null,
      !lastName ? "last name" : null,
      !email ? "a valid email" : null,
      !phone ? "a valid phone number" : null,
    ].filter(Boolean);
    if (missing.length) {
      return fail(res, 400, `Please provide ${missing.join(", ")}.`);
    }

    const existing = await prisma.user.findUnique({
      where: { email: email as string },
      select: { id: true },
    });
    if (existing) {
      return fail(
        res,
        409,
        "An account already exists for this email. Log in instead.",
        "ALREADY_REGISTERED",
      );
    }

    // No password is collected at sign-up; a random one keeps the account
    // closed until the member sets their own from the emailed link.
    const passwordHash = await hashPassword(crypto.randomBytes(24).toString("hex"));
    const name = [firstName, otherName, lastName].filter(Boolean).join(" ");

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        is_user: false,
        is_active: true,
        is_guest: isGuest,
        registration_source: REGISTRATION_SOURCE_MOBILE,
        // Members queue for confirmation; guests have no membership status.
        status: isGuest ? null : "UNCONFIRMED",
        branch_id: await resolveBranchIdOrDefault(body.branch_id),
        user_info: {
          create: {
            title,
            first_name: firstName,
            other_name: otherName,
            last_name: lastName,
            // Required column; sign-up doesn't ask. Completed from the profile.
            gender: "",
            email,
            primary_number: phone,
            country_code: countryCode,
          },
        },
      },
      select: { id: true, name: true, email: true, password: true },
    });

    if (!isGuest) {
      await userService
        .generateUserId(user)
        .catch((error) => console.error("Error generating member ID:", error));
    }

    try {
      await sendEmail(
        selfRegistrationTemplate({
          user_name: firstName as string,
          link: buildSetPasswordLink(user.id, email as string, passwordHash),
          is_guest: isGuest,
          expiration: SET_PASSWORD_EXPIRY_LABEL,
        }),
        email as string,
        "Welcome to Worldwide Word Ministries",
      );
    } catch (error) {
      // The account exists and the session below works; "Forgot password?"
      // recovers the set-password step if this email never arrives.
      console.error("Failed to send self-registration email:", error);
    }

    const token = await issueSessionTokenForUser(user.id);
    return res.status(201).json({
      message: isGuest ? "Welcome! You've joined as a guest." : "Account created.",
      token,
      data: { id: user.id, name: user.name, email: user.email, is_guest: isGuest },
    });
  } catch (error: any) {
    console.error(error);
    if (error?.code === "P2002") {
      return fail(
        res,
        409,
        "An account already exists for this email. Log in instead.",
        "ALREADY_REGISTERED",
      );
    }
    return fail(res, 500, "We couldn't create your account right now.");
  }
};

/* ------------------------------------------------------------------ */
/* Guest -> membership requests (guest-facing)                          */
/* ------------------------------------------------------------------ */

const REQUEST_SELECT = {
  id: true,
  status: true,
  message: true,
  requested_at: true,
  decided_at: true,
  decline_reason: true,
} as const;

/** POST /user/membership-request — a guest asks to become a member. */
export const createMembershipRequest = async (req: Request, res: Response) => {
  const userId = getRequestUserId(req);
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, is_guest: true, branch_id: true },
    });
    if (!user) return fail(res, 404, "User not found.");
    if (!user.is_guest) {
      return fail(res, 400, "You're already a member.", "ALREADY_MEMBER");
    }

    const pending = await prisma.membership_request.findFirst({
      where: { user_id: userId, status: "PENDING" },
      select: REQUEST_SELECT,
    });
    if (pending) {
      return res.status(200).json({
        message: "Your membership request is already with the church office.",
        data: pending,
      });
    }

    const request = await prisma.membership_request.create({
      data: {
        user_id: userId,
        message: text(req.body?.message, 2000),
        branch_id: user.branch_id ?? null,
      },
      select: REQUEST_SELECT,
    });

    return res.status(201).json({ message: "Membership request sent.", data: request });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "We couldn't send your request right now.");
  }
};

/** GET /user/membership-request/mine — the caller's latest request, or null. */
export const getMyMembershipRequest = async (req: Request, res: Response) => {
  const userId = getRequestUserId(req);
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const request = await prisma.membership_request.findFirst({
      where: { user_id: userId },
      orderBy: { requested_at: "desc" },
      select: REQUEST_SELECT,
    });
    return res.status(200).json({ message: "Operation successful", data: request });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "Internal Server Error");
  }
};

/* ------------------------------------------------------------------ */
/* Dashboard: Guests and Guest to membership                           */
/* ------------------------------------------------------------------ */

const GUEST_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  member_id: true,
  created_at: true,
  is_active: true,
  is_guest: true,
  registration_source: true,
  branch_id: true,
  user_info: {
    select: {
      title: true,
      first_name: true,
      other_name: true,
      last_name: true,
      primary_number: true,
      country_code: true,
      gender: true,
      city: true,
      country: true,
    },
  },
} as const;

const searchWhere = (search: unknown) => {
  const term = typeof search === "string" ? search.trim() : "";
  if (!term) return null;
  return {
    OR: [
      { name: { contains: term } },
      { email: { contains: term } },
      { user_info: { is: { primary_number: { contains: term } } } },
    ],
  };
};

const pageArgs = (query: Request["query"]) => {
  const page = toPositiveInt(query.page) ?? 1;
  const take = Math.min(toPositiveInt(query.take ?? query.limit) ?? 50, 500);
  return { page, take, skip: (page - 1) * take };
};

/**
 * GET /user/guests — Visitors > Guests: everyone who joined as a guest from
 * the app (and is still a guest), newest first, with their latest membership
 * request so the page can flag who has asked to join.
 */
export const listGuests = async (req: Request, res: Response) => {
  try {
    const { page, take, skip } = pageArgs(req.query);
    const where: any = {
      AND: [
        { is_guest: true },
        getBranchScopedWhere(req.query?.branch_id) ?? {},
        searchWhere(req.query?.search) ?? {},
      ],
    };

    const [total, guests] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take,
        select: {
          ...GUEST_USER_SELECT,
          membership_requests: {
            orderBy: { requested_at: "desc" },
            take: 1,
            select: REQUEST_SELECT,
          },
        },
      }),
    ]);

    const items = guests.map(({ membership_requests, ...guest }) => ({
      ...guest,
      membership_request: membership_requests[0] ?? null,
    }));

    return res.status(200).json({
      message: "Operation successful",
      data: { items, total, page, take },
    });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "Internal Server Error");
  }
};

/**
 * GET /user/membership-requests?status=PENDING|APPROVED|DECLINED|ALL —
 * Membership management > Guest to membership.
 */
export const listMembershipRequests = async (req: Request, res: Response) => {
  try {
    const { page, take, skip } = pageArgs(req.query);
    const status = String(req.query?.status ?? "PENDING").trim().toUpperCase();
    const where: any = {
      AND: [
        ["PENDING", "APPROVED", "DECLINED"].includes(status) ? { status } : {},
        getBranchScopedWhere(req.query?.branch_id) ?? {},
        req.query?.search ? { user: searchWhere(req.query.search) } : {},
      ],
    };

    const [total, requests] = await Promise.all([
      prisma.membership_request.count({ where }),
      prisma.membership_request.findMany({
        where,
        orderBy: { requested_at: "desc" },
        skip,
        take,
        select: {
          ...REQUEST_SELECT,
          user: { select: GUEST_USER_SELECT },
          decider: { select: { id: true, name: true } },
        },
      }),
    ]);

    return res.status(200).json({
      message: "Operation successful",
      data: { items: requests, total, page, take },
    });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "Internal Server Error");
  }
};

const loadPendingRequest = async (requestId: number) =>
  prisma.membership_request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      user_id: true,
      user: { select: { id: true, name: true, password: true, member_id: true, is_guest: true } },
    },
  });

/**
 * PATCH /user/membership-requests/approve?id= — the guest becomes a confirmed
 * member. The confirmation notification is sent by the status change itself
 * (`persistMemberStatus`), so this path and Member Confirmation tell the
 * member the same way.
 */
export const approveMembershipRequest = async (req: Request, res: Response) => {
  const actorId = getRequestUserId(req);
  const requestId = toPositiveInt(req.query?.id ?? req.body?.id);
  if (!requestId) return fail(res, 400, "Invalid or missing id.");

  try {
    const request = await loadPendingRequest(requestId);
    if (!request) return fail(res, 404, "Membership request not found.");
    if (request.status !== "PENDING") {
      return fail(res, 400, `This request was already ${request.status.toLowerCase()}.`);
    }

    await prisma.$transaction([
      prisma.membership_request.update({
        where: { id: requestId },
        data: { status: "APPROVED", decided_by: actorId, decided_at: new Date() },
      }),
      prisma.user.update({
        where: { id: request.user_id },
        data: { is_guest: false, status: null },
      }),
    ]);

    if (!request.user.member_id) {
      await userService
        .generateUserId(request.user)
        .catch((error) => console.error("Error generating member ID:", error));
    }

    const result = await userService.convertMemeberToConfirmedMember(request.user_id, "CONFIRMED");
    if (result.error) return fail(res, 400, result.error);

    return res.status(200).json({ message: `${request.user.name} is now a confirmed member.`, data: null });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "Internal Server Error");
  }
};

/** PATCH /user/membership-requests/decline?id= body { reason? } */
export const declineMembershipRequest = async (req: Request, res: Response) => {
  const actorId = getRequestUserId(req);
  const requestId = toPositiveInt(req.query?.id ?? req.body?.id);
  if (!requestId) return fail(res, 400, "Invalid or missing id.");
  const reason = text(req.body?.reason, 2000);

  try {
    const request = await loadPendingRequest(requestId);
    if (!request) return fail(res, 404, "Membership request not found.");
    if (request.status !== "PENDING") {
      return fail(res, 400, `This request was already ${request.status.toLowerCase()}.`);
    }

    await prisma.membership_request.update({
      where: { id: requestId },
      data: {
        status: "DECLINED",
        decided_by: actorId,
        decided_at: new Date(),
        decline_reason: reason,
      },
    });

    await notificationService
      .createInAppNotification({
        type: "membership.request_declined",
        title: "About your membership request",
        body: `The church office couldn't approve your membership request right now.${
          reason ? ` Note: ${reason}` : ""
        } You can still join us as a guest, and reach out to the office with any questions.`,
        recipientUserId: request.user_id,
        actorUserId: actorId,
        entityType: "membership_request",
        entityId: requestId,
        priority: "MEDIUM",
        dedupeKey: `membership.request_declined:${requestId}`,
      })
      .catch((error) => console.error("Failed to send decline notification:", error));

    return res.status(200).json({ message: "Request declined.", data: null });
  } catch (error) {
    console.error(error);
    return fail(res, 500, "Internal Server Error");
  }
};

/* ------------------------------------------------------------------ */
/* Own profile                                                          */
/* ------------------------------------------------------------------ */

/**
 * PUT /user/me/profile — the signed-in member completes their own record.
 * Partial: send only the sections being saved. Church fields (status,
 * membership type, departments, member ID) and login access are not
 * accepted here; they stay with the church office.
 *
 * Body sections:
 *   personal_info { title, first_name, other_name, last_name, gender,
 *                   date_of_birth, marital_status, nationality }
 *   contact_info  { email, phone: { country_code, number }, other_number,
 *                   address, city, state_region, country }
 *   emergency_contact { name, relation, phone: { country_code, number } }
 *   work_info     { employment_status, work_name, work_industry,
 *                   work_position, school_name }
 */
export const updateMyProfile = async (req: Request, res: Response) => {
  const userId = getRequestUserId(req);
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const body = req.body ?? {};
    const has = (section: string) =>
      body[section] !== undefined && body[section] !== null && typeof body[section] === "object";

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { user_info: { include: { work_info: true, emergency_contact: true } } },
    });
    if (!existing) return fail(res, 404, "User not found.");

    const info: Record<string, any> = {};
    const userData: Record<string, any> = {};

    if (has("personal_info")) {
      const p = body.personal_info;
      if ("title" in p) info.title = text(p.title, 30);
      if ("first_name" in p) {
        if (!hasValue(p.first_name)) return fail(res, 400, "First name can't be empty.");
        info.first_name = text(p.first_name, 100);
      }
      if ("last_name" in p) {
        if (!hasValue(p.last_name)) return fail(res, 400, "Last name can't be empty.");
        info.last_name = text(p.last_name, 100);
      }
      if ("other_name" in p) info.other_name = text(p.other_name, 100);
      if ("gender" in p) {
        const gender = normalizeGender(p.gender);
        if (!gender) return fail(res, 400, "Gender must be Male or Female.");
        info.gender = gender;
      }
      if ("date_of_birth" in p) {
        if (!hasValue(p.date_of_birth)) {
          info.date_of_birth = null;
        } else {
          const dob = new Date(String(p.date_of_birth));
          if (Number.isNaN(dob.getTime()) || dob > new Date()) {
            return fail(res, 400, "Enter a valid date of birth.");
          }
          info.date_of_birth = dob;
        }
      }
      if ("marital_status" in p) {
        const marital = String(p.marital_status ?? "").trim().toUpperCase();
        if (marital && !MARITAL_STATUSES.has(marital)) {
          return fail(res, 400, "Choose a valid marital status.");
        }
        info.marital_status = marital || null;
      }
      if ("nationality" in p) info.nationality = text(p.nationality, 100);
    }

    if (has("contact_info")) {
      const c = body.contact_info;
      if ("email" in c) {
        const email = normalizeEmail(c.email);
        if (!email) return fail(res, 400, "Enter a valid email address.");
        if (email !== existing.email) {
          const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
          if (taken && taken.id !== userId) {
            return fail(res, 409, "Another account already uses this email.");
          }
        }
        info.email = email;
        userData.email = email;
      }
      if (c.phone && typeof c.phone === "object") {
        const number = normalizePhone(c.phone.number);
        if (!number) return fail(res, 400, "Enter a valid primary phone number.");
        info.primary_number = number;
        info.country_code = normalizeCountryCode(c.phone.country_code) ?? existing.user_info?.country_code ?? "+233";
      }
      if ("other_number" in c) {
        if (hasValue(c.other_number) && !normalizePhone(c.other_number)) {
          return fail(res, 400, "Enter a valid other phone number.");
        }
        info.other_number = normalizePhone(c.other_number);
      }
      if ("address" in c) info.address = text(c.address);
      if ("city" in c) info.city = text(c.city, 100);
      if ("state_region" in c) info.state_region = text(c.state_region, 100);
      if ("country" in c) info.country = text(c.country, 100);
    }

    if (has("emergency_contact")) {
      const e = body.emergency_contact;
      const name = text(e.name, 150);
      const relation = text(e.relation, 50);
      const phoneNumber = normalizePhone(e.phone?.number);
      if (!name || !relation || !phoneNumber) {
        return fail(res, 400, "Emergency contact needs a name, relationship and phone number.");
      }
      const data = {
        name,
        relation,
        phone_number: phoneNumber,
        country_code: normalizeCountryCode(e.phone?.country_code) ?? "+233",
      };
      info.emergency_contact = existing.user_info?.emergency_contact
        ? { update: data }
        : { create: data };
    }

    if (has("work_info")) {
      const w = body.work_info;
      const workInput = {
        employment_status: w.employment_status,
        work_name: w.work_name,
        work_industry: w.work_industry,
        work_position: w.work_position,
        school_name: w.school_name,
      };
      if (hasAnyWorkInfoPayload(workInput)) {
        const existingWork = existing.user_info?.work_info;
        const missing = getMissingRequiredWorkFields(workInput, existingWork);
        if (missing.length) {
          return fail(res, 400, "Add where you work, the industry and your position.");
        }
        const data = buildPersistedWorkInfoData(workInput, existingWork);
        info.work_info = existingWork ? { update: data } : { create: data };
      }
    }

    if (!Object.keys(info).length) {
      return fail(res, 400, "Nothing to update.");
    }

    // Keep the display name in step with the name parts.
    if ("first_name" in info || "other_name" in info || "last_name" in info) {
      const pick = (key: "first_name" | "other_name" | "last_name") =>
        key in info ? info[key] : existing.user_info?.[key];
      userData.name =
        [pick("first_name"), pick("other_name"), pick("last_name")].filter(hasValue).join(" ") ||
        existing.name;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...userData,
        user_info: {
          upsert: {
            // `gender` is a required column; "" until the member picks one.
            create: { gender: "", ...info },
            update: info,
          },
        },
      },
    });

    return res.status(200).json({ message: "Profile updated.", data: null });
  } catch (error: any) {
    console.error(error);
    if (error?.code === "P2002") {
      return fail(res, 409, "Another account already uses this email.");
    }
    return fail(res, 500, "We couldn't save your profile right now.");
  }
};
