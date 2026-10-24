import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";
import { getBranchScopedWhere } from "../branches/branchService";
import { departmentRosters } from "../departmentReports/departmentRoster";
import { REPORT_KEYS, ReportKey } from "../departmentReports/types";

/**
 * Settings › General configuration › Reports: which department answers for
 * each church-wide department report, and the department attendance reports.
 * Contract: Frontend/docs/WORKSPACES_AND_REPORT_CONFIG_BACKEND_CONTRACT.md §2
 */

const REPORT_CONFIG_ID = 1;
export const DEPT_ATTENDANCE_DUE_DAYS = [1, 3, 5, 7, 10, 14] as const;
export const DEFAULT_DEPT_ATTENDANCE_DUE_DAY = 5;

export type ReportOwners = Record<ReportKey, number | null>;

export interface ReportConfig {
  owners: ReportOwners;
  dept_attendance: { due_day: number; disabled_department_ids: number[] };
}

export interface ReportConfigDepartment {
  id: number;
  name: string;
  branch_id: number | null;
  branch_name: string | null;
  head: { id: number; name: string } | null;
  members: number;
}

export interface ReportConfigResponse extends ReportConfig {
  departments: ReportConfigDepartment[];
}

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const emptyOwners = (): ReportOwners =>
  Object.fromEntries(REPORT_KEYS.map((key) => [key, null])) as ReportOwners;

const readOwners = (value: unknown): ReportOwners => {
  const owners = emptyOwners();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of REPORT_KEYS) {
      owners[key] = toPositiveInt((value as Record<string, unknown>)[key]);
    }
  }
  return owners;
};

const readIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(toPositiveInt).filter((id): id is number => Boolean(id))))
    : [];

const readDueDay = (value: unknown) =>
  (DEPT_ATTENDANCE_DUE_DAYS as readonly number[]).includes(Number(value))
    ? Number(value)
    : DEFAULT_DEPT_ATTENDANCE_DUE_DAY;

/** The saved configuration, with defaults when nothing has been saved. */
export const loadReportConfig = async (): Promise<ReportConfig> => {
  const row = await prisma.report_config.findUnique({ where: { id: REPORT_CONFIG_ID } });
  return {
    owners: readOwners(row?.owners),
    dept_attendance: {
      due_day: readDueDay(row?.dept_attendance_due_day),
      disabled_department_ids: readIds(row?.dept_attendance_disabled_department_ids),
    },
  };
};

const listDepartments = async (branchId: unknown): Promise<ReportConfigDepartment[]> => {
  const departments = await prisma.department.findMany({
    where: getBranchScopedWhere(branchId) || {},
    select: {
      id: true,
      name: true,
      branch_id: true,
      branch: { select: { name: true } },
      department_head_info: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  const rosters = await departmentRosters(departments.map((d) => d.id));
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    branch_id: d.branch_id ?? null,
    branch_name: d.branch?.name ?? null,
    head: d.department_head_info ? { id: d.department_head_info.id, name: d.department_head_info.name } : null,
    members: rosters.get(d.id)?.size ?? 0,
  }));
};

/** Department ids that don't exist or sit outside the caller's branches. */
const unknownDepartmentIds = async (ids: number[]) => {
  if (!ids.length) return [];
  const scope = getBranchScope();
  const found = await prisma.department.findMany({
    where: { id: { in: ids } },
    select: { id: true, branch_id: true },
  });
  const ok = new Set(
    found.filter((d) => d.branch_id == null || isBranchAllowed(scope, d.branch_id)).map((d) => d.id),
  );
  return ids.filter((id) => !ok.has(id));
};

export class ReportConfigService {
  async getConfig(branchId?: unknown): Promise<ReportConfigResponse> {
    const [config, departments] = await Promise.all([loadReportConfig(), listDepartments(branchId)]);
    return { ...config, departments };
  }

  async upsertConfig(payload: unknown, updatedByUserId: number, branchId?: unknown): Promise<ReportConfigResponse> {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const current = await loadReportConfig();
    const owners = { ...current.owners };
    let dueDay = current.dept_attendance.due_day;
    let disabledIds = current.dept_attendance.disabled_department_ids;
    const referenced: number[] = [];

    if (record.owners !== undefined) {
      if (!record.owners || typeof record.owners !== "object" || Array.isArray(record.owners)) {
        throw new InputValidationError("owners must be an object of report key to department id");
      }
      for (const [key, raw] of Object.entries(record.owners as Record<string, unknown>)) {
        if (!(REPORT_KEYS as string[]).includes(key)) {
          throw new InputValidationError(`Unknown report: ${key}`);
        }
        if (raw === null || raw === "") {
          owners[key as ReportKey] = null;
          continue;
        }
        const id = toPositiveInt(raw);
        if (!id) throw new InputValidationError(`owners.${key} must be a department id or null`);
        // Only newly chosen ids are checked, so a branch admin can save the
        // form back even when another branch's department owns a report.
        if (current.owners[key as ReportKey] !== id) referenced.push(id);
        owners[key as ReportKey] = id;
      }
    }

    if (record.dept_attendance !== undefined) {
      const att = record.dept_attendance;
      if (!att || typeof att !== "object" || Array.isArray(att)) {
        throw new InputValidationError("dept_attendance must be an object");
      }
      const { due_day, disabled_department_ids } = att as Record<string, unknown>;
      if (due_day !== undefined) {
        if (!(DEPT_ATTENDANCE_DUE_DAYS as readonly number[]).includes(Number(due_day))) {
          throw new InputValidationError(`due_day must be one of ${DEPT_ATTENDANCE_DUE_DAYS.join(", ")}`);
        }
        dueDay = Number(due_day);
      }
      if (disabled_department_ids !== undefined) {
        if (!Array.isArray(disabled_department_ids)) {
          throw new InputValidationError("disabled_department_ids must be an array of department ids");
        }
        const ids = disabled_department_ids.map(toPositiveInt);
        if (ids.some((id) => !id)) {
          throw new InputValidationError("disabled_department_ids must be an array of department ids");
        }
        const previous = new Set(disabledIds);
        disabledIds = Array.from(new Set(ids as number[]));
        referenced.push(...disabledIds.filter((id) => !previous.has(id)));
      }
    }

    const unknown = await unknownDepartmentIds(Array.from(new Set(referenced)));
    if (unknown.length) {
      throw new InputValidationError(`Unknown department ids: ${unknown.join(", ")}`);
    }

    const data = {
      owners,
      dept_attendance_due_day: dueDay,
      dept_attendance_disabled_department_ids: disabledIds,
      updated_by_user_id: updatedByUserId,
    };
    await prisma.report_config.upsert({
      where: { id: REPORT_CONFIG_ID },
      update: data,
      create: { id: REPORT_CONFIG_ID, ...data },
    });

    return this.getConfig(branchId);
  }
}

export const reportConfigService = new ReportConfigService();
