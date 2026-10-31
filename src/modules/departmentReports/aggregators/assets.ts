/**
 * Assets report: the register as it stood at the end of the period.
 *
 * Sources: `assets` (status, status_since, price, category, department,
 * purchase date, repair requisition link), `asset_history` (status changes,
 * used to rebuild an asset's status at an earlier date) and closed
 * `asset_stock_check` rounds with their items.
 *
 * Status at a date: when the asset's current status started before that date
 * it is exact; otherwise the last recorded status change before the date is
 * used. Assets with neither are left out of status counts rather than guessed.
 * Departments, categories and repair requisitions are only stored as they are
 * now, so the department and category splits use today's values.
 *
 * Dropped or changed from the design:
 * - "Assigned to a person": assets are assigned to departments, not people, so
 *   the KPI is "Assigned to a department".
 * - Per-department "not counted at the stock check": closing a check requires
 *   every item to be counted or marked not found, so the flag reports items
 *   the latest check could not find instead.
 * - Replacement estimates: there is no replacement cost or useful-life field.
 *   "Due for replacement" lists beyond-repair and over-8-year-old items with
 *   what they cost when bought.
 * - Repairs "fixed this period" (the mock's "after the sound desk ... were
 *   fixed"): only counts are compared; repair outcomes aren't stored per item.
 */
import { Prisma, RequestApprovalStatus, asset_stock_check_status, asset_status } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { ASSET_CATEGORIES, STATUS_LABEL } from "../../assets/asset-redesign";
import { longDate } from "../period";
import {
  AM,
  BL,
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
  inRange,
  kpi,
  list,
  nf,
  pctOf,
  pill,
  segments,
  sortFlags,
  stats,
  sum,
  sumPerBucket,
  table,
} from "../sections";
import { FlagDTO, PeriodType, ReportBuilder, SectionDTO } from "../types";

const DAY = 86_400_000;
/** Repairs open longer than this are stale and need action. */
const REPAIR_ACT_DAYS = 60;
/** Same threshold the register uses for "Needs your attention". */
const REPAIR_WATCH_DAYS = 30;
const HIGH_VALUE = 10_000;
const OLD_YEARS = 8;
const MAX_CHECKS = 20;

const ASSETS_PATH = "/home/assets";
const RECON_PATH = "/home/assets/reconciliation";

const STATUS_ORDER: asset_status[] = [
  asset_status.ASSIGNED,
  asset_status.UNASSIGNED,
  asset_status.NEEDS_REPAIR,
  asset_status.OUT_OF_REPAIRS,
  asset_status.NOT_FIXABLE,
  asset_status.LOST_OR_STOLEN,
];
const STATUS_COLOR: Record<asset_status, string> = {
  ASSIGNED: GN,
  UNASSIGNED: BL,
  NEEDS_REPAIR: AM,
  OUT_OF_REPAIRS: BZ,
  NOT_FIXABLE: MG,
  LOST_OR_STOLEN: RD,
};
const IN_REPAIR: asset_status[] = [asset_status.NEEDS_REPAIR, asset_status.OUT_OF_REPAIRS];
const CATEGORY_LABEL = new Map(ASSET_CATEGORIES.map((c) => [c.key, c.label]));

const PERIOD_WORD: Record<PeriodType, string> = {
  WEEKLY: "this week",
  MONTHLY: "this month",
  QUARTERLY: "this quarter",
  ANNUAL: "this year",
  CUSTOM: "in this period",
};
const TREND_UNIT: Partial<Record<PeriodType, string>> = {
  WEEKLY: "week",
  MONTHLY: "month",
  QUARTERLY: "quarter",
  ANNUAL: "year",
};

