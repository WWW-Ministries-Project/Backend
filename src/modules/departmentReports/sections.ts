import {
  Bucket,
  FlagDTO,
  Health,
  KpiDTO,
  KpiFormat,
  Pill,
  PillTone,
  SectionDTO,
  TableCell,
} from "./types";

/* Design-system palette. */
export const NV = "#080D2D";
export const BZ = "#9A5D1A";
export const SF = "rgba(8,13,45,0.3)";
export const GR = "#D8DAE5";
export const MG = "#6B7280";
export const GN = "#15803D";
export const AM = "#B45309";
export const RD = "#B91C1C";
export const BL = "#1D4ED8";
export const PALETTE = [NV, BZ, SF, MG, GR];

export const pill = (tone: PillTone, label: string): Pill => ({ tone, label });

export const nf = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 });
export const ghs = (n: number | null | undefined) => {
  const value = Number(n || 0);
  return "GH₵ " + (Math.abs(value) >= 1e6 ? (value / 1e6).toFixed(2) + "m" : Math.round(value).toLocaleString("en-GB"));
};
export const pctOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const sum = (values: number[]) => values.reduce((a, b) => a + (Number(b) || 0), 0);

export const inRange = (date: Date | string | null | undefined, from: Date, to: Date) => {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return d >= from && d < to;
};

/** Counts items per bucket by a date accessor. */
export const perBucket = <T>(items: T[], buckets: Bucket[], dateOf: (item: T) => Date | string | null | undefined) =>
  buckets.map((b) => items.filter((item) => inRange(dateOf(item), b.from, b.to)).length);

/** Sums a value per bucket by a date accessor. */
export const sumPerBucket = <T>(
  items: T[],
  buckets: Bucket[],
  dateOf: (item: T) => Date | string | null | undefined,
  valueOf: (item: T) => number,
) =>
  buckets.map((b) =>
    sum(items.filter((item) => inRange(dateOf(item), b.from, b.to)).map(valueOf)),
  );

export const kpi = (
  key: string,
  label: string,
  value: number | null,
  o: {
    format?: KpiFormat;
    prev?: number | null;
    yoy?: number | null;
    good?: "up" | "down" | null;
    spark?: number[];
    sub?: string | null;
    display?: string | null;
    points?: boolean;
    provisional?: boolean;
  } = {},
): KpiDTO => ({
  key,
  label,
  value,
  display: o.display ?? null,
  format: o.format || "n",
  compare: { prev: o.prev ?? null, yoy: o.yoy ?? null },
  points: o.points || (o.format === "pct" ? true : undefined),
  good: o.good === undefined ? "up" : o.good,
  spark: o.spark || [],
  sub: o.sub ?? null,
  provisional: o.provisional || undefined,
});

export const flag = (
  severity: "act" | "watch",
  text: string,
  linkLabel?: string,
  linkPath?: string,
): FlagDTO => ({ severity, text, link_label: linkLabel || null, link_path: linkPath || null });

export const sortFlags = (flags: FlagDTO[]) =>
  flags.slice().sort((a, b) => (a.severity === "act" ? 0 : 1) - (b.severity === "act" ? 0 : 1));

export const healthOf = (flags: FlagDTO[]): Health =>
  flags.some((f) => f.severity === "act") ? "act" : flags.length ? "watch" : "ok";

type Opts = { full?: boolean; note?: string; sub?: string };

export const bars = (
  id: string,
  title: string,
  sub: string,
  labels: string[],
  series: { name: string; color: string; values: number[] }[],
  o: Opts & { stack?: boolean; money?: boolean; line?: { name: string; color: string; values: number[] } } = {},
): SectionDTO => ({ kind: "bars", id, title, sub, labels, series, stack: o.stack, money: o.money, line: o.line, full: o.full, note: o.note });

export const hbars = (
  id: string,
  title: string,
  sub: string,
  rows: { label: string; value: number; display?: string; color?: string; sub?: string; max?: number }[],
  o: Opts & { money?: boolean; max?: number; color?: string } = {},
): SectionDTO => ({ kind: "hbars", id, title, sub, rows, money: o.money, max: o.max, color: o.color, full: o.full, note: o.note });

export const funnel = (
  id: string,
  title: string,
  sub: string,
  steps: { label: string; value: number; note?: string }[],
  o: Opts = {},
): SectionDTO => ({ kind: "funnel", id, title, sub, steps, full: o.full, note: o.note });

