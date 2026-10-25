import e, { Request, Response } from "express";
import JWT from "jsonwebtoken";
import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import { prisma } from "../../Models/context";
import { getRequestAccess, hasActionPermission } from "../../middleWare/authorization";
import {
  sendEmail,
  comparePassword,
  hashPassword,
} from "../../utils";
import { UserService } from "./userService";
import {
  NormalizedDepartmentPosition,
  normalizeDepartmentPositions,
} from "./departmentPositionUtils";
import { buildMembershipStatusTimestampData } from "./membershipStatusTimestamps";
import { buildMemberSource } from "./memberSource";
import {
  callerActionAllowed,
  canSeeContactDetails,
  denyAction,
  denyMembersOutOfReach,
  maskContactDetails,
  memberExclusionIds,
  memberScopeWhere,
  membersActionAllowed,
} from "./memberAccess";
import { computeEnrollmentProgress } from "./enrollmentProgress";
import { parseOtherNumber } from "./otherNumber";
import { CourseService } from "../programs/courseService";
import { LifeCenterService } from "../lifeCenterMangement/lifeCenterService";
// import { forgetPasswordTemplate } from "../../utils/mail_templates/forgot-password";
// import { forgetPasswordTemplate } from "../../utils/mail_templates/forgetPasswordTemplate";
import { forgetPasswordTemplate } from "../../utils/mail_templates/forgotPasswordTemplate";
import { userActivatedTemplate } from "../../utils/mail_templates/userActivatedTemplate";
import { activateUserTemplate } from "../../utils/mail_templates/activateUserTemplate";
import {
  FAMILY_RELATION,
  getReciprocalFamilyRelation,
  normalizeFamilyRelation,
  pruneMissingBidirectionalFamilyRelations,
  toFamilyRelationLabel,
  upsertBidirectionalFamilyRelation,
} from "./familyRelations";
import {
  buildPersistedWorkInfoData,
  getMissingRequiredWorkFields,
  hasAnyWorkInfoPayload,
} from "./workInfoUtils";
import { MinimumAccessLevel, userHasMinimumDomainAccess } from "../../utils/permissionResolver";
import {
  buildPositionEligibilityFailureResponse,
  buildRoleEligibilityFailureResponse,
  isPositionEligibilityValidationError,
  isRoleEligibilityValidationError,
  roleEligibilityService,
} from "../settings/roleEligibilityService";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { Prisma } from "@prisma/client";
import { buildPrismaError } from "../../middleWare/errorHandler";
import { sessionChanged, sessionRevoked } from "../realtime/realtimeSession";
import {
  assertCanGrantInBranches,
  listUserBranchGrants,
  setBranchGrants,
} from "../accessLevels/branchAccessService";
import { BranchAccessError } from "../branches/branchService";
import { resolveWorkspaces } from "../workspaces/workspaceKeys";
import { sessionReasonsForUserUpdate } from "../realtime/sessionNotifier";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";

dotenv.config();

const JWT_SECRET: any = process.env.JWT_SECRET;
const userService = new UserService();
const courseService = new CourseService();
const lifeCenterService = new LifeCenterService();

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
    emailPattern.test(normalizedEmail) && !normalizedEmail.endsWith("@temp.com")
  );
};

const hasOwn = (obj: unknown, key: string) =>
  !!obj &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key);

const normalizeMemberPayload = (payload: any = {}) => {
  const personalInfo = { ...(payload?.personal_info || {}) };
  const contactInfo = { ...(payload?.contact_info || {}) };
  const contactPhone = { ...(contactInfo?.phone || {}) };
  const churchInfo = { ...(payload?.church_info || {}) };
  const workInfo = { ...(payload?.work_info || {}) };

  const topLevelToPersonalInfo: Record<string, string> = {
    title: "title",
    first_name: "first_name",
    last_name: "last_name",
    other_name: "other_name",
    date_of_birth: "date_of_birth",
    gender: "gender",
    marital_status: "marital_status",
    nationality: "nationality",
    has_children: "has_children",
  };

  for (const [sourceKey, targetKey] of Object.entries(topLevelToPersonalInfo)) {
    if (!hasOwn(personalInfo, targetKey) && hasOwn(payload, sourceKey)) {
      personalInfo[targetKey] = payload[sourceKey];
    }
  }

  const topLevelToContactInfo: Record<string, string> = {
    email: "email",
    resident_country: "resident_country",
    state_region: "state_region",
    city: "city",
  };

  for (const [sourceKey, targetKey] of Object.entries(topLevelToContactInfo)) {
    if (!hasOwn(contactInfo, targetKey) && hasOwn(payload, sourceKey)) {
      contactInfo[targetKey] = payload[sourceKey];
    }
  }

  if (
    !hasOwn(contactPhone, "country_code") &&
    hasOwn(payload, "country_code")
  ) {
    contactPhone.country_code = payload.country_code;
  }

  if (!hasOwn(contactPhone, "number")) {
    if (hasOwn(payload, "primary_number")) {
      contactPhone.number = payload.primary_number;
    } else if (hasOwn(payload, "phone_number")) {
      contactPhone.number = payload.phone_number;
    }
  }

  contactInfo.phone = contactPhone;

  const topLevelToChurchInfo: Record<string, string> = {
    membership_type: "membership_type",
    position_id: "position_id",
    department_id: "department_id",
    member_since: "member_since",
    branch_id: "branch_id",
  };

  for (const [sourceKey, targetKey] of Object.entries(topLevelToChurchInfo)) {
    if (!hasOwn(churchInfo, targetKey) && hasOwn(payload, sourceKey)) {
      churchInfo[targetKey] = payload[sourceKey];
    }
  }

  const topLevelToWorkInfo: Record<string, string> = {
    employment_status: "employment_status",
    work_name: "work_name",
    work_industry: "work_industry",
    work_position: "work_position",
    school_name: "school_name",
  };

  for (const [sourceKey, targetKey] of Object.entries(topLevelToWorkInfo)) {
    if (!hasOwn(workInfo, targetKey) && hasOwn(payload, sourceKey)) {
      workInfo[targetKey] = payload[sourceKey];
    }
  }

  return {
    ...payload,
    personal_info: personalInfo,
    contact_info: contactInfo,
    church_info: churchInfo,
    work_info: workInfo,
  };
};

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const normalizeOptionalText = (value: unknown) => {
  if (!hasValue(value)) return null;
  return String(value).trim();
};

const normalizeGenderValue = (value: unknown) => {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) return null;

  const normalizedLower = normalizedValue.toLowerCase();
  if (normalizedLower === "male" || normalizedLower === "m") return "Male";
  if (normalizedLower === "female" || normalizedLower === "f") return "Female";
  if (normalizedLower === "other") return "Other";

  return normalizedValue;
};

const buildMissingFieldsMessage = (
  baseMessage: string,
  missingFields: string[],
) => {
  if (!missingFields.length) {
    return baseMessage;
  }

  return `${baseMessage} Missing required fields: ${missingFields.join(", ")}.`;
};

const parsePermissionsObject = (
  permissions: any,
): Record<string, any> | null => {
  if (!permissions) return null;

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return null;

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions);
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Record<string, any>;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  if (typeof permissions === "object" && !Array.isArray(permissions)) {
    return permissions as Record<string, any>;
  }

  return null;
};

const canRunSensitiveUserOps = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const allowSensitiveOps = process.env.ALLOW_ADMIN_UTIL_ENDPOINTS === "true";
  return !isProduction || allowSensitiveOps;
};

const isFamilyRelationValidationError = (errorMessage?: string) => {
  if (!errorMessage) return false;

  const relationValidationIndicators = [
    "Unsupported family relation",
    "A member cannot create a relationship with themselves.",
    "Duplicate relationship for member ID",
    "Duplicate spouse relationships are not allowed.",
    "Family member not found.",
    "Spouse user not found.",
  ];

  return relationValidationIndicators.some((indicator) =>
    errorMessage.includes(indicator),
  );
};

export const landingPage = async (req: Request, res: Response) => {
  res.send(
    // `<h1>Welcome to Worldwide Word Ministries Backend Server🔥🎉💒</h1>`
    `<h1>Welcome to Worldwide Word Ministries Backend Server🔥🎉🙏💒...</h1>`,
  );
};

const selectQuery = {
  id: true,
  name: true,
  email: true,
  membership_type: true,
  created_at: true,
  is_active: true,
  position_id: true,
  department_id: true,
  access_level_id: true,
  member_id: true,
  status: true,
  user_info: {
    select: {
      first_name: true,
      last_name: true,
      other_name: true,
      country_code: true,
      primary_number: true,
      title: true,
      photo: true,
      marital_status: true,
      nationality: true,
      state_region: true,
      city: true,
      date_of_birth: true,
      gender: true,
      country: true,
      occupation: true,
      company: true,
      address: true,
      member_since: true,
      emergency_contact: {
        select: {
          name: true,
          country_code: true,
          phone_number: true,
          relation: true,
        },
      },
      work_info: {
        select: {
          name_of_institution: true,
          industry: true,
          position: true,
        },
      },
    },
  },
  department: {
    select: {
      department_info: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  position: {
    select: {
      id: true,
      name: true,
    },
  },
};

const PUBLIC_MEMBERSHIP_TYPES = new Set(["ONLINE", "IN_HOUSE"]);

const pickObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

/**
 * POST /user/public-register: the church's public "become a member" form.
 * Only the person's own details are accepted. Everything that grants or
 * places them (status, sign-in, password, departments, positions, the
 * visitor/soul they came from, linking an existing spouse) is fixed or
 * dropped, so the form can't create a confirmed member or an admin.
 */
export const publicRegisterMember = async (req: Request, res: Response) => {
  const body = pickObject(req.body);
  const churchInfo = pickObject(body.church_info);
  const membershipType = String(churchInfo.membership_type || "").toUpperCase();
  const branchId = Number(churchInfo.branch_id);
  const branch =
    Number.isInteger(branchId) && branchId > 0
      ? await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } })
      : null;
  const stripLink = (member: unknown) => {
    const { user_id: _userId, id: _id, ...rest } = pickObject(member);
    return rest;
  };

  req.body = {
    personal_info: pickObject(body.personal_info),
    picture: pickObject(body.picture),
    contact_info: pickObject(body.contact_info),
    work_info: pickObject(body.work_info),
    emergency_contact: pickObject(body.emergency_contact),
    church_info: {
      membership_type: PUBLIC_MEMBERSHIP_TYPES.has(membershipType) ? membershipType : "ONLINE",
      member_since: churchInfo.member_since,
      ...(branch ? { branch_id: branch.id } : {}),
    },
    family: Array.isArray(body.family) ? body.family.map(stripLink) : [],
    children: Array.isArray(body.children) ? body.children.map(stripLink) : [],
    status: "UNCONFIRMED",
    is_user: false,
  };
  return registerUser(req, res);
};

const positiveIdOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Dashboard "Add member": Members › Add members; a conversion also needs the convert action
 * (visitor: Membership management › Convert visitors or Visitors › Convert
 * to member; soul won: Membership management › Convert souls won), and the
 * source record must be in a branch the caller works in.
 */
const denyRegisterWithoutActions = async (
  req: Request,
  res: Response,
  payload: any,
): Promise<boolean> => {
  if (denyAction(res, membersActionAllowed(req, "create"), "You don't have permission to add members.")) {
    return true;
  }
  const branchScope = getBranchScope();
  const visitorId = positiveIdOrNull(payload?.source_visitor_id);
  if (visitorId) {
    if (
      denyAction(
        res,
        callerActionAllowed(req, "Membership_Management", "convert_visitor") ||
          callerActionAllowed(req, "Visitors", "convert_to_member"),
        "You don't have permission to convert visitors to members.",
      )
    ) {
      return true;
    }
    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      select: { branch_id: true },
    });
    if (
      visitor?.branch_id &&
      denyAction(res, isBranchAllowed(branchScope, visitor.branch_id), "This visitor belongs to another branch.")
    ) {
      return true;
    }
  }
  const soulId = positiveIdOrNull(payload?.source_soul_won_id);
  if (soulId) {
    if (
      denyAction(
        res,
        callerActionAllowed(req, "Membership_Management", "convert_soul"),
        "You don't have permission to convert souls won to members.",
      )
    ) {
      return true;
    }
    const soul = await prisma.soul_won.findUnique({
      where: { id: soulId },
      select: { lifeCenter: { select: { branch_id: true } } },
    });
    const soulBranchId = soul?.lifeCenter?.branch_id;
    if (
      soulBranchId &&
      denyAction(res, isBranchAllowed(branchScope, soulBranchId), "This soul won belongs to another branch.")
    ) {
      return true;
    }
  }
  return false;
};

