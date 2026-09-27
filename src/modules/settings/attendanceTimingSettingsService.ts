import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

const ATTENDANCE_TIMING_SETTINGS_ID = 1;
const ATTENDANCE_TIMING_UNITS = ["MINUTES", "HOURS"] as const;
const DEFAULT_RULE_VALUE = 15;
const APPLY_FROM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type AttendanceTimingUnit = (typeof ATTENDANCE_TIMING_UNITS)[number];

type TimingRuleKey = "early" | "on_time" | "late";

type ConfigRow = {
  id: number;
  early_value: number;
  early_unit: AttendanceTimingUnit;
  on_time_value: number;
  on_time_unit: AttendanceTimingUnit;
  late_value: number;
  late_unit: AttendanceTimingUnit;
  updated_at: Date;
  updated_by: {
    id: number;
    name: string;
  } | null;
};

type RuleVersionRow = {
  early_value: number;
  early_unit: AttendanceTimingUnit;
  on_time_value: number;
  on_time_unit: AttendanceTimingUnit;
  late_value: number;
  late_unit: AttendanceTimingUnit;
  effective_from: Date;
};

type AttendanceTimingDb = Pick<
  Prisma.TransactionClient,
  "attendance_timing_rule_version"
>;

export type AttendanceTimingStatus = "early" | "on_time" | "late";

export type AttendanceTimingRuleMinutes = {
  early: number;
  on_time: number;
  late: number;
};

export type AttendanceTimingResolver = (
  arrivalTime: Date,
) => AttendanceTimingRuleMinutes;

export type AttendanceTimingRuleResponse = {
  value: number;
  unit: AttendanceTimingUnit;
  minutes: number;
};

export type AttendanceTimingSettingsResponse = {
  early: AttendanceTimingRuleResponse;
  on_time: AttendanceTimingRuleResponse;
  late: AttendanceTimingRuleResponse;
  effective_from: string | null;
  updated_at: string | null;
  updated_by: {
    id: number;
    name: string;
  } | null;
};

const DEFAULT_RULE_MINUTES: AttendanceTimingRuleMinutes = {
  early: DEFAULT_RULE_VALUE,
  on_time: DEFAULT_RULE_VALUE,
  late: DEFAULT_RULE_VALUE,
};

const toMinutes = (value: number, unit: AttendanceTimingUnit): number =>
  unit === "HOURS" ? value * 60 : value;

const normalizeRuleUnit = (value: unknown, ruleKey: TimingRuleKey): AttendanceTimingUnit => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  if (!ATTENDANCE_TIMING_UNITS.includes(normalized as AttendanceTimingUnit)) {
    throw new InputValidationError(
      `${ruleKey}.unit must be either MINUTES or HOURS`,
    );
  }

  return normalized as AttendanceTimingUnit;
};

const normalizeRuleValue = (value: unknown, ruleKey: TimingRuleKey): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputValidationError(
      `${ruleKey}.value must be a positive whole number`,
    );
  }

  return parsed;
};

/**
 * Resolves when a saved rule change starts to apply. Without
 * `apply_to_existing` the change only affects attendance recorded after the
 * save; with it, attendance from the first day of `apply_from` (YYYY-MM,
 * UTC) onwards is reclassified too.
 */
const resolveEffectiveFrom = (record: Record<string, unknown>, now: Date): Date => {
  const applyToExisting =
    record.apply_to_existing === true || record.apply_to_existing === "true";

  if (!applyToExisting) {
    return now;
  }

  const match = String(record.apply_from ?? "").trim().match(APPLY_FROM_PATTERN);
  if (!match) {
    throw new InputValidationError(
      "apply_from must be a month in YYYY-MM format when apply_to_existing is true",
    );
  }

  const effectiveFrom = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, 1),
  );
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  if (effectiveFrom.getTime() > currentMonthStart.getTime()) {
    throw new InputValidationError("apply_from cannot be in the future");
  }

  return effectiveFrom;
};

const toRuleMinutes = (row: RuleVersionRow): AttendanceTimingRuleMinutes => ({
  early: toMinutes(row.early_value, row.early_unit),
  on_time: toMinutes(row.on_time_value, row.on_time_unit),
  late: toMinutes(row.late_value, row.late_unit),
});

/**
 * Early and Late take priority where ranges overlap; anything between the two
 * thresholds counts as on time.
 */
export const classifyAttendanceTiming = (
  minutesFromStart: number,
  rules: AttendanceTimingRuleMinutes,
): AttendanceTimingStatus => {
  if (minutesFromStart <= -rules.early) {
    return "early";
  }

  if (minutesFromStart >= rules.late) {
    return "late";
  }

  return "on_time";
};

/**
 * Loads every rule version once and returns a lookup for the rules that apply
 * to a given arrival time: the most recently saved version whose
 * `effective_from` is on or before the arrival.
 */
