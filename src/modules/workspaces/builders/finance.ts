/**
 * Finance workspace: "Where is the money, and what's waiting on me?"
 *
 * Definitions
 * - Giving = receipt lines of weekly records (`financials`) dated in the range,
 *   drafts left out (same rule as the Finance department report).
 * - Online giving = successful GHS giving contributions by `paid_at`, in major units.
 * - Pledge fulfilment = redeemed / pledged for campaigns live in the period
 *   (created before its end, deadline not before its start); delta in points.
 * - Requisitions approved = value (items × unit price, GHS only) of requisitions
 *   whose final approval falls in the range (last step decision, else
 *   `ps_approval_date`, else `updated_at`).
 * - Overdue pledges = pledgers with an unpaid balance on a campaign whose
 *   deadline has passed.
 */
import { RequestApprovalStatus } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere, getRelationBranchScopedWhere } from "../../branches/branchService";
import { switchedOffEverywhere } from "../access";
import type { BarRow, Kpi, NeedsItem, QueueItem, WorkspaceBuilder, WorkspaceContext } from "../types";
import { deltaPct, runWidgets, trailingPeriods } from "../widgetKit";
import {
  channelLabel,
  loadWeeklyRecords,
  parseWeeklyRecord,
  scopedBranches,
  weeklyRecordSelect,
  type WeeklyRecord,
} from "../queries/financeQueries";
import {
  DAY,
  ghs,
  isGhs,
  isoDay,
  loadStepLookups,
  num,
  pctOf,
  requisitionQueueItem,
  requisitionReplyDays,
  requisitionSelect,
  requisitionValue,
  round1,
  shortDate,
  sum,
  within,
  type RequisitionRow,
} from "../queries/genericCommon";

type Period = { from: Date; to: Date };
type Entries = Parameters<typeof runWidgets>[1];

const topBars = (m: Map<string, { label: string; value: number }>, limit = 8): BarRow[] => {
  const all = [...m.values()].filter((v) => v.value > 0).sort((a, b) => b.value - a.value);
  const rows: BarRow[] = all.slice(0, limit).map((v) => ({ label: v.label, value: round1(v.value) }));
  const rest = all.slice(limit);
  if (rest.length) rows.push({ label: `Other (${rest.length})`, value: round1(sum(rest.map((v) => v.value))) });
  return rows;
};

const addTo = (m: Map<string, { label: string; value: number }>, key: string, label: string, value: number) => {
  const e = m.get(key) || { label, value: 0 };
  e.value += value;
  m.set(key, e);
};

/** APPROVED | PENDING_APPROVAL | DRAFT | RETURNED */
const recordStatus = (r: WeeklyRecord) => (r.status === "DRAFT" && r.returned ? "RETURNED" : r.status);

