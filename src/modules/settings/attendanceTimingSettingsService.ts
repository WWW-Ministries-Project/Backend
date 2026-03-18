import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

const ATTENDANCE_TIMING_SETTINGS_ID = 1;
const ATTENDANCE_TIMING_UNITS = ["MINUTES", "HOURS"] as const;
const DEFAULT_RULE_VALUE = 15;

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

export type AttendanceTimingRuleResponse = {
  value: number;
  unit: AttendanceTimingUnit;
  minutes: number;
};

export type AttendanceTimingSettingsResponse = {
  early: AttendanceTimingRuleResponse;
  on_time: AttendanceTimingRuleResponse;
  late: AttendanceTimingRuleResponse;
  updated_at: string | null;
  updated_by: {
    id: number;
    name: string;
  } | null;
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
  updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
  updated_by: row?.updated_by ?? null,
});

export class AttendanceTimingSettingsService {
  async getConfig(): Promise<AttendanceTimingSettingsResponse> {
    const row = (await prisma.attendance_timing_settings.findUnique({
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

    return mapConfigRow(row);
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

    await prisma.attendance_timing_settings.upsert({
      where: {
        id: ATTENDANCE_TIMING_SETTINGS_ID,
      },
      update: {
        early_value: nextConfig.early.value,
        early_unit: nextConfig.early.unit,
        on_time_value: nextConfig.on_time.value,
        on_time_unit: nextConfig.on_time.unit,
        late_value: nextConfig.late.value,
        late_unit: nextConfig.late.unit,
        updated_by_user_id: updatedByUserId,
      },
      create: {
        id: ATTENDANCE_TIMING_SETTINGS_ID,
        early_value: nextConfig.early.value,
        early_unit: nextConfig.early.unit,
        on_time_value: nextConfig.on_time.value,
        on_time_unit: nextConfig.on_time.unit,
        late_value: nextConfig.late.value,
        late_unit: nextConfig.late.unit,
        updated_by_user_id: updatedByUserId,
      },
    });

    return this.getConfig();
  }
}

export const attendanceTimingSettingsService =
  new AttendanceTimingSettingsService();
