import { prisma } from "../../Models/context";
import { toCapitalizeEachWord, hashPassword, sendEmail } from "../../utils";
import axios from "axios";
import { applicationLiveTemplate } from "../../utils/mail_templates/applicationLiveTemplate";
import { InputValidationError } from "../../utils/custom-error-handlers";
import {
  FAMILY_RELATION,
  normalizeFamilyRelation,
  toFamilyRelationLabel,
  upsertBidirectionalFamilyRelation,
} from "./familyRelations";
import { roleEligibilityService } from "../settings/roleEligibilityService";

type MemberStatusTransitionTarget = "CONFIRMED" | "MEMBER";
type MemberStatusValue = "UNCONFIRMED" | "CONFIRMED" | "MEMBER" | null;
type ResolvedMemberStatus = Exclude<MemberStatusValue, null> | "UNKNOWN";
type BulkMemberStatusFailureCode =
  | "INVALID_USER_ID"
  | "NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "MEMBER_PROGRAM_REQUIRED"
  | "INTERNAL_ERROR";

type BulkMemberStatusSuccessResult = {
  user_id: string;
  success: true;
  previous_status: Exclude<MemberStatusValue, null>;
  current_status: MemberStatusTransitionTarget;
};

type BulkMemberStatusFailureResult = {
  user_id: string;
  success: false;
  code: BulkMemberStatusFailureCode;
  message: string;
};

type BulkMemberStatusResult =
  | BulkMemberStatusSuccessResult
  | BulkMemberStatusFailureResult;

export class UserService {
  private normalizeOptionalEmail(email?: string | null) {
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();

    return normalizedEmail || null;
  }

  private isRealEmail(email?: string | null) {
    const normalizedEmail = this.normalizeOptionalEmail(email);
    if (!normalizedEmail) return false;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (
      emailPattern.test(normalizedEmail) &&
      !normalizedEmail.endsWith("@temp.com")
    );
  }

