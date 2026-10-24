/**
 * Personal workspace: the caller's own data. Scoped by the user, not the
 * branch, except event lists (selected branch, else the caller's own branch,
 * plus church-wide events).
 */
import { prisma } from "../../../Models/context";
import { bodyToPlainText } from "../../community/communityRichText";
import { departmentIdsOf, loadViewer, visiblePostWhere } from "../../community/communityQueries";
import { dueDateFromRule, parseDueRule } from "../../programs/lms/dueRules";
import type { AgendaItem, BarRow, ListItem, NeedsItem, Pill, WorkspaceBuilder, WorkspaceContext } from "../types";
import { deltaPct, runWidgets } from "../widgetKit";
import {
  DAY,
  dayStart,
  eventAgendaItem,
  eventBranchWhere,
  eventSelect,
  loadStepLookups,
  num,
  pill,
  registrationOpen,
  relativeTime,
  requisitionListItem,
  requisitionSelect,
  round1,
  shortDate,
  sum,
  type EventRow,
  type RequisitionRow,
} from "../queries/genericCommon";

type Entries = Parameters<typeof runWidgets>[1];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const filled = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v != null);

const APPT_PILL: Record<string, Pill> = {
  PENDING: { tone: "warning", label: "Awaiting reply" },
  CONFIRMED: { tone: "success", label: "Confirmed" },
  RESCHEDULED: { tone: "info", label: "New time suggested" },
};

const ORDER_PILL = (payment: string, delivery: string, method: string): Pill => {
  if (delivery === "cancelled") return pill("neutral", "Cancelled");
  if (payment !== "success") return pill(payment === "failed" ? "danger" : "warning", payment === "failed" ? "Payment failed" : "Awaiting payment");
  if (delivery === "delivered") return pill("neutral", method === "pickup" ? "Collected" : "Delivered");
  if (delivery === "shipped") return pill("info", "On its way");
  return pill("success", method === "pickup" ? "Ready for collection" : "Paid");
};

