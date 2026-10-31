import type { WorkspaceKey } from "./workspaceKeys";

/** Shapes from Frontend/docs/WORKSPACES_AND_REPORT_CONFIG_BACKEND_CONTRACT.md §4. */

export type RangeKey = "WEEK" | "MONTH" | "QUARTER" | "YEAR";
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export interface Pill {
  tone: Tone;
  label: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  format: "n" | "pct" | "ghs" | "signed" | "raw";
  delta_pct: number | null;
  points?: boolean;
  good: "up" | "down" | null;
  spark: number[];
  sub?: string;
}

export type QueueKind =
  | "requisition"
  | "dept_report"
  | "appointment"
  | "join_request"
  | "visitor"
  | "weekly_record"
  | "sermon"
  | "follow_up";

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** Record id for the module endpoint; weekly finance records use string ids. */
  ref_id: number | string;
  title: string;
  sub: string;
  amount?: number | null;
  pill?: Pill | null;
  /** follow_up only: the visitor's latest open follow-up, updated instead of creating another. */
  follow_up_id?: number | null;
  detail?: {
    fields: [string, string][];
    text?: string;
    text_label?: string;
    items?: { label: string; qty?: number | null; amount: number }[];
    steps?: { label: string; who: string; state: "ok" | "cur" | "wait"; when?: string }[];
  };
  /** dept_report only: the workflow row the approve/return endpoints take (branch_id omitted for church-wide). */
  selector?: { report_key: string; period_type: string; period_key: string; branch_id?: number };
}

export interface AgendaItem {
  date: string;
  title: string;
  sub: string;
  pill?: Pill | null;
  ref_id?: number;
}

export interface ListItem {
  title: string;
  sub?: string;
  pill?: Pill | null;
  right?: string | null;
  ref_id?: number;
}

export interface BarRow {
  label: string;
  value: number;
  max?: number | null;
  sub?: string | null;
}

export interface NeedsItem {
  key: string;
  label: string;
  count: number;
  widget: string;
  tab?: string;
}

export type WidgetResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface WorkspaceRange {
  key: RangeKey;
  label: string;
  compare_label: string;
  from: Date;
  to: Date;
  /** The comparison period (same length, immediately before). */
  prevFrom: Date;
  prevTo: Date;
}

export interface WorkspaceContext {
  userId: number;
  userName: string;
  ws: WorkspaceKey;
  range: WorkspaceRange;
  /** Selected branch; null = all of the caller's branches. */
  branchId: number | null;
  /** hod only: the department being viewed. */
  departmentId: number | null;
  /** Raw query, for widget-specific options (e.g. `att_event`). */
  query: Record<string, unknown>;
  can: (domain: string, action: "view" | "manage" | "admin") => Promise<boolean>;
  /** Catalogue action (`Domain.action`) in the selected branch; every branch when none is selected. */
  action: (domain: string, action: string) => Promise<boolean>;
  /** Stored role permissions of the caller's grants in the selected branch (all when none). */
  grants: () => Promise<unknown[]>;
}

export interface WorkspaceBuild {
  needs: NeedsItem[];
  widgets: Record<string, WidgetResult>;
  departments?: { id: number; name: string; pack: "media" | "evangelism" | "children" | null }[];
}

export type WorkspaceBuilder = (ctx: WorkspaceContext) => Promise<WorkspaceBuild>;