export const table = (
  id: string,
  title: string,
  sub: string,
  columns: [string, string, ("left" | "right")?][],
  rows: { cells: TableCell[]; keys?: (string | number)[] }[],
  o: Opts & { sortable?: boolean; minWidth?: string } = {},
): SectionDTO => ({
  kind: "table",
  id,
  title,
  sub,
  columns: columns.map(([label, width, align]) => ({ label, width, align })),
  rows,
  sortable: o.sortable,
  minWidth: o.minWidth,
  full: o.full,
  note: o.note,
});

export const segments = (
  id: string,
  title: string,
  sub: string,
  groups: { label?: string; parts: { label: string; value: number; color: string; display?: string }[] }[],
  o: Opts = {},
): SectionDTO => ({
  kind: "segments",
  id,
  title,
  sub,
  groups: groups
    .map((g) => ({ ...g, parts: g.parts.filter((p) => p.value > 0) }))
    .filter((g) => g.parts.length > 0),
  full: o.full,
  note: o.note,
});

export const heat = (
  id: string,
  title: string,
  sub: string,
  columns: string[],
  rows: { label: string; cells: { bg: string; fg: string; text: string }[] }[],
  o: Opts = {},
): SectionDTO => ({ kind: "heat", id, title, sub, columns, rows, full: o.full, note: o.note });

export const list = (
  id: string,
  title: string,
  sub: string,
  items: { title: string; sub?: string; pill?: Pill; right?: string; pii?: boolean }[],
  o: Opts = {},
): SectionDTO => ({ kind: "list", id, title, sub, items, full: o.full, note: o.note });

export const stats = (
  id: string,
  title: string,
  sub: string,
  items: { label: string; value: string; sub?: string; color?: string }[],
  o: Opts = {},
): SectionDTO => ({ kind: "stats", id, title, sub, stats: items, full: o.full, note: o.note });

/** Heat cells. */
export const pctCell = (v: number | null) =>
  v == null
    ? { bg: "#F3F4F6", fg: MG, text: "—" }
    : v >= 75
      ? { bg: "#F0FDF4", fg: GN, text: `${Math.round(v)}%` }
      : v >= 60
        ? { bg: "#FFFBEB", fg: AM, text: `${Math.round(v)}%` }
        : { bg: "#FEF2F2", fg: RD, text: `${Math.round(v)}%` };
export const metCell = (v: boolean | null) =>
  v == null ? { bg: "#F3F4F6", fg: MG, text: "—" } : v ? { bg: "#F0FDF4", fg: GN, text: "✓" } : { bg: "#FEF2F2", fg: RD, text: "✕" };
export const attCell = (v: number | null) =>
  v == null
    ? { bg: "#F8F9FC", fg: MG, text: "—" }
    : v > 1000
      ? { bg: NV, fg: "#fff", text: nf(v) }
      : v > 300
        ? { bg: "rgba(8,13,45,0.6)", fg: "#fff", text: nf(v) }
        : v > 100
          ? { bg: "rgba(8,13,45,0.22)", fg: NV, text: nf(v) }
          : { bg: "rgba(8,13,45,0.08)", fg: NV, text: nf(v) };

export const pctPill = (v: number) =>
  v >= 75 ? pill("success", `${Math.round(v)}%`) : v >= 60 ? pill("warning", `${Math.round(v)}%`) : pill("danger", `▼ ${Math.round(v)}%`);

/** "By branch" table shown when every branch is selected. */
export const byBranch = (
  id: string,
  columns: string[],
  rows: { branch: string; values: (string | number)[] }[],
): SectionDTO =>
  table(
    `bb-${id}`,
    "By branch",
    "The same figures split by branch",
    [["Branch", "minmax(170px,1.4fr)"] as [string, string], ...columns.map((c) => [c, "minmax(100px,1fr)", "right"] as [string, string, "right"])],
    rows.map((r) => ({ cells: [{ text: r.branch, bold: true }, ...r.values.map((v) => (typeof v === "number" ? nf(v) : v))] })),
    { full: true, sortable: true, minWidth: "640px" },
  );

/** Change sentence helper for highlights: "up 14% on Aug 2026". */
export const changeWords = (current: number, previous: number | null | undefined, label: string) => {
  if (previous == null || previous === 0) return "";
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (change === 0) return `, level with ${label}`;
  return `, ${change > 0 ? "up" : "down"} ${Math.abs(change)}% on ${label}`;
};

export const emptyBody = () => ({
  kpis: [] as KpiDTO[],
  flags: [] as FlagDTO[],
  highlights: [] as string[],
  sections: [] as SectionDTO[],
  by_branch: null as SectionDTO | null,
  headline: [0, 1] as [number, number],
  health: "ok" as Health,
  provisional_note: null as string | null,
  empty: false,
});
