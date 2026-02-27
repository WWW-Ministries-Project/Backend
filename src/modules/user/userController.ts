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
    emailPattern.test(normalizedEmail) &&
    !normalizedEmail.endsWith("@temp.com")
  );
};

const parsePermissionsObject = (permissions: any): Record<string, any> | null => {
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

export const landingPage = async (req: Request, res: Response) => {
  res.send(
    // `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉💒</h1>`
    `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉🙏💒...</h1>`,
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
    const {
      personal_info: { first_name } = {},

      contact_info: { email } = {},

      password,
      is_user,
    } = req.body;

    const normalizedEmail = normalizeOptionalEmail(email);
    const isLoginUser =
      is_user === true || is_user === "true" || is_user === 1 || is_user === "1";

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
      return res
        .status(404)
        .json({
          message: "User exist with this email " + normalizedEmail,
          data: null,
        });
    }

    const response = await userService.registerUser(req.body);

    return res
      .status(201)
      .json({ message: "User Created Successfully", data: response });
  } catch (error: any) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    const contactInfoPayload = req.body?.contact_info || {};
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
      work_info: { work_name, work_industry, work_position, school_name } = {},
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
    } = req.body;

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

    const hasValue = (value: any) =>
      value !== undefined && value !== null && String(value).trim() !== "";

    const hasEmergencyContactPayload =
      hasValue(emergency_contact_name) ||
      hasValue(emergency_contact_relation) ||
      hasValue(emergency_country_code) ||
      hasValue(emergency_phone_number);

    const hasWorkInfoPayload =
      hasValue(work_name) ||
      hasValue(work_industry) ||
      hasValue(work_position) ||
      hasValue(school_name);

    if (!userExists?.user_info) {
      return res.status(400).json({
        message:
          "User profile details are missing. Please complete personal information first.",
        data: null,
      });
    }

    const userInfoUpdateData: any = {
      title,
      first_name,
      last_name,
      other_name,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : undefined,
      gender,
      marital_status,
      nationality,
      photo: picture.src,
      email: hasEmailField ? incomingEmail : undefined,
      country: resident_country,
      state_region,
      city,
      country_code,
      primary_number,
      member_since: member_since ? new Date(member_since) : undefined,
    };

    if (hasEmergencyContactPayload) {
      if (userExists.user_info.emergency_contact) {
        userInfoUpdateData.emergency_contact = {
          update: {
            name: emergency_contact_name,
            relation: emergency_contact_relation,
            country_code: emergency_country_code,
            phone_number: emergency_phone_number,
          },
        };
      } else {
        if (
          !hasValue(emergency_contact_name) ||
          !hasValue(emergency_contact_relation) ||
          !hasValue(emergency_phone_number)
        ) {
          return res.status(400).json({
            message:
              "Emergency contact name, relation, and phone number are required to add an emergency contact.",
            data: null,
          });
        }

        userInfoUpdateData.emergency_contact = {
          create: {
            name: emergency_contact_name,
            relation: emergency_contact_relation,
            country_code: emergency_country_code,
            phone_number: emergency_phone_number,
          },
        };
      }
    }

    if (hasWorkInfoPayload) {
      if (userExists.user_info.work_info) {
        userInfoUpdateData.work_info = {
          update: {
            name_of_institution: work_name,
            industry: work_industry,
            position: work_position,
            school_name,
          },
        };
      } else {
        if (
          !hasValue(work_name) ||
          !hasValue(work_industry) ||
          !hasValue(work_position)
        ) {
          return res.status(400).json({
            message:
              "Work name, industry, and position are required to add work information.",
            data: null,
          });
        }

        userInfoUpdateData.work_info = {
          create: {
            name_of_institution: work_name,
            industry: work_industry,
            position: work_position,
            school_name,
          },
        };
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: Number(user_id) },
      data: {
        name: `${first_name || userExists?.user_info?.first_name} ${
          other_name || userExists?.user_info?.other_name || ""
        } ${last_name || userExists?.user_info?.last_name}`.trim(),
        email: hasEmailField ? incomingEmail : userExists?.email,
        is_user: nextIsUser,
        access_level_id: nextAccessLevelId,
        status: status || userExists?.status,
        position_id: Number(position_id) || userExists?.position_id,
        department_id: Number(department_id) || userExists?.department_id,
        membership_type: membership_type || userExists?.membership_type,
        user_info: {
          update: userInfoUpdateData,
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

    // Optional: handle children (currently stubbed)
    if (family.length > 0) {
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
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
  }
};

async function updateFamilyMembers(family: any[], primaryUser: any) {
  const childKeywords = ["child", "son", "daughter", "ward", "kid", "children"];
  const spouseKeywords = ["spouse", "wife", "husband"];

  let spouseUser: any = null;

  /* =====================================================
     1️⃣ HANDLE SPOUSE FIRST (UPDATE OR CREATE)
  ====================================================== */
  for (const member of family) {
    if (!spouseKeywords.includes(member.relation.toLowerCase())) continue;

    if (member.user_id) {
      const hasEmailField = Object.prototype.hasOwnProperty.call(member, "email");
      // UPDATE EXISTING SPOUSE
      spouseUser = await prisma.user.update({
        where: { id: Number(member.user_id) },
        data: {
          name: toCapitalizeEachWord(
            `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
          ),
          ...(hasEmailField ? { email: normalizeOptionalEmail(member.email) } : {}),
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
      // CREATE SPOUSE
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

    await prisma.family_relation.upsert({
      where: {
        user_id_family_id: {
          user_id: primaryUser.id,
          family_id: spouseUser.id,
        },
      },
      update: { relation: member.relation },
      create: {
        user_id: primaryUser.id,
        family_id: spouseUser.id,
        relation: member.relation,
      },
    });

    await prisma.family_relation.upsert({
      where: {
        user_id_family_id: {
          user_id: spouseUser.id,
          family_id: primaryUser.id,
        },
      },
      update: { relation: member.relation },
      create: {
        user_id: spouseUser.id,
        family_id: primaryUser.id,
        relation: member.relation,
      },
    });
  }

  return Promise.all(
    family.map(async (member) => {
      let familyUser: any;

      // Skip spouse (already handled)
      if (spouseKeywords.includes(member.relation.toLowerCase())) {
        return spouseUser;
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
      } else if (childKeywords.includes(member.relation.toLowerCase())) {
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

        // 🔗 CHILD ↔ SPOUSE
        if (spouseUser) {
          await prisma.family_relation.upsert({
            where: {
              user_id_family_id: {
                user_id: spouseUser.id,
                family_id: familyUser.id,
              },
            },
            update: { relation: "child" },
            create: {
              user_id: spouseUser.id,
              family_id: familyUser.id,
              relation: "child",
            },
          });
        }
      } else {
        /* =====================
         OTHER FAMILY MEMBERS
      ====================== */
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

      /* =====================
         LINK TO PRIMARY USER
      ====================== */
      await prisma.family_relation.upsert({
        where: {
          user_id_family_id: {
            user_id: primaryUser.id,
            family_id: familyUser.id,
          },
        },
        update: { relation: member.relation },
        create: {
          user_id: primaryUser.id,
          family_id: familyUser.id,
          relation: member.relation,
        },
      });

      return familyUser;
    }),
  );
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
        email: true,
        name: true,
        password: true,
        is_active: true,
        is_user: true,
        access_level_id: true,
        membership_type: true,
        department_positions: {
          include: {
            department: true,
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

    const department: string[] = existance.department_positions.map(
      (dept: any) => dept.department?.name,
    ).filter(Boolean);

    const ministry_worker = Boolean(existance.is_user);
    const user_category =
      ministry_worker && Boolean(existance.access_level_id) ? "admin" : "member";
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
          name: existance.name,
          email: existance.email,
          ministry_worker: ministry_worker,
          user_category,
          permissions: tokenPermissions,
          profile_img: existance.user_info?.photo,
          membership_type: existance.membership_type || null,
          department,
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
export const ListUsers = async (req: Request, res: Response) => {
  const {
    is_user,
    department_id,
    page = "1",
    take = "12",
    is_active,
    name,
    ministry_worker,
    membership_type,
  } = req.query;
  const isUser =
    is_user === "true" || ministry_worker === "true" ? true : false;

  const pageNum = parseInt(page as string, 10);
  const pageSize = parseInt(take as string, 10);
  const skip = (pageNum - 1) * pageSize;
  const memberScope = (req as any).memberScope;
  const excludedMemberIds: number[] = Array.isArray(memberScope?.exclusions)
    ? memberScope.exclusions
    : [];

  try {
    const departments = await prisma.department.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    const departmentMap = new Map(departments.map((d) => [d.id, d.name]));

    const whereFilter: any = {};

    if (is_active !== undefined) whereFilter.is_active = is_active;
    if (is_user !== undefined) whereFilter.is_user = isUser;
    if (department_id) {
      const parsedDepartmentId = Number(department_id);
      if (!Number.isNaN(parsedDepartmentId) && parsedDepartmentId > 0) {
        whereFilter.OR = [
          { department_id: parsedDepartmentId },
          { department_positions: { some: { department_id: parsedDepartmentId } } },
        ];
      }
    }
    if (membership_type) whereFilter.membership_type = membership_type;
    if (typeof name === "string" && name.trim()) {
      whereFilter.name = { contains: name.trim() };
    }
    if (excludedMemberIds.length > 0) {
      whereFilter.id = { notIn: excludedMemberIds };
    }

    const total = await prisma.user.count({ where: whereFilter });

    const users = await prisma.user.findMany({
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
        user_info: {
          select: {
            country_code: true,
            primary_number: true,
            title: true,
            photo: true,
            country: true,
            member_since: true,
            marital_status: true,
            work_info: {
              select: {
                employment_status: true,
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
      },
    });

    const usersWithDeptName = users.map((user: any) => {
      const departmentIdsFromPositions = Array.from(
        new Set(
          (user.department_positions || [])
            .map((entry: any) => entry?.department?.id ?? entry?.department_id)
            .filter((value: number | undefined): value is number => Number.isInteger(value)),
        ),
      );
      const departmentNamesFromPositions = Array.from(
        new Set(
          (user.department_positions || [])
            .map((entry: any) => entry?.department?.name)
            .filter((value: string | undefined): value is string => Boolean(value)),
        ),
      );

      const primaryDepartmentId = user.department_id || departmentIdsFromPositions[0] || null;
      const primaryDepartmentName =
        departmentMap.get(primaryDepartmentId) || departmentNamesFromPositions[0] || null;

      return {
        ...user,
        department_id: primaryDepartmentId,
        department_name: primaryDepartmentName,
        department_names: departmentNamesFromPositions,
        department_positions: (user.department_positions || []).map((entry: any) => ({
          department_id: entry?.department?.id ?? entry?.department_id ?? null,
          department_name: entry?.department?.name ?? null,
          position_id: entry?.position?.id ?? entry?.position_id ?? null,
          position_name: entry?.position?.name ?? null,
        })),
      };
    });

    const destructure = (data: any[]) => {
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

    res.status(200).json({
      message: "Operation Successful",
      current_page: pageNum,
      page_size: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: destructure(usersWithDeptName),
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
        department_positions: {
          select: {
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
          orderBy: {
            id: "asc",
          },
        },
      },
    });

    res.status(200).json({
      message: "Operation Successful",
      data: users.map((user) => {
        const fallbackDepartment = user.department_positions?.find(
          (item) => item.department,
        )?.department;
        const fallbackPosition = user.department_positions?.find(
          (item) => item.position,
        )?.position;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          ministry_worker: Boolean(user.is_user),
          department: user.department?.department_info || fallbackDepartment || null,
          position: user.position || fallbackPosition || null,
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
    // Convert pagination params to numbers
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

    // Fetch total count for pagination info
    const total = await prisma.user.count({ where: filters });

    // Fetch paginated users
    const users = await prisma.user.findMany({
      where: filters,
      include: {
        user_info: true,
      },
      orderBy: {
        created_at: "asc",
      },
      skip,
      take: limitNum,
    });

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

  const siblingsKeywords = [
    "sibling",
    "brother",
    "sister",
    "sibs",
    "sis",
    "bro",
    "siblings",
  ];

  const childKeywords = ["child", "son", "daughter", "ward", "kid", "children"];

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
        relation: r.relation.toLowerCase(),
        direction: "forward",
      });
    });

    // Reverse (them → me)
    reverseRelations.forEach((r) => {
      let inferredRelation = r.relation.toLowerCase();

      if (childKeywords.includes(inferredRelation)) inferredRelation = "parent";
      else if (inferredRelation === "parent") inferredRelation = "child";

      normalizedRelations.push({
        user: r.user,
        relation: inferredRelation,
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
    const spouses = relations.filter((r) => r.relation === "spouse");

    const parents = relations.filter((r) => r.relation === "parent");

    const children = relations.filter((r) =>
      childKeywords.includes(r.relation),
    );

    const siblings = relations.filter((r) =>
      siblingsKeywords.includes(r.relation),
    );

    const others = relations.filter(
      (r) =>
        !["spouse", "parent"]
          .concat(childKeywords, siblingsKeywords)
          .includes(r.relation),
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
      ...spouses.map((s) => ({ ...s.user.user_info, relation: "spouse" })),
      ...Array.from(childrenMap.values()).map((c) => ({
        ...c.user_info,
        relation: "child",
      })),
      ...parents.map((p) => ({
        ...p.user.user_info,
        relation: "parent",
      })),
      ...Array.from(siblingsMap.values()).map((s) => ({
        ...s.user_info,
        relation: "sibling",
      })),
      ...others.map((o) => ({
        ...o.user.user_info,
        relation: o.relation,
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
        isOwnScope && Number.isInteger(authenticatedUserId) && authenticatedUserId > 0
          ? {
              user_id: authenticatedUserId,
            }
          : {
              OR: [{ email: email as string }, { primary_number: email as string }],
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
      include: {
        user_info: true,
        department_positions: {
          include: {
            department: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const department: string[] = user.department_positions.map(
      (dept) => dept.department.name,
    );

    const data = {
      name: user.name,
      email: user.email,
      phone: user.user_info?.primary_number || null,
      member_since: user.user_info?.member_since || null,
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