export const registerUser = async (req: Request, res: Response) => {
  try {
    const normalizedPayload = normalizeMemberPayload(req.body);
    const {
      personal_info: { first_name } = {},

      contact_info: { email } = {},

      password,
      is_user,
    } = normalizedPayload;

    const normalizedEmail = normalizeOptionalEmail(email);
    const isLoginUser =
      is_user === true ||
      is_user === "true" ||
      is_user === 1 ||
      is_user === "1";

    if (await denyRegisterWithoutActions(req, res, normalizedPayload)) {
      return;
    }

    if (isLoginUser && !isRealEmail(normalizedEmail)) {
      return res.status(400).json({
        message:
          "A valid non-temporary email is required when creating a login user.",
        data: null,
      });
    }

    const existance = normalizedEmail
      ? await prisma.user.findUnique({
          where: { email: normalizedEmail },
        })
      : null;

    if (existance) {
      return res.status(404).json({
        message: "User exist with this email " + normalizedEmail,
        data: null,
      });
    }

    const response = await userService.registerUser(normalizedPayload);

    return res
      .status(201)
      .json({ message: "User Created Successfully", data: response });
  } catch (error: any) {
    console.error(error);

    if (isPositionEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildPositionEligibilityFailureResponse(error));
    }

    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }

    if (error instanceof InputValidationError) {
      return res.status(400).json({
        message: error.message,
        data: null,
      });
    }

    if (isFamilyRelationValidationError(error?.message)) {
      return res.status(400).json({
        message: error?.message,
        data: null,
      });
    }

    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
  }
};

/**
 * A role that can't see contact details gets them masked (null) on the edit
 * form; drop them from the payload so saving doesn't wipe the stored values.
 */
const withoutHiddenContactDetails = (payload: any) => {
  const { email, phone, other_number, state_region, city, ...contactInfo } =
    payload?.contact_info || {};
  const { emergency_contact, ...rest } = payload || {};
  return { ...rest, contact_info: contactInfo };
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const normalizedPayload = canSeeContactDetails(req, Number(req.query?.user_id))
      ? normalizeMemberPayload(req.body)
      : withoutHiddenContactDetails(normalizeMemberPayload(req.body));
    const { user_id } = req.query;
    const contactInfoPayload = normalizedPayload?.contact_info || {};
    const hasEmailField = Object.prototype.hasOwnProperty.call(
      contactInfoPayload,
      "email",
    );
    const {
      personal_info: {
        title,
        first_name,
        last_name,
        other_name,
        date_of_birth,
        gender,
        marital_status,
        nationality,
        has_children,
      } = {},
      picture = {},
      contact_info: {
        email,
        resident_country,
        state_region,
        city,
        phone: { country_code, number: primary_number } = {},
      } = {},
      work_info: {
        employment_status,
        work_name,
        work_industry,
        work_position,
        school_name,
      } = {},
      emergency_contact: {
        name: emergency_contact_name,
        relation: emergency_contact_relation,
        phone: {
          country_code: emergency_country_code,
          number: emergency_phone_number,
        } = {},
      } = {},
      church_info: {
        membership_type,
        position_id,
        department_id,
        member_since,
        branch_id,
      } = {},
      children = [],
      family = [],
      status,
      is_user,
      department_positions,
    } = normalizedPayload;
    const hasFamilyField = Object.prototype.hasOwnProperty.call(
      normalizedPayload,
      "family",
    );
    const hasPrimaryPositionField =
      hasOwn(normalizedPayload?.church_info, "position_id") ||
      hasOwn(normalizedPayload, "position_id");

    const userExists = await prisma.user.findUnique({
      where: { id: Number(user_id) },
      include: {
        user_info: {
          include: {
            work_info: true,
            emergency_contact: true,
          },
        },
      },
    });

    if (!userExists) {
      return res.status(400).json({ message: "User not found", data: null });
    }

    const existingEmail = normalizeOptionalEmail(userExists?.email);
    const incomingEmail = normalizeOptionalEmail(email);
    const nextIsUser =
      typeof is_user === "boolean"
        ? is_user
        : is_user === "true" || is_user === "1"
          ? true
          : is_user === "false" || is_user === "0"
            ? false
            : userExists?.is_user;
    const nextEmail = hasEmailField ? incomingEmail : existingEmail;
    const nextAccessLevelId = nextIsUser ? userExists?.access_level_id : null;
    const nextStatus = String(status || userExists?.status || "")
      .trim()
      .toUpperCase();

    if (await denyMembersOutOfReach(req, res, [userExists.id])) return;
    const storedStatus = String(userExists?.status || "UNCONFIRMED").toUpperCase();
    const requestedBranchId = Number(branch_id);
    if (
      denyAction(res, membersActionAllowed(req, "edit"), "You don't have permission to edit members.") ||
      // Turning "ministry worker" off removes their roles in every branch,
      // i.e. their admin sign-in (Members › Give admin sign-in).
      (!nextIsUser &&
        userExists?.is_user &&
        (await prisma.user_branch_access.count({ where: { user_id: userExists.id } })) > 0 &&
        denyAction(
          res,
          membersActionAllowed(req, "grant_login"),
          "You don't have permission to remove a member's admin sign-in.",
        )) ||
      (Boolean(status) &&
        nextStatus !== storedStatus &&
        denyAction(
          res,
          membersActionAllowed(req, "change_status") ||
            callerActionAllowed(req, "Membership_Management", "confirm_member"),
          "You don't have permission to change membership status.",
        )) ||
      (hasFamilyField &&
        Array.isArray(family) &&
        family.length > 0 &&
        denyAction(
          res,
          membersActionAllowed(req, "link_family"),
          "You don't have permission to link family members.",
        )) ||
      (Number.isInteger(requestedBranchId) &&
        requestedBranchId > 0 &&
        requestedBranchId !== userExists?.branch_id &&
        denyAction(
          res,
          isBranchAllowed(getBranchScope(), requestedBranchId),
          "You can only move members into branches you have access to.",
        ))
    ) {
      return;
    }

    if (nextIsUser && !isRealEmail(nextEmail)) {
      return res.status(400).json({
        message:
          "A valid non-temporary email is required for users with login access.",
        data: null,
      });
    }

    if (hasEmailField && incomingEmail && incomingEmail !== existingEmail) {
      const emailExists = await prisma.user.findUnique({
        where: { email: incomingEmail },
      });

      if (emailExists) {
        return res.status(409).json({
          message: "User exist with this email " + incomingEmail,
          data: null,
        });
      }
    }

    if (nextIsUser && !userExists?.is_user) {
      await roleEligibilityService.assertEligible(
        "ministry_worker",
        Number(user_id),
      );
    }

    if (nextStatus === "MEMBER" && userExists?.status !== "MEMBER") {
      await roleEligibilityService.assertEligible("member", Number(user_id));
    }

    const parsedNextPositionId = hasPrimaryPositionField
      ? Number(position_id)
      : null;
    const validNextPositionId =
      typeof parsedNextPositionId === "number" &&
      Number.isInteger(parsedNextPositionId) &&
      parsedNextPositionId > 0
        ? parsedNextPositionId
        : null;

    if (validNextPositionId) {
      await roleEligibilityService.assertEligibleForPosition(
        validNextPositionId,
        Number(user_id),
      );
    }

    const departmentPositionIds =
      Array.isArray(department_positions) && department_positions.length > 0
        ? Array.from(
            new Set(
              department_positions
                .map((departmentPosition: { position_id?: unknown }) =>
                  Number(departmentPosition?.position_id),
                )
                .filter(
                  (departmentPositionId) =>
                    Number.isInteger(departmentPositionId) &&
                    departmentPositionId > 0,
                ),
            ),
          )
        : [];

    for (const departmentPositionId of departmentPositionIds) {
      await roleEligibilityService.assertEligibleForPosition(
        departmentPositionId,
        Number(user_id),
      );
    }

    // `department_positions` present as an array (even empty) replaces the
    // member's rows; absent leaves them untouched. Validated up front so a bad
    // payload fails before anything is written.
    const normalizedDepartmentPositions: NormalizedDepartmentPosition[] | null =
      Array.isArray(department_positions)
        ? normalizeDepartmentPositions(department_positions)
        : null;

    // undefined = absent (untouched), null = cleared; throws 400 when invalid.
    const otherNumber = parseOtherNumber(contactInfoPayload);

    const normalizedGender = normalizeGenderValue(gender);
    const resolvedUserInfoGender =
      normalizedGender || userExists?.user_info?.gender || null;
    const shouldCreateUserInfo = !userExists?.user_info;

    const hasEmergencyContactPayload =
      hasValue(emergency_contact_name) ||
      hasValue(emergency_contact_relation) ||
      hasValue(emergency_country_code) ||
      hasValue(emergency_phone_number);

    if (!resolvedUserInfoGender) {
      const missingProfileFields = ["personal_info.gender"];

      return res.status(400).json({
        message: buildMissingFieldsMessage(
          shouldCreateUserInfo
            ? "User profile details are missing and could not be created from this request."
            : "User profile details are invalid and could not be updated.",
          missingProfileFields,
        ),
        data: null,
      });
    }

    const userInfoUpdateData: any = {
      title,
      first_name,
      last_name,
      other_name,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : undefined,
      gender: normalizedGender || undefined,
      marital_status,
      nationality,
      photo: picture?.src,
      email: hasEmailField ? incomingEmail : undefined,
      country: resident_country,
      state_region,
      city,
      country_code,
      primary_number,
      other_number: otherNumber,
      member_since: member_since ? new Date(member_since) : undefined,
    };
    const userInfoCreateData: any = {
      title,
      first_name,
      last_name,
      other_name,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
      gender: resolvedUserInfoGender,
      marital_status,
      nationality,
      photo: picture?.src || "",
      email: nextEmail,
      country: resident_country,
      state_region,
      city,
      country_code,
      primary_number,
      other_number: otherNumber ?? null,
      member_since: member_since ? new Date(member_since) : null,
    };

    if (hasEmergencyContactPayload) {
      const missingEmergencyFields = [
        !hasValue(emergency_contact_name) ? "emergency_contact.name" : null,
        !hasValue(emergency_contact_relation)
          ? "emergency_contact.relation"
          : null,
        !hasValue(emergency_phone_number)
          ? "emergency_contact.phone.number"
          : null,
      ].filter((field): field is string => Boolean(field));

      if (missingEmergencyFields.length > 0) {
        return res.status(400).json({
          message: buildMissingFieldsMessage(
            "Emergency contact could not be saved.",
            missingEmergencyFields,
          ),
          data: null,
        });
      }

      const emergencyContactData = {
        name: emergency_contact_name,
        relation: emergency_contact_relation,
        country_code: emergency_country_code,
        phone_number: emergency_phone_number,
      };

      if (userExists.user_info?.emergency_contact) {
        userInfoUpdateData.emergency_contact = {
          update: emergencyContactData,
        };
      } else {
        userInfoUpdateData.emergency_contact = {
          create: emergencyContactData,
        };
      }

      userInfoCreateData.emergency_contact = {
        create: emergencyContactData,
      };
    }

    const workInfoInput = {
      employment_status,
      work_name,
      work_industry,
      work_position,
      school_name,
    };
    const hasWorkInfoPayload = hasAnyWorkInfoPayload(workInfoInput);

    if (hasWorkInfoPayload) {
      const missingWorkFields = getMissingRequiredWorkFields(
        workInfoInput,
        userExists.user_info?.work_info,
      );

      if (missingWorkFields.length > 0) {
        return res.status(400).json({
          message: buildMissingFieldsMessage(
            "Work information could not be saved.",
            missingWorkFields,
          ),
          data: null,
        });
      }

      const workInfoData = buildPersistedWorkInfoData(
        workInfoInput,
        userExists.user_info?.work_info,
      );

      if (userExists.user_info?.work_info) {
        userInfoUpdateData.work_info = {
          update: workInfoData,
        };
      } else {
        userInfoUpdateData.work_info = {
          create: workInfoData,
        };
      }

      userInfoCreateData.work_info = {
        create: workInfoData,
      };
    }

    const nextNameParts = [
      hasValue(first_name) ? String(first_name).trim() : userExists?.user_info?.first_name,
      hasValue(other_name) ? String(other_name).trim() : userExists?.user_info?.other_name,
      hasValue(last_name) ? String(last_name).trim() : userExists?.user_info?.last_name,
    ].filter((part): part is string => hasValue(part));
    const nextDisplayName = nextNameParts.length
      ? nextNameParts.join(" ")
      : userExists?.name;

    const resolvedBranchId = await resolveBranchIdOrDefault(
      branch_id ?? userExists?.branch_id,
    );
    // The profile row and the department rows are written in one transaction
    // so a failed department write can't leave a half-saved member.
    const userUpdate = prisma.user.update({
      where: { id: Number(user_id) },
      data: {
        name: nextDisplayName,
        email: hasEmailField ? incomingEmail : userExists?.email,
        is_user: nextIsUser,
        access_level_id: nextAccessLevelId,
        status: status || userExists?.status,
        ...buildMembershipStatusTimestampData(
          userExists,
          status || userExists?.status,
        ),
        position_id: Number(position_id) || userExists?.position_id,
        department_id: Number(department_id) || userExists?.department_id,
        branch_id: resolvedBranchId,
        membership_type: membership_type || userExists?.membership_type,
        user_info: {
          upsert: {
            create: userInfoCreateData,
            update: userInfoUpdateData,
          },
        },
      },
      include: {
        user_info: {
          select: {
            photo: true,
          },
        },
      },
    });

    let dep_posts, kids;
    let updatedUser;

    if (normalizedDepartmentPositions) {
      const [savedUser, , ...createdPositions] = await prisma.$transaction([
        userUpdate,
        ...departmentPositionWrites(Number(user_id), normalizedDepartmentPositions),
      ]);
      updatedUser = savedUser;
      dep_posts = createdPositions;
    } else {
      updatedUser = await userUpdate;
    }

    // Losing admin sign-in removes their role in every branch.
    if (!nextIsUser && userExists?.is_user) {
      await prisma.user_branch_access.deleteMany({
        where: { user_id: updatedUser.id },
      });
    }

    void sessionChanged(
      [updatedUser.id],
      sessionReasonsForUserUpdate(userExists, updatedUser, Boolean(dep_posts)),
    );

    if (hasFamilyField) {
      if (!Array.isArray(family)) {
        return res.status(400).json({
          message: "family must be an array when provided.",
          data: null,
        });
      }
      await updateFamilyMembers(family, updatedUser);
    }
    // The client never returns the password hash (see Models/context.ts).
    const rest = updatedUser;

    const data = {
      parent: rest,
      department_positions: dep_posts,
      children: kids,
    };

    return res
      .status(200)
      .json({ message: "User updated successfully", data: data });
  } catch (error: any) {
    console.error(error);

    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }

    if (isFamilyRelationValidationError(error?.message)) {
      return res.status(400).json({
        message: error?.message,
        data: null,
      });
    }

    if (error instanceof InputValidationError) {
      return res.status(400).json({
        message: error.message,
        data: null,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = buildPrismaError(error);
      return res.status(prismaError.statusCode).json({
        message: prismaError.message,
        data: null,
      });
    }

    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
  }
};