export const buildFinance: WorkspaceBuilder = async (ctx: WorkspaceContext) => {
  const { range } = ctx;
  const bw = getBranchScopedWhere(ctx.branchId) || {};
  const periods = trailingPeriods(range, 9);
  const windowFrom = periods[0].from < range.prevFrom ? periods[0].from : range.prevFrom;
  const cur: Period = { from: range.from, to: range.to };
  const prev: Period = { from: range.prevFrom, to: range.prevTo };
  const now = range.to;

  /* ---------- shared sources, loaded once and only when a widget needs them ---------- */
  const once = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= fn());
  };
  // At least the last 4 weeks, for the weekly-records table.
  const records = once(() =>
    loadWeeklyRecords(bw, new Date(Math.min(windowFrom.getTime(), now.getTime() - 28 * DAY))),
  );
  // Online giving summed in SQL per period (minor units), one query per distinct period.
  const givingWhere = (p: Period) => ({ ...bw, status: "success", currency: "GHS", paid_at: { gte: p.from, lte: p.to } });
  const onlineSums = new Map<string, Promise<number>>();
  const onlineMinor = (p: Period) => {
    const key = `${p.from.getTime()}|${p.to.getTime()}`;
    let hit = onlineSums.get(key);
    if (!hit) {
      hit = prisma.givingContribution
        .aggregate({ where: givingWhere(p), _sum: { amount: true } })
        .then((r) => num(r._sum.amount));
      onlineSums.set(key, hit);
    }
    return hit;
  };
  const approved = once(async () => {
    const rows = await prisma.request.findMany({
      where: {
        ...bw,
        request_approval_status: { in: [RequestApprovalStatus.APPROVED, RequestApprovalStatus.DISBURSED] },
        OR: [{ approval_instances: { some: { acted_at: { gte: windowFrom } } } }, { updated_at: { gte: windowFrom } }],
      },
      select: {
        currency: true,
        updated_at: true,
        department: { select: { name: true } },
        products: { select: { unitPrice: true, quantity: true } },
        // Only the latest decision is used.
        approval_instances: { where: { acted_at: { not: null } }, select: { acted_at: true }, orderBy: { acted_at: "desc" }, take: 1 },
        request_approvals: { select: { ps_approval_date: true } },
      },
    });
    return rows
      .filter((r) => isGhs(r.currency))
      .map((r) => {
        const acted = r.approval_instances.map((i) => i.acted_at?.getTime() || 0).filter(Boolean);
        const decided = acted.length
          ? new Date(Math.max(...acted))
          : r.request_approvals?.ps_approval_date || r.updated_at || null;
        return { decided, value: requisitionValue(r), department: r.department?.name || "No department" };
      });
  });
  const pledgeStats = once(async () => {
    // Detail only for campaigns that can be live in some charted period (deadline not
    // before the window start); every earlier campaign is past its deadline and only
    // feeds the overdue figures below.
    const [rows, expiredPledgers, expiredPaid] = await Promise.all([
      prisma.pledge.findMany({
        where: { ...bw, OR: [{ deadline: null }, { deadline: { gte: windowFrom } }] },
        select: {
          id: true,
          title: true,
          target_amount: true,
          deadline: true,
          created_at: true,
          groups: {
            select: {
              pledgers: { select: { pledged_amount: true, redemptions: { select: { amount: true, date: true } } } },
            },
          },
        },
      }),
      prisma.pledger.findMany({
        where: { group: { pledge: { ...bw, deadline: { lt: windowFrom } } } },
        select: { id: true, pledged_amount: true },
      }),
      prisma.pledge_redemption.groupBy({
        by: ["pledger_id"],
        where: { pledger: { group: { pledge: { ...bw, deadline: { lt: windowFrom } } } } },
        _sum: { amount: true },
      }),
    ]);
    const info = rows.map((p) => {
      const pledgers = p.groups.flatMap((g) => g.pledgers);
      return {
        id: p.id,
        title: p.title?.trim() || `Pledge #${p.id}`,
        target: p.target_amount != null ? num(p.target_amount) : null,
        deadline: p.deadline,
        created: p.created_at,
        pledged: sum(pledgers.map((x) => num(x.pledged_amount))),
        redemptions: pledgers.flatMap((x) => x.redemptions.map((r) => ({ amount: num(r.amount), date: r.date }))),
        pledgers: pledgers.map((x) => ({
          pledged: num(x.pledged_amount),
          paid: sum(x.redemptions.map((r) => num(r.amount))),
        })),
      };
    });
    const paidBy = new Map(expiredPaid.map((r) => [r.pledger_id, num(r._sum.amount)]));
    // Pledgers on every campaign whose deadline has passed.
    const expired = [
      ...info.filter((p) => p.deadline && p.deadline < now).flatMap((p) => p.pledgers),
      ...expiredPledgers.map((x) => ({ pledged: num(x.pledged_amount), paid: paidBy.get(x.id) ?? 0 })),
    ];
    const pct = (p: Period) => {
      const live = info.filter((x) => x.created <= p.to && (!x.deadline || x.deadline >= p.from));
      const pledged = sum(live.map((x) => x.pledged));
      const paid = sum(live.flatMap((x) => x.redemptions.filter((r) => r.date <= p.to).map((r) => r.amount)));
      return pledged > 0 ? pctOf(paid, pledged) : null;
    };
    return { info, expired, pct };
  });

  const counted = (list: WeeklyRecord[], p: Period) => list.filter((r) => r.counted && within(r.date, p.from, p.to));
  const receiptsIn = (list: WeeklyRecord[], p: Period) => sum(counted(list, p).map((r) => r.total));

  let pendingRecordsCount = 0;
  let pendingReqCount = 0;
  let overduePledges = 0;

  const branchWidgets: Entries =
    ctx.branchId === null
      ? [
          [
            "f-br",
            ["Financials", "view"],
            async () => {
              const branches = await scopedBranches(null);
              if (branches.length < 2) return { rows: [] };
              const [recs, headcounts] = await Promise.all([
                records(),
                prisma.event_attendance_summary.findMany({
                  where: {
                    date: { gte: cur.from, lte: cur.to },
                    event: {
                      is: {
                        branch_id: { in: branches.map((b) => b.id) },
                        OR: [{ event_type: "SERVICE" }, { event_type: null }],
                      },
                    },
                  },
                  select: {
                    adultMale: true,
                    adultFemale: true,
                    youthMale: true,
                    youthFemale: true,
                    childrenMale: true,
                    childrenFemale: true,
                    visitors: true,
                    event: { select: { branch_id: true } },
                  },
                }),
              ]);
              const list = counted(recs, cur);
              const rows: BarRow[] = branches
                .map((b) => {
                  const value = sum(list.filter((r) => r.branchId === b.id).map((r) => r.total));
                  const att = sum(
                    headcounts
                      .filter((h) => h.event.branch_id === b.id)
                      .map(
                        (h) =>
                          h.adultMale + h.adultFemale + h.youthMale + h.youthFemale + h.childrenMale + h.childrenFemale + h.visitors,
                      ),
                  );
                  return {
                    label: b.name,
                    value: round1(value),
                    sub: att > 0 && value > 0 ? `${ghs(value / att)} per attendee` : null,
                  };
                })
                .sort((a, b) => b.value - a.value);
              return { rows };
            },
          ],
        ]
      : [
          [
            "f-ch",
            ["Giving", "view"],
            async () => {
              const byChannel = await prisma.givingContribution.groupBy({
                by: ["channel"],
                where: givingWhere(cur),
                _sum: { amount: true },
              });
              const m = new Map<string, { label: string; value: number }>();
              byChannel.forEach((g) => {
                const label = channelLabel(g.channel);
                addTo(m, label, label, num(g._sum.amount) / 100);
              });
              return { rows: topBars(m) };
            },
          ],
        ];

  const widgets = await runWidgets(ctx, [
    [
      "f-kpi",
      ["Financials", "view"],
      async () => {
        const [recs, online, appr, pl] = await Promise.all([
          records(),
          Promise.all([cur, prev, ...periods].map(onlineMinor)),
          approved(),
          pledgeStats(),
        ]);
        const [onlineCur, onlinePrev, ...onlinePeriods] = online.map((v) => round1(v / 100));
        const apprIn = (p: Period) => round1(sum(appr.filter((a) => within(a.decided, p.from, p.to)).map((a) => a.value)));
        const hasRecords = (p: Period) => counted(recs, p).length > 0;
        const givingNow = hasRecords(cur) ? round1(receiptsIn(recs, cur)) : null;
        const givingPrev = hasRecords(prev) ? receiptsIn(recs, prev) : null;
        const pctNow = pl.pct(cur);
        const pctPrev = pl.pct(prev);
        const kpis: Kpi[] = [
          {
            key: "giving",
            label: "Giving",
            value: givingNow,
            format: "ghs",
            delta_pct: deltaPct(givingNow, givingPrev),
            good: "up",
            spark: periods.map((p) => round1(receiptsIn(recs, p))),
            sub: givingNow === null ? "No weekly records yet" : "From weekly records",
          },
          {
            key: "online_giving",
            label: "Online giving",
            value: onlineCur,
            format: "ghs",
            delta_pct: deltaPct(onlineCur, onlinePrev),
            good: "up",
            spark: onlinePeriods,
          },
          {
            key: "pledge_fulfilment",
            label: "Pledge fulfilment",
            value: pctNow,
            format: "pct",
            delta_pct: pctNow !== null && pctPrev !== null ? round1(pctNow - pctPrev) : null,
            points: true,
            good: "up",
            spark: periods.map((p) => pl.pct(p) ?? 0),
            sub: pctNow === null ? "No live pledge campaigns" : "Paid against pledged",
          },
          {
            key: "requisitions_approved",
            label: "Requisitions approved",
            value: apprIn(cur),
            format: "ghs",
            delta_pct: deltaPct(apprIn(cur), apprIn(prev)),
            good: null,
            spark: periods.map(apprIn),
          },
        ];
        return { kpis };
      },
    ],
    [
      // Not gated: requisitions are the caller's own approval steps (hidden when
      // the role switches Requisition.approve off); weekly records only show to
      // the configured approver with Financials.approve, never their own.
      "f-q",
      null,
      async () => {
        const [cfg, canApprove, grants] = await Promise.all([
          prisma.finance_approval_config.findUnique({
            where: { config_key: "FINANCE" },
            select: { finance_approver_user_id: true },
          }),
          ctx.action("Financials", "approve"),
          ctx.grants(),
        ]);
        const canApproveRecords = canApprove && cfg?.finance_approver_user_id === ctx.userId;
        const canApproveRequisitions = !switchedOffEverywhere(grants, "Requisition", "approve");

        const [recordRows, reqRows, replyDays] = await Promise.all([
          canApproveRecords
            ? prisma.financials.findMany({
                where: {
                  ...bw,
                  status: "PENDING_APPROVAL",
                  OR: [{ submitted_by_user_id: null }, { NOT: { submitted_by_user_id: ctx.userId } }],
                },
                select: { ...weeklyRecordSelect, branch: { select: { name: true } } },
                orderBy: { submitted_at: "asc" },
                take: 20,
              })
            : Promise.resolve([]),
          (canApproveRequisitions
            ? prisma.request.findMany({
            where: {
              ...bw,
              request_approval_status: {
                in: [RequestApprovalStatus.Awaiting_HOD_Approval, RequestApprovalStatus.Awaiting_Executive_Pastor_Approval],
              },
              approval_instances: { some: { approver_user_id: ctx.userId, status: "PENDING" } },
            },
            select: requisitionSelect,
            orderBy: { submitted_at: "asc" },
            take: 20,
          })
            : Promise.resolve([])) as Promise<RequisitionRow[]>,
          requisitionReplyDays(),
        ]);

        const submitterIds = [
          ...new Set(recordRows.map((r) => r.submitted_by_user_id).filter((x): x is number => !!x)),
        ];
        const [submitters, lookups] = await Promise.all([
          submitterIds.length
            ? prisma.user.findMany({ where: { id: { in: submitterIds } }, select: { id: true, name: true } })
            : Promise.resolve([]),
          loadStepLookups(reqRows),
        ]);
        const nameOf = (id: number | null) => (id ? submitters.find((u) => u.id === id)?.name || null : null);

        const weekly: QueueItem[] = recordRows.map((row) => {
          const r = parseWeeklyRecord(row);
          const branch = row.branch?.name || "No branch";
          const by = nameOf(r.submittedBy);
          const span = r.legacyMonth ? shortDate(r.date) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
          return {
            id: `weekly_record:${r.id}`,
            kind: "weekly_record",
            // financials ids are cuid strings; passed through unchanged for the approve call.
            ref_id: r.id,
            title: `${r.week} · ${branch}`,
            sub: ["Weekly record", by ? `submitted by ${by}` : null, r.submittedAt ? shortDate(r.submittedAt) : null]
              .filter(Boolean)
              .join(" · "),
            amount: round1(r.total),
            pill: null,
            detail: {
              fields: [
                ["Branch", branch],
                ["Week", `${r.week} · ${span}`],
                ["Submitted by", by || "Unknown"],
              ],
              text_label: "Collections",
              items: r.receipts.filter((l) => l.amount).map((l) => ({ label: l.label, qty: null, amount: l.amount })),
            },
          };
        });
        const reqs = reqRows.map((r) => requisitionQueueItem(r, lookups, replyDays, now));
        pendingRecordsCount = weekly.length;
        pendingReqCount = reqs.length;
        return { items: [...weekly, ...reqs] };
      },
    ],
    [
      "f-wkt",
      ["Financials", "view"],
      async () => {
        const [recs, branches] = await Promise.all([records(), scopedBranches(ctx.branchId)]);
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
        const weeks = [0, 1, 2].map((i) => new Date(monday.getTime() - i * 7 * DAY));
        // Only branches that keep weekly records can be "missing" one.
        const keepers = new Set(recs.filter((r) => !r.legacyMonth).map((r) => r.branchId));
        const rows: { week_label: string; branch_name: string; status: string; ref_id: string | null }[] = [];
        weeks.forEach((w) => {
          const end = new Date(w.getTime() + 7 * DAY - 1);
          branches.forEach((b) => {
            const rec = recs.find((r) => r.branchId === b.id && !r.legacyMonth && within(r.date, w, end));
            if (rec) {
              rows.push({
                week_label: rec.week !== "Week" ? rec.week : `Week of ${shortDate(w)}`,
                branch_name: b.name,
                status: recordStatus(rec),
                ref_id: rec.id,
              });
            } else if (keepers.has(b.id) && end < now) {
              rows.push({ week_label: `Week of ${shortDate(w)}`, branch_name: b.name, status: "MISSING", ref_id: null });
            }
          });
        });
        return { rows: rows.slice(0, 15) };
      },
    ],
    [
      "f-opt",
      ["Financials", "view"],
      async () => {
        const recs = await records();
        const m = new Map<string, { label: string; value: number }>();
        counted(recs, cur).forEach((r) => r.receipts.forEach((l) => addTo(m, l.key, l.label, l.amount)));
        return { rows: topBars(m) };
      },
    ],
    ...branchWidgets,
    [
      "f-rqd",
      ["Requisition", "view"],
      async () => {
        const appr = await approved();
        const m = new Map<string, { label: string; value: number }>();
        appr.filter((a) => within(a.decided, cur.from, cur.to)).forEach((a) => addTo(m, a.department, a.department, a.value));
        return { rows: topBars(m) };
      },
    ],
    [
      "f-pl",
      ["Pledges", "view"],
      async () => {
        const { info, expired } = await pledgeStats();
        const live = info.filter((p) => !p.deadline || p.deadline >= now);
        const overdue = expired.filter((x) => x.pledged - x.paid > 0.005);
        overduePledges = overdue.length;
        const campaigns: BarRow[] = live
          .slice()
          .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity))
          .slice(0, 5)
          .map((p) => {
            const raised = sum(p.pledgers.map((x) => x.paid));
            const target = p.target && p.target > 0 ? p.target : p.pledged;
            return {
              label: p.title,
              value: round1(raised),
              max: target > 0 ? round1(target) : null,
              sub: p.deadline ? `Deadline ${isoDay(p.deadline)}` : "No deadline",
            };
          });
        return {
          pledged: round1(sum(live.map((p) => p.pledged))),
          paid: round1(sum(live.flatMap((p) => p.pledgers.map((x) => x.paid)))),
          overdue_count: overdue.length,
          overdue_amount: round1(sum(overdue.map((x) => x.pledged - x.paid))),
          campaigns,
        };
      },
    ],
    [
      "f-mkt",
      ["Marketplace", "view"],
      async () => {
        // Orders carry no branch; a branch means orders with items from its markets
        // (same rule as the marketplace overview). Delivery fees only count unscoped.
        const marketWhere = getRelationBranchScopedWhere(ctx.branchId, "market");
        const itemScope = marketWhere ? { ...marketWhere } : {};
        const orderScope = marketWhere ? { items: { some: itemScope } } : {};
        const [inRange, unpaid, awaiting] = await Promise.all([
          prisma.orders.findMany({
            where: { deleted_at: null, created_at: { gte: cur.from, lte: cur.to }, ...orderScope },
            select: {
              payment_status: true,
              delivery_status: true,
              delivery_fee: true,
              items: { where: itemScope, select: { price_amount: true, quantity: true } },
            },
          }),
          prisma.orders.findMany({
            where: {
              deleted_at: null,
              payment_status: { in: ["pending", "failed"] },
              delivery_status: { not: "cancelled" },
              ...orderScope,
            },
            select: { total_amount: true },
          }),
          prisma.orders.count({
            where: {
              deleted_at: null,
              payment_status: "success",
              delivery_status: "pending",
              fulfilment_method: "pickup",
              ...orderScope,
            },
          }),
        ]);
        const paid = inRange.filter((o) => o.payment_status === "success" && o.delivery_status !== "cancelled");
        const revenue = sum(
          paid.map((o) => sum(o.items.map((i) => i.price_amount * i.quantity)) + (marketWhere ? 0 : o.delivery_fee || 0)),
        );
        return {
          revenue: round1(revenue),
          orders: inRange.length,
          unpaid_orders: unpaid.length,
          unpaid_amount: round1(sum(unpaid.map((o) => o.total_amount))),
          awaiting_collection: awaiting,
        };
      },
    ],
  ]);

  const needs: NeedsItem[] = [
    { key: "f-wk", label: "Weekly records to approve", count: pendingRecordsCount, widget: "f-q", tab: "weekly_record" },
    { key: "f-req", label: "Requisitions to approve", count: pendingReqCount, widget: "f-q", tab: "requisition" },
    { key: "f-pl", label: "Overdue pledges", count: overduePledges, widget: "f-pl" },
  ];
  return { needs, widgets };
};