export const loadAttendanceTimingResolver = async (
  db: AttendanceTimingDb = prisma,
): Promise<AttendanceTimingResolver> => {
  const versions = (await db.attendance_timing_rule_version.findMany({
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: {
      early_value: true,
      early_unit: true,
      on_time_value: true,
      on_time_unit: true,
      late_value: true,
      late_unit: true,
      effective_from: true,
    },
  })) as RuleVersionRow[];

  const resolved = versions.map((version) => ({
    effectiveFrom: version.effective_from.getTime(),
    rules: toRuleMinutes(version),
  }));

  return (arrivalTime: Date) => {
    const arrival = arrivalTime.getTime();
    return (
      resolved.find((version) => version.effectiveFrom <= arrival)?.rules ??
      DEFAULT_RULE_MINUTES
    );
  };
};

const mapRule = (
  value: number,
  unit: AttendanceTimingUnit,
): AttendanceTimingRuleResponse => ({
  value,
  unit,
  minutes: toMinutes(value, unit),
});

const mapConfigRow = (
  row: ConfigRow | null,
  effectiveFrom: Date | null,
): AttendanceTimingSettingsResponse => ({
  early: mapRule(
    row?.early_value ?? DEFAULT_RULE_VALUE,
    row?.early_unit ?? "MINUTES",
  ),
  on_time: mapRule(
    row?.on_time_value ?? DEFAULT_RULE_VALUE,
    row?.on_time_unit ?? "MINUTES",
  ),
  late: mapRule(
    row?.late_value ?? DEFAULT_RULE_VALUE,
    row?.late_unit ?? "MINUTES",
  ),
  effective_from: effectiveFrom ? effectiveFrom.toISOString() : null,
  updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
  updated_by: row?.updated_by ?? null,
});

export class AttendanceTimingSettingsService {
  async getConfig(): Promise<AttendanceTimingSettingsResponse> {
    const [row, latestVersion] = await Promise.all([
      this.getConfigRow(),
      prisma.attendance_timing_rule_version.findFirst({
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { effective_from: true },
      }),
    ]);

    return mapConfigRow(row, latestVersion?.effective_from ?? null);
  }

  private async getConfigRow(): Promise<ConfigRow | null> {
    return (await prisma.attendance_timing_settings.findUnique({
      where: {
        id: ATTENDANCE_TIMING_SETTINGS_ID,
      },
      select: {
        id: true,
        early_value: true,
        early_unit: true,
        on_time_value: true,
        on_time_unit: true,
        late_value: true,
        late_unit: true,
        updated_at: true,
        updated_by: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })) as ConfigRow | null;
  }

  async upsertConfig(
    payload: unknown,
    updatedByUserId: number,
  ): Promise<AttendanceTimingSettingsResponse> {
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};

    const nextConfig = {
      early: {
        value: normalizeRuleValue(
          (record.early as Record<string, unknown> | undefined)?.value,
          "early",
        ),
        unit: normalizeRuleUnit(
          (record.early as Record<string, unknown> | undefined)?.unit,
          "early",
        ),
      },
      on_time: {
        value: normalizeRuleValue(
          (record.on_time as Record<string, unknown> | undefined)?.value,
          "on_time",
        ),
        unit: normalizeRuleUnit(
          (record.on_time as Record<string, unknown> | undefined)?.unit,
          "on_time",
        ),
      },
      late: {
        value: normalizeRuleValue(
          (record.late as Record<string, unknown> | undefined)?.value,
          "late",
        ),
        unit: normalizeRuleUnit(
          (record.late as Record<string, unknown> | undefined)?.unit,
          "late",
        ),
      },
    };
    const effectiveFrom = resolveEffectiveFrom(record, new Date());

    const ruleColumns = {
      early_value: nextConfig.early.value,
      early_unit: nextConfig.early.unit,
      on_time_value: nextConfig.on_time.value,
      on_time_unit: nextConfig.on_time.unit,
      late_value: nextConfig.late.value,
      late_unit: nextConfig.late.unit,
    };

    await prisma.$transaction([
      prisma.attendance_timing_rule_version.create({
        data: {
          ...ruleColumns,
          effective_from: effectiveFrom,
          created_by_user_id: updatedByUserId,
        },
      }),
      prisma.attendance_timing_settings.upsert({
        where: {
          id: ATTENDANCE_TIMING_SETTINGS_ID,
        },
        update: {
          ...ruleColumns,
          updated_by_user_id: updatedByUserId,
        },
        create: {
          id: ATTENDANCE_TIMING_SETTINGS_ID,
          ...ruleColumns,
          updated_by_user_id: updatedByUserId,
        },
      }),
    ]);

    return this.getConfig();
  }
}

export const attendanceTimingSettingsService =
  new AttendanceTimingSettingsService();