async function updateFamilyMembers(family: any[], primaryUser: any) {
  const retainedFamilyIds = new Set<number>();
  const updatedMembers: any[] = [];
  let spouseUser: any = null;

  for (const member of family) {
    const relation = normalizeFamilyRelation(member?.relation);
    if (relation !== FAMILY_RELATION.SPOUSE) {
      continue;
    }

    if (spouseUser) {
      throw new Error("Duplicate spouse relationships are not allowed.");
    }

    if (member.user_id) {
      const hasEmailField = Object.prototype.hasOwnProperty.call(
        member,
        "email",
      );
      spouseUser = await prisma.user.update({
        where: { id: Number(member.user_id) },
        data: {
          name: `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ...(hasEmailField
            ? { email: normalizeOptionalEmail(member.email) }
            : {}),
          user_info: {
            upsert: {
              create: {
                title: member.title,
                first_name: member.first_name,
                last_name: member.last_name,
                other_name: member.other_name || null,
                date_of_birth: new Date(member.date_of_birth),
                gender: member.gender,
                marital_status: member.marital_status,
                nationality: member.nationality,
              },
              update: {
                title: member.title,
                first_name: member.first_name,
                last_name: member.last_name,
                other_name: member.other_name || null,
                date_of_birth: new Date(member.date_of_birth),
                gender: member.gender,
                marital_status: member.marital_status,
                nationality: member.nationality,
              },
            },
          },
        },
      });
    } else {
      spouseUser = await prisma.user.create({
        data: {
          name: `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          email: normalizeOptionalEmail(member.email),
          is_user: false,
          is_active: true,
          user_info: {
            create: {
              title: member.title,
              first_name: member.first_name,
              last_name: member.last_name,
              other_name: member.other_name || null,
              date_of_birth: new Date(member.date_of_birth),
              gender: member.gender,
              marital_status: member.marital_status,
              nationality: member.nationality,
            },
          },
        },
      });

      await userService.generateUserId(spouseUser);
    }

    retainedFamilyIds.add(spouseUser.id);
    await upsertBidirectionalFamilyRelation(
      primaryUser.id,
      spouseUser.id,
      relation,
    );
  }

  for (const member of family) {
    const relation = normalizeFamilyRelation(member?.relation);
    let familyUser: any;

    if (relation === FAMILY_RELATION.SPOUSE) {
      if (spouseUser) {
        updatedMembers.push(spouseUser);
      }
      continue;
    }

    if (member.user_id) {
      const hasEmailField = Object.prototype.hasOwnProperty.call(
        member,
        "email",
      );
      familyUser = await prisma.user.update({
        where: { id: Number(member.user_id) },
        data: {
          name: `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ...(hasEmailField
            ? { email: normalizeOptionalEmail(member.email) }
            : {}),
          user_info: {
            upsert: {
              create: {
                title: member.title,
                first_name: member.first_name,
                last_name: member.last_name,
                other_name: member.other_name || null,
                date_of_birth: new Date(member.date_of_birth),
                gender: member.gender,
                marital_status: member.marital_status,
                nationality: member.nationality,
              },
              update: {
                title: member.title,
                first_name: member.first_name,
                last_name: member.last_name,
                other_name: member.other_name || null,
                date_of_birth: new Date(member.date_of_birth),
                gender: member.gender,
                marital_status: member.marital_status,
                nationality: member.nationality,
              },
            },
          },
        },
      });
    } else if (relation === FAMILY_RELATION.CHILD) {
      familyUser = await prisma.user.findFirst({
        where: {
          user_info: {
            first_name: member.first_name,
            last_name: member.last_name,
            date_of_birth: new Date(member.date_of_birth),
          },
          OR: [{ parent_id: primaryUser.id }, { parent_id: spouseUser?.id }],
        },
      });

      if (!familyUser) {
        familyUser = await prisma.user.create({
          data: {
            name: `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
            email: normalizeOptionalEmail(member.email),
            parent_id: primaryUser.id,
            is_user: false,
            is_active: true,
            user_info: {
              create: {
                title: member.title,
                first_name: member.first_name,
                last_name: member.last_name,
                other_name: member.other_name || null,
                date_of_birth: new Date(member.date_of_birth),
                gender: member.gender,
                marital_status: member.marital_status,
                nationality: member.nationality,
              },
            },
          },
        });

        await userService.generateUserId(familyUser);
      }

      if (spouseUser) {
        await upsertBidirectionalFamilyRelation(
          spouseUser.id,
          familyUser.id,
          FAMILY_RELATION.CHILD,
        );
      }
    } else {
      familyUser = await prisma.user.create({
        data: {
          name: `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          email: normalizeOptionalEmail(member.email),
          is_user: false,
          is_active: true,
          user_info: {
            create: {
              title: member.title,
              first_name: member.first_name,
              last_name: member.last_name,
              other_name: member.other_name || null,
              date_of_birth: new Date(member.date_of_birth),
              gender: member.gender,
              marital_status: member.marital_status,
              nationality: member.nationality,
            },
          },
        },
      });

      await userService.generateUserId(familyUser);
    }

    if (!familyUser) {
      throw new Error("Family member not found.");
    }

    if (retainedFamilyIds.has(familyUser.id)) {
      throw new Error(`Duplicate relationship for member ID ${familyUser.id}.`);
    }

    retainedFamilyIds.add(familyUser.id);
    await upsertBidirectionalFamilyRelation(
      primaryUser.id,
      familyUser.id,
      relation,
    );
    updatedMembers.push(familyUser);
  }

  await pruneMissingBidirectionalFamilyRelations(
    primaryUser.id,
    retainedFamilyIds,
  );
  return updatedMembers;
}

// Writes that replace a member's department rows: delete everything, then
// re-create. Callers run them inside a transaction so a failed create rolls the
// delete back. An empty array clears every row.
function departmentPositionWrites(
  userId: number,
  rows: NormalizedDepartmentPosition[],
) {
  return [
    prisma.department_positions.deleteMany({
      where: { user_id: userId },
    }),
    ...rows.map((dp) =>
      prisma.department_positions.create({
        data: {
          user_id: userId,
          ...dp,
        },
      }),
    ),
  ] as const;
}

async function updateChildren(
  children: any[],
  parentObj: any,
  membership_type: string,
  userId: number,
) {
  await prisma.user.deleteMany({
    where: { parent_id: userId },
  });
  await userService.registerChildren(children, parentObj, membership_type);
}

export const updateUserSatus = async (req: Request, res: Response) => {
  const { id, is_active } = req.body;
  if (
    denyAction(
      res,
      membersActionAllowed(req, "change_status"),
      "You don't have permission to activate or deactivate members.",
    ) ||
    (await denyMembersOutOfReach(req, res, [Number(id)]))
  ) {
    return;
  }
  try {
    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        is_active,
      },
      select: {
        id: true,
        is_active: true,
        member_id: true,
        status: true,
        name: true,
        email: true,
        password: true,
      },
    });
    const email: any = response.email;
    const secret = JWT_SECRET + response.password;
    const token = JWT.sign(
      {
        id: response.id,
        email: response.email,
      },
      secret,
      {
        expiresIn: "7d",
      },
    );

    const link = `${process.env.Frontend_URL}/reset-password/?id=${response.id}&token=${token}`;

    const mailDetails = {
      user_name: response.name,
      link,
      expiration: "7days",
    };

    if (is_active) {
      sendEmail(userActivatedTemplate(mailDetails), email, "Reset Password");
    }

    if (response.is_active === false) {
      sessionRevoked(response.id, "deactivated");
    } else {
      void sessionChanged([response.id], ["profile"]);
    }

    const { password, ...rest } = response;

    return res
      .status(200)
      .json({ message: "User Status Updated Succesfully", data: rest });
  } catch (error) {
    return res
      .status(500)
      .json({ message: " Error updating User status " + error, data: null });
  }
};
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.query;
    if (
      denyAction(res, membersActionAllowed(req, "delete"), "You don't have permission to delete members.") ||
      (await denyMembersOutOfReach(req, res, [Number(id)]))
    ) {
      return;
    }
    const existance = await prisma.user.findUnique({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
      },
    });

    if (!existance) {
      return res.status(400).json({ message: "No user found", data: null });
    }

    await prisma.user.delete({
      where: {
        id: Number(id),
      },
    });
    sessionRevoked(Number(id), "deleted");
    return res
      .status(200)
      .json({ message: "User deleted Succesfully", data: null });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

export const deleteOwnAccount = async (req: Request, res: Response) => {
  const authenticatedUserId = Number((req as any).user?.id);
  if (!Number.isInteger(authenticatedUserId) || authenticatedUserId <= 0) {
    return res.status(401).json({ message: "Unauthorized", data: null });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: { id: true },
    });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found", data: null });
    }

    await prisma.$transaction(async (tx) => {
      await tx.notification_push_subscription.updateMany({
        where: { user_id: authenticatedUserId },
        data: { is_active: false },
      });

      await tx.user_info.updateMany({
        where: { user_id: authenticatedUserId },
        data: {
          first_name: null,
          last_name: null,
          other_name: null,
          primary_number: null,
          other_number: null,
          email: null,
          address: null,
          city: null,
          state_region: null,
          occupation: null,
          company: null,
          photo: null,
          payment_info_token: null,
        },
      });

      await tx.user.update({
        where: { id: authenticatedUserId },
        data: {
          name: `Deleted User ${authenticatedUserId}`,
          email: null,
          password: null,
          is_active: false,
          is_user: false,
          updated_at: new Date(),
        },
      });
    });
    sessionRevoked(authenticatedUserId, "deleted");

    return res
      .status(200)
      .json({ message: "Account deleted successfully", data: null });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

/** The user fields a session token is built from (login + self-registration). */
const SESSION_USER_SELECT = {
  id: true,
  member_id: true,
  email: true,
  name: true,
  password: true,
  is_active: true,
  is_user: true,
  access_level_id: true,
  branch_id: true,
  branch_access: {
    where: { access_level: { deleted: false } },
    orderBy: { branch_id: "asc" as const },
    select: {
      branch_id: true,
      access_level_id: true,
      branch: { select: { name: true } },
      access_level: { select: { name: true, permissions: true, workspaces: true } },
    },
  },
  membership_type: true,
  is_guest: true,
  status: true,
  department_positions: {
    select: {
      department_id: true,
      position_id: true,
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      position: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  user_info: {
    select: {
      photo: true,
      member_since: true,
      primary_number: true,
    },
  },
  access: {
    select: {
      permissions: true,
    },
  },
  };

/**
 * The session claims for a user loaded with `SESSION_USER_SELECT`. Signed into
 * the login JWT and returned by `current-user`, so a client refreshing after a
 * realtime `session.changed` sees exactly what a fresh login would.
 */
export const buildSessionClaims = async (existance: any) => {
  const department_positions = (existance.department_positions || []).map(
    (deptPos: any) => ({
      department_id:
        deptPos?.department?.id ?? deptPos?.department_id ?? null,
      department_name: deptPos?.department?.name ?? null,
      position_id: deptPos?.position?.id ?? deptPos?.position_id ?? null,
      position_name: deptPos?.position?.name ?? null,
    }),
  );

  const department: string[] = Array.from(
    new Set(
      department_positions
        .map((deptPos: any) => deptPos.department_name)
        .filter((name: string | null): name is string => Boolean(name)),
    ),
  );

  const ministry_worker = Boolean(existance.is_user);
  const grants: any[] = Array.isArray(existance.branch_access)
    ? existance.branch_access
    : [];
  // Admin access comes from per-branch roles; no role in any branch = member.
  const user_category =
    ministry_worker && grants.length > 0 ? "admin" : "member";
  // The token carries the home-branch role (or the first one); clients switch
  // to the active branch's permissions using `branch_access` from current-user.
  const homeGrant =
    grants.find((grant) => grant.branch_id === existance.branch_id) ??
    grants[0];
  const tokenPermissions =
    user_category === "admin"
      ? parsePermissionsObject(
          homeGrant?.access_level?.permissions ?? existance.access?.permissions,
        ) || {}
      : null;
  // Names only: per-branch permission maps would push the JWT past the
  // cookie size limit, so current-user sends those.
  const branch_access =
    user_category === "admin"
      ? grants.map((grant) => ({
          branch_id: grant.branch_id,
          branch_name: grant.branch?.name ?? "",
          access_level_id: grant.access_level_id,
          access_level_name: grant.access_level?.name ?? "",
        }))
      : [];

  const life_center_leader: boolean = await checkIfLifeCenterLeader(
    existance.id,
  );
  const instructor: boolean = await courseService.checkIfInstructor(
    existance.id,
  );

  return {
    id: existance.id,
    member_id: existance.member_id || null,
    name: existance.name,
    email: existance.email,
    ministry_worker: ministry_worker,
    user_category,
    permissions: tokenPermissions,
    profile_img: existance.user_info?.photo,
    membership_type: existance.membership_type || null,
    department,
    department_positions,
    life_center_leader,
    instructor,
    phone: existance.user_info?.primary_number || null,
    member_since: existance.user_info?.member_since || null,
    is_guest: Boolean(existance.is_guest),
    status: existance.status ?? null,
    branch_id: existance.branch_id ?? null,
    branch_access,
  };
};

/**
 * Signs the 12h session JWT for a user loaded with `SESSION_USER_SELECT`.
 * Shared by `login` and mobile self-registration so both hand out the same
 * claims.
 */
export const signSessionToken = async (existance: any) =>
  JWT.sign(await buildSessionClaims(existance), JWT_SECRET, {
    expiresIn: "12h",
  });

/** Loads a user by id and signs their session token, or null if missing. */
export const issueSessionTokenForUser = async (userId: number) => {
  const existance = await prisma.user.findUnique({
    where: { id: userId },
    select: SESSION_USER_SELECT,
  });
  return existance ? signSessionToken(existance) : null;
};

const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;

/** Records that the user is using the app. Fire-and-forget; written at most every 5 minutes. */
const touchLastActive = (userId: number) => {
  const now = new Date();
  void prisma.user
    .updateMany({
      where: {
        id: userId,
        OR: [
          { last_active_at: null },
          { last_active_at: { lt: new Date(now.getTime() - LAST_ACTIVE_THROTTLE_MS) } },
        ],
      },
      data: { last_active_at: now },
    })
    .catch(() => undefined);
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const normalizedEmail = normalizeOptionalEmail(email);
    if (!isRealEmail(normalizedEmail)) {
      return res.status(400).json({
        message: "A valid non-temporary email is required for login.",
        data: null,
      });
    }
    const loginEmail = normalizedEmail as string;

    const existance: any = await prisma.user.findUnique({
      where: {
        email: loginEmail,
      },
      select: SESSION_USER_SELECT,
    });

    if (!existance) {
      return res
        .status(401)
        .json({ message: "Invalid Credentials", data: null });
    }

    if (existance && existance.is_active === false) {
      return res.status(401).json({
        message: "Account is deactivated",
        data: null,
      });
    }

    if (!existance.password) {
      return res
        .status(401)
        .json({ message: "Invalid Credentials", data: null });
    }

    if (await comparePassword(String(password || ""), existance.password)) {
      const token = await signSessionToken(existance);
      touchLastActive(existance.id);

      return res
        .status(200)
        .json({ status: "Login Successfully", token: token });
    } else {
      return res
        .status(401)
        .json({ message: "Invalid Credentials", data: null });
    }
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const authenticatedUserId = Number((req as any).user?.id);
  const { current_password, newpassword } = req.body;
  try {
    if (!Number.isInteger(authenticatedUserId) || authenticatedUserId <= 0) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }

    if (!current_password || !newpassword) {
      return res.status(400).json({
        message: "current_password and newpassword are required",
        data: null,
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        id: authenticatedUserId,
      },
      select: {
        id: true,
        password: true,
      },
    });

    if (!existingUser?.password) {
      return res
        .status(401)
        .json({ message: "Invalid current password", data: null });
    }

    const isCurrentPasswordValid = await comparePassword(
      String(current_password),
      existingUser.password,
    );
    if (!isCurrentPasswordValid) {
      return res
        .status(401)
        .json({ message: "Invalid current password", data: null });
    }

    await prisma.user.update({
      where: {
        id: authenticatedUserId,
      },
      data: {
        password: await hashPassword(newpassword),
      },
    });
    res
      .status(200)
      .json({ message: "Password Changed Successfully", data: null });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

export const forgetPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const normalizedEmail = normalizeOptionalEmail(email);
    const genericResponse = {
      message: "If an account exists, a reset link has been sent.",
      data: null,
    };

    if (!isRealEmail(normalizedEmail)) {
      return res.status(200).json(genericResponse);
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail as string,
      },
      // The reset link is signed with the current hash.
      omit: { password: false },
    });

    if (!existingUser?.password) {
      return res.status(200).json(genericResponse);
    }

    const secret = JWT_SECRET + existingUser.password;
    const token = JWT.sign(
      {
        id: existingUser.id,
        email: existingUser.email,
      },
      secret,
      {
        expiresIn: "15m",
      },
    );

    const link = `${process.env.Frontend_URL}/reset-password/?id=${existingUser.id}&token=${token}`;
    const mailDetails = {
      user_name: existingUser.name,
      link,
      expiration: "15mins",
    };
    await sendEmail(
      forgetPasswordTemplate(mailDetails),
      normalizedEmail as string,
      "Reset Password",
    );
    return res.status(200).json(genericResponse);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { id, token } = req.query;
  const { newpassword } = req.body;
  try {
    const parsedUserId = Number(id);
    if (
      !Number.isInteger(parsedUserId) ||
      parsedUserId <= 0 ||
      typeof token !== "string" ||
      !newpassword
    ) {
      return res
        .status(400)
        .json({ message: "Invalid reset payload", data: null });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        id: parsedUserId,
      },
      select: {
        id: true,
        password: true,
      },
    });
    if (!existingUser?.password) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset link", data: null });
    }

    const secret = JWT_SECRET + existingUser.password;
    JWT.verify(token, secret);

    await prisma.user.update({
      where: {
        id: parsedUserId,
      },
      data: {
        password: await hashPassword(newpassword),
      },
    });
    // A forgot-password reset signs the member out everywhere else.
    sessionRevoked(parsedUserId, "password_reset");
    return res
      .status(200)
      .json({ message: "Password Successfully changed", data: null });
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Invalid or expired reset link", data: null });
  }
};

export const activateAccount = async (req: Request, res: Response) => {
  const { user_id } = req.query;
  if (
    denyAction(
      res,
      membersActionAllowed(req, "change_status"),
      "You don't have permission to activate or deactivate members.",
    ) ||
    (await denyMembersOutOfReach(req, res, [Number(user_id)]))
  ) {
    return;
  }
  try {
    const existingUser = await prisma.user.findUnique({
      where: {
        id: Number(user_id),
      },
    });
    if (!existingUser) {
      return res.status(404).json({ message: "User Not Exists", data: null });
    }

    const response = await prisma.user.update({
      where: {
        id: Number(user_id),
      },
      data: {
        is_active: !existingUser.is_active,
      },
    });

    if (response.is_active === false) {
      sessionRevoked(response.id, "deactivated");
    } else {
      void sessionChanged([response.id], ["profile"]);
    }

    if (response.is_user) {
      sendEmail(
        activateUserTemplate({ user_name: existingUser.name }),
        existingUser.email || "",
        "User Activation",
      );
    }

    return res
      .status(200)
      .json({ message: "User Activated Successfully", data: response });
  } catch (error) {
    return res.status(500).json({ message: "Operation Failed", data: error });
  }
};

export const seedUser = async (req: Request, res: Response) => {
  if (!canRunSensitiveUserOps()) {
    return res.status(403).json({
      message: "This endpoint is disabled in production.",
      data: null,
    });
  }

  try {
    const response = await prisma.user.create({
      data: {
        name: "Ordinary Member",
        email: "member@member.com",
        password:
          "$2b$10$2EYtobxw11Tk1.JXCjplJOQ5mgu1dmNENtbDnpcQiqjnkSgyRrZqu",
        is_user: true,
      },
      select: {
        email: true,
        name: true,
      },
    });
    res
      .status(200)
      .json({ message: "User Created Succesfully", data: response });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something went wrong", data: error });
  }
};
const toUniquePositiveIds = (values: Array<number | null | undefined>) =>
  Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isInteger(value) && value > 0,
      ),
    ),
  );

const buildLookupById = <T extends { id: number }>(rows: T[]) =>
  new Map<number, T>(rows.map((row) => [row.id, row]));

const groupRowsByUserId = <T extends { user_id: number }>(rows: T[]) => {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    const existingRows = grouped.get(row.user_id);
    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    grouped.set(row.user_id, [row]);
  }

  return grouped;
};

const fetchUserDirectoryRelations = async (
  userIds: number[],
  primaryDepartmentIds: number[],
  primaryPositionIds: number[],
) => {
  if (!userIds.length) {
    return {
      userInfoByUserId: new Map<number, any>(),
      positionById: new Map<number, any>(),
      departmentById: new Map<number, any>(),
      departmentPositionsByUserId: new Map<number, any[]>(),
    };
  }

  const [userInfos, departmentPositions] = await Promise.all([
    prisma.user_info.findMany({
      where: {
        user_id: {
          in: userIds,
        },
      },
      select: {
        user_id: true,
        country_code: true,
        primary_number: true,
        title: true,
        photo: true,
        country: true,
        member_since: true,
        date_of_birth: true,
        marital_status: true,
        work_info_id: true,
        gender: true,
        city: true,
        state_region: true,
        nationality: true,
        emergency_contact: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.department_positions.findMany({
      where: {
        user_id: {
          in: userIds,
        },
      },
      select: {
        user_id: true,
        department_id: true,
        position_id: true,
      },
      orderBy: {
        id: "asc",
      },
    }),
  ]);

  const workInfoIds = toUniquePositiveIds(
    userInfos.map((info) => info.work_info_id),
  );
  const departmentIds = toUniquePositiveIds([
    ...primaryDepartmentIds,
    ...departmentPositions.map((entry) => entry.department_id),
  ]);
  const positionIds = toUniquePositiveIds([
    ...primaryPositionIds,
    ...departmentPositions.map((entry) => entry.position_id),
  ]);

  const [workInfos, departments, positions] = await Promise.all([
    workInfoIds.length
      ? prisma.user_work_info.findMany({
          where: {
            id: {
              in: workInfoIds,
            },
          },
          select: {
            id: true,
            employment_status: true,
          },
        })
      : Promise.resolve([] as any[]),
    departmentIds.length
      ? prisma.department.findMany({
          where: {
            id: {
              in: departmentIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : Promise.resolve([] as any[]),
    positionIds.length
      ? prisma.position.findMany({
          where: {
            id: {
              in: positionIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : Promise.resolve([] as any[]),
  ]);

  const workInfoById = buildLookupById(workInfos);
  const departmentById = buildLookupById(departments);
  const positionById = buildLookupById(positions);

  const userInfoByUserId = new Map(
    userInfos.map((info) => [
      info.user_id,
      {
        country_code: info.country_code,
        primary_number: info.primary_number,
        title: info.title,
        photo: info.photo,
        country: info.country,
        member_since: info.member_since,
        date_of_birth: info.date_of_birth,
        marital_status: info.marital_status,
        gender: info.gender ?? null,
        city: info.city ?? null,
        state_region: info.state_region ?? null,
        nationality: info.nationality ?? null,
        has_emergency_contact: Boolean(info.emergency_contact?.name?.trim()),
        work_info: info.work_info_id
          ? workInfoById.get(info.work_info_id) || null
          : null,
      },
    ]),
  );

  const normalizedDepartmentPositions = departmentPositions.map((entry) => ({
    user_id: entry.user_id,
    department_id: entry.department_id,
    department_name: departmentById.get(entry.department_id)?.name ?? null,
    position_id: entry.position_id ?? null,
    position_name: entry.position_id
      ? (positionById.get(entry.position_id)?.name ?? null)
      : null,
  }));

  return {
    userInfoByUserId,
    positionById,
    departmentById,
    departmentPositionsByUserId: groupRowsByUserId(
      normalizedDepartmentPositions,
    ),
  };
};

// Members on the requester's Members exclusion list are still listed, but
// only by name: contact and personal details are withheld and the client is
// told the profile can't be opened.
const maskExcludedListedUser = (user: any) => ({
  ...user,
  email: null,
  primary_number: null,
  country_code: null,
  date_of_birth: null,
  marital_status: null,
  employment_status: null,
  gender: null,
  city: null,
  state_region: null,
  nationality: null,
  has_emergency_contact: null,
  children_count: null,
  is_restricted: true,
});

/**
 * Children per user for one page of the member list: explicit CHILD links
 * (either direction of family_relation) plus legacy `parent_id` children,
 * de-duplicated the same way get-user builds `family`.
 */
const countChildrenByUserId = async (
  userIds: number[],
): Promise<Map<number, number>> => {
  const childIdsByUser = new Map<number, Set<number>>();
  if (!userIds.length) return new Map();

  const [forwardChildren, reverseChildren, biologicalChildren] =
    await Promise.all([
      prisma.family_relation.findMany({
        where: { user_id: { in: userIds }, relation: FAMILY_RELATION.CHILD },
        select: { user_id: true, family_id: true },
      }),
      prisma.family_relation.findMany({
        where: { family_id: { in: userIds }, relation: FAMILY_RELATION.PARENT },
        select: { user_id: true, family_id: true },
      }),
      prisma.user.findMany({
        where: { parent_id: { in: userIds } },
        select: { id: true, parent_id: true },
      }),
    ]);

  const add = (parentId: number | null, childId: number) => {
    if (!parentId || parentId === childId) return;
    const set = childIdsByUser.get(parentId) || new Set<number>();
    set.add(childId);
    childIdsByUser.set(parentId, set);
  };

  forwardChildren.forEach((row) => add(row.user_id, row.family_id));
  reverseChildren.forEach((row) => add(row.family_id, row.user_id));
  biologicalChildren.forEach((row) => add(row.parent_id, row.id));

  return new Map(
    Array.from(childIdsByUser.entries()).map(([id, set]) => [id, set.size]),
  );
};

type MemberStatusCounts = {
  all: number;
  UNCONFIRMED: number;
  CONFIRMED: number;
  MEMBER: number;
  inactive: number;
};

/** One grouped query over the request's filters minus status / is_active. */
const buildMemberStatusCounts = async (
  baseWhere: any,
): Promise<MemberStatusCounts> => {
  const groups = await prisma.user.groupBy({
    by: ["status", "is_active"],
    where: baseWhere,
    _count: { _all: true },
  });

  const counts: MemberStatusCounts = {
    all: 0,
    UNCONFIRMED: 0,
    CONFIRMED: 0,
    MEMBER: 0,
    inactive: 0,
  };

  for (const group of groups) {
    const count = group._count?._all ?? 0;
    counts.all += count;
    if (group.is_active === false) {
      counts.inactive += count;
      continue;
    }
    if (group.is_active !== true) continue;
    if (group.status === "CONFIRMED") counts.CONFIRMED += count;
    else if (group.status === "MEMBER") counts.MEMBER += count;
    else if (group.status === "UNCONFIRMED" || group.status === null) {
      counts.UNCONFIRMED += count;
    }
  }

  return counts;
};

type ListUsersSort = "name" | "newest" | "oldest";

const resolveListUsersSort = (value: unknown): ListUsersSort => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "newest" || normalized === "oldest"
    ? normalized
    : "name";
};

const buildListUsersOrderBy = (sort: ListUsersSort): any => {
  if (sort === "newest") {
    return [
      { user_info: { member_since: { sort: "desc", nulls: "last" } } },
      { created_at: "desc" },
      { id: "desc" },
    ];
  }
  if (sort === "oldest") {
    return [
      { user_info: { member_since: { sort: "asc", nulls: "last" } } },
      { created_at: "asc" },
      { id: "asc" },
    ];
  }
  return { name: "asc" };
};

const flattenListedUsers = (data: any[]) => {
  return data.map(({ user_info, ...rest }) => {
    const info = user_info || {};
    const workInfo = info.work_info || null;
    const { work_info, ...flatInfo } = info;

    return {
      ...rest,
      ...flatInfo,
      marital_status: flatInfo?.marital_status ?? null,
      employment_status: workInfo?.employment_status ?? null,
      date_joined: flatInfo?.member_since ?? rest?.created_at ?? null,
    };
  });
};

export const ListUsers = async (req: Request, res: Response) => {
  const {
    is_user,
    department_id,
    page = "1",
    take,
    limit,
    is_active,
    name,
    search,
    ministry_worker,
    membership_type,
    status,
    sort,
    include_status_counts,
  } = req.query;
  const listSort = resolveListUsersSort(sort);
  const includeStatusCounts = include_status_counts === "true";
  const isUser =
    is_user === "true" || ministry_worker === "true" ? true : false;
  const resolvedTake =
    typeof take === "string" && take.trim()
      ? take
      : typeof limit === "string" && limit.trim()
        ? limit
        : "12";
  const searchTerm =
    typeof search === "string" && search.trim()
      ? search.trim()
      : typeof name === "string" && name.trim()
        ? name.trim()
        : "";
  const normalizedStatus =
    typeof status === "string" && status.trim()
      ? status.trim().toUpperCase()
      : "";

  const parsedPageNum = parseInt(page as string, 10);
  const pageNum =
    Number.isInteger(parsedPageNum) && parsedPageNum > 0 ? parsedPageNum : 1;
  const parsedPageSize = parseInt(resolvedTake as string, 10);
  const pageSize =
    Number.isInteger(parsedPageSize) && parsedPageSize > 0
      ? parsedPageSize
      : 12;
  const skip = (pageNum - 1) * pageSize;
  const memberScope = (req as any).memberScope;
  const excludedMemberIds: number[] = Array.isArray(memberScope?.exclusions)
    ? memberScope.exclusions
    : [];

  try {
    const whereConditions: any[] = [];
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);
    if (branchWhere) {
      whereConditions.push(branchWhere);
    }
    // A role limited to its departments or life centers lists those people.
    const scopeWhere = memberScopeWhere(req);
    if (scopeWhere) {
      whereConditions.push(scopeWhere);
    }
    // Guests who joined from the mobile app have accounts but are not
    // members: keep them out of the member list and the confirmation queue
    // (a null status would otherwise land them in UNCONFIRMED). They are
    // listed under Visitors > Guests instead. `include_guests=true` opts out.
    if (req.query?.include_guests !== "true") {
      whereConditions.push({
        OR: [{ is_guest: false }, { is_guest: null }],
      });
    }

    // status / is_active are kept out of `whereConditions` so status_counts
    // can reuse every other filter.
    const stageConditions: any[] = [];
    if (is_active !== undefined) {
      stageConditions.push({
        is_active:
          is_active === "true"
            ? true
            : is_active === "false"
              ? false
              : is_active,
      });
    }
    if (is_user !== undefined || ministry_worker !== undefined) {
      whereConditions.push({ is_user: isUser });
    }
    if (typeof department_id === "string" && department_id.trim()) {
      if (department_id === "unassigned") {
        whereConditions.push({
          AND: [
            { department_id: null },
            {
              department_positions: {
                none: {},
              },
            },
          ],
        });
      } else {
        const parsedDepartmentId = Number(department_id);
        if (!Number.isNaN(parsedDepartmentId) && parsedDepartmentId > 0) {
          whereConditions.push({
            OR: [
              { department_id: parsedDepartmentId },
              {
                department_positions: {
                  some: { department_id: parsedDepartmentId },
                },
              },
            ],
          });
        }
      }
    }
    if (normalizedStatus) {
      if (normalizedStatus === "UNCONFIRMED") {
        stageConditions.push({
          OR: [{ status: "UNCONFIRMED" }, { status: null }],
        });
      } else if (
        normalizedStatus === "CONFIRMED" ||
        normalizedStatus === "MEMBER"
      ) {
        stageConditions.push({ status: normalizedStatus });
      }
    }
    if (membership_type) {
      whereConditions.push({ membership_type });
    }
    if (searchTerm) {
      const contactMatches: any[] = [
        { email: { contains: searchTerm } },
        {
          user_info: {
            is: {
              primary_number: { contains: searchTerm },
            },
          },
        },
      ];
      whereConditions.push({
        OR: [
          { name: { contains: searchTerm } },
          { member_id: { contains: searchTerm } },
          // Excluded members stay listed but their contact details are
          // masked, so they must not be findable by email or phone either;
          // nor is anyone, for a role that can't see contact details.
          ...(!membersActionAllowed(req, "view_contact_details")
            ? []
            : excludedMemberIds.length > 0
            ? [
                {
                  AND: [
                    { id: { notIn: excludedMemberIds } },
                    { OR: contactMatches },
                  ],
                },
              ]
            : contactMatches),
        ],
      });
    }
    const baseWhere =
      whereConditions.length > 0 ? { AND: whereConditions } : undefined;
    const allConditions = [...whereConditions, ...stageConditions];
    const whereFilter =
      allConditions.length > 0 ? { AND: allConditions } : undefined;

    const [total, users, statusCounts] = await Promise.all([
      prisma.user.count({ where: whereFilter }),
      prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: buildListUsersOrderBy(listSort),
        where: whereFilter,
        select: {
          id: true,
          name: true,
          email: true,
          member_id: true,
          created_at: true,
          is_active: true,
          is_user: true,
          branch_id: true,
          department_id: true,
          membership_type: true,
          status: true,
          position_id: true,
          confirmed_at: true,
          functional_at: true,
          source_visitor_id: true,
          source_soul_won_id: true,
        },
      }),
      includeStatusCounts
        ? buildMemberStatusCounts(baseWhere)
        : Promise.resolve(null),
    ]);

    const userIds = users.map((user) => user.id);
    const childrenCountByUserId = await countChildrenByUserId(userIds);
    const primaryPositionIds = toUniquePositiveIds(
      users.map((user) => user.position_id),
    );
    const primaryDepartmentIds = toUniquePositiveIds(
      users.map((user) => user.department_id),
    );
    const {
      userInfoByUserId,
      positionById,
      departmentById,
      departmentPositionsByUserId,
    } = await fetchUserDirectoryRelations(
      userIds,
      primaryDepartmentIds,
      primaryPositionIds,
    );

    const usersWithDeptName = users.map((user: any) => {
      const userInfo = userInfoByUserId.get(user.id) || null;
      const departmentPositions =
        departmentPositionsByUserId.get(user.id) || [];
      const departmentIdsFromPositions = Array.from(
        new Set(
          departmentPositions
            .map((entry: any) => entry.department_id)
            .filter((value: number | null): value is number => Boolean(value)),
        ),
      );
      const departmentNamesFromPositions = Array.from(
        new Set(
          departmentPositions
            .map((entry: any) => entry.department_name)
            .filter((value: string | null): value is string => Boolean(value)),
        ),
      );

      const primaryDepartmentId =
        user.department_id || departmentIdsFromPositions[0] || null;
      const primaryDepartmentName =
        (primaryDepartmentId
          ? departmentById.get(primaryDepartmentId)?.name
          : null) ||
        departmentNamesFromPositions[0] ||
        null;

      const {
        source_visitor_id: sourceVisitorId,
        source_soul_won_id: sourceSoulWonId,
        ...listedUser
      } = user;

      return {
        ...listedUser,
        position: user.position_id
          ? positionById.get(user.position_id) || null
          : null,
        user_info: userInfo,
        department_id: primaryDepartmentId,
        department_name: primaryDepartmentName,
        branch_id: user.branch_id ?? null,
        confirmed_at: user.confirmed_at ?? null,
        functional_at: user.functional_at ?? null,
        from_visitor: sourceVisitorId != null,
        from_soul_won: sourceSoulWonId != null,
        children_count: childrenCountByUserId.get(user.id) ?? 0,
        department_names: departmentNamesFromPositions,
        department_positions: departmentPositions.map((entry: any) => ({
          department_id: entry.department_id,
          department_name: entry.department_name,
          position_id: entry.position_id,
          position_name: entry.position_name,
        })),
      };
    });

    const excludedMemberIdSet = new Set(excludedMemberIds);
    const showContacts = membersActionAllowed(req, "view_contact_details");

    res.status(200).json({
      message: "Operation Successful",
      current_page: pageNum,
      take: pageSize,
      page_size: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      ...(statusCounts ? { meta: { status_counts: statusCounts } } : {}),
      data: flattenListedUsers(usersWithDeptName).map((user) =>
        excludedMemberIdSet.has(user.id)
          ? maskExcludedListedUser(user)
          : showContacts || canSeeContactDetails(req, user.id)
            ? { ...user, is_restricted: false }
            : maskContactDetails({ ...user, is_restricted: false }),
      ),
    });
  } catch (error) {
    return res.status(500).json({ message: "Something Went Wrong", error });
  }
};
export const ListUsersLight = async (req: Request, res: Response) => {
  try {
    const memberScope = (req as any).memberScope;
    const excludedMemberIds: number[] = Array.isArray(memberScope?.exclusions)
      ? memberScope.exclusions
      : [];
    const permissionDomain = String(req.query.permission_domain || "").trim();
    // Who holds a permission is access-rights information: only for people
    // who can see roles, or who manage that module (e.g. the finance approver picker).
    const callerPermissions = getRequestAccess(req)?.permissions;
    if (
      permissionDomain &&
      !hasActionPermission(callerPermissions, "Access_rights", "view") &&
      !hasActionPermission(callerPermissions, permissionDomain, "manage")
    ) {
      return res.status(403).json({ message: "Not authorized", data: null });
    }
    const minimumAccessRaw = String(req.query.minimum_access || "").trim().toLowerCase();
    const minimumAccess: MinimumAccessLevel =
      minimumAccessRaw === "manage"
        ? "manage"
        : minimumAccessRaw === "admin"
          ? "admin"
          : "view";
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);
    const users = await prisma.user.findMany({
      orderBy: {
        name: "asc",
      },
      where:
        {
          ...(excludedMemberIds.length > 0
            ? {
                id: {
                  notIn: excludedMemberIds,
                },
              }
            : {}),
          ...(branchWhere || {}),
        },
      select: {
        id: true,
        name: true,
        email: true,
        is_user: true,
        is_active: true,
        branch_id: true,
        position_id: true,
        access: {
          select: {
            permissions: true,
          },
        },
      },
    });

    const filteredUsers =
      permissionDomain.length > 0
        ? users.filter((user) =>
            userHasMinimumDomainAccess(
              user.access?.permissions,
              permissionDomain,
              minimumAccess,
            ),
          )
        : users;

    const userIds = filteredUsers.map((user) => user.id);
    const [userDepartments, departmentPositions] = await Promise.all([
      userIds.length
        ? prisma.user_departments.findMany({
            where: {
              user_id: {
                in: userIds,
              },
            },
            select: {
              user_id: true,
              department_id: true,
            },
          })
        : Promise.resolve([] as any[]),
      userIds.length
        ? prisma.department_positions.findMany({
            where: {
              user_id: {
                in: userIds,
              },
            },
            select: {
              user_id: true,
              department_id: true,
              position_id: true,
            },
            orderBy: {
              id: "asc",
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const departmentIds = toUniquePositiveIds([
      ...userDepartments.map((entry) => entry.department_id),
      ...departmentPositions.map((entry) => entry.department_id),
    ]);
    const positionIds = toUniquePositiveIds([
      ...users.map((user) => user.position_id),
      ...departmentPositions.map((entry) => entry.position_id),
    ]);

    const [departments, positions] = await Promise.all([
      departmentIds.length
        ? prisma.department.findMany({
            where: {
              id: {
                in: departmentIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([] as any[]),
      positionIds.length
        ? prisma.position.findMany({
            where: {
              id: {
                in: positionIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const departmentById = buildLookupById(departments);
    const positionById = buildLookupById(positions);
    const userDepartmentByUserId = new Map(
      userDepartments.map((entry) => [
        entry.user_id,
        entry.department_id
          ? departmentById.get(entry.department_id) || null
          : null,
      ]),
    );
    const departmentPositionsByUserId = groupRowsByUserId(
      departmentPositions.map((entry) => ({
        user_id: entry.user_id,
        department: entry.department_id
          ? departmentById.get(entry.department_id) || null
          : null,
        position: entry.position_id
          ? positionById.get(entry.position_id) || null
          : null,
      })),
    );

    res.status(200).json({
      message: "Operation Successful",
      data: filteredUsers.map((user) => {
        const fallbackRows = departmentPositionsByUserId.get(user.id) || [];
        const fallbackDepartment = fallbackRows.find(
          (item) => item.department,
        )?.department;
        const fallbackPosition = fallbackRows.find(
          (item) => item.position,
        )?.position;

        return {
          id: user.id,
          name: user.name,
          ministry_worker: Boolean(user.is_user),
          is_active: user.is_active ?? true,
          department:
            userDepartmentByUserId.get(user.id) || fallbackDepartment || null,
          position:
            (user.position_id
              ? positionById.get(user.position_id) || null
              : null) ||
            fallbackPosition ||
            null,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({ message: "Something Went Wrong", error });
  }
};

export const filterUsersInfo = async (req: Request, res: Response) => {
  const {
    name,
    membership_type,
    ministry_worker,
    page = "1",
    take = "10",
  } = req.query;

  try {
    const memberScope = (req as any).memberScope;
    const excludedMemberIds: number[] = Array.isArray(memberScope?.exclusions)
      ? memberScope.exclusions
      : [];
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(take as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const filters: any = {};
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);

    if (branchWhere) {
      Object.assign(filters, branchWhere);
    }

    if (name) {
      filters.name = {
        contains: String(name),
        mode: "insensitive",
      };
    }

    if (membership_type) {
      filters.membership_type = String(membership_type);
    }

    if (ministry_worker !== undefined) {
      filters.is_user = ministry_worker === "true";
    }
    if (excludedMemberIds.length > 0) {
      filters.id = {
        notIn: excludedMemberIds,
      };
    }
    const scopeWhere = memberScopeWhere(req);
    if (scopeWhere) {
      filters.AND = [scopeWhere];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where: filters }),
      prisma.user.findMany({
        where: filters,
        include: {
          user_info: true,
        },
        orderBy: {
          created_at: "asc",
        },
        skip,
        take: limitNum,
      }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      message: "Users fetched successfully",
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      count: users.length,
      data: users.map((user) =>
        canSeeContactDetails(req, user.id) ? user : maskContactDetails(user),
      ),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Something Went Wrong",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getUser = async (req: Request, res: Response) => {
  const { user_id } = req.query;
  const fallbackUserId = Number((req as any).user?.id);
  const resolvedUserId =
    Number.isInteger(Number(user_id)) && Number(user_id) > 0
      ? Number(user_id)
      : Number.isInteger(fallbackUserId) && fallbackUserId > 0
        ? fallbackUserId
        : null;
  if (!resolvedUserId) {
    return res.status(400).json({ message: "Invalid or missing user_id" });
  }
  if (await denyMembersOutOfReach(req, res, [resolvedUserId])) return;

  try {
    const response: any = await prisma.user.findUnique({
      where: { id: resolvedUserId },

      include: {
        user_info: {
          include: {
            emergency_contact: true,
            work_info: true,
          },
        },
        department_positions: {
          include: {
            department: true,
            position: true,
          },
        },
        department: true,
        position: true,
        access: true,
        source_visitor: {
          select: {
            id: true,
            visitDate: true,
            visits: { select: { date: true } },
          },
        },
        source_soul_won: {
          select: {
            id: true,
            date_won: true,
            lifeCenter: { select: { name: true } },
            wonBy: { select: { name: true } },
          },
        },
        enrollments: {
          select: {
            id: true,
            enrolledAt: true,
            completed: true,
            completedAt: true,
            progress: {
              select: {
                topicId: true,
                completed: true,
                status: true,
                topic: { select: { programId: true } },
              },
            },
            course: {
              select: {
                cohort: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    program: {
                      select: {
                        id: true,
                        title: true,
                      },
                    },
                  },
                },
                instructor: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            enrolledAt: "desc",
          },
        },
      },
    });

    if (!response) {
      return res.status(404).json({ message: "User not found" });
    }

    delete response.password;

    /* =========================
       2️⃣ FETCH FAMILY RELATIONS
       - Forward
       - Reverse
    ========================== */
    const forwardRelations = await prisma.family_relation.findMany({
      where: { user_id: response.id },
      include: {
        family: { include: { user_info: true } },
      },
    });

    const reverseRelations = await prisma.family_relation.findMany({
      where: { family_id: response.id },
      include: {
        user: { include: { user_info: true } },
      },
    });

    const normalizedRelations: any[] = [];

    // Forward (me → them)
    forwardRelations.forEach((r) => {
      normalizedRelations.push({
        user: r.family,
        relation: r.relation,
        direction: "forward",
      });
    });

    // Reverse (them → me)
    reverseRelations.forEach((r) => {
      normalizedRelations.push({
        user: r.user,
        relation: getReciprocalFamilyRelation(r.relation),
        direction: "reverse",
      });
    });

    /* =========================
       4️⃣ DEDUPE BY USER ID
    ========================== */
    const relationMap = new Map<number, any>();

    normalizedRelations.forEach((r) => {
      if (!relationMap.has(r.user.id)) {
        relationMap.set(r.user.id, r);
      }
    });

    const relations = Array.from(relationMap.values());

    /* =========================
       5️⃣ GROUP FAMILY
    ========================== */
    const spouses = relations.filter(
      (r) => r.relation === FAMILY_RELATION.SPOUSE,
    );

    const parents = relations.filter(
      (r) => r.relation === FAMILY_RELATION.PARENT,
    );

    const children = relations.filter(
      (r) => r.relation === FAMILY_RELATION.CHILD,
    );

    const siblings = relations.filter(
      (r) => r.relation === FAMILY_RELATION.SIBLING,
    );

    const others = relations.filter(
      (r) =>
        ![
          FAMILY_RELATION.SPOUSE,
          FAMILY_RELATION.PARENT,
          FAMILY_RELATION.CHILD,
          FAMILY_RELATION.SIBLING,
        ].includes(r.relation),
    );

    /* =========================
       6️⃣ BIOLOGICAL LOOKUPS
    ========================== */
    const biologicalChildren = await prisma.user.findMany({
      where: { parent_id: response.id },
      include: { user_info: true },
    });

    const childrenMap = new Map<number, any>();
    [...children.map((c) => c.user), ...biologicalChildren].forEach((c) =>
      childrenMap.set(c.id, c),
    );

    const parentIds = parents.map((p) => p.user.id);
    const siblingByParent =
      parentIds.length > 0
        ? await prisma.user.findMany({
            where: {
              parent_id: { in: parentIds },
              NOT: { id: response.id },
            },
            include: { user_info: true },
          })
        : [];

    const siblingsMap = new Map<number, any>();
    [...siblings.map((s) => s.user), ...siblingByParent].forEach((s) =>
      siblingsMap.set(s.id, s),
    );

    /* =========================
       7️⃣ BUILD RESPONSE
    ========================== */
    const {
      user_info,
      department_positions,
      enrollments,
      source_visitor,
      source_soul_won,
      ...rest
    } = response;

    const user: any = {
      ...(user_info || {}),
      ...rest,
      email: user_info?.email ?? rest.email ?? null,
    };

    user.family = [
      ...spouses.map((s) => ({
        ...s.user.user_info,
        relation: toFamilyRelationLabel(s.relation),
      })),
      ...Array.from(childrenMap.values()).map((c) => ({
        ...c.user_info,
        relation: toFamilyRelationLabel(FAMILY_RELATION.CHILD),
      })),
      ...parents.map((p) => ({
        ...p.user.user_info,
        relation: toFamilyRelationLabel(p.relation),
      })),
      ...Array.from(siblingsMap.values()).map((s) => ({
        ...s.user_info,
        relation: toFamilyRelationLabel(FAMILY_RELATION.SIBLING),
      })),
      ...others.map((o) => ({
        ...o.user.user_info,
        relation: toFamilyRelationLabel(o.relation),
      })),
    ];

    /* =========================
       8️⃣ FLATTEN DEPARTMENTS
    ========================== */
    // Always an array (empty when the member serves nowhere), so clients can
    // treat `department_positions` as the source of department/position data.
    user.department_positions = (department_positions || []).map((dp: any) => ({
      department_id: dp.department?.id ?? null,
      department_name: dp.department?.name ?? null,
      position_id: dp.position?.id ?? null,
      position_name: dp.position?.name ?? null,
      start_date: dp.start_date ?? null,
      end_date: dp.end_date ?? null,
    }));

    user.member_source = buildMemberSource(source_visitor, source_soul_won);

    // One grouped query for every enrolled program's topic count (no N+1).
    const enrolledProgramIds = toUniquePositiveIds(
      (enrollments || []).map(
        (enrollment: any) => enrollment.course?.cohort?.program?.id,
      ),
    );
    const topicCountByProgramId = new Map<number, number>();
    if (enrolledProgramIds.length > 0) {
      const topicCounts = await prisma.topic.groupBy({
        by: ["programId"],
        where: { programId: { in: enrolledProgramIds } },
        _count: { _all: true },
      });
      topicCounts.forEach((row) =>
        topicCountByProgramId.set(row.programId, row._count._all),
      );
    }

    const enrolledPrograms = (enrollments || []).map((enrollment: any) => {
      const completed = Boolean(enrollment.completed);
      const programId: number | null =
        enrollment.course?.cohort?.program?.id ?? null;
      const progress = computeEnrollmentProgress({
        programId,
        totalTopics: programId ? topicCountByProgramId.get(programId) ?? 0 : 0,
        enrollmentCompleted: enrollment.completed,
        progress: (enrollment.progress || []).map((row: any) => ({
          topicId: row.topicId,
          completed: row.completed,
          status: row.status,
          topicProgramId: row.topic?.programId ?? null,
        })),
      });

      return {
        enrollment_id: enrollment.id,
        enrolled_at: enrollment.enrolledAt,
        program: {
          id: enrollment.course?.cohort?.program?.id ?? null,
          name: enrollment.course?.cohort?.program?.title ?? null,
        },
        cohort: {
          id: enrollment.course?.cohort?.id ?? null,
          name: enrollment.course?.cohort?.name ?? null,
          status: enrollment.course?.cohort?.status ?? null,
        },
        facilitator: {
          id: enrollment.course?.instructor?.id ?? null,
          name: enrollment.course?.instructor?.name ?? null,
        },
        status: {
          completed,
          label: completed ? "COMPLETED" : "IN_PROGRESS",
          completed_at: enrollment.completedAt ?? null,
        },
        progress_percent: progress.progress_percent,
        completed_topics: progress.completed_topics,
        total_topics: progress.total_topics,
      };
    });

    const completedPrograms = enrolledPrograms.filter(
      (program: any) => program.status.completed,
    ).length;

    user.enrolled_programs = {
      summary: {
        total: enrolledPrograms.length,
        completed: completedPrograms,
        in_progress: enrolledPrograms.length - completedPrograms,
      },
      items: enrolledPrograms,
    };

    const showContacts = canSeeContactDetails(req, resolvedUserId);
    return res.status(200).json({
      message: "Operation Successful",
      data: showContacts
        ? user
        : {
            ...maskContactDetails(user),
            family: (user.family || []).map((relative: any) => maskContactDetails(relative)),
          },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

type Gender = "Male" | "Female" | "Other";
type AgeCategory = "children" | "adults";

interface Stats {
  Total: number;
  Male: number;
  Female: number;
  Other: number;
}

interface CategoryStats {
  children: Stats;
  adults: Stats;
}

const emptyStats = (): Stats => ({
  Total: 0,
  Male: 0,
  Female: 0,
  Other: 0,
});

const emptyCategoryStats = (): CategoryStats => ({
  children: emptyStats(),
  adults: emptyStats(),
});

const normalizeGender = (gender?: string): Gender => {
  if (gender === "Male" || gender === "Female") return gender;
  return "Other";
};

const getAgeCategory = (dob?: Date): AgeCategory => {
  if (!dob) return "adults"; // safe fallback
  const age = new Date().getFullYear() - dob.getFullYear();
  return age <= 18 ? "children" : "adults";
};

const calculateStats = (users: any[]) => {
  const totals = emptyStats();
  const categories = emptyCategoryStats();

  for (const user of users) {
    const gender = normalizeGender(user.gender);
    const ageCategory = getAgeCategory(user.date_of_birth);

    // Overall totals
    totals.Total++;
    totals[gender]++;

    // Age category stats
    categories[ageCategory].Total++;
    categories[ageCategory][gender]++;
  }

  return { totals, categories };
};

export const statsUsers = async (req: Request, res: Response) => {
  try {
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);
    // `active_only=true` counts active members only; default counts everyone.
    const activeWhere = req.query?.active_only === "true" ? { is_active: true } : {};
    // A role limited to its departments or life centers counts those people.
    const scopeWhere = memberScopeWhere(req);
    const scopeFilter = scopeWhere ? { AND: [scopeWhere] } : {};
    const [onlineUsers, inhouseUsers] = await Promise.all([
      prisma.user_info.findMany({
        where: {
          user: {
            membership_type: "ONLINE",
            ...(branchWhere || {}),
            ...activeWhere,
            ...scopeFilter,
          },
        },
      }),
      prisma.user_info.findMany({
        where: {
          user: {
            membership_type: "IN_HOUSE",
            ...(branchWhere || {}),
            ...activeWhere,
            ...scopeFilter,
          },
        },
      }),
    ]);

    const onlineStats = calculateStats(onlineUsers);
    const inhouseStats = calculateStats(inhouseUsers);

    return res.status(200).json({
      message: "Operation Successful",
      data: {
        online: {
          total_members: onlineStats.totals.Total,
          total_males: onlineStats.totals.Male,
          total_females: onlineStats.totals.Female,
          total_others: onlineStats.totals.Other,
          stats: onlineStats.categories,
        },
        inhouse: {
          total_members: inhouseStats.totals.Total,
          total_males: inhouseStats.totals.Male,
          total_females: inhouseStats.totals.Female,
          total_others: inhouseStats.totals.Other,
          stats: inhouseStats.categories,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal Server Error",
      data: error,
    });
  }
};

export const getUserByEmailPhone = async (req: Request, res: Response) => {
  const { email, cohortId } = req.query;
  const memberScope = (req as any).memberScope;
  const authenticatedUserId = Number((req as any).user?.id);
  const isOwnScope = memberScope?.mode === "own";

  try {
    let user = null;
    let courses: any[] = [];

    // If email is passed, find user
    if (email) {
      const userLookupWhere: any =
        isOwnScope &&
        Number.isInteger(authenticatedUserId) &&
        authenticatedUserId > 0
          ? {
              user_id: authenticatedUserId,
            }
          : {
              OR: [
                { email: email as string },
                { primary_number: email as string },
              ],
            };

      user = await prisma.user_info.findFirst({
        where: userLookupWhere,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          other_name: true,
          email: true,
          country_code: true,
          primary_number: true,
          title: true,
          user: {
            select: {
              membership_type: true,
              status: true,
            },
          },
        },
      });
    }

    // If cohortId is passed, get courses
    if (cohortId) {
      courses = await courseService.getAllCourses({
        cohortId: Number(cohortId),
      });
    }

    // If no params were passed
    if (!email && !cohortId) {
      return res.status(400).json({
        message:
          "At least one query parameter (email or cohortId) must be provided.",
      });
    }

    // If email was provided but no user found
    if (email && !user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    if (user && (await denyMembersOutOfReach(req, res, [user.user_id]))) return;

    return res.status(200).json({
      message: "Operation successful",
      data: {
        user,
        courses,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

export const convertMemeberToConfirmedMember = async (
  req: Request,
  res: Response,
) => {
  const { user_id, status } = req.query;

  if (!user_id || Number.isNaN(Number(user_id))) {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "Invalid or missing user_id.",
      },
    });
  }

  const user_status = typeof status === "string" ? status : undefined;
  if (
    denyAction(
      res,
      callerActionAllowed(req, "Membership_Management", "confirm_member") ||
        membersActionAllowed(req, "change_status"),
      "You don't have permission to confirm members.",
    ) ||
    (await denyMembersOutOfReach(req, res, [Number(user_id)]))
  ) {
    return;
  }

  try {
    const result = await userService.convertMemeberToConfirmedMember(
      Number(user_id),
      user_status,
    );
    if (result.error !== "") {
      return res.status(400).json({
        message: "Operation failed",
        data: result,
      });
    }
    return res.status(200).json({
      message: "Operation successful",
      data: result,
    });
  } catch (error) {
    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }

    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

export const bulkUpdateMemberStatus = async (req: Request, res: Response) => {
  const { status, user_ids } = req.body ?? {};

  if (typeof status !== "string" || status.trim() === "") {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "Invalid or missing status.",
      },
    });
  }

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "user_ids must be a non-empty array.",
      },
    });
  }

  if (
    denyAction(
      res,
      callerActionAllowed(req, "Membership_Management", "confirm_member") ||
        membersActionAllowed(req, "change_status"),
      "You don't have permission to change membership status.",
    ) ||
    (await denyMembersOutOfReach(req, res, user_ids))
  ) {
    return;
  }

  try {
    const result = await userService.bulkUpdateMemberStatus(status, user_ids);

    return res.status(200).json({
      data: result,
    });
  } catch (error: any) {
    if (error instanceof InputValidationError) {
      return res.status(400).json({
        message: "Operation failed",
        data: {
          message: "",
          error: error.message,
        },
      });
    }

    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

export const bulkUpdateUserStatus = async (req: Request, res: Response) => {
  const { user_ids, is_active } = req.body ?? {};

  if (typeof is_active !== "boolean") {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "is_active must be a boolean.",
      },
    });
  }

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "user_ids must be a non-empty array.",
      },
    });
  }

  const actingUserId = (req as any).user?.id;
  if (
    is_active === false &&
    actingUserId != null &&
    user_ids.some((id: string | number) => Number(id) === Number(actingUserId))
  ) {
    return res.status(400).json({
      message: "Operation failed",
      data: {
        message: "",
        error: "You cannot deactivate your own account.",
      },
    });
  }

  if (
    denyAction(
      res,
      membersActionAllowed(req, "change_status") ||
        callerActionAllowed(req, "Access_rights", "deactivate_users"),
      "You don't have permission to activate or deactivate members.",
    ) ||
    (await denyMembersOutOfReach(req, res, user_ids))
  ) {
    return;
  }

  try {
    const result = await userService.bulkUpdateUserStatus(user_ids, is_active);
    const changedIds = result.results
      .filter((row) => row.success && !row.noop)
      .map((row) => Number(row.user_id));
    if (is_active === false) {
      changedIds.forEach((userId) => sessionRevoked(userId, "deactivated"));
    } else {
      void sessionChanged(changedIds, ["profile"]);
    }
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

export const linkSpouses = async (req: Request, res: Response) => {
  try {
    const { husband, wife } = req.body;
    if (
      denyAction(
        res,
        membersActionAllowed(req, "link_family"),
        "You don't have permission to link family members.",
      ) ||
      (await denyMembersOutOfReach(req, res, [Number(husband), Number(wife)]))
    ) {
      return;
    }
    const result = await userService.linkSpouses(Number(husband), Number(wife));
    if (result.error == "") {
      return res.status(400).json({
        message: "Operation failed",
        data: result,
      });
    }
    return res.status(200).json({
      message: "Operation successful",
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Operation failed",
      data: error.message,
    });
  }
};

export const getUserFamily = async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    const fallbackUserId = Number((req as any).user?.id);
    const resolvedUserId =
      Number.isInteger(Number(user_id)) && Number(user_id) > 0
        ? Number(user_id)
        : Number.isInteger(fallbackUserId) && fallbackUserId > 0
          ? fallbackUserId
          : null;

    if (!resolvedUserId) {
      return res.status(400).json({
        message: "Operation failed",
        data: "Invalid or missing user_id",
      });
    }

    if (await denyMembersOutOfReach(req, res, [resolvedUserId])) return;
    const family = await userService.getUserFamily(resolvedUserId);

    if (!family) {
      return res.status(404).json({
        message: "",
        data: "Error in getting the family",
      });
    }

    return res.status(200).json({
      message: "Operation Successfull",
      data: family,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};

export const linkChildren = async (req: Request, res: Response) => {
  try {
    const { childrenIds, parentId } = req.body;
    if (
      denyAction(
        res,
        membersActionAllowed(req, "link_family"),
        "You don't have permission to link family members.",
      ) ||
      (await denyMembersOutOfReach(req, res, [
        Number(parentId),
        ...(Array.isArray(childrenIds) ? childrenIds.map(Number) : []),
      ]))
    ) {
      return;
    }

    if (Array.isArray(childrenIds) && childrenIds.length > 0) {
      const result = await userService.linkChildren(childrenIds, parentId);
      if (result) {
        return res.status(200).json({ message: "Operation Sucess", data: result });
      }

      return res.status(400).json({
        message: "Operation Failed",
        data: "Something Happened, Contact Eshun",
      });
    }

    return res.status(400).json({
      message: "Operation Failed",
      data: "We expect the children Id to be an Array",
    });
  } catch (error) {
    console.error("Error linking children:", error);
    throw error;
  }
};

export const currentuser = async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = Number((req as any).user?.id);
    if (!Number.isInteger(authenticatedUserId) || authenticatedUserId <= 0) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    touchLastActive(authenticatedUserId);

    const user = await prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        id: true,
        name: true,
        email: true,
        membership_type: true,
        branch_id: true,
        member_id: true,
        status: true,
        is_guest: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const [userInfo, departmentPositions, membershipRequest, sessionUser] = await Promise.all([
      prisma.user_info.findUnique({
        where: { user_id: authenticatedUserId },
        select: {
          primary_number: true,
          member_since: true,
        },
      }),
      prisma.department_positions.findMany({
        where: { user_id: authenticatedUserId },
        select: {
          department_id: true,
        },
        orderBy: {
          id: "asc",
        },
      }),
      // Guests only: the app shows "request sent" vs "request membership"
      // from the latest request.
      user.is_guest
        ? prisma.membership_request.findFirst({
            where: { user_id: authenticatedUserId },
            orderBy: { requested_at: "desc" },
            select: { id: true, status: true, requested_at: true, decline_reason: true },
          })
        : Promise.resolve(null),
      // The login-token claims, so a refresh after `session.changed` picks up
      // live permission/role changes.
      prisma.user.findUnique({
        where: { id: authenticatedUserId },
        select: SESSION_USER_SELECT,
      }),
    ]);
    const claims = sessionUser ? await buildSessionClaims(sessionUser) : null;
    const departmentIds = toUniquePositiveIds(
      departmentPositions.map((dept) => dept.department_id),
    );
    const departments = departmentIds.length
      ? await prisma.department.findMany({
          where: {
            id: {
              in: departmentIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
    const departmentById = buildLookupById(departments);
    const department = departmentPositions
      .map((dept) => departmentById.get(dept.department_id)?.name ?? null)
      .filter((value): value is string => Boolean(value));

    const branchAccess =
      claims?.user_category === "admin"
        ? (sessionUser?.branch_access ?? []).map((grant: any) => ({
            branch_id: grant.branch_id,
            branch_name: grant.branch?.name ?? "",
            access_level_id: grant.access_level_id,
            access_level_name: grant.access_level?.name ?? "",
            permissions: parsePermissionsObject(grant.access_level?.permissions),
            workspaces: resolveWorkspaces(
              grant.access_level?.workspaces,
              grant.access_level?.permissions,
            ).workspaces,
          }))
        : [];
    const homeBranch = user.branch_id
      ? await prisma.branch.findUnique({
          where: { id: user.branch_id },
          select: { id: true, name: true },
        })
      : null;

    const data = {
      permissions: claims?.permissions ?? null,
      user_category: claims?.user_category ?? null,
      branch_access: branchAccess,
      branch_name: homeBranch?.name ?? null,
      ministry_worker: claims?.ministry_worker ?? false,
      department_positions: claims?.department_positions ?? [],
      life_center_leader: claims?.life_center_leader ?? false,
      instructor: claims?.instructor ?? false,
      profile_img: claims?.profile_img ?? null,
      id: authenticatedUserId,
      name: user.name,
      email: user.email,
      phone: userInfo?.primary_number || null,
      member_since: userInfo?.member_since || null,
      department,
      branch_id: user.branch_id ?? null,
      membership_type: user.membership_type || null,
      member_id: user.member_id || null,
      status: user.status ?? null,
      is_guest: Boolean(user.is_guest),
      membership_request: membershipRequest,
    };

    return res.json({ message: "Operation sucessful", data: data });
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized", error });
  }
};

const getWholeYearsSince = (date?: Date | null): number => {
  if (!date) return 0;
  const now = new Date();
  let years = now.getFullYear() - date.getFullYear();
  const hasHadAnniversaryThisYear =
    now.getMonth() > date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() >= date.getDate());
  if (!hasHadAnniversaryThisYear) years--;
  return Math.max(0, years);
};

export const getMemberProfileStats = async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = Number((req as any).user?.id);
    if (!Number.isInteger(authenticatedUserId) || authenticatedUserId <= 0) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [userInfo, servicesAttended, soulsWon] = await Promise.all([
      prisma.user_info.findUnique({
        where: { user_id: authenticatedUserId },
        select: { member_since: true },
      }),
      prisma.event_attendance.count({
        where: {
          user_id: authenticatedUserId,
          event: { event_type: "SERVICE" },
        },
      }),
      prisma.soul_won.count({
        where: { wonById: authenticatedUserId },
      }),
    ]);

    return res.status(200).json({
      message: "Operation successful",
      data: {
        yearsServing: getWholeYearsSince(userInfo?.member_since),
        servicesAttended,
        soulsWon,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Something Went Wrong",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const updateUserPasswordToDefault = async (
  req: Request,
  res: Response,
) => {
  if (!canRunSensitiveUserOps()) {
    return res.status(403).json({
      message: "This endpoint is disabled in production.",
      data: null,
    });
  }

  try {
    const data = await userService.updateUserPasswordToDefault();

    return res.json({ message: "Operation sucessful", data: data });
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized", error });
  }
};

async function checkIfLifeCenterLeader(userId: number): Promise<boolean> {
  const lifeCenterMember = await lifeCenterService.getMyLifeCenter(userId);

  return Boolean(lifeCenterMember);
}

export const sendEmailToAllUsers = async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    const response = await userService.sendEmailToAllUsers(emails);

    return res
      .status(200)
      .json({ message: "Emails sent successfully", data: response });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Failed to send emails", data: error?.message });
  }
};


/**
 * Emails a link to set a new password: the 7-day welcome link for an account
 * that was just turned on, else the 15-minute reset link. An account with no
 * password gets a random one first, because the reset endpoint needs a stored
 * hash to check the link against.
 */
const sendPasswordLinkTo = async (
  user: { id: number; name: string; email: string | null; password: string | null },
  welcome: boolean,
) => {
  if (!isRealEmail(user.email)) return false;

  let password = user.password;
  if (!password) {
    password = await hashPassword(randomBytes(24).toString("hex"));
    await prisma.user.update({ where: { id: user.id }, data: { password } });
  }

  const token = JWT.sign(
    { id: user.id, email: user.email },
    JWT_SECRET + password,
    { expiresIn: welcome ? "7d" : "15m" },
  );
  const mailDetails = {
    user_name: user.name,
    link: `${process.env.Frontend_URL}/reset-password/?id=${user.id}&token=${token}`,
    expiration: welcome ? "7days" : "15mins",
  };
  await sendEmail(
    welcome ? userActivatedTemplate(mailDetails) : forgetPasswordTemplate(mailDetails),
    user.email as string,
    welcome ? "Set your password" : "Reset Password",
  );
  return true;
};

/** POST /user/send-reset-link { user_id } — an admin emails someone a password link. */
export const sendResetLink = async (req: Request, res: Response) => {
  const userId = Number(req.body?.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "user_id is required", data: null });
  }
  // Members › Send password links, or Access rights › Reset passwords (the
  // Users page); a role saved before actions keeps the Members manage rule.
  if (
    denyAction(
      res,
      membersActionAllowed(req, "send_password_link") ||
        callerActionAllowed(req, "Access_rights", "reset_password"),
      "You don't have permission to send password links.",
    ) ||
    (await denyMembersOutOfReach(req, res, [userId]))
  ) {
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, password: true },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found", data: null });
    }
    if (!(await sendPasswordLinkTo(user, false))) {
      return res.status(400).json({
        message: "This user has no email address to send the link to",
        data: null,
      });
    }
    return res.status(200).json({
      message: "Password link sent",
      data: { user_id: user.id, email: user.email, expires_in: "15m" },
    });
  } catch (error: any) {
    return res.status(500).json({ message: "Operation Failed", data: error?.message ?? null });
  }
};

/**
 * POST /user/give-access { user_id, branch_id, access_level_id, send_invite? }
 * Lets a member sign in to the admin app: turns on their account, gives them
 * a role in one branch and optionally emails them a link to set a password.
 */
export const giveAccess = async (req: Request, res: Response) => {
  const userId = Number(req.body?.user_id);
  const branchId = Number(req.body?.branch_id);
  const accessLevelId = Number(req.body?.access_level_id);
  const sendInvite = req.body?.send_invite !== false;

  if (![userId, branchId, accessLevelId].every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({
      message: "user_id, branch_id and access_level_id are required",
      data: null,
    });
  }

  try {
    assertCanGrantInBranches([branchId]);

    const [user, branch, level] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, password: true, is_user: true },
      }),
      prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }),
      prisma.access_level.findUnique({
        where: { id: accessLevelId },
        select: { id: true, deleted: true },
      }),
    ]);
    if (!user) return res.status(404).json({ message: "Member not found", data: null });
    if (!branch) return res.status(404).json({ message: "Branch not found", data: null });
    if (!level || level.deleted) {
      return res.status(404).json({ message: "Role not found", data: null });
    }
    if (sendInvite && !isRealEmail(user.email)) {
      return res.status(400).json({
        message: "This member has no email address, so they can't sign in yet",
        data: null,
      });
    }

    const newAccount = !user.is_user;
    if (newAccount) {
      await roleEligibilityService.assertEligible("ministry_worker", userId);
    }
    // Grant first: if it fails the member is not left as an admin with no role.
    await setBranchGrants([userId], [branchId], accessLevelId);
    if (newAccount) {
      await prisma.user.update({
        where: { id: userId },
        data: { is_user: true, is_active: true },
      });
    }
    void sessionChanged([userId], ["permissions", "profile"]);

    const invited = sendInvite ? await sendPasswordLinkTo(user, newAccount) : false;

    return res.status(200).json({
      message: "Access given",
      data: {
        user_id: userId,
        invited,
        branch_access: await listUserBranchGrants(userId),
      },
    });
  } catch (error: any) {
    if (error instanceof BranchAccessError) {
      return res
        .status(403)
        .json({ message: error.message, data: null, code: "BRANCH_FORBIDDEN" });
    }
    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }
    return res.status(500).json({ message: "Operation Failed", data: error?.message ?? null });
  }
};