const ASSET_SELECT = {
  id: true,
  name: true,
  status: true,
  price: true,
  category: true,
  branch_id: true,
  created_at: true,
  date_purchased: true,
  date_assigned: true,
  status_since: true,
  department_assigned: true,
  assigned_to: { select: { name: true } },
  repair_request: { select: { request_approval_status: true } },
} satisfies Prisma.assetsSelect;
type Asset = Prisma.assetsGetPayload<{ select: typeof ASSET_SELECT }>;

type HistoryEntry = { status: asset_status; at: Date };
type StatusAt = { status: asset_status; since: Date; current: boolean };

type CheckItem = {
  check_id: number;
  result: string | null;
  found_department_id: number | null;
  found_in_store: boolean;
  asset: { branch_id: number | null; price: number | null };
};
type Check = { id: number; name: string; closed_at: Date; branch_id: number | null };
type CheckStats = {
  check: Check;
  expected: number;
  counted: number;
  matched: number;
  notFound: number;
  notFoundValue: number;
  match: number;
};

const price = (a: { price: number | null }) => Number(a.price) || 0;
const sinceOf = (a: Asset) => a.status_since ?? a.date_assigned ?? a.date_purchased ?? a.created_at;
const days = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));
const plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;

const requisitionLabel = (a: Asset, current: boolean) => {
  if (!current) return "—";
  const s = a.repair_request?.request_approval_status;
  if (!s) return "Not raised";
  if (s === RequestApprovalStatus.APPROVED) return "Approved";
  if (s === RequestApprovalStatus.DISBURSED) return "Disbursed";
  if (s === RequestApprovalStatus.REJECTED) return "Rejected";
  if (s === RequestApprovalStatus.Draft) return "Draft";
  return "Pending approval";
};

/** Items are done when they have a result (and "elsewhere" says where). */
const isDone = (item: CheckItem) =>
  Boolean(item.result) &&
  !(item.result === "elsewhere" && !item.found_in_store && item.found_department_id === null);

