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

type EligibilityProgram = {
  id: number;
  title: string;
};

type RoleEligibilityRuleRow = {
  role_key: string;
  program: EligibilityProgram;
};

type PositionEligibilityRuleRow = {
  position_id: number;
  program: EligibilityProgram;
  position: {
    id: number;
    name: string;
  };
};

export type RoleEligibilityConfigRule = {
  role_key: RoleEligibilityKey;
  required_program_ids: number[];
  required_programs: EligibilityProgram[];
};

export type PositionEligibilityConfigRule = {
  position_id: number;
  position: {
    id: number;
    name: string;
  };
  required_program_ids: number[];
  required_programs: EligibilityProgram[];
};

export class RoleEligibilityValidationError extends AppError {
  roleKey: RoleEligibilityKey;
  missingPrograms: EligibilityProgram[];

  constructor(roleKey: RoleEligibilityKey, missingPrograms: EligibilityProgram[]) {
    super("Member is not eligible for this role", StatusCodes.UNPROCESSABLE_ENTITY);
    this.roleKey = roleKey;
    this.missingPrograms = missingPrograms;
  }
}

export class PositionEligibilityValidationError extends AppError {
  positionId: number;
  missingPrograms: EligibilityProgram[];

  constructor(positionId: number, missingPrograms: EligibilityProgram[]) {
    super(
      "Member is not eligible for this position",
      StatusCodes.UNPROCESSABLE_ENTITY,
    );
    this.positionId = positionId;
    this.missingPrograms = missingPrograms;
  }
}

export const isRoleEligibilityValidationError = (
  error: unknown,
): error is RoleEligibilityValidationError =>
  error instanceof RoleEligibilityValidationError;

export const isPositionEligibilityValidationError = (
  error: unknown,
): error is PositionEligibilityValidationError =>
  error instanceof PositionEligibilityValidationError;

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

