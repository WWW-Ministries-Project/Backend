import { prisma } from "../../Models/context";
import { toCapitalizeEachWord, hashPassword, sendEmail } from "../../utils";
import axios from "axios";
import { program } from "@prisma/client/edge";
import { applicationLiveTemplate } from "../../utils/mail_templates/applicationLiveTemplate";

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
      family =[],
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
  const childKeywords = ["child", "son", "daughter", "ward", "kid", "children"];
  const spouseKeywords = ["spouse", "wife", "husband"];

  let spouseUser: any = null;

  // 1️⃣ First pass → handle spouse
  for (const member of family) {
    if (spouseKeywords.includes(member.relation.toLowerCase())) {
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
            email:
              member.email ||
              `${member.first_name.toLowerCase()}_${member.last_name.toLowerCase()}_${Date.now()}@temp.com`,
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

        await this.generateUserId(spouseUser);
      }

      // 🔗 link spouses
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
    }
  }

  // 2️⃣ Second pass → handle everyone else (including children)
  return Promise.all(
    family.map(async (member) => {
      let familyUser : any;

      // Skip spouse (already handled)
      if (spouseKeywords.includes(member.relation.toLowerCase())) {
        return spouseUser;
      }

      // 3️⃣ Existing user
      if (member.user_id) {
        familyUser = await prisma.user.findUnique({
          where: { id: Number(member.user_id) },
        });
      }

      // 4️⃣ Child logic
      else if (childKeywords.includes(member.relation.toLowerCase())) {
        // Try to find existing child for either parent
        familyUser = await prisma.user.findFirst({
          where: {
            user_info: {
              first_name: member.first_name,
              last_name: member.last_name,
              date_of_birth: new Date(member.date_of_birth),
            },
            OR: [
              { parent_id: primaryUser.id },
              { parent_id: spouseUser?.id },
            ],
          },
        });

        // Create child if not found
        if (!familyUser) {
          familyUser = await prisma.user.create({
            data: {
              name: toCapitalizeEachWord(
                `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
              ),
              email:
                member.email ||
                `${member.first_name.toLowerCase()}_${member.last_name.toLowerCase()}_${Date.now()}@temp.com`,
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

        // 🔗 Link child to spouse as well
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
      }

      // 5️⃣ Other family members
      else {
        familyUser = await prisma.user.create({
          data: {
            name: toCapitalizeEachWord(
              `${member.first_name} ${member.other_name || ""} ${member.last_name}`.trim(),
            ),
            email:
              member.email ||
              `${member.first_name.toLowerCase()}_${member.last_name.toLowerCase()}_${Date.now()}@temp.com`,
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

      // 🔗 Link to primary user
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
    const siblingsKeywords = ["sibling", "brother", "sister", "sibs", "sis", "bro", "siblings"];
    const childKeywords = ["child", "son", "daughter", "ward", "kid", "children"];
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
    .filter((r) => r.relation.toLowerCase() === "spouse")
    .map((r) => r.family);

  const children = relations
    .filter((r) => childKeywords.includes(r.relation.toLowerCase()))
    .map((r) => r.family);

  const siblings = relations
    .filter((r) => siblingsKeywords.includes(r.relation.toLowerCase()))
    .map((r) => r.family);

  const parents = relations
    .filter((r) => r.relation.toLowerCase() === "parent")
    .map((r) => r.family);

  const others = relations
    .filter(
      (r) =>
        !["spouse", "child", "sibling", "parent"].concat(siblingsKeywords, childKeywords).includes(
          r.relation.toLowerCase(),
        ),
    )
    .map((r) => ({ ...r.family, relation: r.relation }));

  // 4️⃣ Include children who have this user as biological parent
  const biologicalChildren = await prisma.user.findMany({
    where: { parent_id: user.id },
    include: { user_info: true },
  });

  // Merge children from family_relation and parent_id, deduplicate
  const childrenMap = new Map<number, any>();
  [...children, ...biologicalChildren].forEach((c) => childrenMap.set(c.id, c));

  // 5️⃣ Include siblings by checking parent_id
  const parentIds = parents.map((p) => p.id);
  const siblingsByParent = await prisma.user.findMany({
    where: { parent_id: { in: parentIds }, NOT: { id: user.id } },
    include: { user_info: true },
  });

  const siblingsMap = new Map<number, any>();
  [...siblings, ...siblingsByParent].forEach((s) => siblingsMap.set(s.id, s));

  // 6️⃣ Return structured family tree
  return {
    user,
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

    const emailPromises = recipients.map(async (user: any) => {
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