export const buildGeneric: WorkspaceBuilder = async (ctx: WorkspaceContext) => {
  const now = ctx.range.to;
  const today = dayStart(now);
  const me = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: {
      email: true,
      branch_id: true,
      department_id: true,
      user_info: {
        select: {
          photo: true,
          date_of_birth: true,
          primary_number: true,
          email: true,
          address: true,
          marital_status: true,
          occupation: true,
          nationality: true,
          emergency_contact_id: true,
        },
      },
    },
  });
  const eventBranch = ctx.branchId ?? me?.branch_id ?? null;
  const deptIds = [...new Set([...(await departmentIdsOf(ctx.userId)), ...(me?.department_id ? [me.department_id] : [])])];
  const [orderCount, canMarket] = await Promise.all([
    prisma.orders.count({ where: { user_id: ctx.userId, deleted_at: null } }),
    ctx.can("Marketplace", "view"),
  ]);

  const counts = { profile: 0, pledge: 0, assignment: 0, pledgeLabel: "Pledge payment due" };

  const entries: Entries = [
    [
      "g-prof",
      null,
      async () => {
        const info = me?.user_info;
        const fields: [string, unknown][] = [
          ["Photo", info?.photo],
          ["Date of birth", info?.date_of_birth],
          ["Phone number", info?.primary_number],
          ["Email", me?.email || info?.email],
          ["Home address", info?.address],
          ["Marital status", info?.marital_status],
          ["Occupation", info?.occupation],
          ["Nationality", info?.nationality],
          ["Emergency contact", info?.emergency_contact_id],
        ];
        const missing = fields.filter(([, v]) => !filled(v)).map(([label]) => label);
        counts.profile = missing.length;
        return { pct: Math.round(((fields.length - missing.length) / fields.length) * 100), missing };
      },
    ],
    [
      "g-ev",
      null,
      async () => {
        const rows = (await prisma.event_mgt.findMany({
          where: { ...eventBranchWhere(eventBranch), start_date: { gte: today, lt: new Date(today.getTime() + 15 * DAY) } },
          select: eventSelect,
          orderBy: { start_date: "asc" },
          take: 5,
        })) as EventRow[];
        const regs = rows.length
          ? await prisma.event_registers.findMany({
              where: { user_id: ctx.userId, event_id: { in: rows.map((e) => e.id) } },
              select: { event_id: true },
            })
          : [];
        const registered = new Set(regs.map((r) => r.event_id));
        return {
          items: rows.map((e) => ({
            ...eventAgendaItem(e),
            registered: registered.has(e.id),
            can_register: !registered.has(e.id) && registrationOpen(e, now),
          })),
        };
      },
    ],
    [
      "g-give",
      null,
      async () => {
        const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const [gifts, pledgers] = await Promise.all([
          prisma.givingContribution.findMany({
            where: {
              user_id: ctx.userId,
              status: "success",
              currency: "GHS",
              paid_at: { gte: lastMonthStart < yearStart ? lastMonthStart : yearStart },
            },
            select: { amount: true, paid_at: true },
          }),
          prisma.pledger.findMany({
            where: { user_id: ctx.userId },
            select: {
              pledged_amount: true,
              redemptions: { select: { amount: true } },
              group: { select: { pledge: { select: { id: true, title: true, deadline: true } } } },
            },
          }),
        ]);
        const total = (from: Date, to: Date) =>
          round1(sum(gifts.filter((g) => g.paid_at && g.paid_at >= from && g.paid_at < to).map((g) => g.amount)) / 100);
        const month = total(monthStart, new Date(now.getTime() + 1));
        const lastMonth = total(lastMonthStart, monthStart);
        const open = pledgers
          .map((p) => {
            const amount = num(p.pledged_amount);
            const paid = sum(p.redemptions.map((r) => num(r.amount)));
            return { p, amount, paid, left: amount - paid };
          })
          .filter((x) => x.left > 0.005)
          .sort((a, b) => (a.p.group.pledge.deadline?.getTime() ?? Infinity) - (b.p.group.pledge.deadline?.getTime() ?? Infinity));
        const next = open[0];
        if (next?.p.group.pledge.deadline && next.p.group.pledge.deadline.getTime() - now.getTime() <= 14 * DAY) {
          counts.pledge = 1;
          if (next.p.group.pledge.deadline < now) counts.pledgeLabel = "Pledge payment overdue";
        }
        return {
          year_total: total(yearStart, new Date(now.getTime() + 1)),
          month_total: month,
          month_delta_pct: deltaPct(month, lastMonth),
          pledge: next
            ? {
                id: next.p.group.pledge.id,
                name: next.p.group.pledge.title?.trim() || `Pledge #${next.p.group.pledge.id}`,
                paid: round1(next.paid),
                amount: round1(next.amount),
                // No instalment schedule is stored: the balance is due by the campaign deadline.
                next_due: next.p.group.pledge.deadline?.toISOString() ?? null,
                next_amount: round1(next.left),
              }
            : null,
        };
      },
    ],
    [
      "g-appt",
      null,
      async () => {
        const rows = await prisma.appointment.findMany({
          where: {
            requesterId: ctx.userId,
            date: { gte: today },
            status: { in: ["PENDING", "CONFIRMED", "RESCHEDULED"] },
          },
          select: {
            id: true,
            date: true,
            startTime: true,
            purpose: true,
            status: true,
            proposedDate: true,
            proposedStartTime: true,
            user: { select: { name: true } },
          },
          orderBy: [{ date: "asc" }, { startTime: "asc" }],
          take: 3,
        });
        const items: AgendaItem[] = rows.map((a) => {
          const suggested = a.status === "RESCHEDULED" && a.proposedDate;
          return {
            date: (suggested ? (a.proposedDate as Date) : a.date).toISOString(),
            title: a.purpose || "Appointment",
            sub: [suggested ? a.proposedStartTime : a.startTime, a.user?.name].filter(Boolean).join(" · "),
            pill: APPT_PILL[a.status] || null,
            ref_id: a.id,
          };
        });
        return { items };
      },
    ],
    [
      "g-ride",
      null,
      async () => {
        const [asPassenger, asDriver] = await Promise.all([
          prisma.ride_request.findFirst({
            where: {
              passenger_id: ctx.userId,
              status: { in: ["PENDING", "ACCEPTED"] },
              offer: { status: "ACTIVE", service_date: { gte: today } },
            },
            orderBy: { offer: { service_date: "asc" } },
            select: {
              id: true,
              status: true,
              pickup_time: true,
              pickup_point: { select: { name: true } },
              offer: {
                select: {
                  service_date: true,
                  seats_total: true,
                  driver: { select: { name: true } },
                  event: { select: { event: { select: { event_name: true } } } },
                  _count: { select: { requests: { where: { status: "ACCEPTED" } } } },
                },
              },
            },
          }),
          prisma.ride_offer.findFirst({
            where: { driver_id: ctx.userId, status: "ACTIVE", service_date: { gte: today } },
            orderBy: { service_date: "asc" },
            select: {
              id: true,
              service_date: true,
              depart_time: true,
              seats_total: true,
              area: { select: { name: true } },
              event: { select: { event: { select: { event_name: true } } } },
              _count: { select: { requests: { where: { status: "ACCEPTED" } } } },
            },
          }),
        ]);
        const label = (name: string | null | undefined, d: Date) =>
          `${name?.trim() || "Church"} · ${WEEKDAYS[d.getUTCDay()]} ${shortDate(d)}`;
        const useDriver =
          asDriver && (!asPassenger || asDriver.service_date.getTime() <= asPassenger.offer.service_date.getTime());
        if (useDriver && asDriver) {
          const taken = asDriver._count.requests;
          return {
            service_label: label(asDriver.event?.event?.event_name, asDriver.service_date),
            item: {
              title: "You're driving",
              sub: `${asDriver.depart_time} · from ${asDriver.area.name} · ${taken} of ${asDriver.seats_total} seats taken`,
              pill: pill("info", "Driving"),
              ref_id: asDriver.id,
            } as ListItem,
          };
        }
        if (asPassenger) {
          const o = asPassenger.offer;
          const left = Math.max(0, o.seats_total - o._count.requests);
          return {
            service_label: label(o.event?.event?.event_name, o.service_date),
            item: {
              title: `${o.driver.name} is driving`,
              sub: `${asPassenger.pickup_time} · from ${asPassenger.pickup_point.name} · ${left} ${left === 1 ? "seat" : "seats"} left`,
              pill: asPassenger.status === "ACCEPTED" ? pill("success", "You have a seat") : pill("warning", "Request pending"),
              ref_id: asPassenger.id,
            } as ListItem,
          };
        }
        const nextService = await prisma.event_mgt.findFirst({
          where: { ...eventBranchWhere(eventBranch), event_type: "SERVICE", start_date: { gte: today } },
          orderBy: { start_date: "asc" },
          select: { start_date: true, event: { select: { event_name: true } } },
        });
        return {
          service_label: nextService?.start_date ? label(nextService.event?.event_name, nextService.start_date) : null,
          item: null,
        };
      },
    ],
    [
      "g-grow",
      null,
      async () => {
        const [lc, enrollments] = await Promise.all([
          prisma.life_center_member.findFirst({
            where: { userId: ctx.userId },
            select: { lifeCenter: { select: { id: true, name: true, meetingDays: true, meetingLocation: true } }, role: { select: { name: true } } },
          }),
          prisma.enrollment.findMany({
            where: { user_id: ctx.userId, OR: [{ completed: false }, { completed: null }] },
            orderBy: { enrolledAt: "desc" },
            take: 3,
            select: {
              id: true,
              course: {
                select: {
                  name: true,
                  cohort: {
                    select: {
                      id: true,
                      name: true,
                      startDate: true,
                      program: { select: { title: true, _count: { select: { topics: true } } } },
                      assignments: {
                        where: { isActive: true, closedAt: null },
                        select: {
                          dueDate: true,
                          learningUnitId: true,
                          learningUnit: { select: { due_rule: true, topic: { select: { name: true } } } },
                        },
                      },
                    },
                  },
                },
              },
              progress: { select: { status: true, completed: true } },
              submissions: { select: { learningUnitId: true } },
              extensions: { select: { learningUnitId: true, dueDate: true } },
            },
          }),
        ]);
        const life_center: ListItem | null = lc
          ? {
              title: lc.lifeCenter.name,
              sub: [lc.lifeCenter.meetingDays && `Meets ${lc.lifeCenter.meetingDays}`, lc.lifeCenter.meetingLocation]
                .filter(Boolean)
                .join(" · "),
              right: lc.role?.name || null,
              ref_id: lc.lifeCenter.id,
            }
          : null;

        // Next unsubmitted assignment across the caller's open enrolments.
        const due = enrollments
          .flatMap((e) => {
            const submitted = new Set(e.submissions.map((s) => s.learningUnitId));
            return e.course.cohort.assignments
              .filter((a) => !submitted.has(a.learningUnitId))
              .map((a) => ({
                e,
                name: a.learningUnit.topic?.name || "Assignment",
                due:
                  e.extensions.find((x) => x.learningUnitId === a.learningUnitId)?.dueDate ??
                  a.dueDate ??
                  dueDateFromRule(e.course.cohort.startDate, parseDueRule(a.learningUnit.due_rule)),
              }));
          })
          .filter((x): x is typeof x & { due: Date } => !!x.due && x.due.getTime() >= today.getTime() - 7 * DAY)
          .sort((a, b) => a.due.getTime() - b.due.getTime());
        const next = due[0];
        counts.assignment = due.filter((x) => x.due.getTime() - now.getTime() <= 7 * DAY).length;
        const assignment: ListItem | null = next
          ? {
              title: `Assignment: ${next.name}`,
              sub: `${next.e.course.cohort.program.title} · due ${WEEKDAYS[next.due.getUTCDay()]} ${shortDate(next.due)}`,
              pill:
                next.due < now
                  ? pill("danger", "Overdue")
                  : next.due.getTime() - now.getTime() <= 7 * DAY
                    ? pill("warning", `Due ${WEEKDAYS[next.due.getUTCDay()]}`)
                    : null,
            }
          : null;

        const first = enrollments[0];
        const course: BarRow | null = first
          ? {
              label: `${first.course.cohort.program.title} · ${first.course.cohort.name}`,
              value: first.progress.filter((p) => p.status === "PASS" || p.completed).length,
              max: first.course.cohort.program._count.topics || null,
              sub: "lessons completed",
            }
          : null;
        return { life_center, assignment, course };
      },
    ],
    [
      "g-ser",
      null,
      async () => {
        const s = await prisma.sermon.findFirst({
          where: { status: "PUBLISHED", ...(eventBranch ? { OR: [{ branch_id: eventBranch }, { branch_id: null }] } : {}) },
          orderBy: [{ preached_at: "desc" }, { published_at: "desc" }],
          select: { id: true, title: true, preached_at: true, published_at: true, thumbnail_url: true, youtube_url: true, series: { select: { title: true } } },
        });
        if (!s) return null;
        return {
          id: s.id,
          title: s.title,
          // Sermons store no preacher or duration.
          preacher: null,
          date: (s.preached_at || s.published_at)?.toISOString() ?? null,
          duration_min: null,
          series: s.series?.title ?? null,
          thumbnail_url: s.thumbnail_url,
          youtube_url: s.youtube_url,
        };
      },
    ],
    [
      "g-com",
      null,
      async () => {
        let viewer;
        try {
          viewer = await loadViewer(ctx.userId, { canView: true, canManage: false });
        } catch {
          return { items: [] }; // guests and deactivated accounts have no community feed
        }
        const posts = await prisma.community_post.findMany({
          where: visiblePostWhere(viewer),
          orderBy: [{ is_pinned: "desc" }, { created_at: "desc" }],
          take: 3,
          select: {
            id: true,
            type: true,
            body: true,
            is_anonymous: true,
            is_important: true,
            created_at: true,
            author: { select: { name: true } },
            _count: { select: { reactions: { where: { type: "PRAY" } } } },
          },
        });
        const items: ListItem[] = posts.map((p) => {
          const text = bodyToPlainText(p.body).replace(/\s+/g, " ").trim();
          const title = text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text || "Post";
          const by = p.is_anonymous ? "Anonymous" : p.author.name;
          const prayed = p.type === "PRAYER" && p._count.reactions ? `${p._count.reactions} prayed` : null;
          return {
            title,
            sub: [by, prayed].filter(Boolean).join(" · "),
            pill: p.is_important ? pill("info", "Important") : now.getTime() - p.created_at.getTime() < 3 * DAY ? pill("info", "New") : null,
            ref_id: p.id,
          };
        });
        return { items };
      },
    ],
    [
      "g-not",
      null,
      async () => {
        const rows = await prisma.in_app_notification.findMany({
          where: { recipient_user_id: ctx.userId },
          orderBy: { created_at: "desc" },
          take: 5,
          select: { id: true, title: true, is_read: true, created_at: true, action_url: true },
        });
        const unread = await prisma.in_app_notification.count({ where: { recipient_user_id: ctx.userId, is_read: false } });
        const items = rows.map((n) => ({
          title: n.title,
          sub: relativeTime(n.created_at, now),
          pill: n.is_read ? null : pill("info", "New"),
          ref_id: n.id,
          action_url: n.action_url,
        }));
        return { items, unread };
      },
    ],
  ];

  if (deptIds.length) {
    entries.push([
      "g-req",
      null,
      async () => {
        const [dept, rows] = await Promise.all([
          prisma.department.findFirst({ where: { id: { in: deptIds } }, select: { name: true }, orderBy: { name: "asc" } }),
          prisma.request.findMany({
            where: { user_id: ctx.userId },
            select: requisitionSelect,
            orderBy: { id: "desc" },
            take: 5,
          }) as Promise<RequisitionRow[]>,
        ]);
        const lookups = await loadStepLookups(rows);
        return { department: dept?.name ?? null, items: rows.map((r) => requisitionListItem(r, lookups)) };
      },
    ]);
  }

  if (orderCount > 0 || canMarket) {
    entries.push([
      "g-ord",
      null,
      async () => {
        const rows = await prisma.orders.findMany({
          where: { user_id: ctx.userId, deleted_at: null },
          orderBy: { created_at: "desc" },
          take: 4,
          select: {
            id: true,
            order_number: true,
            total_amount: true,
            payment_status: true,
            delivery_status: true,
            fulfilment_method: true,
            items: { select: { name: true, size: true, quantity: true }, take: 2 },
            _count: { select: { items: true } },
          },
        });
        const items: ListItem[] = rows.map((o) => {
          const first = o.items[0];
          const name = first ? `${first.name}${first.size && first.size !== "N/A" ? ` (${first.size})` : ""}` : "Order";
          return {
            title: o._count.items > 1 ? `${name} +${o._count.items - 1} more` : name,
            sub: `Order #${o.order_number || o.id} · GH₵ ${Math.round(o.total_amount).toLocaleString("en-GB")}`,
            pill: ORDER_PILL(o.payment_status, o.delivery_status, o.fulfilment_method),
            ref_id: o.id,
          };
        });
        return { items };
      },
    ]);
  }

  const widgets = await runWidgets(ctx, entries);
  const needs: NeedsItem[] = [
    { key: "g-prof", label: "Finish your profile", count: counts.profile, widget: "g-prof" },
    { key: "g-pl", label: counts.pledgeLabel, count: counts.pledge, widget: "g-give" },
    { key: "g-as", label: counts.assignment === 1 ? "Assignment due" : "Assignments due", count: counts.assignment, widget: "g-grow" },
  ];
  return { needs, widgets };
};