export const buildAssets: ReportBuilder = async (ctx) => {
  const branchWhere = getBranchScopedWhere(ctx.branchId) || {};
  const scope: Prisma.assetsWhereInput = { ...branchWhere };
  const checkScope: Prisma.asset_stock_checkWhereInput =
    "branch_id" in branchWhere ? { OR: [{ branch_id: branchWhere.branch_id }, { branch_id: null }] } : {};

  const [assets, historyRows, checkRows] = await Promise.all([
    prisma.assets.findMany({ where: { ...scope, created_at: { lt: ctx.to } }, select: ASSET_SELECT }),
    prisma.asset_history.findMany({
      where: { status_update: { not: null }, update_date: { lt: ctx.to }, asset: { is: scope } },
      select: { asset_id: true, status_update: true, update_date: true },
      orderBy: [{ update_date: "asc" }, { id: "asc" }],
    }),
    prisma.asset_stock_check.findMany({
      where: { ...checkScope, status: asset_stock_check_status.CLOSED, closed_at: { lt: ctx.to } },
      select: { id: true, name: true, closed_at: true, branch_id: true },
      orderBy: [{ closed_at: "desc" }, { id: "desc" }],
      take: MAX_CHECKS,
    }),
  ]);

  if (!assets.length) {
    return {
      body: { ...emptyBody(), headline: [0, 2], empty: true },
      facts: { total_assets: 0, asset_value: 0, needs_repair: 0 },
    };
  }

  const checks: Check[] = checkRows
    .filter((c) => c.closed_at)
    .map((c) => ({ id: c.id, name: c.name, closed_at: c.closed_at as Date, branch_id: c.branch_id }));
  const items: CheckItem[] = checks.length
    ? await prisma.asset_stock_check_item.findMany({
        where: { check_id: { in: checks.map((c) => c.id) }, asset: { is: scope } },
        select: {
          check_id: true,
          result: true,
          found_department_id: true,
          found_in_store: true,
          asset: { select: { branch_id: true, price: true } },
        },
      })
    : [];

  /* ------------------------------ Status at a date ----------------------------- */

  const history = new Map<number, HistoryEntry[]>();
  historyRows.forEach((row) => {
    if (!row.asset_id || !row.status_update) return;
    const listFor = history.get(row.asset_id) || [];
    listFor.push({ status: row.status_update, at: row.update_date });
    history.set(row.asset_id, listFor);
  });

  const statusAt = (a: Asset, at: Date): StatusAt | null => {
    const since = sinceOf(a);
    if (since < at) return { status: a.status || asset_status.UNASSIGNED, since, current: true };
    const entries = history.get(a.id) || [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].at < at) return { status: entries[i].status, since: entries[i].at, current: false };
    }
    return null;
  };

  type Snapshot = {
    total: number;
    value: number;
    known: number;
    counts: Record<asset_status, number>;
    rows: { asset: Asset; st: StatusAt | null }[];
  };
  const snapshot = (at: Date, branchId?: number): Snapshot => {
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<asset_status, number>;
    const rows: Snapshot["rows"] = [];
    let value = 0;
    let known = 0;
    assets.forEach((a) => {
      if (a.created_at >= at) return;
      if (branchId !== undefined && a.branch_id !== branchId) return;
      const st = statusAt(a, at);
      rows.push({ asset: a, st });
      value += price(a);
      if (st) {
        counts[st.status] += 1;
        known += 1;
      }
    });
    return { total: rows.length, value, known, counts, rows };
  };
  const assignedShare = (s: Snapshot) => (s.known ? pctOf(s.counts.ASSIGNED, s.known) : null);

  /** Assets that became lost or stolen in [from, to). */
  const lostIn = (from: Date, to: Date, branchId?: number) => {
    const found: Asset[] = [];
    assets.forEach((a) => {
      if (branchId !== undefined && a.branch_id !== branchId) return;
      const viaHistory = (history.get(a.id) || []).some(
        (e) => e.status === asset_status.LOST_OR_STOLEN && inRange(e.at, from, to),
      );
      const viaStatus = a.status === asset_status.LOST_OR_STOLEN && inRange(sinceOf(a), from, to);
      if (viaHistory || viaStatus) found.push(a);
    });
    return found;
  };

  /* -------------------------------- Stock checks ------------------------------- */

  const itemsByCheck = new Map<number, CheckItem[]>();
  items.forEach((item) => itemsByCheck.set(item.check_id, [...(itemsByCheck.get(item.check_id) || []), item]));

  const checkStats = (check: Check, branchId?: number): CheckStats | null => {
    const rows = (itemsByCheck.get(check.id) || []).filter(
      (item) => branchId === undefined || item.asset.branch_id === branchId,
    );
    if (!rows.length) return null;
    const done = rows.filter(isDone);
    const matched = done.filter((i) => i.result === "found" || i.result === "atrepair").length;
    const missing = done.filter((i) => i.result === "missing");
    return {
      check,
      expected: rows.length,
      counted: done.length,
      matched,
      notFound: missing.length,
      notFoundValue: sum(missing.map((i) => price(i.asset))),
      match: pctOf(matched, rows.length),
    };
  };
  /** The latest check closed before `at` that covered any of these assets. */
  const latestCheck = (at: Date, branchId?: number): CheckStats | null => {
    for (const check of checks) {
      if (check.closed_at >= at) continue;
      if (branchId !== undefined && check.branch_id !== null && check.branch_id !== branchId) continue;
      const result = checkStats(check, branchId);
      if (result) return result;
    }
    return null;
  };

  /* ----------------------------------- KPIs ----------------------------------- */

  const end = ctx.to;
  const refEnd = ctx.to < ctx.now ? ctx.to : ctx.now;
  const cur = snapshot(end);
  const prev = snapshot(ctx.prev.to);
  const yoy = snapshot(ctx.yoy.to);
  const trendSnaps = ctx.trend.map((b) => snapshot(b.to));

  const lostNow = lostIn(ctx.from, ctx.to);
  const lostValue = sum(lostNow.map(price));
  const lostTrend = ctx.trend.map((b) => lostIn(b.from, b.to).length);

  const checkNow = latestCheck(end);
  const checkPrev = latestCheck(ctx.prev.to);
  const checkYoy = latestCheck(ctx.yoy.to);
  const checkTrend = ctx.trend.map((b) => latestCheck(b.to)?.match ?? null);
  // Same rule as assignedSpark: a spark must line up with ctx.trend, so it is
  // dropped rather than shortened when early buckets had no closed check.
  const checkSpark = checkTrend.every((v) => v !== null) ? (checkTrend as number[]) : [];

  const assignedNow = assignedShare(cur);
  const assignedSpark = trendSnaps.map(assignedShare);
  const needsRepair = cur.counts.NEEDS_REPAIR;
  const unknownNote = cur.total - cur.known;

  const kpis = [
    kpi("total_assets", "Total assets", cur.total, {
      prev: prev.total,
      yoy: yoy.total,
      good: null,
      spark: trendSnaps.map((s) => s.total),
      sub: `Worth ${ghs(cur.value)}`,
    }),
    kpi("assigned_share", "Assigned to a department", assignedNow, {
      format: "pct",
      prev: assignedShare(prev),
      yoy: assignedShare(yoy),
      good: "up",
      spark: assignedSpark.every((v) => v !== null) ? (assignedSpark as number[]) : [],
      sub: `${nf(cur.counts.ASSIGNED)} of ${nf(cur.known)} assets`,
    }),
    kpi("needs_repair", "Needs repair", cur.known ? needsRepair : null, {
      prev: prev.known ? prev.counts.NEEDS_REPAIR : null,
      yoy: yoy.known ? yoy.counts.NEEDS_REPAIR : null,
      good: "down",
      spark: trendSnaps.map((s) => s.counts.NEEDS_REPAIR),
      sub: cur.counts.OUT_OF_REPAIRS ? `${nf(cur.counts.OUT_OF_REPAIRS)} more under repair` : null,
    }),
    kpi("lost_or_stolen", "Lost or stolen", lostNow.length, {
      prev: lostIn(ctx.prev.from, ctx.prev.to).length,
      yoy: lostIn(ctx.yoy.from, ctx.yoy.to).length,
      good: "down",
      spark: lostTrend,
      sub: lostNow.length ? `Worth ${ghs(lostValue)}` : null,
    }),
    kpi("stock_check_match", "Stock-check match", checkNow ? checkNow.match : null, {
      format: "pct",
      prev: checkPrev?.match ?? null,
      yoy: checkYoy?.match ?? null,
      good: "up",
      spark: checkSpark,
      sub: checkNow ? `${checkNow.check.name} · ${longDate(checkNow.check.closed_at)}` : "No stock check closed yet",
    }),
  ];

  /* ------------------------------- Open repairs ------------------------------- */

  const refSnap = refEnd.getTime() === end.getTime() ? cur : snapshot(refEnd);
  const openRepairs = refSnap.rows
    .filter((r) => r.st && IN_REPAIR.includes(r.st.status))
    .map((r) => ({ asset: r.asset, st: r.st as StatusAt, open: days((r.st as StatusAt).since, refEnd) }))
    .sort((a, b) => b.open - a.open);
  const staleRepairs = openRepairs.filter((r) => r.open > REPAIR_ACT_DAYS);
  const noRequisition = openRepairs.filter(
    (r) =>
      r.st.current &&
      r.st.status === asset_status.NEEDS_REPAIR &&
      !r.asset.repair_request &&
      r.open > REPAIR_WATCH_DAYS &&
      r.open <= REPAIR_ACT_DAYS,
  );

  /* ----------------------------------- Flags ---------------------------------- */

  const flags: FlagDTO[] = [];
  if (staleRepairs.length) {
    flags.push(
      flag(
        "act",
        `${plural(staleRepairs.length, "repair has", "repairs have")} been open for more than ${REPAIR_ACT_DAYS} days`,
        "View assets",
        ASSETS_PATH,
      ),
    );
  }
  if (lostNow.length) {
    flags.push(
      flag(
        "act",
        `${plural(lostNow.length, "item was", "items were")} lost or stolen ${PERIOD_WORD[ctx.periodType]} (${ghs(lostValue)})`,
        "View assets",
        ASSETS_PATH,
      ),
    );
  }
  if (checkNow && inRange(checkNow.check.closed_at, ctx.from, ctx.to) && checkNow.notFound > 0) {
    flags.push(
      flag(
        "watch",
        `The ${checkNow.check.name} stock check could not find ${plural(checkNow.notFound, "item", "items")} (${ghs(checkNow.notFoundValue)})`,
        "View stock check",
        `${RECON_PATH}?check=${checkNow.check.id}`,
      ),
    );
  }
  const highValueStore = cur.rows.filter(
    (r) => r.st?.status === asset_status.UNASSIGNED && price(r.asset) > HIGH_VALUE,
  );
  if (highValueStore.length) {
    flags.push(
      flag(
        "watch",
        `${plural(highValueStore.length, "item", "items")} worth over ${ghs(HIGH_VALUE)} ${highValueStore.length === 1 ? "has" : "have"} no department assigned`,
        "View assets",
        ASSETS_PATH,
      ),
    );
  }
  if (noRequisition.length) {
    flags.push(
      flag(
        "watch",
        `${plural(noRequisition.length, "item has", "items have")} needed repair for over ${REPAIR_WATCH_DAYS} days with no repair requisition raised`,
        "View assets",
        ASSETS_PATH,
      ),
    );
  }
  const sortedFlags = sortFlags(flags);

  /* -------------------------------- Highlights -------------------------------- */

  const highlights: string[] = [];
  highlights.push(
    `${plural(cur.total, "asset", "assets")} worth ${ghs(cur.value)} ${cur.total === 1 ? "is" : "are"} on the register` +
      (assignedNow !== null ? `, and ${Math.round(assignedNow)}% are assigned to a department.` : "."),
  );
  {
    const repairWords = changeWords(needsRepair, prev.known ? prev.counts.NEEDS_REPAIR : null, ctx.prev.label);
    const under = cur.counts.OUT_OF_REPAIRS;
    highlights.push(
      needsRepair || under
        ? `${plural(needsRepair, "item needs", "items need")} repair${repairWords}` +
            (under ? `, and ${nf(under)} ${under === 1 ? "is" : "are"} out for repair.` : ".")
        : "Nothing on the register is waiting for repair.",
    );
  }
  if (checkNow && inRange(checkNow.check.closed_at, ctx.from, ctx.to)) {
    highlights.push(
      `The ${checkNow.check.name} stock check matched ${checkNow.match}% of items.` +
        (checkNow.notFound ? ` ${ghs(checkNow.notFoundValue)} worth was not found.` : " Nothing was missing."),
    );
  }
  if (lostNow.length) {
    const unit = TREND_UNIT[ctx.periodType];
    const earlier = lostTrend.slice(0, -1);
    const most = unit && earlier.length && lostNow.length > Math.max(...earlier);
    highlights.push(
      `${plural(lostNow.length, "item was", "items were")} reported lost or stolen` +
        (most ? `, the most in any ${unit} of the last ${lostTrend.length}.` : "."),
    );
  }
  const purchasesNow = assets.filter((a) => inRange(a.date_purchased, ctx.from, ctx.to));
  if (highlights.length < 4 && purchasesNow.length) {
    const spend = sum(purchasesNow.map(price));
    const prevSpend = sum(assets.filter((a) => inRange(a.date_purchased, ctx.prev.from, ctx.prev.to)).map(price));
    highlights.push(
      `${ghs(spend)} was spent on ${plural(purchasesNow.length, "new asset", "new assets")}${changeWords(spend, prevSpend, ctx.prev.label)}.`,
    );
  }

  /* --------------------------------- Sections --------------------------------- */

  const sections: SectionDTO[] = [];
  sections.push(
    segments(
      "asset-health",
      "Asset health",
      "Every asset by status at the end of the period",
      [
        {
          parts: STATUS_ORDER.map((s) => ({
            label: STATUS_LABEL[s],
            value: cur.counts[s],
            color: STATUS_COLOR[s],
          })),
        },
      ],
      {
        full: true,
        note: unknownNote
          ? `${plural(unknownNote, "asset has", "assets have")} no recorded status for this date and ${unknownNote === 1 ? "is" : "are"} left out.`
          : undefined,
      },
    ),
  );

  const groupValue = (keyOf: (a: Asset) => string) => {
    const map = new Map<string, number>();
    cur.rows.forEach(({ asset }) => map.set(keyOf(asset), (map.get(keyOf(asset)) || 0) + price(asset)));
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  };
  const topWithOther = (rows: { label: string; value: number }[], top: number) =>
    rows.length <= top
      ? rows
      : [...rows.slice(0, top - 1), { label: "Other", value: sum(rows.slice(top - 1).map((r) => r.value)) }];

  const byDept = topWithOther(groupValue((a) => a.assigned_to?.name || "In store"), 8);
  if (byDept.length) {
    sections.push(
      hbars("value-by-department", "Value by department", "What the register cost, by the department holding it", byDept, {
        money: true,
        note: "Uses each asset's current department.",
      }),
    );
  }
  const byCategory = groupValue((a) => CATEGORY_LABEL.get(a.category || "") || "Other");
  if (byCategory.length) {
    sections.push(hbars("value-by-category", "Value by category", "What the register cost, by category", byCategory, { money: true }));
  }

  if (openRepairs.length) {
    const shown = openRepairs.slice(0, 25);
    sections.push(
      table(
        "open-repairs",
        "Open repairs",
        `Oldest first. Over ${REPAIR_ACT_DAYS} days counts as stale.`,
        [
          ["Item", "minmax(200px,1.6fr)"],
          ["Department", "150px"],
          ["Status", "130px"],
          ["Open for", "100px", "right"],
          ["Requisition", "140px"],
        ],
        shown.map(({ asset, st, open }) => {
          const dept = asset.assigned_to?.name || "Store";
          const status = STATUS_LABEL[st.status];
          const req = requisitionLabel(asset, st.current);
          return {
            cells: [
              { text: asset.name, bold: true },
              dept,
              status,
              {
                pill:
                  open > REPAIR_ACT_DAYS
                    ? pill("danger", `${open} days`)
                    : open > REPAIR_WATCH_DAYS
                      ? pill("warning", `${open} days`)
                      : pill("neutral", `${open} days`),
              },
              req,
            ],
            keys: [asset.name, dept, status, open, req],
          };
        }),
        {
          full: true,
          sortable: true,
          minWidth: "760px",
          note:
            openRepairs.length > shown.length
              ? `Showing the ${shown.length} oldest of ${nf(openRepairs.length)} open repairs.`
              : undefined,
        },
      ),
    );
  }

  if (checkNow) {
    sections.push(
      stats("stock-check", "Stock check", `${checkNow.check.name} · closed ${longDate(checkNow.check.closed_at)}`, [
        { label: "Expected", value: nf(checkNow.expected) },
        { label: "Counted", value: nf(checkNow.counted) },
        { label: "Matched", value: nf(checkNow.matched), sub: `${checkNow.match}%`, color: GN },
        { label: "Not found", value: nf(checkNow.notFound), sub: ghs(checkNow.notFoundValue), color: RD },
      ]),
    );
  }

  const yearsAt = (d: Date) => (refEnd.getTime() - d.getTime()) / (365.25 * DAY);
  const dated = cur.rows.filter((r) => r.asset.date_purchased);
  if (dated.length) {
    const ages = dated.map((r) => yearsAt(r.asset.date_purchased as Date));
    const bands: { label: string; test: (y: number) => boolean; color?: string }[] = [
      { label: "Under 2 years", test: (y) => y < 2 },
      { label: "2 to 5 years", test: (y) => y >= 2 && y < 5 },
      { label: "5 to 8 years", test: (y) => y >= 5 && y < OLD_YEARS },
      { label: `Over ${OLD_YEARS} years`, test: (y) => y >= OLD_YEARS, color: AM },
    ];
    const missingDates = cur.total - dated.length;
    sections.push(
      hbars(
        "asset-age",
        "Asset age",
        "Years since purchase",
        bands.map((b) => ({ label: b.label, value: ages.filter(b.test).length, color: b.color })),
        { note: missingDates ? `${plural(missingDates, "asset has", "assets have")} no purchase date.` : undefined },
      ),
    );
  }

  const replacement = cur.rows
    .filter(
      (r) =>
        r.st?.status !== asset_status.LOST_OR_STOLEN &&
        (r.st?.status === asset_status.NOT_FIXABLE ||
          (r.asset.date_purchased && yearsAt(r.asset.date_purchased) >= OLD_YEARS)),
    )
    .map((r) => ({
      asset: r.asset,
      beyond: r.st?.status === asset_status.NOT_FIXABLE,
      years: r.asset.date_purchased ? Math.floor(yearsAt(r.asset.date_purchased)) : null,
    }))
    .sort((a, b) => Number(b.beyond) - Number(a.beyond) || (b.years ?? 0) - (a.years ?? 0) || price(b.asset) - price(a.asset))
    .slice(0, 6);
  if (replacement.length) {
    sections.push(
      list(
        "due-for-replacement",
        "Due for replacement",
        "Beyond-repair and ageing items to plan for. Amounts are what they cost when bought.",
        replacement.map(({ asset, beyond, years }) => ({
          title: asset.name,
          sub: [asset.assigned_to?.name || "Store", years !== null ? `${years} years old` : null]
            .filter(Boolean)
            .join(" · "),
          pill: beyond ? pill("danger", "Beyond repair") : undefined,
          right: ghs(price(asset)),
        })),
      ),
    );
  }

  const purchaseTrend = sumPerBucket(assets, ctx.trend, (a) => a.date_purchased, price);
  if (purchaseTrend.some((v) => v > 0)) {
    const unit = TREND_UNIT[ctx.periodType] || "period";
    sections.push(
      bars(
        "new-purchases",
        "New purchases",
        `Spend on new assets each ${unit}`,
        ctx.trend.map((b) => b.label),
        [{ name: "Spend", color: NV, values: purchaseTrend }],
        { money: true },
      ),
    );
  }

  /* --------------------------------- By branch -------------------------------- */

  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "assets",
      ["Assets", "Value", "Needs repair", "Stock-check match"],
      ctx.branches.map((b) => {
        const snap = snapshot(end, b.id);
        const check = latestCheck(end, b.id);
        return {
          branch: b.name,
          values: [snap.total, ghs(snap.value), snap.counts.NEEDS_REPAIR, check ? `${check.match}%` : "—"],
        };
      }),
    );
  }

  return {
    body: {
      kpis,
      flags: sortedFlags,
      highlights: highlights.slice(0, 4),
      sections,
      by_branch,
      headline: [0, 2],
      health: healthOf(sortedFlags),
      provisional_note: null,
      empty: false,
    },
    facts: {
      total_assets: cur.total,
      asset_value: cur.value,
      needs_repair: cur.known ? needsRepair : null,
    },
  };
};
