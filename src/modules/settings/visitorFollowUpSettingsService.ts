import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

const SETTINGS_ID = 1;
const MAX_PER_MONTH = 31;

export type VisitorFollowUpSettingsResponse = {
  follow_ups_per_month: number;
  enabled: boolean;
  updated_at: string | null;
  updated_by: { id: number; name: string } | null;
};

const mapRow = (row: any): VisitorFollowUpSettingsResponse => ({
  follow_ups_per_month: row?.follow_ups_per_month ?? 2,
  enabled: row?.enabled ?? false,
  updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
  updated_by: row?.updated_by ?? null,
});

const normalizeCount = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PER_MONTH) {
    throw new InputValidationError(
      `follow_ups_per_month must be a whole number between 1 and ${MAX_PER_MONTH}`,
    );
  }
  return n;
};

const normalizeEnabled = (value: unknown): boolean =>
  value === true || value === "true" || value === 1 || value === "1";

export class VisitorFollowUpSettingsService {
  async getConfig(): Promise<VisitorFollowUpSettingsResponse> {
    const row = await prisma.visitor_follow_up_settings.findUnique({
      where: { id: SETTINGS_ID },
      select: {
        follow_ups_per_month: true,
        enabled: true,
        updated_at: true,
        updated_by: { select: { id: true, name: true } },
      },
    });
    return mapRow(row);
  }

  async upsertConfig(payload: unknown, updatedByUserId: number) {
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const data = {
      follow_ups_per_month: normalizeCount(record.follow_ups_per_month),
      enabled: normalizeEnabled(record.enabled),
      updated_by_user_id: updatedByUserId,
    };
    await prisma.visitor_follow_up_settings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    return this.getConfig();
  }
}

export const visitorFollowUpSettingsService =
  new VisitorFollowUpSettingsService();
