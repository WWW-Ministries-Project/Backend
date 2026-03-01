import { RequestApprovalStatus, appointment_status, payment_status } from "@prisma/client";
import { Dirent, promises as fs } from "fs";
import path from "path";
import { prisma } from "../../Models/context";
import {
  AI_MODULE_QUERY_CONTRACTS,
  AiModuleName,
  AiModuleQueryContract,
  AiReadOnlyOperationName,
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  getModuleContract,
} from "./aiReadOnlyContracts";

const PENDING_REQUISITION_STATUSES = [
  RequestApprovalStatus.Awaiting_HOD_Approval,
  RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
] as const;

const INCOME_KEYWORD_REGEX =
  /\b(income|revenue|tithe|offering|offerings|donation|inflow|credit|sales?)\b/i;
const EXPENSE_KEYWORD_REGEX =
  /\b(expense|expenses|cost|costs|outflow|debit|disbursement|purchase|payable)\b/i;
const AMOUNT_KEYWORD_REGEX = /\b(amount|total|sum|value|balance|net|gross)\b/i;
const METRIC_SKIP_KEY_REGEX = /\b(id|count|index|code|year|month|day|quantity|qty)\b/i;

type QueryExecutionInput = {
  module: string;
  operation: string;
  input?: Record<string, unknown>;
  actorId?: number;
  crossModule?: boolean;
};

type QueryExecutionResult = {
  module: AiModuleName;
  operation: AiReadOnlyOperationName;
  generated_at: string;
  data_source: string;
  applied_filters: Record<string, unknown>;
  result: unknown;
};

type DateRangeFilter = {
  start: Date;
  endExclusive: Date;
  start_iso: string;
  end_iso: string;
};

type FinancialMetricEntry = {
  path: string;
  value: number;
  tag: "income" | "expense" | "amount" | "other";
};

type FinancialMetrics = {
  income_like_total: number;
  expense_like_total: number;
  amount_like_total: number;
  net_income_like: number;
  numeric_values_scanned: number;
  top_amount_fields: FinancialMetricEntry[];
};

export class AiReadOnlyDataServiceError extends Error {
  status_code: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "AiReadOnlyDataServiceError";
    this.status_code = statusCode;
  }
}

export class AiReadOnlyDataService {
  listContracts(moduleName?: string): AiModuleQueryContract[] {
    if (!moduleName) {
      return Object.values(AI_MODULE_QUERY_CONTRACTS);
    }

    const contract = getModuleContract(moduleName);
    if (!contract) {
      throw new AiReadOnlyDataServiceError(`Unknown module: ${moduleName}`, 400);
    }

    return [contract];
  }

  async executeQuery(params: QueryExecutionInput): Promise<QueryExecutionResult> {
    const contract = getModuleContract(params.module);
    if (!contract) {
      throw new AiReadOnlyDataServiceError(
        `Unknown module "${params.module}". Call list contracts first.`,
        400,
      );
    }

    const operation = this.normalizeOperation(params.operation);
    if (!contract.operations.some((entry) => entry.name === operation)) {
      throw new AiReadOnlyDataServiceError(
        `Operation "${operation}" is not allowed for module "${contract.module}"`,
        400,
      );
    }

    const input = this.normalizeInput(params.input);
    const limit = this.parseLimit(input.limit);

    const { dataSource, result, appliedFilters } = await this.dispatchModuleQuery(
      contract.module,
      operation,
      input,
      limit,
      params.actorId,
    );

    return {
      module: contract.module,
      operation,
      generated_at: new Date().toISOString(),
      data_source: dataSource,
      applied_filters: {
        ...appliedFilters,
        cross_module: true,
      },
      result,
    };
  }

  private normalizeOperation(value: string): AiReadOnlyOperationName {
    const operation = String(value || "").trim().toLowerCase();
    if (
      operation !== "summary" &&
      operation !== "recent" &&
      operation !== "search" &&
      operation !== "attendance_lookup"
    ) {
      throw new AiReadOnlyDataServiceError(`Unsupported operation "${value}"`, 400);
    }

    return operation;
  }

  private normalizeInput(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private parseLimit(raw: unknown): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_RECENT_LIMIT;
    }

