import { prisma } from "../../Models/context";

export interface AiPreferences {
  brief: boolean;
  nudges: boolean;
  quiet: boolean;
  emailCopy: boolean;
  approvalAfter: string;
  reportLead: string;
  visitorAfter: string;
}

export type AiPreferencesPatch = Partial<AiPreferences>;

const DEFAULTS: AiPreferences = {
  brief: true,
  nudges: true,
  quiet: true,
  emailCopy: false,
  approvalAfter: "24 hours",
  reportLead: "2 days before",
  visitorAfter: "48 hours",
};

const APPROVAL_AFTER_OPTIONS = ["12 hours", "24 hours", "48 hours"];
const REPORT_LEAD_OPTIONS = ["1 day before", "2 days before", "1 week before"];
const VISITOR_AFTER_OPTIONS = ["24 hours", "48 hours", "72 hours"];

type PreferenceRow = {
  brief: boolean;
  nudges: boolean;
  quiet: boolean;
  email_copy: boolean;
  approval_after: string;
  report_lead: string;
  visitor_after: string;
};

const toApi = (row: PreferenceRow): AiPreferences => ({
  brief: row.brief,
  nudges: row.nudges,
  quiet: row.quiet,
  emailCopy: row.email_copy,
  approvalAfter: row.approval_after,
  reportLead: row.report_lead,
  visitorAfter: row.visitor_after,
});

const pickEnum = (value: unknown, options: string[], fallback: string): string => {
  if (typeof value === "string" && options.includes(value)) return value;
  return fallback;
};

export class AiPreferenceService {
  /** Returns the user's preferences, or defaults when none are stored yet. */
  async getPreferences(userId: number): Promise<AiPreferences> {
    const row = await prisma.assistant_preference.findUnique({ where: { user_id: userId } });
    return row ? toApi(row) : { ...DEFAULTS };
  }

  /**
   * Merges a partial patch onto the current (or default) preferences and
   * upserts. Unknown keys are ignored; select values are clamped to the
   * allowed options.
   */
  async updatePreferences(userId: number, patch: AiPreferencesPatch): Promise<AiPreferences> {
    const current = await this.getPreferences(userId);

    const next: AiPreferences = {
      brief: typeof patch.brief === "boolean" ? patch.brief : current.brief,
      nudges: typeof patch.nudges === "boolean" ? patch.nudges : current.nudges,
      quiet: typeof patch.quiet === "boolean" ? patch.quiet : current.quiet,
      emailCopy: typeof patch.emailCopy === "boolean" ? patch.emailCopy : current.emailCopy,
      approvalAfter: patch.approvalAfter
        ? pickEnum(patch.approvalAfter, APPROVAL_AFTER_OPTIONS, current.approvalAfter)
        : current.approvalAfter,
      reportLead: patch.reportLead
        ? pickEnum(patch.reportLead, REPORT_LEAD_OPTIONS, current.reportLead)
        : current.reportLead,
      visitorAfter: patch.visitorAfter
        ? pickEnum(patch.visitorAfter, VISITOR_AFTER_OPTIONS, current.visitorAfter)
        : current.visitorAfter,
    };

    const data = {
      brief: next.brief,
      nudges: next.nudges,
      quiet: next.quiet,
      email_copy: next.emailCopy,
      approval_after: next.approvalAfter,
      report_lead: next.reportLead,
      visitor_after: next.visitorAfter,
    };

    const row = await prisma.assistant_preference.upsert({
      where: { user_id: userId },
      update: data,
      create: { user_id: userId, ...data },
    });

    return toApi(row);
  }
}
