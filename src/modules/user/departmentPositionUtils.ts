import { InputValidationError } from "../../utils/custom-error-handlers";

// Optional department/position dates: return a valid Date or null.
export const parseOptionalDate = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * `department_positions.position_id` is `Int?`: a department membership with
 * no position is valid. null / undefined / "" / 0 / anything non-numeric maps
 * to null rather than `parseInt` → NaN (which Prisma rejects).
 */
export const normalizeDepartmentPositionId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export type DepartmentPositionInput = {
  department_id: unknown;
  position_id?: unknown;
  start_date?: unknown;
  end_date?: unknown;
};

export type NormalizedDepartmentPosition = {
  department_id: number;
  position_id: number | null;
  start_date: Date | null;
  end_date: Date | null;
};

/**
 * Validate and normalize a `department_positions` payload. Throws
 * InputValidationError for a missing/invalid department_id or a department
 * listed twice (the table is unique on user_id + department_id).
 */
export const normalizeDepartmentPositions = (
  department_positions: DepartmentPositionInput[],
): NormalizedDepartmentPosition[] => {
  const seenDepartmentIds = new Set<number>();

  return department_positions.map((dp) => {
    const departmentId = Number(dp?.department_id);
    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      throw new InputValidationError(
        `Invalid department_id ${String(dp?.department_id)} in department_positions.`,
      );
    }
    if (seenDepartmentIds.has(departmentId)) {
      throw new InputValidationError(
        `Duplicate department assignment: department_id ${departmentId} appears more than once in department_positions.`,
      );
    }
    seenDepartmentIds.add(departmentId);

    return {
      department_id: departmentId,
      position_id: normalizeDepartmentPositionId(dp?.position_id),
      start_date: parseOptionalDate(dp?.start_date),
      end_date: parseOptionalDate(dp?.end_date),
    };
  });
};
