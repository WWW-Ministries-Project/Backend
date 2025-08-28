import { prisma } from "../../Models/context";
import { toCapitalizeEachWord, hashPassword } from "../../utils";
import axios from "axios";
import { program, topic } from "@prisma/client/edge";

export class UserService {
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
      status,
      password,
      is_user,
      department_positions,
    } = userData;

    // Generate email if not provided
    let userEmail =
      email?.trim().toLowerCase() ||
      `${first_name.toLowerCase()}${last_name.toLowerCase()}_${Date.now()}@temp.com`;

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
        is_user,
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
            email,
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

    let savedChildren;

    if (has_children && children.length > 0) {
      savedChildren = await this.registerChildren(
        children,
        savedUser,
        membership_type,
      );
    }

    return {
      parent: {
        ...userWithoutPassword,
        photo,
      },
      children: savedChildren,
    };
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
              email: `${child.first_name.toLowerCase()}_${child.last_name.toLowerCase()}_${Date.now()}@temp.com`,
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

  private async generateUserId(userData: any) {
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

  async convertMemeberToConfirmedMember(id: number, status: string) {
    const allRequiredMemberPrograms = await prisma.program.findMany({
      where: {
        member_required: true,
      },
    });

    if (allRequiredMemberPrograms.length === 0) {
      return this.updateMemberToConfirmedMember(id, status);
    }

    const programIds = allRequiredMemberPrograms.map(
      (program: program) => program.id,
    );
    const completionResults = await this.checkMultipleProgramCompletion(
      id,
      programIds,
    );

    const notEnrolledPrograms = completionResults
      .filter((res) => !res.enrolled)
      .map((res) => res.programId);

    const incompletePrograms = completionResults
      .filter((res) => res.enrolled && !res.completed)
      .map((res) => res.programId);

    const getProgramTitles = (ids: number[]) =>
      allRequiredMemberPrograms
        .filter((p: program) => ids.includes(p.id))
        .map((p: any) => p.title);

    if (notEnrolledPrograms.length > 0 || incompletePrograms.length > 0) {
      const notEnrolledTitles = getProgramTitles(notEnrolledPrograms);
      const incompleteTitles = getProgramTitles(incompletePrograms);

      let errorMsg = "Cannot confirm membership. ";

      if (notEnrolledTitles.length > 0) {
        errorMsg += `Not enrolled in: ${notEnrolledTitles.join(", ")}. `;
      }
      if (incompleteTitles.length > 0) {
        errorMsg += `Incomplete programs: ${incompleteTitles.join(", ")}.`;
      }

      return {
        message: "",
        error: errorMsg.trim(),
      };
    }

    return this.updateMemberToConfirmedMember(id, status);
  }

  private async updateMemberToConfirmedMember(id: number, status: string) {
    const updatedMember = await prisma.user.update({
      where: {
        id,
      },
      data: {
        status: "CONFIRMED",
      },
    });

    if (updatedMember.status === "CONFIRMED") {
      return {
        message: `Membership confirmed for ${updatedMember.name}`,
        error: "",
      };
    } else {
      return {
        message: "",
        error: `Membership confirmed for ${updatedMember.name}`,
      };
    }
  }

  private async checkMultipleProgramCompletion(
    userId: number,
    programIds: number[],
  ) {
    const results = await Promise.all(
      programIds.map(async (programId) => {
        // 1. Check enrollment
        const enrollment = await prisma.enrollment.findFirst({
          where: {
            user_id: userId,
            course: {
              cohort: {
                programId,
              },
            },
          },
          select: { id: true },
        });

        if (!enrollment) {
          return { programId, enrolled: false, completed: false };
        }

        // 2. Get topic IDs
        const topics = await prisma.topic.findMany({
          where: { programId },
          select: { id: true },
        });
        const topicIds = topics.map((t: any) => t.id);

        // 3. Check progress
        const passedCount = await prisma.progress.count({
          where: {
            enrollmentId: enrollment.id,
            topicId: { in: topicIds },
            status: "PASS",
          },
        });

        const completed = passedCount === topicIds.length;

        return { programId, enrolled: true, completed };
      }),
    );

    return results;
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

    return { message: "Spouses linked successfully.", error: "" };
  }

  async getUserFamily(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        spouse: {
          include: {
            user_info: true,
          },
        },
        user_info: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const spouse = user.spouse;

    const children = await prisma.user.findMany({
      where: {
        OR: [
          { parent_id: user.id },
          ...(spouse?.id ? [{ parent_id: spouse.id }] : []),
        ],
      },
      include: {
        user_info: true,
      },
    });

    return {
      user,
      spouse,
      children,
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
}