export const buildPositionEligibilityFailureResponse = (
  error: PositionEligibilityValidationError,
) => ({
  success: false,
  message: error.message,
  data: {
    position_id: error.positionId,
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
    contextLabel: string,
  ) {
    if (!Array.isArray(requiredProgramIds)) {
      throw new InputValidationError(
        `required_program_ids must be an array for ${contextLabel}`,
      );
    }

    const parsedProgramIds = requiredProgramIds.map((programId) => Number(programId));
    const hasInvalidProgramIds = parsedProgramIds.some(
      (programId) => !Number.isInteger(programId) || programId <= 0,
    );

    if (hasInvalidProgramIds) {
      throw new InputValidationError(
        `required_program_ids must contain only positive integers for ${contextLabel}`,
      );
    }

    return Array.from(new Set(parsedProgramIds));
  }

  private parsePositionId(positionId: unknown, contextLabel: string) {
    const parsedPositionId = Number(positionId);

    if (!Number.isInteger(parsedPositionId) || parsedPositionId <= 0) {
      throw new InputValidationError(
        `position_id must be a positive integer for ${contextLabel}`,
      );
    }

    return parsedPositionId;
  }

  private mapRoleRules(rows: RoleEligibilityRuleRow[]): RoleEligibilityConfigRule[] {
    const groupedRules = new Map<RoleEligibilityKey, RoleEligibilityConfigRule>();

    for (const row of rows) {
      const roleKey = this.normalizeRoleKey(row.role_key);
      const existingRule = groupedRules.get(roleKey);

      if (!existingRule) {
        groupedRules.set(roleKey, {
          role_key: roleKey,
          required_program_ids: [row.program.id],
          required_programs: [{ id: row.program.id, title: row.program.title }],
        });
        continue;
      }

      existingRule.required_program_ids.push(row.program.id);
      existingRule.required_programs.push({
        id: row.program.id,
        title: row.program.title,
      });
    }

    return Array.from(groupedRules.values()).sort((left, right) =>
      left.role_key.localeCompare(right.role_key),
    );
  }

  private mapPositionRules(
    rows: PositionEligibilityRuleRow[],
  ): PositionEligibilityConfigRule[] {
    const groupedRules = new Map<number, PositionEligibilityConfigRule>();

    for (const row of rows) {
      const existingRule = groupedRules.get(row.position_id);

      if (!existingRule) {
        groupedRules.set(row.position_id, {
          position_id: row.position.id,
          position: {
            id: row.position.id,
            name: row.position.name,
          },
          required_program_ids: [row.program.id],
          required_programs: [{ id: row.program.id, title: row.program.title }],
        });
        continue;
      }

      existingRule.required_program_ids.push(row.program.id);
      existingRule.required_programs.push({
        id: row.program.id,
        title: row.program.title,
      });
    }

    return Array.from(groupedRules.values()).sort(
      (left, right) => left.position_id - right.position_id,
    );
  }

  private async ensureProgramsExist(programIds: number[]) {
    if (programIds.length === 0) {
      return;
    }

    const existingPrograms = await prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true },
    });

    const existingProgramIds = new Set(existingPrograms.map((program) => program.id));
    const missingProgramIds = programIds.filter(
      (programId) => !existingProgramIds.has(programId),
    );

    if (missingProgramIds.length > 0) {
      throw new NotFoundError(`Programs not found: ${missingProgramIds.join(", ")}`);
    }
  }

  private async ensurePositionsExist(positionIds: number[]) {
    if (positionIds.length === 0) {
      return;
    }

    const existingPositions = await prisma.position.findMany({
      where: { id: { in: positionIds } },
      select: { id: true },
    });

    const existingPositionIds = new Set(
      existingPositions.map((position) => position.id),
    );
    const missingPositionIds = positionIds.filter(
      (positionId) => !existingPositionIds.has(positionId),
    );

    if (missingPositionIds.length > 0) {
      throw new NotFoundError(`Positions not found: ${missingPositionIds.join(", ")}`);
    }
  }

  private async getMissingProgramsFromRequiredPrograms(
    requiredPrograms: EligibilityProgram[],
    userId?: number | null,
  ): Promise<EligibilityProgram[]> {
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

  async getConfig(): Promise<{
    rules: RoleEligibilityConfigRule[];
    position_rules: PositionEligibilityConfigRule[];
  }> {
    const [roleRows, positionRows] = await Promise.all([
      prisma.role_eligibility_rules.findMany({
        include: {
          program: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: [{ role_key: "asc" }, { program_id: "asc" }],
      }) as Promise<RoleEligibilityRuleRow[]>,
      prisma.position_eligibility_rules.findMany({
        include: {
          position: {
            select: {
              id: true,
              name: true,
            },
          },
          program: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: [{ position_id: "asc" }, { program_id: "asc" }],
      }) as Promise<PositionEligibilityRuleRow[]>,
    ]);

    return {
      rules: this.mapRoleRules(roleRows),
      position_rules: this.mapPositionRules(positionRows),
    };
  }

  async upsertConfig(payload: unknown): Promise<{
    rules: RoleEligibilityConfigRule[];
    position_rules: PositionEligibilityConfigRule[];
  }> {
    const rules = (payload as { rules?: unknown })?.rules;
    const positionRules = (payload as { position_rules?: unknown })?.position_rules;

    if (!Array.isArray(rules)) {
      throw new InputValidationError("rules must be an array");
    }

    if (positionRules !== undefined && !Array.isArray(positionRules)) {
      throw new InputValidationError("position_rules must be an array");
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
          `role_key ${roleKey}`,
        ),
      };
    });

    const positionIdsSeen = new Set<number>();
    const normalizedPositionRules = (positionRules ?? []).map((rule, index) => {
      const positionId = this.parsePositionId(
        (rule as { position_id?: unknown })?.position_id,
        `position_rules[${index}]`,
      );

      if (positionIdsSeen.has(positionId)) {
        throw new InputValidationError(
          `Duplicate position_id in payload: ${positionId} at index ${index}`,
        );
      }

      positionIdsSeen.add(positionId);

      return {
        position_id: positionId,
        required_program_ids: this.parseRequiredProgramIds(
          (rule as { required_program_ids?: unknown })?.required_program_ids,
          `position_id ${positionId}`,
        ),
      };
    });

    const allProgramIds = Array.from(
      new Set([
        ...normalizedRules.flatMap((rule) => rule.required_program_ids),
        ...normalizedPositionRules.flatMap((rule) => rule.required_program_ids),
      ]),
    );

    await Promise.all([
      this.ensureProgramsExist(allProgramIds),
      this.ensurePositionsExist(
        normalizedPositionRules.map((rule) => rule.position_id),
      ),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.role_eligibility_rules.deleteMany({});
      await tx.position_eligibility_rules.deleteMany({});

      for (const rule of normalizedRules) {
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

      for (const rule of normalizedPositionRules) {
        if (rule.required_program_ids.length === 0) {
          continue;
        }

        await tx.position_eligibility_rules.createMany({
          data: rule.required_program_ids.map((programId) => ({
            position_id: rule.position_id,
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

  async getRequiredProgramsForPosition(positionId: number) {
    const config = await this.getConfig();
    return (
      config.position_rules.find((rule) => rule.position_id === positionId)
        ?.required_programs ?? []
    );
  }

  async getMissingProgramsForUser(
    roleKey: RoleEligibilityKey,
    userId?: number | null,
  ): Promise<EligibilityProgram[]> {
    const requiredPrograms = await this.getRequiredProgramsForRole(roleKey);
    return this.getMissingProgramsFromRequiredPrograms(requiredPrograms, userId);
  }

  async getMissingProgramsForPosition(
    positionId: number,
    userId?: number | null,
  ): Promise<EligibilityProgram[]> {
    const requiredPrograms = await this.getRequiredProgramsForPosition(positionId);
    return this.getMissingProgramsFromRequiredPrograms(requiredPrograms, userId);
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

  async assertEligibleForPosition(
    positionId: number,
    userId?: number | null,
  ): Promise<void> {
    const missingPrograms = await this.getMissingProgramsForPosition(
      positionId,
      userId,
    );

    if (missingPrograms.length > 0) {
      throw new PositionEligibilityValidationError(positionId, missingPrograms);
    }
  }
}

export const roleEligibilityService = new RoleEligibilityService();
