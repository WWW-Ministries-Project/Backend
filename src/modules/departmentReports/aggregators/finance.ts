/**
 * Finance report.
 *
 * Sources and definitions:
 * - Weekly records (`financials`): one per week per branch, dated by
 *   `periodDate` (the week's first day, clipped to its month; legacy records
 *   hold a `YYYY-MM` month key and are dated the 1st). The JSON payload holds
 *   receipt lines, payment lines, the tithe rate and breakdown, balances and
 *   fund allocations. Totals are recomputed here with the same arithmetic as
 *   the Frontend (`buildFinanceSummary`): tithe = receipts × rate, surplus =
 *   receipts − tithe − payments, fund allocation = share × final balance.
 * - Approved and submitted (PENDING_APPROVAL) records count toward the totals.
 *   Drafts are left out. Whenever a record in the period is not approved, the
 *   record-based KPIs are marked provisional and `provisional_note` explains.
 * - Online giving = successful giving contributions by `paid_at` (major units,
 *   the donation itself, without the donor-borne fee). Payment outcomes count
 *   every attempt started in the period (`createdAt`).
 * - Pledges redeemed = all redemptions recorded up to the end of a period
 *   against the pledged total of campaigns live in it (created before its end,
 *   deadline not before its start). Pledged amounts are today's amounts.
 * - Requisitions use the requisition analytics rules: counted by submission
 *   date (requisition date when never submitted), drafts excluded, value =
 *   items × unit price, time to approve = submission → last step decision.
 *   "Waiting over 10 days" covers every requisition still in approval now.
 * - Fund allocation: "Required" applies the current Finance configuration
 *   (tithe breakdown and fund accounts) to each counted week; "Set aside" is
 *   what each week's own lines allocated.
 *
 * Dropped / adapted from the design mock (no data behind them):
 * - Spending causes in highlights ("from the Youth Rally"): payment lines are
 *   free-text categories with no link to events; the top line is named instead.
 * - "Special seeds" / "Other" income sources are not fixed categories; sources
 *   are whatever receipt lines the church configured.
 * - Requisition money counts GHS requests only; other currencies are noted,
 *   not converted (no exchange rates stored).
 * - Failed payments are compared across all channels: failed attempts often
 *   carry no channel, so a mobile-money-only rate would be unreliable.
 */
import { RequestApprovalStatus } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { isoDate, shortDate } from "../period";
import {
  AM,
  BZ,
  GN,
  MG,
  NV,
  RD,
  bars,
  byBranch,
  changeWords,
  emptyBody,
  flag,
  ghs,
  hbars,
  healthOf,
  kpi,
  list,
  nf,
  pctOf,
  pill,
  round1,
  segments,
  sortFlags,
  stats,
  sum,
  table,
} from "../sections";
import { FlagDTO, ReportBuilder, SectionDTO, TableCell } from "../types";

const DAY = 86_400_000;
const WAITING_DAYS = 10;

