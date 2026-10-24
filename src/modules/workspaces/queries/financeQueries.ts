/**
 * Finance workspace data helpers. Weekly-record parsing mirrors
 * departmentReports/aggregators/finance.ts (`parseRecord`): receipts are the
 * record's receipt lines, drafts don't count, legacy month records are dated
 * the 1st.
 */
import { prisma } from "../../../Models/context";
import { getBranchScope } from "../../branches/branchScope";
import { DAY, num, sum } from "./genericCommon";

type AnyObj = Record<string, any>;

const parseDay = (s: unknown): Date | null => {
  const text = String(s ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return new Date(`${text}-01T00:00:00Z`);
  return null;
};

export type ReceiptLine = { label: string; key: string; amount: number };

export type WeeklyRecord = {
  id: string;
  date: Date;
  from: Date;
  to: Date;
  legacyMonth: boolean;
  week: string;
  status: string;
  returned: boolean;
  counted: boolean;
  branchId: number | null;
  submittedBy: number | null;
  submittedAt: Date | null;
  receipts: ReceiptLine[];
  total: number;
};

export const weeklyRecordSelect = {
  id: true,
  payload: true,
  periodDate: true,
  createdAt: true,
  status: true,
  branch_id: true,
  submitted_by_user_id: true,
  submitted_at: true,
  returned_at: true,
} as const;

export const parseWeeklyRecord = (row: {
  id: string;
  payload: string;
  periodDate: string | null;
  createdAt: Date;
  status: string;
  branch_id: number | null;
  submitted_by_user_id: number | null;
  submitted_at: Date | null;
  returned_at: Date | null;
}): WeeklyRecord => {
  let data: AnyObj = {};
  try {
    const parsed = JSON.parse(row.payload);
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    data = {};
  }
  const meta: AnyObj = data.metaData || {};
  const date = parseDay(row.periodDate) || parseDay(meta.from) || row.createdAt;
  const legacyMonth = /^\d{4}-\d{2}$/.test(String(row.periodDate ?? ""));
  const from = parseDay(meta.from) || date;
  const to = parseDay(meta.to) || new Date(from.getTime() + 6 * DAY);
  const receipts = (Array.isArray(data.receipts) ? data.receipts : []).map((x: AnyObj) => {
    const label = String(x?.item ?? "").trim() || "Unnamed line";
    return { label, key: label.toLowerCase(), amount: num(x?.amount) };
  });
  const status = String(row.status || "DRAFT").toUpperCase();
  return {
    id: row.id,
    date,
    from,
    to,
    legacyMonth,
    week: String(meta.week || (legacyMonth ? "Month" : "Week")),
    status,
    returned: !!row.returned_at,
    counted: status !== "DRAFT",
    branchId: row.branch_id,
    submittedBy: row.submitted_by_user_id,
    submittedAt: row.submitted_at,
    receipts,
    total: sum(receipts.map((r: ReceiptLine) => r.amount)),
  };
};

/** Weekly records dated from `from` on, in the branch filter. */
export const loadWeeklyRecords = async (branchWhere: Record<string, unknown>, from: Date) => {
  const rows = await prisma.financials.findMany({
    where: {
      ...branchWhere,
      OR: [
        { periodDate: { gte: from.toISOString().slice(0, 7) } },
        { periodDate: null, createdAt: { gte: from } },
      ],
    },
    select: weeklyRecordSelect,
  });
  return rows.map(parseWeeklyRecord).filter((r) => r.date >= from);
};

/** Branches the caller sees: the selected one, else their allowed branches (all when unrestricted). */
export const scopedBranches = async (branchId: number | null) => {
  const allowed = getBranchScope()?.allowedBranchIds ?? null;
  return prisma.branch.findMany({
    where: branchId ? { id: branchId } : allowed ? { id: { in: allowed } } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
};

const CHANNELS: Record<string, string> = {
  mobile_money: "Mobile money",
  card: "Card",
  bank: "Bank",
  bank_transfer: "Bank transfer",
  ussd: "USSD",
  qr: "QR",
  apple_pay: "Apple Pay",
};
export const channelLabel = (c: string | null) =>
  c ? CHANNELS[c] || c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "Not recorded";
