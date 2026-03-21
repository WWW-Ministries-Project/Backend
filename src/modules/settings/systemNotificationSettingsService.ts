import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

const SYSTEM_NOTIFICATION_SETTINGS_ID = 1;

type AdminCandidateRow = {
  id: number;
  name: string;
  email: string | null;
  access_level_id: number | null;
  access: {
    id: number;
    name: string;
  } | null;
};

type ConfigRow = {
  id: number;
  system_failure_recipient_user_id: number | null;
  updated_at: Date;
  system_failure_recipient: AdminCandidateRow | null;
  updated_by: {
    id: number;
    name: string;
  } | null;
};

export type SystemNotificationAdminCandidate = {
  id: number;
  name: string;
  email: string | null;
  access_level_id: number | null;
  access_level_name: string | null;
};

export type SystemNotificationSettingsResponse = {
  system_failure_recipient_user_id: number | null;
  system_failure_recipient: SystemNotificationAdminCandidate | null;
  updated_at: string | null;
  updated_by: {
    id: number;
    name: string;
  } | null;
};

const toPositiveIntOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputValidationError(
      "system_failure_recipient_user_id must be a positive integer",
    );
  }

  return parsed;
};

const mapAdminCandidate = (
  user: AdminCandidateRow | null,
): SystemNotificationAdminCandidate | null => {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    access_level_id: user.access_level_id,
    access_level_name: user.access?.name || null,
  };
};

const mapConfigRow = (
  row: ConfigRow | null,
): SystemNotificationSettingsResponse => ({
  system_failure_recipient_user_id:
    row?.system_failure_recipient_user_id ?? null,
  system_failure_recipient: mapAdminCandidate(
    row?.system_failure_recipient || null,
  ),
  updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
  updated_by: row?.updated_by || null,
});

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  access_level_id: true,
  access: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export class SystemNotificationSettingsService {
  async listAdminCandidates(): Promise<SystemNotificationAdminCandidate[]> {
    const rows = (await prisma.user.findMany({
      where: {
        is_user: true,
        access_level_id: {
          not: null,
        },
        NOT: {
          is_active: false,
        },
      },
      orderBy: {
        name: "asc",
      },
      select: adminUserSelect,
    })) as AdminCandidateRow[];

    return rows.map((row) => mapAdminCandidate(row) as SystemNotificationAdminCandidate);
  }

  async getConfig(): Promise<SystemNotificationSettingsResponse> {
    const row = (await prisma.system_notification_settings.findUnique({
      where: {
        id: SYSTEM_NOTIFICATION_SETTINGS_ID,
      },
      select: {
        id: true,
        system_failure_recipient_user_id: true,
        updated_at: true,
        system_failure_recipient: {
          select: adminUserSelect,
        },
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
  ): Promise<SystemNotificationSettingsResponse> {
    const systemFailureRecipientUserId = toPositiveIntOrNull(
      (payload as { system_failure_recipient_user_id?: unknown })
        ?.system_failure_recipient_user_id,
    );

    if (systemFailureRecipientUserId !== null) {
      const targetUser = await prisma.user.findFirst({
        where: {
          id: systemFailureRecipientUserId,
          is_user: true,
          access_level_id: {
            not: null,
          },
          NOT: {
            is_active: false,
          },
        },
        select: {
          id: true,
        },
      });

      if (!targetUser) {
        throw new InputValidationError(
          "Select an active admin user for system failure notifications.",
        );
      }
    }

    await prisma.system_notification_settings.upsert({
      where: {
        id: SYSTEM_NOTIFICATION_SETTINGS_ID,
      },
      update: {
        system_failure_recipient_user_id: systemFailureRecipientUserId,
        updated_by_user_id: updatedByUserId,
      },
      create: {
        id: SYSTEM_NOTIFICATION_SETTINGS_ID,
        system_failure_recipient_user_id: systemFailureRecipientUserId,
        updated_by_user_id: updatedByUserId,
      },
    });

    return this.getConfig();
  }

  async getConfiguredSystemFailureRecipientUserIds(): Promise<number[]> {
    const row = await prisma.system_notification_settings.findUnique({
      where: {
        id: SYSTEM_NOTIFICATION_SETTINGS_ID,
      },
      select: {
        system_failure_recipient_user_id: true,
      },
    });

    const recipientUserId = row?.system_failure_recipient_user_id;
    if (!recipientUserId) {
      return [];
    }

    const recipient = await prisma.user.findFirst({
      where: {
        id: recipientUserId,
        is_user: true,
        access_level_id: {
          not: null,
        },
        NOT: {
          is_active: false,
        },
      },
      select: {
        id: true,
      },
    });

    return recipient ? [recipient.id] : [];
  }
}

export const systemNotificationSettingsService =
  new SystemNotificationSettingsService();
