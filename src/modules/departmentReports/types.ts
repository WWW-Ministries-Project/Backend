/**
 * Shapes returned by /department-reports. The Frontend renders report bodies
 * generically from these, so every chart or table is described as data.
 * Contract: Frontend/docs/DEPARTMENT_REPORTS_BACKEND_CONTRACT.md
 */

export type ReportKey =
  | "membership"
  | "visitors"
  | "events"
  | "attendance"
  | "assets"
  | "finance"
  | "lifecenters";

export const REPORT_KEYS: ReportKey[] = [
  "membership",
  "visitors",
  "events",
  "attendance",
  "assets",
  "finance",
  "lifecenters",
];

export type PeriodType = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM";

export type PillTone = "success" | "warning" | "danger" | "info" | "neutral";
export interface Pill {
  tone: PillTone;
  label: string;
}

export type KpiFormat = "n" | "pct" | "ghs" | "days" | "dec" | "signed" | "raw";

export interface KpiDTO {
  key: string;
  label: string;
  /** Numeric value for the selected period; null when there is no data. */
  value: number | null;
  /** Text shown instead of a formatted value (e.g. "17 of 21"). */
  display?: string | null;
  format: KpiFormat;
  /** Same metric for the previous period and the same period last year. */
  compare: { prev: number | null; yoy: number | null };
  /** True when the delta should be shown in percentage points. */
  points?: boolean;
  good: "up" | "down" | null;
  /** Oldest → newest, the selected period last. */
  spark: number[];
  sub?: string | null;
  provisional?: boolean;
}

export interface FlagDTO {
  severity: "act" | "watch";
  text: string;
  link_label?: string | null;
  /** App path (under /home) that opens the filtered list behind the flag. */
  link_path?: string | null;
}

interface SectionBase {
  id: string;
  title: string;
  sub?: string;
  full?: boolean;
  note?: string;
  legend?: { label: string; color: string; line?: boolean }[];
}

export type TableCell =
  | string
  | number
  | null
  | { text?: string; sub?: string; bold?: boolean; pill?: Pill };

export type SectionDTO =
  | (SectionBase & {
      kind: "bars";
      labels: string[];
      series: { name: string; color: string; values: number[] }[];
      stack?: boolean;
      money?: boolean;
      line?: { name: string; color: string; values: number[] };
    })
  | (SectionBase & {
      kind: "hbars";
      rows: { label: string; value: number; display?: string; color?: string; sub?: string; max?: number }[];
      money?: boolean;
      max?: number;
      color?: string;
    })
  | (SectionBase & { kind: "funnel"; steps: { label: string; value: number; note?: string }[] })
  | (SectionBase & {
      kind: "table";
      columns: { label: string; width: string; align?: "left" | "right" }[];
      rows: { cells: TableCell[]; keys?: (string | number)[] }[];
      sortable?: boolean;
      minWidth?: string;
    })
  | (SectionBase & {
      kind: "segments";
      groups: { label?: string; parts: { label: string; value: number; color: string; display?: string }[] }[];
    })
  | (SectionBase & {
      kind: "heat";
      columns: string[];
      rows: { label: string; cells: { bg: string; fg: string; text: string }[] }[];
    })
  | (SectionBase & {
      kind: "calendar";
      days: { key: string; dow: string; day: number; weekend?: boolean; colors: string[]; tip: string }[];
    })
  | (SectionBase & {
      kind: "list";
      items: { title: string; sub?: string; pill?: Pill; right?: string; pii?: boolean }[];
    })
  | (SectionBase & {
      kind: "stats";
      stats: { label: string; value: string; sub?: string; color?: string }[];
    });

export type Health = "ok" | "watch" | "act";

export interface ReportBodyDTO {
  kpis: KpiDTO[];
  flags: FlagDTO[];
  highlights: string[];
  sections: SectionDTO[];
  /** Present only when every branch is selected. */
  by_branch: SectionDTO | null;
  /** Indexes into `kpis` shown on summary cards. */
  headline: [number, number];
  health: Health;
  /** Set when some figures may still change (e.g. unapproved finance weeks). */
  provisional_note: string | null;
  /** True when the period has no data at all. */
  empty: boolean;
}

/** Facts the executive summary pipeline and branch table need from reports. */
export interface ReportFacts {
  [key: string]: number | null;
}

export interface Bucket {
  label: string;
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface ReportContext {
  periodType: PeriodType;
  periodKey: string;
  periodLabel: string;
  from: Date;
  /** Exclusive end. */
  to: Date;
  prev: { from: Date; to: Date; label: string };
  yoy: { from: Date; to: Date; label: string };
  /** Trend buckets ending with the selected period (12 months or 13 weeks). */
  trend: Bucket[];
  /** Weekly buckets covering the selected period (for heatmaps): the latest 26 that have started. */
  weeks: Bucket[];
  /** null = all branches the viewer may see. */
  branchId: number | null;
  /** Branches to break down when branchId is null. */
  branches: { id: number; name: string }[];
  now: Date;
}

export interface ReportResult {
  body: ReportBodyDTO;
  /** Raw numbers used by the executive summary (pipeline, branch comparison). */
  facts: ReportFacts;
}

export type ReportBuilder = (ctx: ReportContext) => Promise<ReportResult>;
