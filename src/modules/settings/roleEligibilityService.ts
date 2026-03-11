import { StatusCodes } from "http-status-codes";
import { prisma } from "../../Models/context";
import {
  AppError,
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

export const ROLE_ELIGIBILITY_KEYS = [
  "member",
  "ministry_worker",
  "instructor",
  "life_center_leader",
  "head_of_department",
] as const;

export type RoleEligibilityKey = (typeof ROLE_ELIGIBILITY_KEYS)[number];

type RoleEligibilityRuleRow = {
  role_key: string;
  program_id: number;
  program: {
    id: number;
    title: string;
  };
};

type MissingProgram = {
  id: number;
  title: string;
};

export type RoleEligibilityConfigRule = {
  role_key: RoleEligibilityKey;
  required_program_ids: string[];
  required_programs: MissingProgram[];
};

export class RoleEligibilityValidationError extends AppError {
  roleKey: RoleEligibilityKey;
  missingPrograms: MissingProgram[];

  constructor(roleKey: RoleEligibilityKey, missingPrograms: MissingProgram[]) {
    super("Member is not eligible for this role", StatusCodes.UNPROCESSABLE_ENTITY);
    this.roleKey = roleKey;
    this.missingPrograms = missingPrograms;
  }
}

export const isRoleEligibilityValidationError = (
  error: unknown,
): error is RoleEligibilityValidationError =>
  error instanceof RoleEligibilityValidationError;

export const buildRoleEligibilityFailureResponse = (
  error: RoleEligibilityValidationError,
) => ({
  success: false,
  message: error.message,
  data: {
    role_key: error.roleKey,
    missing_programs: error.missingPrograms,
  },
});

export class RoleEligibilityService {
  private normalizeRoleKey(roleKey: unknown): RoleEligibilityKey {
    const normalizedRoleKey = String(roleKey || "")
      .trim()
      .toLowerCase();

    if (
      !ROLE_ELIGIBILITY_KEYS.includes(normalizedRoleKey as RoleEligibilityKey)
    ) {
      throw new InputValidationError(
        `Invalid role_key. Expected one of: ${ROLE_ELIGIBILITY_KEYS.join(", ")}`,
      );
    }

    return normalizedRoleKey as RoleEligibilityKey;
  }

  private parseRequiredProgramIds(
    requiredProgramIds: unknown,
    roleKey: RoleEligibilityKey,
  ) {
    if (!Array.isArray(requiredProgramIds)) {
      throw new InputValidationError(
        `required_program_ids must be an array for role_key ${roleKey}`,
      );
    }

    const parsedProgramIds = requiredProgramIds.map((programId) => Number(programId));
    const hasInvalidProgramIds = parsedProgramIds.some(
      (programId) => !Number.isInteger(programId) || programId <= 0,
    );

    if (hasInvalidProgramIds) {
      throw new InputValidationError(
        `required_program_ids must contain only positive integers for role_key ${roleKey}`,
      );
    }

    return Array.from(new Set(parsedProgramIds));
  }

  private mapRules(rows: RoleEligibilityRuleRow[]): RoleEligibilityConfigRule[] {
    const groupedRules = new Map<RoleEligibilityKey, RoleEligibilityConfigRule>();

    for (const row of rows) {
      const roleKey = this.normalizeRoleKey(row.role_key);
      const existingRule = groupedRules.get(roleKey);

      if (!existingRule) {
        groupedRules.set(roleKey, {
          role_key: roleKey,
          required_program_ids: [String(row.program.id)],
          required_programs: [
            {
              id: row.program.id,
              title: row.program.title,
            },
          ],
        });
        continue;
      }

      existingRule.required_program_ids.push(String(row.program.id));
      existingRule.required_programs.push({
        id: row.program.id,
        title: row.program.title,
      });
    }

    return Array.from(groupedRules.values()).sort((left, right) =>
      left.role_key.localeCompare(right.role_key),
    );
  }

  async getConfig(): Promise<{ rules: RoleEligibilityConfigRule[] }> {
    const rows = (await prisma.role_eligibility_rules.findMany({
      include: {
        program: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: [{ role_key: "asc" }, { program_id: "asc" }],
    })) as RoleEligibilityRuleRow[];

    return {
      rules: this.mapRules(rows),
    };
  }

  async upsertConfig(payload: unknown): Promise<{ rules: RoleEligibilityConfigRule[] }> {
    const rules = (payload as { rules?: unknown })?.rules;

    if (!Array.isArray(rules)) {
      throw new InputValidationError("rules must be an array");
    }

    const roleKeysSeen = new Set<RoleEligibilityKey>();
    const normalizedRules = rules.map((rule, index) => {
      const roleKey = this.normalizeRoleKey((rule as { role_key?: unknown })?.role_key);

      if (roleKeysSeen.has(roleKey)) {
        throw new InputValidationError(
          `Duplicate role_key in payload: ${roleKey} at index ${index}`,
        );
      }

      roleKeysSeen.add(roleKey);

      return {
        role_key: roleKey,
        required_program_ids: this.parseRequiredProgramIds(
          (rule as { required_program_ids?: unknown })?.required_program_ids,
          roleKey,
        ),
      };
    });

    const allProgramIds = Array.from(
      new Set(
        normalizedRules.flatMap((rule) => rule.required_program_ids),
      ),
    );

    if (allProgramIds.length > 0) {
      const existingPrograms = await prisma.program.findMany({
        where: {
          id: {
            in: allProgramIds,
          },
        },
        select: {
          id: true,
        },
      });

      const existingProgramIds = new Set(existingPrograms.map((program) => program.id));
      const missingProgramIds = allProgramIds.filter(
        (programId) => !existingProgramIds.has(programId),
      );

      if (missingProgramIds.length > 0) {
        throw new NotFoundError(
          `Programs not found: ${missingProgramIds.join(", ")}`,
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const rule of normalizedRules) {
        await tx.role_eligibility_rules.deleteMany({
          where: {
            role_key: rule.role_key,
          },
        });

        if (rule.required_program_ids.length === 0) {
          continue;
        }

        await tx.role_eligibility_rules.createMany({
          data: rule.required_program_ids.map((programId) => ({
            role_key: rule.role_key,
            program_id: programId,
          })),
        });
      }
    });

    return this.getConfig();
  }

  async getRequiredProgramsForRole(roleKey: RoleEligibilityKey) {
    const config = await this.getConfig();
    return (
      config.rules.find((rule) => rule.role_key === roleKey)?.required_programs ?? []
    );
  }

  async getMissingProgramsForUser(
    roleKey: RoleEligibilityKey,
    userId?: number | null,
  ): Promise<MissingProgram[]> {
    const requiredPrograms = await this.getRequiredProgramsForRole(roleKey);

    if (requiredPrograms.length === 0) {
      return [];
    }

    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      return requiredPrograms;
    }

    const requiredProgramIds = requiredPrograms.map((program) => program.id);

    const [programs, enrollments] = await Promise.all([
      prisma.program.findMany({
        where: {
          id: {
            in: requiredProgramIds,
          },
        },
        select: {
          id: true,
          topics: {
            select: {
              id: true,
            },
          },
        },
      }),
      prisma.enrollment.findMany({
        where: {
          user_id: userId,
          course: {
            cohort: {
              programId: {
                in: requiredProgramIds,
              },
            },
          },
        },
        select: {
          completed: true,
          course: {
            select: {
              cohort: {
                select: {
                  programId: true,
                },
              },
            },
          },
          progress: {
            select: {
              topicId: true,
              status: true,
              completed: true,
            },
          },
        },
      }),
    ]);

    const topicCountsByProgramId = new Map(
      programs.map((program) => [program.id, program.topics.length]),
    );
    const completedProgramIds = new Set<number>();

    for (const enrollment of enrollments) {
      const programId = enrollment.course.cohort.programId;
      const topicCount = topicCountsByProgramId.get(programId) ?? 0;
      const passedTopicIds = new Set(
        enrollment.progress
          .filter((progress) => progress.status === "PASS" || progress.completed)
          .map((progress) => progress.topicId),
      );

      if (Boolean(enrollment.completed) || passedTopicIds.size >= topicCount) {
        completedProgramIds.add(programId);
      }
    }

    return requiredPrograms.filter(
      (program) => !completedProgramIds.has(program.id),
    );
  }

  async assertEligible(
    roleKey: RoleEligibilityKey,
    userId?: number | null,
  ): Promise<void> {
    const missingPrograms = await this.getMissingProgramsForUser(roleKey, userId);

    if (missingPrograms.length > 0) {
      throw new RoleEligibilityValidationError(roleKey, missingPrograms);
    }
  }
}

export const roleEligibilityService = new RoleEligibilityService();