    return Math.max(1, Math.min(MAX_RECENT_LIMIT, Math.floor(parsed)));
  }

  private parseSearchTerm(input: Record<string, unknown>): string {
    const queryRaw = input.q;
    const query = String(queryRaw || "").trim();
    if (query.length < 2) {
      throw new AiReadOnlyDataServiceError("q must be provided and at least 2 characters", 400);
    }

    return query;
  }

  private parseOptionalDateFilter(raw: unknown): { start: Date; end: Date; iso: string } | null {
    if (!raw) return null;
    const text = String(raw).trim();
    if (!text) return null;

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new AiReadOnlyDataServiceError("date must be a valid date", 400);
    }

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return {
      start,
      end,
      iso: start.toISOString().slice(0, 10),
    };
  }

  private parseOptionalPositiveInt(raw: unknown): number | null {
    if (raw === undefined || raw === null || raw === "") {
      return null;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new AiReadOnlyDataServiceError("Expected a positive integer", 400);
    }

    return parsed;
  }

  private parseDateRange(input: Record<string, unknown>): DateRangeFilter | null {
    const start = this.parseStrictDate(input.start_date, "start_date");
    const end = this.parseStrictDate(input.end_date, "end_date");

    if (!start && !end) {
      return null;
    }

    const effectiveStart = start || end;
    const effectiveEnd = end || start;

    if (!effectiveStart || !effectiveEnd) {
      return null;
    }

    if (effectiveStart.getTime() > effectiveEnd.getTime()) {
      throw new AiReadOnlyDataServiceError("start_date cannot be after end_date", 400);
    }

    const endExclusive = new Date(effectiveEnd);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    return {
      start: effectiveStart,
      endExclusive,
      start_iso: effectiveStart.toISOString().slice(0, 10),
      end_iso: effectiveEnd.toISOString().slice(0, 10),
    };
  }

  private parseStrictDate(raw: unknown, fieldName: string): Date | null {
    if (raw === undefined || raw === null || raw === "") {
      return null;
    }

    const text = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new AiReadOnlyDataServiceError(
        `${fieldName} must be in YYYY-MM-DD format`,
        400,
      );
    }

    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new AiReadOnlyDataServiceError(`${fieldName} must be a valid date`, 400);
    }

    return parsed;
  }

  private appendDateRangeWhere(
    where: Record<string, unknown>,
    fieldName: string,
    dateRange: DateRangeFilter | null,
  ): Record<string, unknown> {
    if (!dateRange) {
      return where;
    }

    const existing =
      where[fieldName] && typeof where[fieldName] === "object" && !Array.isArray(where[fieldName])
        ? (where[fieldName] as Record<string, unknown>)
        : {};

    return {
      ...where,
      [fieldName]: {
        ...existing,
        gte: dateRange.start,
        lt: dateRange.endExclusive,
      },
    };
  }

  private parseJsonSafely(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  private toNumberIfNumeric(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().replace(/,/g, "");
    if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private classifyFinancialMetric(path: string): "income" | "expense" | "amount" | "other" {
    const normalized = path.toLowerCase();
    if (INCOME_KEYWORD_REGEX.test(normalized)) {
      return "income";
    }
    if (EXPENSE_KEYWORD_REGEX.test(normalized)) {
      return "expense";
    }
    if (AMOUNT_KEYWORD_REGEX.test(normalized)) {
      return "amount";
    }
    return "other";
  }

  private isSkippableMetricPath(path: string): boolean {
    const normalized = path.toLowerCase();
    return METRIC_SKIP_KEY_REGEX.test(normalized);
  }

  private deriveFinancialMetrics(payload: unknown): FinancialMetrics {
    const entries: FinancialMetricEntry[] = [];
    let incomeTotal = 0;
    let expenseTotal = 0;
    let amountTotal = 0;
    let scanned = 0;
    let visited = 0;
    const maxVisitedNodes = 4000;

    const walk = (value: unknown, pathSegments: string[]): void => {
      if (visited >= maxVisitedNodes) {
        return;
      }
      visited += 1;

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length && index < 200; index += 1) {
          walk(value[index], [...pathSegments, String(index)]);
        }
        return;
      }

      if (value && typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        const keys = Object.keys(objectValue).slice(0, 200);
        for (const key of keys) {
          walk(objectValue[key], [...pathSegments, key]);
        }
        return;
      }

      const numericValue = this.toNumberIfNumeric(value);
      if (numericValue === null) {
        return;
      }

      scanned += 1;
      const path = pathSegments.join(".");
      if (!path || this.isSkippableMetricPath(path)) {
        return;
      }

      const tag = this.classifyFinancialMetric(path);
      if (tag === "income") {
        incomeTotal += numericValue;
      }
      if (tag === "expense") {
        expenseTotal += numericValue;
      }
      if (tag === "income" || tag === "expense" || tag === "amount") {
        amountTotal += numericValue;
        entries.push({
          path,
          value: numericValue,
          tag,
        });
      }
    };

    walk(payload, []);

    const topAmountFields = [...entries]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 12);

    return {
      income_like_total: incomeTotal,
      expense_like_total: expenseTotal,
      amount_like_total: amountTotal,
      net_income_like: incomeTotal - expenseTotal,
      numeric_values_scanned: scanned,
      top_amount_fields: topAmountFields,
    };
  }

  private async dispatchModuleQuery(
    moduleName: AiModuleName,
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
    actorId?: number,
  ): Promise<{
    dataSource: string;
    appliedFilters: Record<string, unknown>;
    result: unknown;
  }> {
    switch (moduleName) {
      case "user":
        return this.queryUser(operation, input, limit);
      case "department":
        return this.queryDepartment(operation, input, limit);
      case "position":
        return this.queryPosition(operation, input, limit);
      case "access":
        return this.queryAccess(operation, input, limit);
      case "upload":
        return this.queryUploads(operation, input, limit);
      case "assets":
        return this.queryAssets(operation, input, limit);
      case "event":
        return this.queryEvents(operation, input, limit);
      case "requisitions":
        return this.queryRequisitions(operation, input, limit);
      case "program":
        return this.queryPrograms(operation, input, limit);
      case "visitor":
        return this.queryVisitors(operation, input, limit);
      case "lifecenter":
        return this.queryLifeCenters(operation, input, limit);
      case "device":
        return this.queryDevices(operation, input, limit);
      case "market":
        return this.queryMarkets(operation, input, limit);
      case "product":
        return this.queryProducts(operation, input, limit);
      case "orders":
        return this.queryOrders(operation, input, limit);
      case "theme":
        return this.queryThemes(operation, input, limit);
      case "appointment":
        return this.queryAppointments(operation, input, limit);
      case "receiptconfig":
        return this.queryReceiptConfigs(operation, input, limit);
      case "paymentconfig":
        return this.queryPaymentConfigs(operation, input, limit);
      case "bankaccountconfig":
        return this.queryBankAccountConfigs(operation, input, limit);
      case "tithebreakdownconfig":
        return this.queryTitheBreakdownConfigs(operation, input, limit);
      case "financials":
        return this.queryFinancials(operation, input, limit);
      case "ai":
        return this.queryAiModule(operation, input, limit, actorId);
      default:
        throw new AiReadOnlyDataServiceError(`Module ${moduleName} not implemented`, 500);
    }
  }

  private async queryUser(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalUsers, activeUsers, onlineMembers, inhouseMembers] = await Promise.all([
        prisma.user.count({ where: dateWhere }),
        prisma.user.count({ where: { ...dateWhere, is_active: true } }),
        prisma.user.count({ where: { ...dateWhere, membership_type: "ONLINE" } }),
        prisma.user.count({ where: { ...dateWhere, membership_type: "IN_HOUSE" } }),
      ]);

      return {
        dataSource: "prisma.user",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_users: totalUsers,
          active_users: activeUsers,
          inactive_or_unknown_users: Math.max(totalUsers - activeUsers, 0),
          online_members: onlineMembers,
          inhouse_members: inhouseMembers,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.user.findMany({
        where: dateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          member_id: true,
          membership_type: true,
          is_active: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.user",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.user.findMany({
        where: this.appendDateRangeWhere(
          {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { member_id: { contains: q } },
          ],
          },
          "created_at",
          dateRange,
        ),
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          member_id: true,
          membership_type: true,
          is_active: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.user",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported user operation: ${operation}`, 400);
  }

  private async queryDepartment(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalDepartments, assignedHeads] = await Promise.all([
        prisma.department.count({ where: dateWhere }),
        prisma.department.count({ where: { ...dateWhere, department_head: { not: null } } }),
      ]);

      return {
        dataSource: "prisma.department",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_departments: totalDepartments,
          departments_with_head: assignedHeads,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.department.findMany({
        where: dateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          department_head: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.department",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported department operation: ${operation}`, 400);
  }

  private async queryPosition(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalPositions, linkedToDepartment] = await Promise.all([
        prisma.position.count({ where: dateWhere }),
        prisma.position.count({ where: { ...dateWhere, department_id: { not: null } } }),
      ]);

      return {
        dataSource: "prisma.position",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_positions: totalPositions,
          positions_linked_to_department: linkedToDepartment,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.position.findMany({
        where: dateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          department_id: true,
          description: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.position",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported position operation: ${operation}`, 400);
  }

  private async queryAccess(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalLevels, activeLevels] = await Promise.all([
        prisma.access_level.count({ where: dateWhere }),
        prisma.access_level.count({ where: { ...dateWhere, deleted: false } }),
      ]);

      return {
        dataSource: "prisma.access_level",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_access_levels: totalLevels,
          active_access_levels: activeLevels,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.access_level.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        where: { ...dateWhere, deleted: false },
        select: {
          id: true,
          name: true,
          description: true,
          created_at: true,
          updated_at: true,
        },
      });

      return {
        dataSource: "prisma.access_level",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported access operation: ${operation}`, 400);
  }

  private async queryUploads(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    const files = await this.readUploads(uploadsDir, 400);
    const rangedFiles = dateRange
      ? files.filter((file) => {
          const modifiedAt = new Date(file.modified_at).getTime();
          return (
            modifiedAt >= dateRange.start.getTime() &&
            modifiedAt < dateRange.endExclusive.getTime()
          );
        })
      : files;

    if (operation === "summary") {
      const totalBytes = rangedFiles.reduce((sum, file) => sum + file.size, 0);
      return {
        dataSource: `filesystem:${uploadsDir}`,
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          uploads_directory: uploadsDir,
          total_files: rangedFiles.length,
          total_bytes: totalBytes,
        },
      };
    }

    if (operation === "recent") {
      const sorted = [...rangedFiles]
        .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
        .slice(0, limit);

      return {
        dataSource: `filesystem:${uploadsDir}`,
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: sorted,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported upload operation: ${operation}`, 400);
  }

  private async readUploads(baseDir: string, maxFiles: number) {
    const out: Array<{ path: string; size: number; modified_at: string }> = [];

    const walk = async (dir: string): Promise<void> => {
      if (out.length >= maxFiles) return;

      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        return;
      }

      for (const entry of entries) {
        if (out.length >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);
          out.push({
            path: path.relative(baseDir, fullPath),
            size: Number(stats.size || 0),
            modified_at: stats.mtime.toISOString(),
          });
        } catch (error) {
          // Ignore files that cannot be read.
        }
      }
    };

    await walk(baseDir);
    return out;
  }

  private async queryAssets(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalAssets, aggregate, groupedStatus] = await Promise.all([
        prisma.assets.count({ where: dateWhere }),
        prisma.assets.aggregate({ where: dateWhere, _sum: { price: true } }),
        prisma.assets.groupBy({ by: ["status"], where: dateWhere, _count: { _all: true } }),
      ]);

      return {
        dataSource: "prisma.assets",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_assets: totalAssets,
          total_estimated_value: Number(aggregate._sum.price || 0),
          status_breakdown: groupedStatus.map((row) => ({
            status: row.status || "UNKNOWN",
            count: row._count._all,
          })),
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.assets.findMany({
        where: dateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          supplier: true,
          price: true,
          date_purchased: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.assets",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.assets.findMany({
        where: this.appendDateRangeWhere(
          {
            OR: [{ name: { contains: q } }, { supplier: { contains: q } }],
          },
          "created_at",
          dateRange,
        ),
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          supplier: true,
          price: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.assets",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported assets operation: ${operation}`, 400);
  }

  private async queryEvents(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const eventDateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const now = new Date();
      const [totalEvents, upcomingEvents, attendanceRows] = await Promise.all([
        prisma.event_mgt.count({ where: eventDateWhere }),
        prisma.event_mgt.count({
          where: {
            ...eventDateWhere,
            OR: [{ start_date: { gte: now } }, { end_date: { gte: now } }],
          },
        }),
        prisma.event_attendance_summary.count({
          where: this.appendDateRangeWhere({}, "date", dateRange),
        }),
      ]);

      return {
        dataSource: "prisma.event_mgt + event_attendance_summary",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_events: totalEvents,
          upcoming_events: upcomingEvents,
          attendance_summary_records: attendanceRows,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.event_mgt.findMany({
        where: eventDateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          start_date: true,
          end_date: true,
          event_status: true,
          event_type: true,
          created_at: true,
          event: {
            select: {
              event_name: true,
            },
          },
        },
      });

      return {
        dataSource: "prisma.event_mgt + event_act",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows.map((row) => ({
          id: row.id,
          event_name: row.event.event_name,
          start_date: row.start_date,
          end_date: row.end_date,
          event_status: row.event_status,
          event_type: row.event_type,
          created_at: row.created_at,
        })),
      };
    }

    if (operation === "attendance_lookup") {
      const eventId = this.parseOptionalPositiveInt(input.event_id);
      const eventName = String(input.event_name || "").trim();
      const dateFilter = this.parseOptionalDateFilter(input.date);
      const dateRangeForAttendance = dateFilter ? null : dateRange;

      const where: any = {};
      if (eventId) {
        where.event_mgt_id = eventId;
      }
      if (eventName) {
        where.event = {
          event: {
            event_name: {
              contains: eventName,
            },
          },
        };
      }
      if (dateFilter) {
        where.date = {
          gte: dateFilter.start,
          lt: dateFilter.end,
        };
      } else if (dateRangeForAttendance) {
        where.date = {
          gte: dateRangeForAttendance.start,
          lt: dateRangeForAttendance.endExclusive,
        };
      }

      const rows = await prisma.event_attendance_summary.findMany({
        where,
        include: {
          event: {
            select: {
              id: true,
              event: {
                select: {
                  event_name: true,
                },
              },
            },
          },
        },
        orderBy: [{ date: "desc" }, { event_mgt_id: "asc" }],
        take: limit,
      });

      const mapped = rows.map((row) => {
        const maleTotal = Number(row.adultMale) + Number(row.youthMale) + Number(row.childrenMale);
        const femaleTotal =
          Number(row.adultFemale) + Number(row.youthFemale) + Number(row.childrenFemale);
        const attendanceTotal = maleTotal + femaleTotal;
        const visitors = Number(row.visitors || 0);

        return {
          attendance_summary_id: row.id,
          event_id: row.event_mgt_id,
          event_name: row.event.event.event_name,
          date: row.date.toISOString().slice(0, 10),
          group: row.group,
          male_total: maleTotal,
          female_total: femaleTotal,
          attendance_total: attendanceTotal,
          visitors,
          attendance_plus_visitors: attendanceTotal + visitors,
        };
      });

      const totals = mapped.reduce(
        (acc, row) => {
          acc.attendance_total += row.attendance_total;
          acc.visitors += row.visitors;
          acc.attendance_plus_visitors += row.attendance_plus_visitors;
          return acc;
        },
        {
          attendance_total: 0,
          visitors: 0,
          attendance_plus_visitors: 0,
        },
      );

      return {
        dataSource: "prisma.event_attendance_summary + event_mgt + event_act",
        appliedFilters: {
          event_id: eventId,
          event_name: eventName || null,
          date: dateFilter?.iso || null,
          start_date: dateRangeForAttendance?.start_iso || null,
          end_date: dateRangeForAttendance?.end_iso || null,
          limit,
        },
        result: {
          matched_records: mapped.length,
          totals,
          records: mapped,
        },
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported event operation: ${operation}`, 400);
  }

  private async queryRequisitions(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "requisition_date", dateRange);

    if (operation === "summary") {
      const [totalRequests, pendingRequests, approvedRequests] = await Promise.all([
        prisma.request.count({ where: dateWhere }),
        prisma.request.count({
          where: {
            ...dateWhere,
            request_approval_status: {
              in: [...PENDING_REQUISITION_STATUSES],
            },
          },
        }),
        prisma.request.count({
          where: {
            ...dateWhere,
            request_approval_status: RequestApprovalStatus.APPROVED,
          },
        }),
      ]);

      return {
        dataSource: "prisma.request",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_requisitions: totalRequests,
          pending_requisitions: pendingRequests,
          approved_requisitions: approvedRequests,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.request.findMany({
        where: dateWhere,
        orderBy: { requisition_date: "desc" },
        take: limit,
        select: {
          id: true,
          request_id: true,
          request_approval_status: true,
          requisition_date: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          department: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        dataSource: "prisma.request + user + department",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.request.findMany({
        where: this.appendDateRangeWhere(
          {
            OR: [
              {
                request_id: {
                  contains: q,
                },
              },
              {
                user: {
                  name: {
                    contains: q,
                  },
                },
              },
            ],
          },
          "requisition_date",
          dateRange,
        ),
        orderBy: { requisition_date: "desc" },
        take: limit,
        select: {
          id: true,
          request_id: true,
          request_approval_status: true,
          requisition_date: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          department: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        dataSource: "prisma.request + user + department",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported requisitions operation: ${operation}`, 400);
  }

  private async queryPrograms(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const programCreatedWhere = this.appendDateRangeWhere({}, "createdAt", dateRange);
    const programUpdatedWhere = this.appendDateRangeWhere({}, "updatedAt", dateRange);

    if (operation === "summary") {
      const [programs, cohorts, courses, enrollments, activePrograms] = await Promise.all([
        prisma.program.count({ where: programCreatedWhere }),
        prisma.cohort.count({ where: this.appendDateRangeWhere({}, "createdAt", dateRange) }),
        prisma.course.count({ where: this.appendDateRangeWhere({}, "createdAt", dateRange) }),
        prisma.enrollment.count({
          where: this.appendDateRangeWhere({}, "enrolledAt", dateRange),
        }),
        prisma.program.count({ where: { ...programCreatedWhere, completed: false } }),
      ]);

      return {
        dataSource: "prisma.program + cohort + course + enrollment",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_programs: programs,
          active_programs: activePrograms,
          total_cohorts: cohorts,
          total_courses: courses,
          total_enrollments: enrollments,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.program.findMany({
        where: programUpdatedWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          completed: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.program",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.program.findMany({
        where: this.appendDateRangeWhere(
          {
            title: {
              contains: q,
            },
          },
          "updatedAt",
          dateRange,
        ),
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          completed: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.program",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported program operation: ${operation}`, 400);
  }

  private async queryVisitors(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const visitorDateWhere = this.appendDateRangeWhere({}, "createdAt", dateRange);

    if (operation === "summary") {
      const [visitors, convertedVisitors, visits, followupsPending, prayerRequestsActive] =
        await Promise.all([
          prisma.visitor.count({ where: visitorDateWhere }),
          prisma.visitor.count({ where: { ...visitorDateWhere, is_member: true } }),
          prisma.visit.count({ where: this.appendDateRangeWhere({}, "date", dateRange) }),
          prisma.follow_up.count({
            where: {
              ...this.appendDateRangeWhere({}, "date", dateRange),
              status: "pending",
            },
          }),
          prisma.prayer_request.count({
            where: {
              ...this.appendDateRangeWhere({}, "date", dateRange),
              status: "active",
            },
          }),
        ]);

      return {
        dataSource: "prisma.visitor + visit + follow_up + prayer_request",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_visitors: visitors,
          converted_to_member: convertedVisitors,
          total_visits: visits,
          pending_followups: followupsPending,
          active_prayer_requests: prayerRequestsActive,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.visitor.findMany({
        where: visitorDateWhere,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          visitDate: true,
          is_member: true,
          createdAt: true,
        },
      });

      return {
        dataSource: "prisma.visitor",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.visitor.findMany({
        where: this.appendDateRangeWhere(
          {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          },
          "createdAt",
          dateRange,
        ),
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          visitDate: true,
          is_member: true,
          createdAt: true,
        },
      });

      return {
        dataSource: "prisma.visitor",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported visitor operation: ${operation}`, 400);
  }

  private async queryLifeCenters(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const requestedDateRange = dateRange
      ? `${dateRange.start_iso} to ${dateRange.end_iso}`
      : null;
    const unsupportedDateRangeNote = dateRange
      ? "Date filters are not supported for life center tables (no timestamp columns available)."
      : null;

    if (operation === "summary") {
      const [centers, members, roles] = await Promise.all([
        prisma.life_center.count(),
        prisma.life_center_member.count(),
        prisma.life_center_role.count(),
      ]);

      return {
        dataSource: "prisma.life_center + life_center_member + life_center_role",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
          note: unsupportedDateRangeNote,
        },
        result: {
          data_limitation: unsupportedDateRangeNote,
          requested_date_range: requestedDateRange,
          total_life_centers: centers,
          total_life_center_memberships: members,
          total_life_center_roles: roles,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.life_center.findMany({
        orderBy: { id: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          meetingLocation: true,
          meetingDays: true,
        },
      });

      return {
        dataSource: "prisma.life_center",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
          note: unsupportedDateRangeNote,
        },
        result: {
          data_limitation: unsupportedDateRangeNote,
          requested_date_range: requestedDateRange,
          records: rows,
        },
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported lifecenter operation: ${operation}`, 400);
  }

  private async queryDevices(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const requestedDateRange = dateRange
      ? `${dateRange.start_iso} to ${dateRange.end_iso}`
      : null;
    const unsupportedDateRangeNote = dateRange
      ? "Date filters are not supported for device tables (no timestamp columns available)."
      : null;

    if (operation === "summary") {
      const totalDevices = await prisma.devices.count();
      return {
        dataSource: "prisma.devices",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
          note: unsupportedDateRangeNote,
        },
        result: {
          data_limitation: unsupportedDateRangeNote,
          requested_date_range: requestedDateRange,
          total_devices: totalDevices,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.devices.findMany({
        orderBy: { id: "desc" },
        take: limit,
        select: {
          id: true,
          device_name: true,
          ip_address: true,
          port: true,
          location: true,
        },
      });

      return {
        dataSource: "prisma.devices",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
          note: unsupportedDateRangeNote,
        },
        result: {
          data_limitation: unsupportedDateRangeNote,
          requested_date_range: requestedDateRange,
          records: rows,
        },
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported device operation: ${operation}`, 400);
  }

  private async queryMarkets(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const now = new Date();
      const [totalMarkets, activeMarkets] = await Promise.all([
        prisma.markets.count({ where: { ...dateWhere, deleted: false } }),
        prisma.markets.count({
          where: {
            ...dateWhere,
            deleted: false,
            OR: [
              {
                AND: [{ start_date: { lte: now } }, { end_date: { gte: now } }],
              },
              {
                AND: [{ start_date: { lte: now } }, { end_date: null }],
              },
            ],
          },
        }),
      ]);

      return {
        dataSource: "prisma.markets",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_markets: totalMarkets,
          active_markets_now: activeMarkets,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.markets.findMany({
        where: { ...dateWhere, deleted: false },
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          start_date: true,
          end_date: true,
          created_at: true,
          event_mgt_id: true,
        },
      });

      return {
        dataSource: "prisma.markets",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.markets.findMany({
        where: this.appendDateRangeWhere(
          {
            deleted: false,
            name: {
              contains: q,
            },
          },
          "created_at",
          dateRange,
        ),
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          start_date: true,
          end_date: true,
          created_at: true,
          event_mgt_id: true,
        },
      });

      return {
        dataSource: "prisma.markets",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported market operation: ${operation}`, 400);
  }

  private async queryProducts(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalProducts, draftProducts] = await Promise.all([
        prisma.products.count({ where: { ...dateWhere, deleted: false } }),
        prisma.products.count({ where: { ...dateWhere, deleted: false, status: "draft" } }),
      ]);

      return {
        dataSource: "prisma.products",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_products: totalProducts,
          draft_products: draftProducts,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.products.findMany({
        where: { ...dateWhere, deleted: false },
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          market_id: true,
          price_amount: true,
          created_at: true,
          updated_at: true,
        },
      });

      return {
        dataSource: "prisma.products",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.products.findMany({
        where: this.appendDateRangeWhere(
          {
            deleted: false,
            name: {
              contains: q,
            },
          },
          "created_at",
          dateRange,
        ),
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          market_id: true,
          price_amount: true,
          created_at: true,
          updated_at: true,
        },
      });

      return {
        dataSource: "prisma.products",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported product operation: ${operation}`, 400);
  }

  private async queryOrders(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [totalOrders, aggregate, pendingPayments] = await Promise.all([
        prisma.orders.count({ where: dateWhere }),
        prisma.orders.aggregate({ where: dateWhere, _sum: { total_amount: true } }),
        prisma.orders.count({
          where: { ...dateWhere, payment_status: payment_status.pending },
        }),
      ]);

      return {
        dataSource: "prisma.orders",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_orders: totalOrders,
          total_order_amount: Number(aggregate._sum.total_amount || 0),
          pending_payment_orders: pendingPayments,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.orders.findMany({
        where: dateWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          order_number: true,
          reference: true,
          payment_status: true,
          delivery_status: true,
          total_amount: true,
          user_id: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.orders",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.orders.findMany({
        where: this.appendDateRangeWhere(
          {
            OR: [{ order_number: { contains: q } }, { reference: { contains: q } }],
          },
          "created_at",
          dateRange,
        ),
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          order_number: true,
          reference: true,
          payment_status: true,
          delivery_status: true,
          total_amount: true,
          user_id: true,
          created_at: true,
        },
      });

      return {
        dataSource: "prisma.orders",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported orders operation: ${operation}`, 400);
  }

  private async queryThemes(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "createdAt", dateRange);

    if (operation === "summary") {
      const [totalThemes, activeThemes] = await Promise.all([
        prisma.annualTheme.count({ where: dateWhere }),
        prisma.annualTheme.count({ where: { ...dateWhere, isActive: true } }),
      ]);

      return {
        dataSource: "prisma.AnnualTheme",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_themes: totalThemes,
          active_themes: activeThemes,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.annualTheme.findMany({
        where: dateWhere,
        orderBy: { year: "desc" },
        take: limit,
        select: {
          id: true,
          year: true,
          title: true,
          verseReference: true,
          isActive: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.AnnualTheme",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported theme operation: ${operation}`, 400);
  }

  private async queryAppointments(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "date", dateRange);

    if (operation === "summary") {
      const [total, pending, confirmed, cancelled] = await Promise.all([
        prisma.appointment.count({ where: dateWhere }),
        prisma.appointment.count({
          where: { ...dateWhere, status: appointment_status.PENDING },
        }),
        prisma.appointment.count({
          where: { ...dateWhere, status: appointment_status.CONFIRMED },
        }),
        prisma.appointment.count({
          where: { ...dateWhere, status: appointment_status.CANCELLED },
        }),
      ]);

      return {
        dataSource: "prisma.appointment",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_appointments: total,
          pending_appointments: pending,
          confirmed_appointments: confirmed,
          cancelled_appointments: cancelled,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.appointment.findMany({
        where: dateWhere,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          date: true,
          startTime: true,
          endTime: true,
          status: true,
          createdAt: true,
          userId: true,
          requesterId: true,
        },
      });

      return {
        dataSource: "prisma.appointment",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    if (operation === "search") {
      const q = this.parseSearchTerm(input);
      const rows = await prisma.appointment.findMany({
        where: this.appendDateRangeWhere(
          {
            OR: [{ fullName: { contains: q } }, { email: { contains: q } }],
          },
          "date",
          dateRange,
        ),
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          date: true,
          startTime: true,
          endTime: true,
          status: true,
          createdAt: true,
          userId: true,
          requesterId: true,
        },
      });

      return {
        dataSource: "prisma.appointment",
        appliedFilters: {
          q,
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported appointment operation: ${operation}`, 400);
  }

  private async queryReceiptConfigs(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "updatedAt", dateRange);

    if (operation === "summary") {
      const total = await prisma.receiptConfig.count({ where: dateWhere });
      return {
        dataSource: "prisma.receiptConfig",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_receipt_configs: total,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.receiptConfig.findMany({
        where: dateWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.receiptConfig",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported receiptconfig operation: ${operation}`, 400);
  }

  private async queryPaymentConfigs(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "updatedAt", dateRange);

    if (operation === "summary") {
      const total = await prisma.paymentConfig.count({ where: dateWhere });
      return {
        dataSource: "prisma.paymentConfig",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_payment_configs: total,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.paymentConfig.findMany({
        where: dateWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.paymentConfig",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported paymentconfig operation: ${operation}`, 400);
  }

  private async queryBankAccountConfigs(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "updatedAt", dateRange);

    if (operation === "summary") {
      const total = await prisma.bankAccountConfig.count({ where: dateWhere });
      return {
        dataSource: "prisma.bankAccountConfig",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_bank_account_configs: total,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.bankAccountConfig.findMany({
        where: dateWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          percentage: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.bankAccountConfig",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(
      `Unsupported bankaccountconfig operation: ${operation}`,
      400,
    );
  }

  private async queryTitheBreakdownConfigs(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "updatedAt", dateRange);

    if (operation === "summary") {
      const total = await prisma.titheBreakdownConfig.count({ where: dateWhere });
      return {
        dataSource: "prisma.titheBreakdownConfig",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_tithe_breakdown_configs: total,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.titheBreakdownConfig.findMany({
        where: dateWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          percentage: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.titheBreakdownConfig",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows,
      };
    }

    throw new AiReadOnlyDataServiceError(
      `Unsupported tithebreakdownconfig operation: ${operation}`,
      400,
    );
  }

  private async queryFinancials(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const dateWhere = this.appendDateRangeWhere({}, "createdAt", dateRange);

    if (operation === "summary") {
      const total = await prisma.financials.count({ where: dateWhere });
      const [latest, scanRows] = await Promise.all([
        prisma.financials.findFirst({
          where: dateWhere,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            periodDate: true,
            updatedAt: true,
            payload: true,
          },
        }),
        prisma.financials.findMany({
          where: dateWhere,
          orderBy: { updatedAt: "desc" },
          take: total > 500 ? 500 : undefined,
          select: {
            payload: true,
          },
        }),
      ]);

      let aggregateIncome = 0;
      let aggregateExpense = 0;
      let aggregateAmounts = 0;
      let aggregateScannedValues = 0;
      const aggregateTopFields: FinancialMetricEntry[] = [];

      for (const row of scanRows) {
        const payload = this.parseJsonSafely(row.payload);
        const metrics = this.deriveFinancialMetrics(payload);
        aggregateIncome += metrics.income_like_total;
        aggregateExpense += metrics.expense_like_total;
        aggregateAmounts += metrics.amount_like_total;
        aggregateScannedValues += metrics.numeric_values_scanned;
        aggregateTopFields.push(...metrics.top_amount_fields);
      }

      const latestPayload = latest ? this.parseJsonSafely(latest.payload) : null;
      const latestMetrics = latestPayload ? this.deriveFinancialMetrics(latestPayload) : null;

      return {
        dataSource: "prisma.financials",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_financial_snapshots: total,
          snapshots_scanned_for_aggregate: scanRows.length,
          aggregate_is_partial: total > scanRows.length,
          aggregated_payload_metrics: {
            income_like_total: aggregateIncome,
            expense_like_total: aggregateExpense,
            amount_like_total: aggregateAmounts,
            net_income_like: aggregateIncome - aggregateExpense,
            numeric_values_scanned: aggregateScannedValues,
            top_amount_fields: aggregateTopFields
              .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
              .slice(0, 12),
          },
          latest_snapshot: latest
            ? {
                id: latest.id,
                periodDate: latest.periodDate,
                updatedAt: latest.updatedAt,
                derived_metrics: latestMetrics,
              }
            : null,
        },
      };
    }

    if (operation === "recent") {
      const rows = await prisma.financials.findMany({
        where: dateWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          periodDate: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        dataSource: "prisma.financials",
        appliedFilters: {
          limit,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows.map((row) => {
          const payload = this.parseJsonSafely(row.payload);
          return {
            id: row.id,
            periodDate: row.periodDate,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            derived_metrics: this.deriveFinancialMetrics(payload),
          };
        }),
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported financials operation: ${operation}`, 400);
  }

  private async queryAiModule(
    operation: AiReadOnlyOperationName,
    input: Record<string, unknown>,
    limit: number,
    actorId?: number,
  ) {
    const dateRange = this.parseDateRange(input);
    const conversationDateWhere = this.appendDateRangeWhere({}, "created_at", dateRange);

    if (operation === "summary") {
      const [conversations, messages, usage] = await Promise.all([
        prisma.ai_conversation.count({ where: conversationDateWhere }),
        prisma.ai_message.count({
          where: this.appendDateRangeWhere({}, "created_at", dateRange),
        }),
        prisma.ai_usage_ledger.aggregate({
          where: this.appendDateRangeWhere({}, "created_at", dateRange),
          _sum: {
            total_tokens: true,
          },
        }),
      ]);

      return {
        dataSource: "prisma.ai_conversation + ai_message + ai_usage_ledger",
        appliedFilters: {
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: {
          total_conversations: conversations,
          total_messages: messages,
          total_tokens_used: Number(usage._sum.total_tokens || 0),
        },
      };
    }

    if (operation === "recent") {
      const scopedWhere =
        Number.isInteger(actorId) && Number(actorId) > 0
          ? { ...conversationDateWhere, created_by: Number(actorId) }
          : conversationDateWhere;

      const rows = await prisma.ai_conversation.findMany({
        where: scopedWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          created_by: true,
          title: true,
          status: true,
          created_at: true,
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      return {
        dataSource: "prisma.ai_conversation",
        appliedFilters: {
          limit,
          scoped_to_actor: Number.isInteger(actorId) && Number(actorId) > 0,
          start_date: dateRange?.start_iso || null,
          end_date: dateRange?.end_iso || null,
        },
        result: rows.map((row) => ({
          id: row.id,
          created_by: row.created_by,
          title: row.title,
          status: row.status,
          created_at: row.created_at,
          message_count: row._count.messages,
        })),
      };
    }

    throw new AiReadOnlyDataServiceError(`Unsupported ai operation: ${operation}`, 400);
  }
}
