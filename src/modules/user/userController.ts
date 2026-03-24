import e, { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { prisma } from "../../Models/context";
import {
  sendEmail,
  comparePassword,
  hashPassword,
  toCapitalizeEachWord,
} from "../../utils";
import { UserService } from "./userService";
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
import {
  buildRoleEligibilityFailureResponse,
  isRoleEligibilityValidationError,
  roleEligibilityService,
} from "../settings/roleEligibilityService";
import { InputValidationError } from "../../utils/custom-error-handlers";

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

export const updateUser = async (req: Request, res: Response) => {
  try {
    const normalizedPayload = normalizeMemberPayload(req.body);
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

    const updatedUser = await prisma.user.update({
      where: { id: Number(user_id) },
      data: {
        name: nextDisplayName,
        email: hasEmailField ? incomingEmail : userExists?.email,
        is_user: nextIsUser,
        access_level_id: nextAccessLevelId,
        status: status || userExists?.status,
        position_id: Number(position_id) || userExists?.position_id,
        department_id: Number(department_id) || userExists?.department_id,
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

    // Handle department_positions update
    if (
      Array.isArray(department_positions) &&
      department_positions.length > 0
    ) {
      console.log("Stub: handle department updates here");
      dep_posts = await updateDepartmentPositions(
        Number(user_id),
        department_positions,
      );
    }

    if (hasFamilyField) {
      if (!Array.isArray(family)) {
        return res.status(400).json({
          message: "family must be an array when provided.",
          data: null,
        });
      }
      await updateFamilyMembers(family, updatedUser);
    }
    const { password, ...rest } = updatedUser;

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
          name: toCapitalizeEachWord(
            `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ),
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
          name: toCapitalizeEachWord(
            `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ),
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
          name: toCapitalizeEachWord(
            `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ),
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
            name: toCapitalizeEachWord(
              `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
            ),
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
          name: toCapitalizeEachWord(
            `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ),
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

// Helper to update department_positions
async function updateDepartmentPositions(
  userId: number,
  department_positions: { department_id: any; position_id: any }[],
) {
  await prisma.department_positions.deleteMany({
    where: { user_id: userId },
  });
  console.log(
    "Department positions to create:",
    department_positions.map((dp) => ({
      user_id: userId,
      department_id: parseInt(dp.department_id),
      position_id: parseInt(dp.position_id),
    })),
  );
  const created = await Promise.all(
    department_positions.map((dp) =>
      prisma.department_positions.create({
        data: {
          user_id: userId,
          department_id: parseInt(dp.department_id),
          position_id: parseInt(dp.position_id),
        },
      }),
    ),
  );
  console.log("Inserted department positions:", created);
  return created;
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
    return res
      .status(200)
      .json({ message: "User deleted Succesfully", data: null });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
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
      select: {
        id: true,
        member_id: true,
        email: true,
        name: true,
        password: true,
        is_active: true,
        is_user: true,
        access_level_id: true,
        membership_type: true,
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
      },
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
    const user_category =
      ministry_worker && Boolean(existance.access_level_id)
        ? "admin"
        : "member";
    const tokenPermissions =
      user_category === "admin"
        ? parsePermissionsObject(existance.access?.permissions) || {}
        : null;

    const life_center_leader: boolean = await checkIfLifeCenterLeader(
      existance.id,
    );
    const instructor: boolean = await courseService.checkIfInstructor(
      existance.id,
    );

    if (await comparePassword(String(password || ""), existance.password)) {
      const token = JWT.sign(
        {
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
        },
        JWT_SECRET,
        {
          expiresIn: "12h",
        },
      );

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
  } = req.query;
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

    if (is_active !== undefined) {
      whereConditions.push({
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
        whereConditions.push({
          OR: [{ status: "UNCONFIRMED" }, { status: null }],
        });
      } else if (
        normalizedStatus === "CONFIRMED" ||
        normalizedStatus === "MEMBER"
      ) {
        whereConditions.push({ status: normalizedStatus });
      }
    }
    if (membership_type) {
      whereConditions.push({ membership_type });
    }
    if (searchTerm) {
      whereConditions.push({
        OR: [
          { name: { contains: searchTerm } },
          { email: { contains: searchTerm } },
          { member_id: { contains: searchTerm } },
          {
            user_info: {
              is: {
                primary_number: { contains: searchTerm },
              },
            },
          },
        ],
      });
    }
    if (excludedMemberIds.length > 0) {
      whereConditions.push({
        id: { notIn: excludedMemberIds },
      });
    }
    const whereFilter =
      whereConditions.length > 0 ? { AND: whereConditions } : undefined;

    const [total, users] = await Promise.all([
      prisma.user.count({ where: whereFilter }),
      prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: {
          name: "asc",
        },
        where: whereFilter,
        select: {
          id: true,
          name: true,
          email: true,
          member_id: true,
          created_at: true,
          is_active: true,
          is_user: true,
          department_id: true,
          membership_type: true,
          status: true,
          position_id: true,
        },
      }),
    ]);

    const userIds = users.map((user) => user.id);
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

      return {
        ...user,
        position: user.position_id
          ? positionById.get(user.position_id) || null
          : null,
        user_info: userInfo,
        department_id: primaryDepartmentId,
        department_name: primaryDepartmentName,
        department_names: departmentNamesFromPositions,
        department_positions: departmentPositions.map((entry: any) => ({
          department_id: entry.department_id,
          department_name: entry.department_name,
          position_id: entry.position_id,
          position_name: entry.position_name,
        })),
      };
    });

    res.status(200).json({
      message: "Operation Successful",
      current_page: pageNum,
      take: pageSize,
      page_size: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: flattenListedUsers(usersWithDeptName),
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
    const users = await prisma.user.findMany({
      orderBy: {
        name: "asc",
      },
      where:
        excludedMemberIds.length > 0
          ? {
              id: {
                notIn: excludedMemberIds,
              },
            }
          : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        is_user: true,
        position_id: true,
      },
    });

    const userIds = users.map((user) => user.id);
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
      data: users.map((user) => {
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
          email: user.email,
          ministry_worker: Boolean(user.is_user),
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
      data: users,
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
        enrollments: {
          select: {
            id: true,
            enrolledAt: true,
            completed: true,
            completedAt: true,
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
    const { user_info, department_positions, enrollments, ...rest } = response;

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
    if (department_positions?.length) {
      user.department_positions = department_positions.map((dp: any) => ({
        department_id: dp.department?.id ?? null,
        department_name: dp.department?.name ?? null,
        position_id: dp.position?.id ?? null,
        position_name: dp.position?.name ?? null,
      }));
    }

    const enrolledPrograms = (enrollments || []).map((enrollment: any) => {
      const completed = Boolean(enrollment.completed);

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

    return res.status(200).json({
      message: "Operation Successful",
      data: user,
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
    const [onlineUsers, inhouseUsers] = await Promise.all([
      prisma.user_info.findMany({
        where: {
          user: { membership_type: "ONLINE" },
        },
      }),
      prisma.user_info.findMany({
        where: {
          user: { membership_type: "IN_HOUSE" },
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

export const linkSpouses = async (req: Request, res: Response) => {
  try {
    const { husband, wife } = req.body;
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

    if (Array.isArray(childrenIds) && childrenIds.length > 0) {
      const result = await userService.linkChildren(childrenIds, parentId);
      if (result) {
        return { message: "Operation Sucess", data: result };
      }

      return {
        message: "Operation Failed",
        data: "Something Happened, Contact Eshun",
      };
    }

    return {
      message: "Operation Failed",
      data: "We expect the children Id to be an Array",
    };
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

    const user = await prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        name: true,
        email: true,
        membership_type: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const [userInfo, departmentPositions] = await Promise.all([
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
    ]);
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

    const data = {
      name: user.name,
      email: user.email,
      phone: userInfo?.primary_number || null,
      member_since: userInfo?.member_since || null,
      department,
      membership_type: user.membership_type || null,
    };

    return res.json({ message: "Operation sucessful", data: data });
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized", error });
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