type Range = { from: Date; to: Date };
type AnyObj = Record<string, any>;

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** 10 and 0.1 both mean ten percent. */
const ratio = (v: unknown) => {
  const n = num(v);
  return Math.abs(n) <= 1 ? n : n / 100;
};
const asPercent = (v: unknown) => {
  const n = num(v);
  return Math.abs(n) <= 1 && n !== 0 ? n * 100 : n;
};
const within = (d: Date | null | undefined, r: Range) => !!d && d >= r.from && d < r.to;
const keyOf = (s: unknown) => String(s ?? "").trim().toLowerCase();
const parseDay = (s: unknown): Date | null => {
  const text = String(s ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return new Date(`${text}-01T00:00:00Z`);
  return null;
};
const dayRange = (a: Date, b: Date) =>
  a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
    ? a.getTime() === b.getTime()
      ? shortDate(a)
      : `${a.getUTCDate()}–${shortDate(b)}`
    : `${shortDate(a)} – ${shortDate(b)}`;
const pctChange = (cur: number, prev: number) =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
const changeTag = (cur: number, prev: number) => {
  const c = pctChange(cur, prev);
  if (c === null) return prev === 0 && cur > 0 ? " (new)" : "";
  return c === 0 ? " (no change)" : ` (${c > 0 ? "▲" : "▼"} ${Math.abs(c)}%)`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
const channelLabel = (c: string | null) =>
  c ? CHANNELS[c] || c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "Not recorded";

type Line = { item: string; key: string; configId: string | null; amount: number };
type WeekRecord = {
  id: string;
  date: Date;
  legacyMonth: boolean;
  status: string;
  branchId: number | null;
  week: string;
  rangeLabel: string;
  counted: boolean;
  submittedBy: number | null;
  submittedAt: Date | null;
  approvedBy: number | null;
  createdBy: number | null;
  returned: boolean;
  R: number;
  P: number;
  T: number;
  fin: number;
  receipts: Line[];
  payments: Line[];
  tithe: Line[];
  alloc: Line[];
};

const parseRecord = (row: {
  id: string;
  payload: string;
  periodDate: string | null;
  createdAt: Date;
  status: string;
  branch_id: number | null;
  submitted_by_user_id: number | null;
  submitted_at: Date | null;
  approved_by_user_id: number | null;
  created_by_user_id: number | null;
  returned_at: Date | null;
}): WeekRecord => {
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

  const lines = (list: unknown, amountOf: (x: AnyObj) => number, nameKey = "item"): Line[] =>
    (Array.isArray(list) ? list : []).map((x: AnyObj) => ({
      item: String(x?.[nameKey] ?? "").trim() || "Unnamed line",
      key: keyOf(x?.[nameKey]),
      configId: x?.configId != null ? String(x.configId) : null,
      amount: amountOf(x || {}),
    }));

  const receipts = lines(data.receipts, (x) => num(x.amount));
  const payments = lines(data.payments, (x) => num(x.amount));
  const R = sum(receipts.map((l) => l.amount));
  const P = sum(payments.map((l) => l.amount));
  const T = R * ratio(data.tithe?.totalTithe?.percentage);
  const tithe = lines(data.tithe?.breakdown, (x) => T * ratio(x.percentage));
  const balance: AnyObj = data.balance || {};
  const reserve = num(balance.ReserveForSavings?.amount);
  const fin = R - T - P - reserve + num(balance.WeeklyRefund?.amount) + num(balance.OfficeMaintenanceReserve?.amount);
  const alloc = lines(
    Array.isArray(data.fundAllocation) ? data.fundAllocation : data.fundsAllocation,
    (x) => ratio(x.portionPercent) * fin,
    "movement",
  );

  const status = String(row.status || "DRAFT").toUpperCase();
  return {
    id: row.id,
    date,
    legacyMonth,
    status,
    branchId: row.branch_id,
    week: String(meta.week || (legacyMonth ? "Month" : "Week")),
    rangeLabel: legacyMonth ? `${meta.month || ""} ${meta.year || date.getUTCFullYear()}`.trim() : dayRange(from, to),
    counted: status !== "DRAFT",
    submittedBy: row.submitted_by_user_id,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by_user_id,
    createdBy: row.created_by_user_id,
    returned: !!row.returned_at,
    R,
    P,
    T,
    fin,
    receipts,
    payments,
    tithe,
    alloc,
  };
};

export const buildFinance: ReportBuilder = async (ctx) => {
  const bw = getBranchScopedWhere(ctx.branchId) || {};
  const period: Range = { from: ctx.from, to: ctx.to };
  const windowFrom = new Date(
    Math.min(ctx.trend[0]?.from.getTime() ?? ctx.from.getTime(), ctx.prev.from.getTime(), ctx.yoy.from.getTime(), ctx.from.getTime()),
  );
  const windowTo = ctx.to;
  const pendingStatuses = [
    RequestApprovalStatus.Awaiting_HOD_Approval,
    RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
  ];
  const requestPeriodWhere = {
    ...bw,
    request_approval_status: { not: RequestApprovalStatus.Draft },
    OR: [
      { submitted_at: { gte: ctx.from, lt: ctx.to } },
      { submitted_at: null, requisition_date: { gte: ctx.from, lt: ctx.to } },
    ],
  };
  const configWhere = Object.keys(bw).length ? { OR: [bw, { branch_id: null }] } : {};

  const [
    recordRows,
    givingRows,
    attemptsNow,
    attemptsPrev,
    pledges,
    redemptions,
    requests,
    pendingRequests,
    titheConfig,
    fundConfig,
  ] = await Promise.all([
    prisma.financials.findMany({
      where: {
        ...bw,
        OR: [
          { periodDate: { gte: isoDate(windowFrom).slice(0, 7), lt: isoDate(windowTo) } },
          { periodDate: null, createdAt: { gte: windowFrom, lt: windowTo } },
        ],
      },
      select: {
        id: true,
        payload: true,
        periodDate: true,
        createdAt: true,
        status: true,
        branch_id: true,
        submitted_by_user_id: true,
        submitted_at: true,
        approved_by_user_id: true,
        created_by_user_id: true,
        returned_at: true,
      },
    }),
    prisma.givingContribution.findMany({
      // Amounts are summed as GH₵, so other currencies are left out.
      where: { ...bw, status: "success", currency: "GHS", paid_at: { gte: windowFrom, lt: windowTo } },
      select: { amount: true, fee: true, fee_actual: true, channel: true, paid_at: true, branch_id: true, user_id: true, donor_email: true },
    }),
    prisma.givingContribution.groupBy({
      by: ["status"],
      where: { ...bw, createdAt: { gte: ctx.from, lt: ctx.to } },
      _count: { _all: true },
    }),
    prisma.givingContribution.groupBy({
      by: ["status"],
      where: { ...bw, createdAt: { gte: ctx.prev.from, lt: ctx.prev.to } },
      _count: { _all: true },
    }),
    prisma.pledge.findMany({
      where: { ...bw, created_at: { lt: ctx.to } },
      select: {
        id: true,
        title: true,
        target_amount: true,
        deadline: true,
        created_at: true,
        branch_id: true,
        groups: { select: { pledgers: { select: { pledged_amount: true } } } },
      },
    }),
    prisma.pledge_redemption.findMany({
      where: { date: { lt: ctx.to }, pledger: { group: { pledge: { ...bw, created_at: { lt: ctx.to } } } } },
      select: { amount: true, date: true, pledger: { select: { group: { select: { pledge_id: true } } } } },
    }),
    prisma.request.findMany({
      where: requestPeriodWhere,
      select: {
        request_approval_status: true,
        submitted_at: true,
        currency: true,
        products: { select: { unitPrice: true, quantity: true } },
        approval_instances: { select: { acted_at: true } },
      },
    }),
    prisma.request.findMany({
      where: { ...bw, request_approval_status: { in: pendingStatuses } },
      select: { submitted_at: true, requisition_date: true, department: { select: { name: true } } },
    }),
    prisma.titheBreakdownConfig.findMany({ where: configWhere, select: { id: true, name: true, percentage: true, branch_id: true } }),
    prisma.bankAccountConfig.findMany({ where: configWhere, select: { id: true, name: true, percentage: true, branch_id: true } }),
  ]);

  /* ------------------------------ weekly records ------------------------------ */
  const records = recordRows.map(parseRecord);
  const inRange = (r: Range) => records.filter((rec) => within(rec.date, r));
  const counted = (r: Range) => inRange(r).filter((rec) => rec.counted);
  const totals = (r: Range) => {
    const list = counted(r);
    const income = sum(list.map((x) => x.R));
    const spending = sum(list.map((x) => x.P));
    const tithe = sum(list.map((x) => x.T));
    return { income, spending, tithe, surplus: income - tithe - spending, n: list.length };
  };
  const periodRecords = inRange(period).sort((a, b) => a.date.getTime() - b.date.getTime());
  const cur = totals(period);
  const prev = totals(ctx.prev);
  const yoy = totals(ctx.yoy);
  const trendTotals = ctx.trend.map((b) => totals(b));
  const hasPrevRecords = counted(ctx.prev).length > 0;
  const hasYoyRecords = counted(ctx.yoy).length > 0;

  const pendingRecs = periodRecords.filter((r) => r.status === "PENDING_APPROVAL");
  const draftRecs = periodRecords.filter((r) => r.status === "DRAFT");
  const provisional = pendingRecs.length + draftRecs.length > 0;

  /* ------------------------------- online giving ------------------------------ */
  const givingIn = (r: Range) => givingRows.filter((g) => within(g.paid_at, r));
  const givingSum = (r: Range) => sum(givingIn(r).map((g) => g.amount)) / 100;
  const givingNow = givingIn(period);
  const online = givingSum(period);
  const onlinePrev = givingSum(ctx.prev);
  const onlineYoy = givingSum(ctx.yoy);
  const givers = new Set(givingNow.map((g) => (g.user_id ? `u${g.user_id}` : `e${keyOf(g.donor_email)}`))).size;
  const fees = sum(givingNow.map((g) => g.fee_actual ?? g.fee)) / 100;
  const byChannel = new Map<string, number>();
  givingNow.forEach((g) => {
    const label = channelLabel(g.channel);
    byChannel.set(label, (byChannel.get(label) || 0) + g.amount / 100);
  });
  const statusCount = (rows: { status: string; _count: { _all: number } }[]) => {
    const m = new Map(rows.map((r) => [r.status, r._count._all]));
    const success = m.get("success") || 0;
    const failed = m.get("failed") || 0;
    const abandoned = m.get("abandoned") || 0;
    const settled = success + failed + abandoned;
    return { success, failed, abandoned, settled, failRate: settled ? pctOf(failed, settled) : null };
  };
  const attNow = statusCount(attemptsNow);
  const attPrev = statusCount(attemptsPrev);

  /* ---------------------------------- pledges --------------------------------- */
  const pledgeInfo = pledges.map((p) => ({
    id: p.id,
    title: p.title?.trim() || `Pledge #${p.id}`,
    target: p.target_amount != null ? Number(p.target_amount) : null,
    deadline: p.deadline,
    createdAt: p.created_at,
    branchId: p.branch_id,
    pledged: sum(p.groups.flatMap((g) => g.pledgers.map((x) => Number(x.pledged_amount)))),
  }));
  const redemptionRows = redemptions.map((r) => ({
    pledgeId: r.pledger.group.pledge_id,
    amount: Number(r.amount),
    date: r.date,
  }));
  const livePledges = (r: Range) =>
    pledgeInfo.filter((p) => p.createdAt < r.to && (!p.deadline || p.deadline >= r.from));
  const redeemedBy = (ids: Set<number>, end: Date) =>
    sum(redemptionRows.filter((x) => ids.has(x.pledgeId) && x.date < end).map((x) => x.amount));
  const redemptionPct = (r: Range): number | null => {
    const live = livePledges(r);
    const pledged = sum(live.map((p) => p.pledged));
    if (!(pledged > 0)) return null;
    return round1(pctOf(redeemedBy(new Set(live.map((p) => p.id)), r.to), pledged));
  };
  const pledgePct = redemptionPct(period);
  const pledgeNow = livePledges(period);
  const pledgedNow = sum(pledgeNow.map((p) => p.pledged));
  const redeemedNow = redeemedBy(new Set(pledgeNow.map((p) => p.id)), ctx.to);
  const redeemedInPeriod = redemptionRows.filter((x) => within(x.date, period));

  /* -------------------------------- requisitions ------------------------------ */
  const reqValue = (r: (typeof requests)[number]) => sum(r.products.map((p) => p.unitPrice * p.quantity));
  const isGhs = (c: string | null | undefined) => !c || c.toUpperCase() === "GHS";
  const ghsRequests = requests.filter((r) => isGhs(r.currency));
  const otherCurrency = requests.length - ghsRequests.length;
  // Disbursed requisitions were approved first.
  const approvedReqs = requests.filter(
    (r) =>
      r.request_approval_status === RequestApprovalStatus.APPROVED ||
      r.request_approval_status === RequestApprovalStatus.DISBURSED,
  );
  const rejectedReqs = requests.filter((r) => r.request_approval_status === RequestApprovalStatus.REJECTED);
  const approveDays = approvedReqs
    .map((r) => {
      const acted = r.approval_instances.map((i) => i.acted_at?.getTime() || 0).filter(Boolean);
      return r.submitted_at && acted.length ? (Math.max(...acted) - r.submitted_at.getTime()) / DAY : null;
    })
    .filter((d): d is number => d !== null && d >= 0);
  const medianApprove = median(approveDays);
  const stuck = pendingRequests.filter((r) => {
    const start = r.submitted_at || r.requisition_date;
    return start && (ctx.now.getTime() - start.getTime()) / DAY > WAITING_DAYS;
  });
  const stuckDepts = [...new Set(stuck.map((r) => r.department?.name).filter(Boolean))] as string[];

  /* ---------------------------------- empty ---------------------------------- */
  const empty =
    periodRecords.length === 0 &&
    givingNow.length === 0 &&
    attNow.settled === 0 &&
    redeemedInPeriod.length === 0 &&
    requests.length === 0;
  if (empty) {
    return {
      body: { ...emptyBody(), empty: true, headline: [0, 2] },
      facts: { total_income: null, total_spending: null, online_giving: null },
    };
  }

  /* ----------------------------------- KPIs ---------------------------------- */
  const recPrev = (v: number) => (hasPrevRecords ? v : null);
  const recYoy = (v: number) => (hasYoyRecords ? v : null);
  const kpis = [
    kpi("total_income", "Total income", cur.n ? cur.income : null, {
      format: "ghs",
      prev: recPrev(prev.income),
      yoy: recYoy(yoy.income),
      spark: trendTotals.map((t) => t.income),
      sub: cur.n ? `From ${plural(cur.n, "weekly record")}` : "No weekly records counted",
      provisional,
    }),
    kpi("total_spending", "Total spending", cur.n ? cur.spending : null, {
      format: "ghs",
      prev: recPrev(prev.spending),
      yoy: recYoy(yoy.spending),
      good: "down",
      spark: trendTotals.map((t) => t.spending),
      provisional,
    }),
    kpi("surplus", "Surplus", cur.n ? cur.surplus : null, {
      format: "ghs",
      prev: recPrev(prev.surplus),
      yoy: recYoy(yoy.surplus),
      spark: trendTotals.map((t) => t.surplus),
      sub: "Income less tithe and spending",
      provisional,
    }),
    kpi("tithe_remitted", "Tithe remitted", cur.n ? cur.tithe : null, {
      format: "ghs",
      prev: recPrev(prev.tithe),
      yoy: recYoy(yoy.tithe),
      good: null,
      spark: trendTotals.map((t) => t.tithe),
      sub: cur.income > 0 ? `${nf(round1(pctOf(cur.tithe, cur.income)))}% of total income` : null,
      provisional,
    }),
    kpi("online_giving", "Online giving", online, {
      format: "ghs",
      prev: onlinePrev,
      yoy: onlineYoy,
      spark: ctx.trend.map((b) => givingSum(b)),
      sub: givers ? `From ${plural(givers, "giver")}` : "No online gifts",
    }),
    kpi("pledges_redeemed", "Pledges redeemed", pledgePct, {
      format: "pct",
      prev: redemptionPct(ctx.prev),
      yoy: redemptionPct(ctx.yoy),
      spark: ctx.trend.map((b) => redemptionPct(b) ?? 0),
      sub: pledgedNow > 0 ? "Paid against pledged" : "No live pledge campaigns",
    }),
  ];

  /* ---------------------------------- flags ---------------------------------- */
  const flags: FlagDTO[] = [];
  const branchName = (id: number | null) => ctx.branches.find((b) => b.id === id)?.name || null;
  const showBranch = ctx.branchId === null && ctx.branches.length > 1;
  const recName = (r: WeekRecord) =>
    `${r.legacyMonth ? "The" : `The ${r.week.toLowerCase()}`} record (${r.rangeLabel})${showBranch && branchName(r.branchId) ? ` for ${branchName(r.branchId)}` : ""}`;

  if (pendingRecs.length > 2) {
    flags.push(flag("act", `${pendingRecs.length} weekly records are waiting for approval`, "Open Finance Manager", "/home/finance"));
  } else {
    pendingRecs.forEach((r) =>
      flags.push(flag("act", `${recName(r)} has not been approved yet`, "Open weekly record", `/home/finance/${r.id}`)),
    );
  }
  if (draftRecs.length > 2) {
    flags.push(flag("watch", `${draftRecs.length} weekly records are still drafts and are left out of the totals`, "Open Finance Manager", "/home/finance"));
  } else {
    draftRecs.forEach((r) =>
      flags.push(
        flag(
          "watch",
          `${recName(r)} is still a draft${r.returned ? " after being returned" : ""} and is left out of the totals`,
          "Open weekly record",
          `/home/finance/${r.id}`,
        ),
      ),
    );
  }

  // Weeks that have ended with no record, for branches that keep weekly records.
  const scopeBranches =
    ctx.branchId !== null
      ? [{ id: ctx.branchId, name: branchName(ctx.branchId) || "" }]
      : ctx.branches;
  const missing: { branch: string; weeks: string[] }[] = [];
  scopeBranches.forEach((b) => {
    const mine = records.filter((r) => r.branchId === b.id);
    if (!mine.length || mine.some((r) => r.legacyMonth && within(r.date, period))) return;
    const gaps = ctx.weeks
      .map((w) => ({ from: w.from < ctx.from ? ctx.from : w.from, to: w.to > ctx.to ? ctx.to : w.to }))
      .filter((w) => w.to <= ctx.now && w.from < w.to)
      .filter((w) => !mine.some((r) => within(r.date, w)))
      .map((w) => shortDate(w.from));
    if (gaps.length) missing.push({ branch: b.name, weeks: gaps });
  });
  if (missing.length) {
    const weeks = sum(missing.map((m) => m.weeks.length));
    const where = showBranch ? ` (${missing.map((m) => m.branch).join(", ")})` : "";
    const which = missing.length === 1 && weeks <= 3 ? `: weeks of ${missing[0].weeks.join(", ")}` : "";
    flags.push(flag("watch", `${plural(weeks, "week")} ${weeks === 1 ? "has" : "have"} no weekly record yet${where}${which}`, "Open Finance Manager", "/home/finance"));
  }

  // Pledge campaigns behind with the deadline near.
  const ref = new Date(Math.min(ctx.to.getTime(), ctx.now.getTime()));
  const campaigns = pledgeNow.map((p) => {
    const raised = redeemedBy(new Set([p.id]), ctx.to);
    const target = p.target && p.target > 0 ? p.target : p.pledged;
    const pct = target > 0 ? pctOf(raised, target) : null;
    const weeksLeft = p.deadline && p.deadline > ref ? Math.ceil((p.deadline.getTime() - ref.getTime()) / (7 * DAY)) : null;
    const behind = pct !== null && weeksLeft !== null && weeksLeft <= 12 && pct < 75;
    return { ...p, raised, target, pct, weeksLeft, behind };
  });
  campaigns
    .filter((c) => c.behind)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .slice(0, 2)
    .forEach((c) =>
      flags.push(
        flag(
          (c.weeksLeft ?? 99) <= 4 && (c.pct ?? 0) < 50 ? "act" : "watch",
          `${c.title} is at ${Math.round(c.pct ?? 0)}% with ${plural(c.weeksLeft ?? 0, "week")} to the deadline`,
          "View pledge campaign",
          `/home/finance/pledges/${c.id}`,
        ),
      ),
    );

  if (stuck.length) {
    flags.push(
      flag(
        "watch",
        `${plural(stuck.length, "requisition")} ${stuck.length === 1 ? "has" : "have"} waited more than ${WAITING_DAYS} days for approval`,
        "View requisitions",
        "/home/requests/staff_requests",
      ),
    );
  }

  if (
    attNow.failRate !== null &&
    attNow.settled >= 20 &&
    attNow.failRate >= 3 &&
    attPrev.failRate !== null &&
    attNow.failRate - attPrev.failRate >= 1.5
  ) {
    flags.push(
      flag(
        "watch",
        `Failed online payments rose to ${nf(attNow.failRate)}% from ${nf(attPrev.failRate)}%`,
        "View failed payments",
        "/home/finance/giving-contributions",
      ),
    );
  }
  const sortedFlags = sortFlags(flags);

  /* ------------------------------ income/spending ------------------------------ */
  const groupLines = (recs: WeekRecord[], pick: (r: WeekRecord) => Line[]) => {
    const m = new Map<string, { label: string; value: number }>();
    recs.forEach((r) =>
      pick(r).forEach((l) => {
        const e = m.get(l.key) || { label: l.item, value: 0 };
        e.value += l.amount;
        m.set(l.key, e);
      }),
    );
    return m;
  };
  const countedNow = counted(period);
  const countedPrev = counted(ctx.prev);
  const incomeNow = groupLines(countedNow, (r) => r.receipts);
  const incomePrev = groupLines(countedPrev, (r) => r.receipts);
  const spendNow = groupLines(countedNow, (r) => r.payments);
  const spendPrev = groupLines(countedPrev, (r) => r.payments);
  const topRows = (now: Map<string, { label: string; value: number }>, before: Map<string, { label: string; value: number }>, withChange: boolean) => {
    const all = [...now.entries()].filter(([, v]) => v.value > 0).sort((a, b) => b[1].value - a[1].value);
    const head = all.slice(0, 7);
    const rest = all.slice(7);
    const rows = head.map(([key, v]) => ({
      label: v.label,
      value: v.value,
      display: ghs(v.value) + (withChange && hasPrevRecords ? changeTag(v.value, before.get(key)?.value || 0) : ""),
    }));
    if (rest.length) {
      const value = sum(rest.map(([, v]) => v.value));
      rows.push({ label: `Other (${rest.length} lines)`, value, display: ghs(value) });
    }
    return rows;
  };
  const incomeRows = topRows(incomeNow, incomePrev, true);
  const spendRows = topRows(spendNow, spendPrev, true);

  /* ------------------------------ fund allocation ------------------------------ */
  type Cfg = { id: string; name: string; percentage: number | null; branch_id: number | null };
  const cfgFor = (cfg: Cfg[], branchId: number | null) => {
    const own = cfg.filter((c) => c.branch_id !== null && c.branch_id === branchId);
    return own.length ? own : cfg.filter((c) => c.branch_id === null);
  };
  const funds = new Map<string, { label: string; kind: string; share: Set<number>; required: number; setAside: number }>();
  const addFund = (kind: string, c: Cfg, required: number, setAside: number) => {
    const key = `${kind}:${keyOf(c.name)}`;
    const e = funds.get(key) || { label: c.name, kind, share: new Set<number>(), required: 0, setAside: 0 };
    e.share.add(round1(asPercent(c.percentage)));
    e.required += required;
    e.setAside += setAside;
    funds.set(key, e);
  };
  const matchLine = (lines: Line[], c: Cfg) =>
    lines.find((l) => l.configId === c.id) || lines.find((l) => l.key === keyOf(c.name));
  countedNow.forEach((r) => {
    cfgFor(titheConfig as Cfg[], r.branchId).forEach((c) =>
      addFund("Tithe", c, r.T * ratio(c.percentage), matchLine(r.tithe, c)?.amount || 0),
    );
    cfgFor(fundConfig as Cfg[], r.branchId).forEach((c) =>
      addFund("Fund", c, Math.max(r.fin, 0) * ratio(c.percentage), matchLine(r.alloc, c)?.amount || 0),
    );
  });
  const fundList = [...funds.values()].filter((f) => f.required !== 0 || f.setAside !== 0);
  const short = fundList.filter((f) => f.required - f.setAside >= 1);
  const fundRows: { cells: TableCell[]; keys?: (string | number)[] }[] = fundList.map((f) => {
    const gap = f.required - f.setAside;
    const shares = [...f.share];
    return {
      cells: [
        { text: f.label, sub: f.kind === "Tithe" ? "Tithe breakdown" : "Fund account", bold: true },
        shares.length === 1 ? `${nf(shares[0])}%` : "Varies",
        ghs(f.required),
        ghs(f.setAside),
        { pill: gap >= 1 ? pill("warning", `${ghs(gap)} short`) : pill("success", "✓ Met") },
      ],
      keys: [f.label, shares[0] ?? 0, f.required, f.setAside, gap],
    };
  });

  /* --------------------------------- sections -------------------------------- */
  const sections: SectionDTO[] = [];
  sections.push(
    bars(
      "income-spending",
      "Income and spending",
      ctx.periodType === "WEEKLY" ? "Each week, with surplus as a line" : ctx.periodType === "ANNUAL" ? "Each year, with surplus as a line" : ctx.periodType === "QUARTERLY" ? "Each quarter, with surplus as a line" : "Each month, with surplus as a line",
      ctx.trend.map((b) => b.label),
      [
        { name: "Income", color: NV, values: trendTotals.map((t) => Math.round(t.income)) },
        { name: "Spending", color: BZ, values: trendTotals.map((t) => Math.round(t.spending)) },
      ],
      {
        stack: false,
        full: true,
        money: true,
        line: { name: "Surplus", color: GN, values: trendTotals.map((t) => Math.round(t.surplus)) },
        note: provisional ? "Includes weekly records still waiting for approval. Drafts are left out." : undefined,
      },
    ),
  );
  if (incomeRows.length) {
    sections.push(
      hbars("income-sources", "Income by source", hasPrevRecords ? `Receipt lines. Change against ${ctx.prev.label} in brackets` : "Receipt lines from the weekly records", incomeRows, { money: true }),
    );
  }
  if (spendRows.length) {
    sections.push(hbars("spending-lines", "Spending by payment line", hasPrevRecords ? `Change against ${ctx.prev.label} in brackets` : "", spendRows, { money: true, color: BZ }));
  }
  if (fundRows.length) {
    sections.push(
      table(
        "funds",
        "Fund allocation",
        "Required portion against what was set aside",
        [
          ["Fund", "minmax(170px,1.4fr)"],
          ["Share", "80px", "right"],
          ["Required", "130px", "right"],
          ["Set aside", "130px", "right"],
          ["Status", "150px"],
        ],
        fundRows,
        {
          minWidth: "620px",
          note: "Required applies today's Finance configuration to each week counted. Set aside is what each weekly record allocated. Fund shares come from the balance after tithe, spending and reserves.",
        },
      ),
    );
  }
  if (online > 0 || attNow.settled > 0) {
    sections.push(
      segments(
        "online-giving",
        "Online giving",
        "By channel and payment outcome",
        [
          {
            label: "By channel",
            parts: [...byChannel.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, value], i) => ({ label, value, color: [NV, BZ, MG, AM, GN][i % 5], display: ghs(value) })),
          },
          {
            label: "Payment attempts",
            parts: [
              { label: "Successful", value: attNow.success, color: GN },
              { label: "Failed", value: attNow.failed, color: RD },
              { label: "Abandoned", value: attNow.abandoned, color: MG },
            ],
          },
        ],
        {
          note: `Fees paid to the payment provider: ${ghs(fees)}, paid by givers on top of their gifts. Line-level detail is in Finance › Giving contributions.`,
        },
      ),
    );
  }
  if (campaigns.length) {
    const sorted = campaigns
      .slice()
      .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity))
      .slice(0, 8);
    sections.push(
      hbars(
        "pledges",
        "Pledge campaigns",
        "Raised against target",
        sorted.map((c) => ({
          label: c.title,
          value: c.raised,
          display: c.target > 0 ? `${ghs(c.raised)} of ${ghs(c.target).replace("GH₵ ", "")}` : ghs(c.raised),
          color: c.behind ? AM : (c.pct ?? 0) >= 80 ? GN : NV,
          sub: `${c.deadline ? `Deadline ${c.deadline.getUTCFullYear() === ctx.to.getUTCFullYear() ? shortDate(c.deadline) : `${shortDate(c.deadline)} ${c.deadline.getUTCFullYear()}`}` : "No deadline"}${c.pct !== null ? ` · ${Math.round(c.pct)}% raised` : ""}`,
          max: c.target > 0 ? c.target : undefined,
        })),
        { note: campaigns.length > 8 ? `Showing 8 of ${campaigns.length} live campaigns.` : "Target is the campaign target, or the total pledged when no target is set." },
      ),
    );
  }
  if (requests.length || stuck.length) {
    sections.push(
      stats(
        "requisitions",
        "Requisitions",
        "Spend requests submitted in the period",
        [
          { label: "Submitted", value: ghs(sum(ghsRequests.map(reqValue))), sub: plural(requests.length, "request") },
          {
            label: "Approved",
            value: ghs(sum(approvedReqs.filter((r) => isGhs(r.currency)).map(reqValue))),
            sub: `${nf(approvedReqs.length)} approved · ${nf(rejectedReqs.length)} rejected`,
          },
          { label: "Median time to approve", value: medianApprove === null ? "—" : plural(round1(medianApprove), "day") },
          {
            label: `Waiting over ${WAITING_DAYS} days`,
            value: nf(stuck.length),
            sub: stuckDepts.length ? stuckDepts.slice(0, 3).join(", ") + (stuckDepts.length > 3 ? ` +${stuckDepts.length - 3}` : "") : "As of today",
            color: stuck.length ? AM : undefined,
          },
        ],
        otherCurrency ? { note: `${plural(otherCurrency, "request")} in other currencies are counted but not included in the amounts.` } : {},
      ),
    );
  }

  const userIds = [...new Set(periodRecords.flatMap((r) => [r.approvedBy, r.submittedBy, r.createdBy]).filter((x): x is number => !!x))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: number | null) => (id ? users.find((u) => u.id === id)?.name || null : null);
  if (periodRecords.length) {
    sections.push(
      list(
        "weekly-records",
        "Weekly records",
        "Approval status of each week",
        periodRecords.map((r) => {
          const by =
            r.status === "APPROVED"
              ? nameOf(r.approvedBy) ? `Approved by ${nameOf(r.approvedBy)}` : "Approved"
              : r.status === "PENDING_APPROVAL"
                ? `Submitted${nameOf(r.submittedBy) ? ` by ${nameOf(r.submittedBy)}` : ""}${r.submittedAt ? ` on ${shortDate(r.submittedAt)}` : ""}`
                : `${r.returned ? "Returned for changes" : "Draft"}${nameOf(r.createdBy) ? ` · started by ${nameOf(r.createdBy)}` : ""}`;
          const branch = showBranch ? branchName(r.branchId) : null;
          return {
            title: `${r.legacyMonth ? "Month" : r.week} · ${r.rangeLabel}`,
            sub: branch ? `${branch} · ${by}` : by,
            pill:
              r.status === "APPROVED"
                ? pill("success", "Approved")
                : r.status === "PENDING_APPROVAL"
                  ? pill("warning", "Pending approval")
                  : r.returned
                    ? pill("danger", "Returned")
                    : pill("neutral", "Draft"),
            right: r.counted ? ghs(r.R) : undefined,
          };
        }),
      ),
    );
  }

  /* -------------------------------- highlights -------------------------------- */
  const highlights: string[] = [];
  if (cur.income > 0) {
    const top = incomeRows[0];
    highlights.push(
      `Income was ${ghs(cur.income)}${hasPrevRecords ? changeWords(cur.income, prev.income, ctx.prev.label) : ""}.${top ? ` ${top.label} made up ${Math.round(pctOf(top.value, cur.income))}%.` : ""}`,
    );
  }
  if (cur.spending > 0) {
    const top = spendRows[0];
    highlights.push(
      `Spending was ${ghs(cur.spending)}${hasPrevRecords ? changeWords(cur.spending, prev.spending, ctx.prev.label) : ""}${top ? `, mostly ${top.label.toLowerCase()} (${ghs(top.value)})` : ""}.`,
    );
  }
  if (online > 0) {
    highlights.push(
      `Online giving brought in ${ghs(online)} from ${plural(givers, "giver")}${changeWords(online, onlinePrev, ctx.prev.label)}.`,
    );
  }
  if (fundList.length && highlights.length < 4) {
    highlights.push(
      short.length === 0
        ? "Every required allocation was met."
        : short.length === 1
          ? `All required allocations were met except ${short[0].label}, which is ${ghs(short[0].required - short[0].setAside)} short.`
          : `${short.length} allocations are short of what configuration requires, ${ghs(sum(short.map((f) => f.required - f.setAside)))} in all.`,
    );
  }
  if (highlights.length < 2 && pledgePct !== null) {
    highlights.push(`${Math.round(pledgePct)}% of the ${ghs(pledgedNow)} pledged to live campaigns has been paid (${ghs(redeemedNow)}).`);
  }

  /* --------------------------------- by branch -------------------------------- */
  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "finance",
      ["Income", "Spending", "Surplus", "Online giving"],
      ctx.branches.map((b) => {
        const recs = countedNow.filter((r) => r.branchId === b.id);
        const inc = sum(recs.map((r) => r.R));
        const sp = sum(recs.map((r) => r.P));
        const t = sum(recs.map((r) => r.T));
        const og = sum(givingNow.filter((g) => g.branch_id === b.id).map((g) => g.amount)) / 100;
        return {
          branch: b.name,
          values: recs.length ? [ghs(inc), ghs(sp), ghs(inc - t - sp), ghs(og)] : ["—", "—", "—", ghs(og)],
        };
      }),
    );
  }

  const notApproved = pendingRecs.length + draftRecs.length;
  const noteParts = [
    pendingRecs.length ? `${nf(pendingRecs.length)} waiting for approval and counted` : "",
    draftRecs.length ? `${nf(draftRecs.length)} ${draftRecs.length === 1 ? "draft" : "drafts"} left out` : "",
  ].filter(Boolean);
  const provisional_note = provisional
    ? `${plural(notApproved, "weekly record")} in this period ${notApproved === 1 ? "is" : "are"} not approved yet (${noteParts.join("; ")}). Income, spending, surplus and tithe may change.`
    : null;

  return {
    body: {
      ...emptyBody(),
      kpis,
      flags: sortedFlags,
      highlights: highlights.slice(0, 4),
      sections,
      by_branch,
      headline: [0, 2],
      health: healthOf(sortedFlags),
      provisional_note,
      empty: false,
    },
    facts: {
      total_income: cur.n ? cur.income : null,
      total_spending: cur.n ? cur.spending : null,
      online_giving: online,
    },
  };
};