  async registerUser(userData: any) {
    const {
      personal_info: {
        title,
        first_name,
        other_name,
        last_name,
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
        department_id,
        position_id,
        member_since,
      } = {},

      children = [],
      family = [],
      status,
      password,
      is_user,
      department_positions,
    } = userData;

    const isLoginUser =
      is_user === true || is_user === "true" || is_user === 1 || is_user === "1";
    const userEmail = this.normalizeOptionalEmail(email);
    const normalizedStatus = String(status || "")
      .trim()
      .toUpperCase();

    if (isLoginUser && !this.isRealEmail(userEmail)) {
      throw new Error("A valid non-temporary email is required for login users.");
    }

    if (normalizedStatus === "MEMBER") {
      await roleEligibilityService.assertEligible("member");
    }

    if (isLoginUser) {
      await roleEligibilityService.assertEligible("ministry_worker");
    }

    // Hash password for all users
    const hashedPassword = await hashPassword(password || "123456");

    const departmentId =
      isNaN(parseInt(department_id)) || parseInt(department_id) === 0
        ? null
        : parseInt(department_id);

    const positionId =
      isNaN(parseInt(position_id)) || parseInt(position_id) === 0
        ? null
        : parseInt(position_id);

    // Create user in database
    const user = await prisma.user.create({
      data: {
        name: toCapitalizeEachWord(
          `${first_name} ${other_name || ""} ${last_name}`.trim(),
        ),
        email: userEmail,
        password: hashedPassword,
        is_user: isLoginUser,
        is_active: false,
        status,
        department_id: departmentId,
        position_id: positionId,
        membership_type,
        user_info: {
          create: {
            title,
            first_name,
            last_name,
            other_name,
            date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
            gender,
            marital_status,
            nationality,
            photo: picture?.src || "",
            primary_number,
            country_code,
            member_since: member_since ? new Date(member_since) : null,
            email: userEmail,
            country: resident_country,
            state_region,
            city,
            emergency_contact: {
              create: {
                name: emergency_contact_name,
                relation: emergency_contact_relation,
                country_code: emergency_country_code,
                phone_number: emergency_phone_number,
              },
            },
            work_info: {
              create: {
                employment_status,
                name_of_institution: work_name,
                industry: work_industry,
                position: work_position,
                school_name,
              },
            },
          },
        },
      },
    });

    await this.generateUserId(user).catch((err) =>
      console.error("Error generating user ID:", err),
    );

    if (
      Array.isArray(department_positions) &&
      department_positions.length > 0
    ) {
      console.log("Stub: handle department updates here");
      await this.savedDepartments(user.id, department_positions);
    }

    const savedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        user_info: {
          select: {
            photo: true,
          },
        },
      },
    });

    if (!savedUser) {
      throw new Error("User not found");
    }

    const { password: _, user_info, ...userWithoutPassword } = savedUser;
    const photo = user_info?.photo || null;

    let savedFamily = [];
    if (Array.isArray(family) && family.length > 0) {
      savedFamily = await this.registerFamilyMembers(family, user);
    }

    return {
      parent: {
        ...userWithoutPassword,
        photo,
      },
      family: savedFamily,
    };
  }

  async registerFamilyMembers(family: any[], primaryUser: any) {
    const retainedFamilyIds = new Set<number>();
    const savedFamilyMembers: any[] = [];
    let spouseUser: any = null;

    for (const member of family) {
      const relation = normalizeFamilyRelation(member?.relation);
      if (relation !== FAMILY_RELATION.SPOUSE) {
        continue;
      }

      if (member.user_id) {
        spouseUser = await prisma.user.findUnique({
          where: { id: Number(member.user_id) },
        });
      } else {
        spouseUser = await prisma.user.create({
          data: {
            name: toCapitalizeEachWord(
              `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
            ),
            email: this.normalizeOptionalEmail(member.email),
            is_user: false,
            is_active: true,
            membership_type: primaryUser.membership_type || "IN_HOUSE",
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

        await this.generateUserId(spouseUser);
      }

      if (!spouseUser) {
        throw new Error("Spouse user not found.");
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
          savedFamilyMembers.push(spouseUser);
        }
        continue;
      }

      if (member.user_id) {
        familyUser = await prisma.user.findUnique({
          where: { id: Number(member.user_id) },
        });
      } else if (relation === FAMILY_RELATION.CHILD) {
        // Try to find existing child for either parent
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

        // Create child if not found
        if (!familyUser) {
          familyUser = await prisma.user.create({
            data: {
              name: toCapitalizeEachWord(
                `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
              ),
              email: this.normalizeOptionalEmail(member.email),
              parent_id: primaryUser.id, // biological / primary
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

          await this.generateUserId(familyUser);
        }
      } else {
        // Other family members
        familyUser = await prisma.user.create({
          data: {
            name: toCapitalizeEachWord(
              `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
            ),
            email: this.normalizeOptionalEmail(member.email),
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

        await this.generateUserId(familyUser);
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

      if (spouseUser && relation === FAMILY_RELATION.CHILD) {
        await upsertBidirectionalFamilyRelation(
          spouseUser.id,
          familyUser.id,
          FAMILY_RELATION.CHILD,
        );
      }

      savedFamilyMembers.push(familyUser);
    }

    return savedFamilyMembers;
  }

  private async savedDepartments(
    userId: number,
    department_positions: { department_id: any; position_id: any }[],
  ) {
    console.log(
      "Department positions to create:",
      department_positions.map((dp: any) => ({
        user_id: userId,
        department_id: parseInt(dp.department_id),
        position_id: parseInt(dp.position_id),
      })),
    );
    return await prisma.department_positions.createMany({
      data: department_positions.map((dp) => ({
        user_id: userId,
        department_id: Number(dp.department_id),
        position_id: Number(dp.position_id),
      })),
      skipDuplicates: true,
    });
  }

  async registerChildren(
    children: any[],
    parentObj: any,
    membership_type: any,
  ) {
    const createdChildren = await Promise.all(
      children.map(async (child) => {
        try {
          const childUser = await prisma.user.create({
            data: {
              name: toCapitalizeEachWord(
                `${child.first_name} ${child.other_name || ""} ${child.last_name}`.trim(),
              ),
              email: this.normalizeOptionalEmail(child.email),
              is_user: false,
              is_active: true,
              parent_id: parentObj.id,
              membership_type,
              status: parentObj.status,
              user_info: {
                create: {
                  title: child.title,
                  first_name: child.first_name,
                  last_name: child.last_name,
                  other_name: child.other_name || null,
                  date_of_birth: new Date(child.date_of_birth),
                  gender: child.gender,
                  marital_status: child.marital_status,
                  nationality: child.nationality,
                },
              },
            },
          });

          const createdChild = await this.generateUserId(childUser);

          return createdChild;
        } catch (error) {
          console.error("Error creating child user:", error);
          return null; // Optional: skip this child if an error occurs
        }
      }),
    );

    return createdChildren.filter(Boolean);
  }

  async generateUserId(userData: any) {
    const prefix = process.env.ID_PREFIX || "WWM-HC";
    const year = new Date().getFullYear();
    const paddedId = (userData.id - 1).toString().padStart(4, "0");
    const generatedUserId = `${prefix}-${year}${paddedId}`;

    const password = userData.password || "";

    return await this.updateUserAndSetUserId(
      userData.id,
      generatedUserId,
      userData.name,
      password,
    );
  }

  private async updateUserAndSetUserId(
    id: number,
    generatedUserId: string,
    name: string,
    password: string,
  ) {
    // this is to save the user to the biometric device
    const result: any = await this.saveUserToZTeco(
      id,
      generatedUserId,
      name,
      password,
    );
    let updatedUser;
    if (result) {
      updatedUser = await prisma.user.update({
        where: { id },
        data: {
          member_id: generatedUserId,
          is_sync: true,
        },
      });
    } else {
      updatedUser = await prisma.user.update({
        where: { id },
        data: {
          member_id: generatedUserId,
          is_sync: false,
        },
      });
    }

    return updatedUser;
  }

  async saveUserToZTeco(
    id: number,
    member_id: string,
    name: string,
    password: string,
  ) {
    if (
      !process.env.SAVE_TO_ZKDEVICE ||
      process.env.SAVE_TO_ZKDEVICE === "false"
    )
      return false;

    if (!process.env.ZTECO_SERVICE) return false;

    const URL = process.env.ZTECO_SERVICE;
    console.log(`${URL}`);

    const userId = member_id.slice(-8);

    try {
      console.log(`attempting to save user to ${URL}/zteco`);
      await axios
        .post(`${URL}/zteco`, {
          id,
          member_id: userId,
          name,
          password,
        })
        .then((res) => {
          console.log(`User ${name} is saved to ZKdevice sucessfully`);
          console.log(res.data);
          return res.data[0];
        });
    } catch (error: any) {
      console.error("❌ Failed to call ZKTeco service:", error.message);
      return false;
    }
  }

  async convertMemeberToConfirmedMember(id: number, requestedStatus?: string) {
    const member = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    if (!member) {
      return {
        message: "",
        error: "User not found.",
      };
    }

    const targetStatus = this.resolveTargetMemberStatus(
      member.status ?? null,
      requestedStatus,
    );

    if (!targetStatus) {
      return {
        message: "",
        error:
          "Invalid target status. Use CONFIRMED for unconfirmed members or MEMBER for functional members.",
      };
    }

    if (member.status === "MEMBER") {
      return {
        message: `${member.name} is already a functional member.`,
        error: "",
      };
    }

    if (member.status === "UNCONFIRMED" || member.status === null) {
      if (targetStatus !== "CONFIRMED") {
        return {
          message: "",
          error:
            "Invalid transition. An unconfirmed member must be confirmed before becoming a functional member.",
        };
      }

      return this.updateMemberStatus(
        member.id,
        "CONFIRMED",
        `Membership confirmed for ${member.name}`,
      );
    }

    if (member.status === "CONFIRMED") {
      if (targetStatus === "CONFIRMED") {
        return {
          message: `${member.name} is already a confirmed member.`,
          error: "",
        };
      }

      return this.promoteConfirmedMemberToFunctionalMember(member.id, member.name);
    }

    return {
      message: "",
      error:
        "Current member status is invalid for this action. Expected UNCONFIRMED, CONFIRMED, or MEMBER.",
    };
  }

  async bulkUpdateMemberStatus(
    requestedStatus: string,
    userIds: unknown[],
  ): Promise<{
    status: MemberStatusTransitionTarget;
    requested_count: number;
    success_count: number;
    failure_count: number;
    results: BulkMemberStatusResult[];
  }> {
    const targetStatus = this.normalizeRequestedMemberStatus(requestedStatus);

    if (!targetStatus) {
      throw new InputValidationError("status must be CONFIRMED or MEMBER.");
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new InputValidationError("user_ids must be a non-empty array.");
    }

    const normalizedUserIds = this.normalizeBulkRequestedUserIds(userIds);
    const parsedUserIds = normalizedUserIds
      .map((userId) => this.parseRequestedUserId(userId))
      .filter((userId): userId is number => userId !== null);
    const uniqueParsedUserIds = Array.from(new Set(parsedUserIds));
    const existingMembers = await prisma.user.findMany({
      where: {
        id: {
          in: uniqueParsedUserIds,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
    const existingMembersById = new Map(
      existingMembers.map((member) => [member.id, member]),
    );

    const results = await Promise.all(
      normalizedUserIds.map((userId) =>
        this.buildBulkMemberStatusResult(
          userId,
          targetStatus,
          existingMembersById,
        ),
      ),
    );
    const successCount = results.filter((result) => result.success).length;

    return {
      status: targetStatus,
      requested_count: normalizedUserIds.length,
      success_count: successCount,
      failure_count: results.length - successCount,
      results,
    };
  }

  private normalizeRequestedMemberStatus(
    requestedStatus?: string,
  ): MemberStatusTransitionTarget | null {
    if (!requestedStatus) return null;

    const normalized = requestedStatus.toUpperCase().trim();

    if (normalized === "CONFIRMED") return "CONFIRMED";

    if (
      normalized === "MEMBER" ||
      normalized === "FUNCTIONAL_MEMBER" ||
      normalized === "FUNCTIONAL-MEMBER" ||
      normalized === "FUNCTIONALMEMBER" ||
      normalized === "FUNCTIONAL"
    ) {
      return "MEMBER";
    }

    return null;
  }

  private resolveTargetMemberStatus(
    currentStatus: string | null,
    requestedStatus?: string,
  ): MemberStatusTransitionTarget | null {
    const normalizedRequestedStatus =
      this.normalizeRequestedMemberStatus(requestedStatus);

    if (normalizedRequestedStatus) {
      return normalizedRequestedStatus;
    }

    if (currentStatus === "UNCONFIRMED" || currentStatus === null) {
      return "CONFIRMED";
    }
    if (currentStatus === "CONFIRMED") return "MEMBER";
    if (currentStatus === "MEMBER") return "MEMBER";

    return null;
  }

  private async promoteConfirmedMemberToFunctionalMember(
    id: number,
    memberName: string,
  ) {
    await roleEligibilityService.assertEligible("member", id);

    return this.updateMemberStatus(
      id,
      "MEMBER",
      `${memberName} is now a functional member.`,
    );
  }

  private normalizeBulkRequestedUserIds(userIds: unknown[]) {
    const seenUserIds = new Set<string>();
    const normalizedUserIds: string[] = [];

    for (const userId of userIds) {
      const rawUserId = String(userId ?? "").trim();
      const parsedUserId = this.parseRequestedUserId(rawUserId);
      const normalizedUserId =
        parsedUserId === null ? rawUserId : String(parsedUserId);
      const dedupeKey =
        parsedUserId === null
          ? `invalid:${normalizedUserId}`
          : `valid:${normalizedUserId}`;

      if (seenUserIds.has(dedupeKey)) {
        continue;
      }

      seenUserIds.add(dedupeKey);
      normalizedUserIds.push(normalizedUserId);
    }

    return normalizedUserIds;
  }

  private parseRequestedUserId(userId: string) {
    const parsedUserId = Number(userId);

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      return null;
    }

    return parsedUserId;
  }

  private resolveStoredMemberStatus(status: string | null): ResolvedMemberStatus {
    if (status === null) return "UNCONFIRMED";

    const normalizedStatus = String(status).trim().toUpperCase();

    if (
      normalizedStatus === "UNCONFIRMED" ||
      normalizedStatus === "CONFIRMED" ||
      normalizedStatus === "MEMBER"
    ) {
      return normalizedStatus;
    }

    return "UNKNOWN";
  }

  private buildBulkFailureResult(
    userId: string,
    code: BulkMemberStatusFailureCode,
    message: string,
  ): BulkMemberStatusFailureResult {
    return {
      user_id: userId,
      success: false,
      code,
      message,
    };
  }

  private async buildBulkMemberStatusResult(
    userId: string,
    targetStatus: MemberStatusTransitionTarget,
    existingMembersById: Map<number, { id: number; status: string | null }>,
  ): Promise<BulkMemberStatusResult> {
    const parsedUserId = this.parseRequestedUserId(userId);

    if (parsedUserId === null) {
      return this.buildBulkFailureResult(
        userId,
        "INVALID_USER_ID",
        "User ID must be a positive integer.",
      );
    }

    const member = existingMembersById.get(parsedUserId);

    if (!member) {
      return this.buildBulkFailureResult(
        userId,
        "NOT_FOUND",
        "User not found.",
      );
    }

    try {
      return await this.applyBulkMemberStatusTransition(
        userId,
        member,
        targetStatus,
      );
    } catch (error) {
      console.error("Failed to bulk update member status", {
        userId,
        targetStatus,
        error,
      });

      return this.buildBulkFailureResult(
        userId,
        "INTERNAL_ERROR",
        "Failed to update member status.",
      );
    }
  }

  private async applyBulkMemberStatusTransition(
    userId: string,
    member: { id: number; status: string | null },
    targetStatus: MemberStatusTransitionTarget,
  ): Promise<BulkMemberStatusResult> {
    const previousStatus = this.resolveStoredMemberStatus(member.status);

    if (previousStatus === "UNKNOWN") {
      return this.buildBulkFailureResult(
        userId,
        "INVALID_STATUS_TRANSITION",
        "Current member status is invalid for this action.",
      );
    }

    if (targetStatus === "CONFIRMED") {
      if (previousStatus !== "UNCONFIRMED") {
        return this.buildBulkFailureResult(
          userId,
          "INVALID_STATUS_TRANSITION",
          "Only unconfirmed members can be updated to CONFIRMED.",
        );
      }

      const updatedMember = await this.persistMemberStatus(member.id, "CONFIRMED");

      if (updatedMember.status !== "CONFIRMED") {
        return this.buildBulkFailureResult(
          userId,
          "INTERNAL_ERROR",
          "Failed to update member status.",
        );
      }

      return {
        user_id: userId,
        success: true,
        previous_status: previousStatus,
        current_status: "CONFIRMED",
      };
    }

    if (previousStatus !== "CONFIRMED") {
      return this.buildBulkFailureResult(
        userId,
        "INVALID_STATUS_TRANSITION",
        "Only confirmed members can be updated to MEMBER.",
      );
    }

    const missingPrograms = await roleEligibilityService.getMissingProgramsForUser(
      "member",
      member.id,
    );

    if (missingPrograms.length > 0) {
      return this.buildBulkFailureResult(
        userId,
        "MEMBER_PROGRAM_REQUIRED",
        "Required member program is incomplete.",
      );
    }

    const updatedMember = await this.persistMemberStatus(member.id, "MEMBER");

    if (updatedMember.status !== "MEMBER") {
      return this.buildBulkFailureResult(
        userId,
        "INTERNAL_ERROR",
        "Failed to update member status.",
      );
    }

    return {
      user_id: userId,
      success: true,
      previous_status: previousStatus,
      current_status: "MEMBER",
    };
  }

  private async updateMemberStatus(
    id: number,
    status: MemberStatusTransitionTarget,
    successMessage: string,
  ) {
    const updatedMember = await this.persistMemberStatus(id, status);

    if (updatedMember.status === status) {
      return {
        message: successMessage,
        error: "",
      };
    }

    return {
      message: "",
      error: `Failed to update membership status for ${updatedMember.name}.`,
    };
  }

  private async persistMemberStatus(
    id: number,
    status: MemberStatusTransitionTarget,
  ) {
    return prisma.user.update({
      where: {
        id,
      },
      data: {
        status,
      },
      select: {
        name: true,
        status: true,
      },
    });
  }

  async linkSpouses(userId1: number, userId2: number) {
    const [user1, user2] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId1 } }),
      prisma.user.findUnique({ where: { id: userId2 } }),
    ]);

    if (!user1 || !user2) {
      return {
        message: "",
        error: "One or both users not found.",
      };
    }

    // Avoid circular linking or overwriting existing links unless intentional
    if (user1.spouse_id || user2.spouse_id) {
      return {
        message: "",
        error: "One or both users already have a spouse linked.",
      };
    }

    await Promise.all([
      prisma.user.update({
        where: { id: userId1 },
        data: { spouse_id: userId2 },
      }),
      prisma.user.update({
        where: { id: userId2 },
        data: { spouse_id: userId1 },
      }),
    ]);

    await upsertBidirectionalFamilyRelation(
      userId1,
      userId2,
      FAMILY_RELATION.SPOUSE,
    );

    return { message: "Spouses linked successfully.", error: "" };
  }
  async getUserFamily(userId: number) {
    // Helper to remove password
    const sanitizeUser = (u: any) => {
      if (!u) return null;
      const { password: _, ...safe } = u;
      return safe;
    };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { user_info: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const relations = await prisma.family_relation.findMany({
      where: { user_id: userId },
      include: { family: { include: { user_info: true } } },
    });

    // 3️⃣ Organize relations by type
    const spouses = relations
      .filter((r) => r.relation === FAMILY_RELATION.SPOUSE)
      .map((r) => sanitizeUser(r.family));

    const children = relations
      .filter((r) => r.relation === FAMILY_RELATION.CHILD)
      .map((r) => sanitizeUser(r.family));

    const siblings = relations
      .filter((r) => r.relation === FAMILY_RELATION.SIBLING)
      .map((r) => sanitizeUser(r.family));

    const parents = relations
      .filter((r) => r.relation === FAMILY_RELATION.PARENT)
      .map((r) => sanitizeUser(r.family));

    const groupedRelationTypes = new Set<string>([
      FAMILY_RELATION.SPOUSE,
      FAMILY_RELATION.CHILD,
      FAMILY_RELATION.SIBLING,
      FAMILY_RELATION.PARENT,
    ]);

    const others = relations
      .filter(
        (r) => !groupedRelationTypes.has(r.relation),
      )
      .map((r) => ({
        ...sanitizeUser(r.family),
        relation: toFamilyRelationLabel(r.relation),
      }));

    // 4️⃣ Include children who have this user as biological parent
    const biologicalChildren = await prisma.user.findMany({
      where: { parent_id: user.id },
      include: { user_info: true },
    });

    // Merge children from family_relation and parent_id, deduplicate
    const childrenMap = new Map<number, any>();
    [...children, ...biologicalChildren.map(sanitizeUser)].forEach((c) =>
      childrenMap.set(c.id, c),
    );

    // 5️⃣ Include siblings by checking parent_id
    const parentIds = parents.map((p) => p.id);
    const siblingsByParent = await prisma.user.findMany({
      where: { parent_id: { in: parentIds }, NOT: { id: user.id } },
      include: { user_info: true },
    });

    const siblingsMap = new Map<number, any>();
    [...siblings, ...siblingsByParent.map(sanitizeUser)].forEach((s) =>
      siblingsMap.set(s.id, s),
    );

    return {
      user: sanitizeUser(user),
      spouses,
      children: Array.from(childrenMap.values()),
      parents,
      siblings: Array.from(siblingsMap.values()),
      others,
    };
  }

  async linkChildren(childrenIds: number[], parentId: number) {
    if (!childrenIds || childrenIds.length === 0) return;

    try {
      const result = await prisma.user.updateMany({
        where: {
          id: { in: childrenIds },
        },
        data: {
          parent_id: parentId,
        },
      });

      if (result) {
        return result;
      }
    } catch (error) {
      console.error("Error linking children:", error);
      throw error;
    }
  }

  async updateUserPasswordToDefault() {
    const hashedPassword = await hashPassword("123456");
    const result = await prisma.user.updateMany({
      data: {
        password: hashedPassword,
        is_active: true,
      },
    });

    return result;
  }

  async sendEmailToAllUsers(emails?: string[]) {
    const email_sent: Record<string, string> = {};
    const email_failed: Record<string, string> = {};

    let recipients: { email?: string | null; name?: string }[] = [];

    if (emails && emails.length > 0) {
      recipients = await prisma.user.findMany({
        where: {
          email: { in: emails },
          is_user: true,
        },
        select: {
          email: true,
          name: true,
        },
      });
    } else {
      recipients = await prisma.user.findMany({
        where: {
          email: { not: null },
          is_user: true,
        },
        select: {
          email: true,
          name: true,
        },
      });
    }

    const itContact =
      process.env.IT_CONTACT_EMAIL || "+233 24 232 5818 Barimah";
    const loginLink = process.env.PLATFORM_LOGIN;
    const guestLink = process.env.GUEST_ORDER_LINK;

    const realRecipients = recipients.filter(
      (user) =>
        Boolean(user.email) &&
        !String(user.email).toLowerCase().endsWith("@temp.com"),
    );

    const emailPromises = realRecipients.map(async (user: any) => {
      try {
        sendEmail(
          applicationLiveTemplate(
            String(loginLink),
            String(guestLink),
            itContact,
            user.name,
            user.email,
          ),
          user.email,
          "🎉 Our Application is Now Live!",
        );

        email_sent[user.email] = "Email sent";
      } catch (err: any) {
        email_failed[user.email] = "Email error: " + err.message;
      }
    });

    await Promise.all(emailPromises);

    return { email_sent, email_failed };
  }
}
