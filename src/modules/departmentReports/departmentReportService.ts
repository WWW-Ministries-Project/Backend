import { DepartmentReportStatus, Prisma } from "@prisma/client";

import { prisma } from "../../Models/context";
import {
  listUserIdsWithDomainPermission,
  userHasDomainPermission,
} from "../../middleWare/authorization";
import {
  AppError,
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { getBranchScope } from "../branches/branchScope";
import { assertBranchAccessible, parseBranchId } from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";
import {
  defaultPeriodKey,
  dueDate,
  isoDate,
  longDate,
  parsePeriod,
  periodOptions,
  PeriodRange,
  previousRange,
  trendBuckets,
  weekBuckets,
  yoyRange,
} from "./period";
import { REPORT_MAP, REPORTS, ReportDefinition } from "./registry";
import { emptyBody, nf, sum } from "./sections";
import {
  FlagDTO,
  KpiDTO,
  PeriodType,
  ReportBodyDTO,
  ReportContext,
  ReportKey,
  ReportResult,
} from "./types";

/* -------------------------------------------------------------------------- */
/*                                   Access                                   */
/* -------------------------------------------------------------------------- */

export interface Viewer {
  userId: number;
  reportsView: boolean;
  /** Leadership: approve, return, decide on requests, send reminders. */
  reportsAdmin: boolean;
  /** Can see member names inside reports. */
  seesNames: boolean;
  domains: Record<string, { view: boolean; manage: boolean }>;
}

export const loadViewer = async (userId: number): Promise<Viewer> => {
  const [reportsView, reportsAdmin, seesNames, ...domainChecks] = await Promise.all([
    userHasDomainPermission(userId, "Reports", "view"),
    userHasDomainPermission(userId, "Reports", "admin"),
    userHasDomainPermission(userId, "Members", "view"),
    ...REPORTS.flatMap((r) => [
      userHasDomainPermission(userId, r.domain, "view"),
      userHasDomainPermission(userId, r.domain, "manage"),
    ]),
  ]);
  const domains: Viewer["domains"] = {};
  REPORTS.forEach((r, i) => {
    domains[r.key] = { view: domainChecks[i * 2], manage: domainChecks[i * 2 + 1] };
  });
  return { userId, reportsView, reportsAdmin, seesNames, domains };
};

const canView = (viewer: Viewer, key: ReportKey) =>
  viewer.reportsView || viewer.domains[key]?.view;
const isHod = (viewer: Viewer, key: ReportKey) => Boolean(viewer.domains[key]?.manage);

const requireDefinition = (raw: unknown) => {
  const def = REPORT_MAP.get(String(raw || "") as ReportKey);
  if (!def) throw new NotFoundError("Report not found");
  return def;
};

/* -------------------------------------------------------------------------- */
/*                               Context + cache                              */
/* -------------------------------------------------------------------------- */

export interface Selection {
  range: PeriodRange;
  branchId: number | null;
  branchKey: number;
}

export const readSelection = (source: Record<string, unknown>): Selection => {
  const type = String(source.period_type || "MONTHLY").toUpperCase() as PeriodType;
  const key = String(source.period_key || "") || defaultPeriodKey(type, new Date());
  const range = parsePeriod(type, key);
  // Fall back to the active branch (X-Branch-Id, or a single-branch admin's
  // only branch) so the workflow row and cache key match the branch the
  // aggregators actually filter on via getBranchScopedWhere(null).
  const branchId = parseBranchId(source.branch_id) ?? getBranchScope()?.activeBranchId ?? null;
  if (branchId) assertBranchAccessible(branchId);
  return { range, branchId, branchKey: branchId ?? 0 };
};

const visibleBranches = async () => {
  const allowed = getBranchScope()?.allowedBranchIds ?? null;
  return prisma.branch.findMany({
    where: allowed ? { id: { in: allowed } } : undefined,
    select: { id: true, name: true },
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
  });
};

const buildContext = async (range: PeriodRange, branchId: number | null): Promise<ReportContext> => {
  const prev = previousRange(range);
  const yoy = yoyRange(range);
  const now = new Date();
  return {
    periodType: range.type,
    periodKey: range.key,
    periodLabel: range.label,
    from: range.from,
    to: range.to,
    prev,
    yoy,
    trend: trendBuckets(range),
    weeks: weekBuckets(range, now),
    branchId,
    branches: branchId ? [] : await visibleBranches(),
    now,
  };
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<ReportResult> }>();

/** Runs a report builder, sharing results for five minutes per scope. */
const computeReport = (def: ReportDefinition, range: PeriodRange, branchId: number | null) => {
  const allowed = getBranchScope()?.allowedBranchIds;
  const key = [def.key, range.type, range.key, branchId ?? "all", allowed ? allowed.join(",") : "*"].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = (async () => def.build(await buildContext(range, branchId)))();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return value;
};

/** A builder failure must not take down the whole summary. */
const safeCompute = async (def: ReportDefinition, range: PeriodRange, branchId: number | null) => {
  try {
    return { result: await computeReport(def, range, branchId), failed: false };
  } catch (error) {
    console.error(`[department-reports] ${def.key} failed`, error);
    return { result: { body: { ...emptyBody(), empty: true }, facts: {} } as ReportResult, failed: true };
  }
};

const redact = (body: ReportBodyDTO, viewer: Viewer): ReportBodyDTO => {
  if (viewer.seesNames) return body;
  return {
    ...body,
    sections: body.sections.map((s) =>
      s.kind === "list"
        ? { ...s, items: s.items.map((it) => (it.pii ? { ...it, title: "Name hidden" } : it)) }
        : s,
    ),
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Workflow                                  */
/* -------------------------------------------------------------------------- */

const STATUS_LABEL: Record<DepartmentReportStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  RETURNED: "Returned",
  APPROVED: "Approved",
};

const ACTION_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted to leadership",
  RESUBMITTED: "Resubmitted to leadership",
  APPROVED: "Approved",
  RETURNED: "Returned to HOD",
  REMINDED: "Reminder sent",
};

const workflowInclude = {
  comments: { orderBy: { created_at: "asc" } },
  activity: { orderBy: { created_at: "asc" } },
  requests: { orderBy: [{ position: "asc" }, { id: "asc" }] },
} satisfies Prisma.department_reportsInclude;

type WorkflowRow = Prisma.department_reportsGetPayload<{ include: typeof workflowInclude }>;

const findWorkflow = (key: ReportKey, sel: Selection) =>
  prisma.department_reports.findUnique({
    where: {
      report_key_period_type_period_key_branch_key: {
        report_key: key,
        period_type: sel.range.type,
        period_key: sel.range.key,
        branch_key: sel.branchKey,
      },
    },
    include: workflowInclude,
  });

const ensureWorkflow = async (key: ReportKey, sel: Selection) => {
  const existing = await findWorkflow(key, sel);
  if (existing) return existing;
  try {
    return await prisma.department_reports.create({
      data: {
        report_key: key,
        period_type: sel.range.type,
        period_key: sel.range.key,
        period_start: sel.range.from,
        period_end: sel.range.to,
        branch_key: sel.branchKey,
      },
      include: workflowInclude,
    });
  } catch (error) {
    // Two requests raced to create it; read the winner.
    const row = await findWorkflow(key, sel);
    if (row) return row;
    throw error;
  }
};

const namesOf = async (ids: (number | null | undefined)[]) => {
  const unique = Array.from(new Set(ids.filter((id): id is number => Boolean(id))));
  if (!unique.length) return new Map<number, string>();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
};

const periodEnded = (range: PeriodRange, now = new Date()) => range.to <= now;
const isOverdue = (status: DepartmentReportStatus, range: PeriodRange, now = new Date()) =>
  status === "DRAFT" && now > dueDate(range);

const serializeWorkflow = (
  def: ReportDefinition,
  sel: Selection,
  row: WorkflowRow | null,
  names: Map<number, string>,
) => {
  const status: DepartmentReportStatus = row?.status ?? "DRAFT";
  const due = dueDate(sel.range);
  const preparedId = row?.submitted_by_user_id ?? row?.prepared_by_user_id ?? null;
  const trail: { action: string; who: string; when: string | null; note: string | null; done: boolean }[] = [];
  if (periodEnded(sel.range)) {
    trail.push({ action: "Draft pre-filled from system data", who: "System", when: sel.range.to.toISOString(), note: null, done: true });
  }
  (row?.activity || []).forEach((a) =>
    trail.push({
      action: ACTION_LABEL[a.action] || a.action,
      who: a.actor_user_id ? names.get(a.actor_user_id) || "Unknown user" : "System",
      when: a.created_at.toISOString(),
      note: a.note,
      done: true,
    }),
  );
  if (status === "SUBMITTED") trail.push({ action: "Waiting for approval", who: "Leadership", when: null, note: null, done: false });
  if (status === "DRAFT" || status === "RETURNED") {
    trail.push({
      action: "Waiting for submission",
      who: preparedId ? names.get(preparedId) || def.hod_role : def.hod_role,
      when: status === "DRAFT" ? `Due ${longDate(due)}` : null,
      note: null,
      done: false,
    });
  }

  return {
    id: row?.id ?? null,
    status,
    status_label: STATUS_LABEL[status],
    overdue: isOverdue(status, sel.range),
    due_date: isoDate(due),
    submitted_at: row?.submitted_at?.toISOString() ?? null,
    approved_at: row?.approved_at?.toISOString() ?? null,
    returned_at: row?.returned_at?.toISOString() ?? null,
    prepared_by: preparedId ? { id: preparedId, name: names.get(preparedId) || null } : null,
    commentary: {
      wins: row?.wins ?? "",
      challenges: row?.challenges ?? "",
      plans: row?.plans ?? "",
      testimonies: row?.testimonies ?? "",
    },
    requests: (row?.requests || []).map((q) => ({
      id: q.id,
      text: q.body,
      needs_decision: q.needs_decision,
      outcome: q.outcome,
      response: q.response,
      decided_at: q.decided_at?.toISOString() ?? null,
      decided_by: q.decided_by_user_id ? names.get(q.decided_by_user_id) || null : null,
    })),
    trail,
    comments: (row?.comments || []).map((c) => ({
      id: c.id,
      author: names.get(c.author_user_id) || "Unknown user",
      author_id: c.author_user_id,
      when: c.created_at.toISOString(),
      text: c.body,
    })),
  };
};

const workflowNameIds = (row: WorkflowRow | null) =>
  row
    ? [
        row.prepared_by_user_id,
        row.submitted_by_user_id,
        row.acted_by_user_id,
        ...row.activity.map((a) => a.actor_user_id),
        ...row.comments.map((c) => c.author_user_id),
        ...row.requests.map((q) => q.decided_by_user_id),
      ]
    : [];

const permissionsFor = (viewer: Viewer, def: ReportDefinition, status: DepartmentReportStatus, sel: Selection) => {
  // Mirrors loadForWrite: branch-limited callers can't write the church-wide report.
  const writable = !(sel.branchKey === 0 && getBranchScope()?.allowedBranchIds);
  const hod = writable && isHod(viewer, def.key);
  const leader = writable && viewer.reportsAdmin;
  const editable = status === "DRAFT" || status === "RETURNED";
  return {
    can_edit: hod && editable,
    can_submit: hod && editable && periodEnded(sel.range),
    can_approve: leader && status === "SUBMITTED",
    can_return: leader && status === "SUBMITTED",
    can_comment: writable,
    can_decide: leader && (status === "SUBMITTED" || status === "APPROVED"),
    can_remind: leader && editable,
  };
};

const branchName = async (branchId: number | null) => {
  if (!branchId) return "All branches";
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
  return branch?.name || "Branch";
};

const periodPayload = (sel: Selection) => {
  const prev = previousRange(sel.range);
  const yoy = yoyRange(sel.range);
  return {
    type: sel.range.type,
    key: sel.range.key,
    label: sel.range.label,
    from: isoDate(sel.range.from),
    to: isoDate(new Date(sel.range.to.getTime() - 86_400_000)),
    in_progress: !periodEnded(sel.range),
    due_date: isoDate(dueDate(sel.range)),
    prev_label: prev.label,
    yoy_label: yoy.label,
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Reads                                     */
/* -------------------------------------------------------------------------- */

export const getReport = async (viewer: Viewer, query: Record<string, unknown>) => {
  const def = requireDefinition(query.report_key);
  if (!canView(viewer, def.key)) throw new UnauthorizedError("Not authorized to view this report");
  const sel = readSelection(query);

  const [computed, row, branch] = await Promise.all([
    sel.range.from <= new Date()
      ? safeCompute(def, sel.range, sel.branchId)
      : Promise.resolve({ result: { body: { ...emptyBody(), empty: true }, facts: {} }, failed: false }),
    findWorkflow(def.key, sel),
    branchName(sel.branchId),
  ]);
  const names = await namesOf(workflowNameIds(row));
  const workflow = serializeWorkflow(def, sel, row, names);

  return {
    meta: { key: def.key, area: def.area, name: def.name, hod_role: def.hod_role, cadence: def.cadence },
    period: periodPayload(sel),
    period_options: periodOptions(sel.range.type, new Date()),
    branch: { id: sel.branchId, name: branch },
    workflow,
    permissions: permissionsFor(viewer, def, workflow.status, sel),
    body: { ...redact(computed.result.body, viewer), restricted: !viewer.seesNames },
    failed: computed.failed,
  };
};

const headlineOf = (body: ReportBodyDTO): KpiDTO[] =>
  body.headline.map((i) => body.kpis[i]).filter((k): k is KpiDTO => Boolean(k));

export const listReports = async (viewer: Viewer, query: Record<string, unknown>) => {
  const sel = readSelection(query);
  const defs = REPORTS.filter((d) => canView(viewer, d.key));
  const [computed, rows, branch] = await Promise.all([
    Promise.all(defs.map((d) => safeCompute(d, sel.range, sel.branchId))),
    prisma.department_reports.findMany({
      where: { period_type: sel.range.type, period_key: sel.range.key, branch_key: sel.branchKey },
      include: workflowInclude,
    }),
    branchName(sel.branchId),
  ]);
  const byKey = new Map(rows.map((r) => [r.report_key, r]));
  const names = await namesOf(rows.flatMap(workflowNameIds));

  return {
    period: periodPayload(sel),
    period_options: periodOptions(sel.range.type, new Date()),
    branch: { id: sel.branchId, name: branch },
    viewer: { is_leadership: viewer.reportsAdmin, hod_of: defs.filter((d) => isHod(viewer, d.key)).map((d) => d.key) },
    reports: defs.map((def, i) => {
      const row = byKey.get(def.key) || null;
      const workflow = serializeWorkflow(def, sel, row, names);
      const body = computed[i].result.body;
      return {
        key: def.key,
        area: def.area,
        name: def.name,
        hod_role: def.hod_role,
        cadence: def.cadence,
        status: workflow.status,
        status_label: workflow.status_label,
        overdue: workflow.overdue,
        due_date: workflow.due_date,
        submitted_at: workflow.submitted_at,
        approved_at: workflow.approved_at,
        returned_at: workflow.returned_at,
        prepared_by: workflow.prepared_by,
        health: body.health,
        headline: headlineOf(body),
        failed: computed[i].failed,
        permissions: permissionsFor(viewer, def, workflow.status, sel),
      };
    }),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Writes                                   */
/* -------------------------------------------------------------------------- */

const text = (value: unknown, max = 5000) => String(value ?? "").trim().slice(0, max);

const notify = async (
  recipients: number[],
  actorId: number,
  type: string,
  title: string,
  body: string,
  def: ReportDefinition,
  sel: Selection,
  dedupe: string,
) => {
  const ids = Array.from(new Set(recipients)).filter((id) => id && id !== actorId);
  if (!ids.length) return;
  const actionUrl = `/home/reports/department/${def.key}?period_type=${sel.range.type}&period_key=${encodeURIComponent(sel.range.key)}${sel.branchId ? `&branch_id=${sel.branchId}` : ""}`;
  try {
    await notificationService.createManyInAppNotifications(
      ids.map((recipientUserId) => ({
        type,
        title,
        body,
        recipientUserId,
        actorUserId: actorId,
        entityType: "DEPARTMENT_REPORT",
        entityId: `${def.key}:${sel.range.type}:${sel.range.key}:${sel.branchKey}`,
        actionUrl,
        dedupeKey: `${dedupe}:${recipientUserId}`,
      })),
    );
  } catch (error) {
    console.error("[department-reports] notification failed", error);
  }
};

const hodRecipients = async (def: ReportDefinition, row: WorkflowRow) => {
  const direct = [row.submitted_by_user_id, row.prepared_by_user_id].filter((id): id is number => Boolean(id));
  return direct.length ? direct : listUserIdsWithDomainPermission(def.domain, "manage");
};

const loadForWrite = async (viewer: Viewer, body: Record<string, unknown>) => {
  const def = requireDefinition(body.report_key);
  if (!canView(viewer, def.key)) throw new UnauthorizedError("Not authorized to view this report");
  const sel = readSelection(body);
  // Someone limited to some branches sees only their branches' numbers under
  // "All branches", so they must not write to the church-wide report.
  if (sel.branchKey === 0 && getBranchScope()?.allowedBranchIds) {
    throw new UnauthorizedError("Pick your branch to work on this report");
  }
  const row = await ensureWorkflow(def.key, sel);
  return { def, sel, row };
};

/** Moves a report between states only if nobody else moved it first. */
const transition = async (
  row: WorkflowRow,
  from: DepartmentReportStatus[],
  data: Prisma.department_reportsUpdateManyMutationInput,
  extra: (tx: Prisma.TransactionClient) => Promise<unknown>,
  conflict: string,
) =>
  prisma.$transaction(async (tx) => {
    const moved = await tx.department_reports.updateMany({ where: { id: row.id, status: { in: from } }, data });
    if (moved.count === 0) throw new AppError(conflict, 409);
    await extra(tx);
  });

const reread = async (viewer: Viewer, def: ReportDefinition, sel: Selection) =>
  getReport(viewer, {
    report_key: def.key,
    period_type: sel.range.type,
    period_key: sel.range.key,
    branch_id: sel.branchId ?? undefined,
  });

export const saveCommentary = async (viewer: Viewer, body: Record<string, unknown>) => {
  const { def, sel, row } = await loadForWrite(viewer, body);
  if (!isHod(viewer, def.key)) throw new UnauthorizedError("Only the head of department can edit this commentary");
  if (row.status !== "DRAFT" && row.status !== "RETURNED") {
    throw new AppError("This report is locked while leadership reviews it", 409);
  }

  const incoming = Array.isArray(body.requests) ? (body.requests as any[]) : null;
  await prisma.$transaction(async (tx) => {
    await tx.department_reports.update({
      where: { id: row.id },
      data: {
        ...(body.wins !== undefined ? { wins: text(body.wins) } : {}),
        ...(body.challenges !== undefined ? { challenges: text(body.challenges) } : {}),
        ...(body.plans !== undefined ? { plans: text(body.plans) } : {}),
        ...(body.testimonies !== undefined ? { testimonies: text(body.testimonies) } : {}),
        prepared_by_user_id: viewer.userId,
      },
    });
    if (!incoming) return;
    // Decided requests are history: keep them as they are.
    const decided = row.requests.filter((q) => q.outcome);
    const keepIds = new Set<number>();
    for (const [index, raw] of incoming.slice(0, 20).entries()) {
      const bodyText = text(raw?.text, 1000);
      if (!bodyText) continue;
      const id = Number(raw?.id);
      const existing = row.requests.find((q) => q.id === id && !q.outcome);
      if (existing) {
        keepIds.add(existing.id);
        await tx.department_report_requests.update({
          where: { id: existing.id },
          data: { body: bodyText, needs_decision: raw?.needs_decision !== false, position: index },
        });
      } else if (!decided.some((q) => q.id === id)) {
        await tx.department_report_requests.create({
          data: { report_id: row.id, body: bodyText, needs_decision: raw?.needs_decision !== false, position: index },
        });
      }
    }
    const stale = row.requests.filter((q) => !q.outcome && !keepIds.has(q.id)).map((q) => q.id);
    if (stale.length) await tx.department_report_requests.deleteMany({ where: { id: { in: stale } } });
  });
  return reread(viewer, def, sel);
};

export const submitReport = async (viewer: Viewer, body: Record<string, unknown>) => {
  const { def, sel, row } = await loadForWrite(viewer, body);
  if (!isHod(viewer, def.key)) throw new UnauthorizedError("Only the head of department can submit this report");
  if (row.status !== "DRAFT" && row.status !== "RETURNED") throw new AppError("This report has already been submitted", 409);
  if (!periodEnded(sel.range)) throw new InputValidationError("This period has not finished yet. Submit it once the period closes.");

  const resubmit = row.status === "RETURNED";
  await transition(
    row,
    ["DRAFT", "RETURNED"],
    { status: "SUBMITTED", submitted_at: new Date(), submitted_by_user_id: viewer.userId },
    (tx) => tx.department_report_activity.create({ data: { report_id: row.id, action: resubmit ? "RESUBMITTED" : "SUBMITTED", actor_user_id: viewer.userId } }),
    "This report has already been submitted",
  );
  const [leaders, me] = await Promise.all([listUserIdsWithDomainPermission("Reports", "admin"), namesOf([viewer.userId])]);
  await notify(
    leaders,
    viewer.userId,
    "department_report.submitted",
    `${def.name} submitted`,
    `${me.get(viewer.userId) || "A head of department"} submitted the ${def.name.toLowerCase()} for ${sel.range.label}. Approve it or return it with a note.`,
    def,
    sel,
    `dept-report:${row.id}:submitted:${Date.now()}`,
  );
  return reread(viewer, def, sel);
};

export const approveReport = async (viewer: Viewer, body: Record<string, unknown>) => {
  if (!viewer.reportsAdmin) throw new UnauthorizedError("Not authorized to sign off reports");
  const { def, sel, row } = await loadForWrite(viewer, body);
  if (row.status !== "SUBMITTED") throw new AppError("Only submitted reports can be approved", 409);
  await transition(
    row,
    ["SUBMITTED"],
    { status: "APPROVED", approved_at: new Date(), acted_by_user_id: viewer.userId },
    (tx) => tx.department_report_activity.create({ data: { report_id: row.id, action: "APPROVED", actor_user_id: viewer.userId } }),
    "Only submitted reports can be approved",
  );
  await notify(
    await hodRecipients(def, row),
    viewer.userId,
    "department_report.approved",
    `${def.name} approved`,
    `Leadership approved the ${def.name.toLowerCase()} for ${sel.range.label}. It is now locked.`,
    def,
    sel,
    `dept-report:${row.id}:approved`,
  );
  return reread(viewer, def, sel);
};

export const returnReport = async (viewer: Viewer, body: Record<string, unknown>) => {
  if (!viewer.reportsAdmin) throw new UnauthorizedError("Not authorized to sign off reports");
  const note = text(body.note, 2000);
  if (!note) throw new InputValidationError("Add a note so the head of department knows what to change");
  const { def, sel, row } = await loadForWrite(viewer, body);
  if (row.status !== "SUBMITTED") throw new AppError("Only submitted reports can be returned", 409);
  await transition(
    row,
    ["SUBMITTED"],
    { status: "RETURNED", returned_at: new Date(), acted_by_user_id: viewer.userId },
    async (tx) => {
      await tx.department_report_activity.create({ data: { report_id: row.id, action: "RETURNED", actor_user_id: viewer.userId, note } });
      await tx.department_report_comments.create({ data: { report_id: row.id, author_user_id: viewer.userId, body: note } });
    },
    "Only submitted reports can be returned",
  );
  await notify(
    await hodRecipients(def, row),
    viewer.userId,
    "department_report.returned",
    `${def.name} returned`,
    `Leadership returned the ${def.name.toLowerCase()} for ${sel.range.label}: “${note.slice(0, 160)}”`,
    def,
    sel,
    `dept-report:${row.id}:returned:${Date.now()}`,
  );
  return reread(viewer, def, sel);
};

export const addComment = async (viewer: Viewer, body: Record<string, unknown>) => {
  const comment = text(body.text, 2000);
  if (!comment) throw new InputValidationError("Write a comment first");
  const { def, sel, row } = await loadForWrite(viewer, body);
  await prisma.department_report_comments.create({ data: { report_id: row.id, author_user_id: viewer.userId, body: comment } });
  const recipients = viewer.reportsAdmin ? await hodRecipients(def, row) : await listUserIdsWithDomainPermission("Reports", "admin");
  await notify(
    recipients,
    viewer.userId,
    "department_report.comment_added",
    `New comment on the ${def.name.toLowerCase()}`,
    comment.slice(0, 200),
    def,
    sel,
    `dept-report:${row.id}:comment:${Date.now()}`,
  );
  return reread(viewer, def, sel);
};

export const sendReminder = async (viewer: Viewer, body: Record<string, unknown>) => {
  if (!viewer.reportsAdmin) throw new UnauthorizedError("Not authorized to send reminders");
  const { def, sel, row } = await loadForWrite(viewer, body);
  if (row.status !== "DRAFT" && row.status !== "RETURNED") throw new AppError("This report is already submitted", 409);
  const recipients = await hodRecipients(def, row);
  await notify(
    recipients,
    viewer.userId,
    "department_report.reminder",
    `${def.name} is due`,
    `The ${def.name.toLowerCase()} for ${sel.range.label} was due on ${longDate(dueDate(sel.range))}. Check the numbers, add your commentary and submit.`,
    def,
    sel,
    `dept-report:${row.id}:reminder:${isoDate(new Date())}`,
  );
  await prisma.department_report_activity.create({ data: { report_id: row.id, action: "REMINDED", actor_user_id: viewer.userId } });
  return { sent_to: recipients.filter((id) => id !== viewer.userId).length };
};

export const decideRequest = async (viewer: Viewer, body: Record<string, unknown>) => {
  if (!viewer.reportsAdmin) throw new UnauthorizedError("Not authorized to decide on requests");
  const id = Number(body.request_id);
  if (!Number.isInteger(id) || id <= 0) throw new InputValidationError("request_id is required");
  const decision = String(body.decision || "").toUpperCase();
  if (decision !== "APPROVE" && decision !== "RESPOND") throw new InputValidationError("decision must be APPROVE or RESPOND");
  const response = text(body.response, 2000);
  if (decision === "RESPOND" && !response) throw new InputValidationError("Write your response first");

  const request = await prisma.department_report_requests.findUnique({ where: { id }, include: { report: true } });
  if (!request) throw new NotFoundError("Request not found");
  if (request.outcome) throw new AppError("This request has already been decided", 409);
  const report = request.report;
  if (report.status !== "SUBMITTED" && report.status !== "APPROVED") {
    throw new AppError("Leadership can decide once the report is submitted", 409);
  }
  if (report.branch_key === 0 && getBranchScope()?.allowedBranchIds) {
    throw new UnauthorizedError("Not authorized for the church-wide report");
  }
  if (report.branch_key && getBranchScope()?.allowedBranchIds && !getBranchScope()!.allowedBranchIds!.includes(report.branch_key)) {
    throw new UnauthorizedError("Not authorized for this branch");
  }
  const def = requireDefinition(report.report_key);

  await prisma.$transaction([
    prisma.department_report_requests.update({
      where: { id },
      data: {
        outcome: decision === "APPROVE" ? "APPROVED" : "RESPONDED",
        response: response || null,
        decided_by_user_id: viewer.userId,
        decided_at: new Date(),
      },
    }),
    ...(response
      ? [prisma.department_report_comments.create({ data: { report_id: report.id, author_user_id: viewer.userId, body: `On “${request.body.slice(0, 120)}”: ${response}` } })]
      : []),
  ]);
  const sel: Selection = {
    range: parsePeriod(report.period_type, report.period_key),
    branchId: report.branch_key || null,
    branchKey: report.branch_key,
  };
  const row = await findWorkflow(def.key, sel);
  if (row) {
    await notify(
      await hodRecipients(def, row),
      viewer.userId,
      "department_report.request_decided",
      decision === "APPROVE" ? "Request approved" : "Leadership responded to your request",
      `${request.body.slice(0, 120)}${response ? ` — ${response.slice(0, 120)}` : ""}`,
      def,
      sel,
      `dept-report-request:${id}`,
    );
  }
  return { id, outcome: decision === "APPROVE" ? "APPROVED" : "RESPONDED", response: response || null };
};

/* -------------------------------------------------------------------------- */
/*                              Executive summary                             */
/* -------------------------------------------------------------------------- */

const RANK = { act: 0, watch: 1, ok: 2 } as const;

export const executiveSummary = async (viewer: Viewer, query: Record<string, unknown>) => {
  if (!viewer.reportsView) throw new UnauthorizedError("Not authorized to view the executive summary");
  const type = String(query.period_type || "MONTHLY").toUpperCase();
  if (!["MONTHLY", "QUARTERLY", "ANNUAL"].includes(type)) {
    throw new InputValidationError("The executive summary is monthly, quarterly or annual");
  }
  const sel = readSelection({ ...query, period_type: type });
  const now = new Date();

  const [computed, rows, branch] = await Promise.all([
    Promise.all(REPORTS.map((d) => safeCompute(d, sel.range, sel.branchId))),
    prisma.department_reports.findMany({
      where: { period_type: sel.range.type, period_key: sel.range.key },
      include: workflowInclude,
    }),
    branchName(sel.branchId),
  ]);
  const scoped = rows.filter((r) => r.branch_key === sel.branchKey);
  const byKey = new Map(scoped.map((r) => [r.report_key, r]));
  const names = await namesOf(scoped.flatMap(workflowNameIds));
  const result = (key: ReportKey) => computed[REPORTS.findIndex((d) => d.key === key)].result;

  const reports = REPORTS.map((def, i) => {
    const row = byKey.get(def.key) || null;
    return { def, row, workflow: serializeWorkflow(def, sel, row, names), body: computed[i].result.body, failed: computed[i].failed };
  });

  const ordered = reports.slice().sort((a, b) => RANK[a.body.health] - RANK[b.body.health]);
  const top: { key: ReportKey; area: string; flag: FlagDTO }[] = [];
  (["act", "watch"] as const).forEach((severity) =>
    ordered.forEach((r) => {
      const f = r.body.flags.find((x) => x.severity === severity);
      if (f) top.push({ key: r.def.key, area: r.def.area, flag: f });
    }),
  );

  const trackOrder = (s: { overdue: boolean; status: DepartmentReportStatus }) =>
    s.overdue ? 0 : s.status === "RETURNED" ? 1 : s.status === "DRAFT" ? 2 : s.status === "SUBMITTED" ? 3 : 4;

  const requests = scoped
    .filter((row) => row.status === "SUBMITTED" || row.status === "APPROVED")
    .flatMap((row) => row.requests.filter((q) => q.needs_decision).map((q) => ({ row, q })))
    .map(({ row, q }) => {
      const def = REPORT_MAP.get(row.report_key as ReportKey)!;
      const author = row.submitted_by_user_id || row.prepared_by_user_id;
      return {
        id: q.id,
        report_key: def.key,
        text: q.body,
        from: `${author ? names.get(author) || def.hod_role : def.hod_role} · ${def.area}`,
        outcome: q.outcome,
        response: q.response,
      };
    })
    .sort((a, b) => (a.outcome ? 1 : 0) - (b.outcome ? 1 : 0));

  const visitors = result("visitors").facts;
  const souls = result("lifecenters").facts;
  const membership = result("membership").facts;
  const visitorsN = Number(visitors.first_time_visitors ?? 0);
  const soulsN = Number(souls.souls_won ?? 0);
  const newMembers = Number(membership.new_members ?? 0);
  const pipeline = [
    { label: "Visitors", value: visitorsN, sub: "First-time this period" },
    { label: "Souls won", value: soulsN, sub: "In life centers" },
    {
      label: "New members",
      value: newMembers,
      sub: visitorsN + soulsN > 0 ? `${Math.round((newMembers / (visitorsN + soulsN)) * 100)}% of visitors and souls won` : "Joined this period",
    },
    {
      label: "Serving in a department",
      value: membership.serving_new_members ?? null,
      sub: "New members who joined a team within 90 days",
    },
  ];

  let branches: Record<string, unknown>[] | null = null;
  if (!sel.branchId) {
    const list = await visibleBranches();
    if (list.length > 1) {
      const keys: ReportKey[] = ["attendance", "visitors", "membership", "finance", "lifecenters"];
      // One branch at a time: each branch runs five report builds, and doing
      // them all at once can exhaust the Prisma connection pool.
      const rowsOut: Record<string, unknown>[] = [];
      for (const b of list) {
        rowsOut.push(
          await (async () => {
          const res = await Promise.all(keys.map((k) => safeCompute(REPORT_MAP.get(k)!, sel.range, b.id)));
          const f = Object.fromEntries(keys.map((k, i) => [k, res[i].result.facts]));
          const att = Number(f.attendance.avg_sunday_attendance ?? 0);
          const inCount = rows.filter((r) => r.branch_key === b.id && r.status !== "DRAFT").length;
          return {
            id: b.id,
            name: b.name,
            avg_sunday_attendance: att || null,
            visitors_per_100: att ? Math.round((Number(f.visitors.first_time_visitors ?? 0) / att) * 1000) / 10 : null,
            new_members: f.membership.new_members ?? null,
            giving_per_attendee: att ? Math.round(Number(f.finance.total_income ?? 0) / att) : null,
            life_centers_meeting: f.lifecenters.centers_total != null ? `${nf(f.lifecenters.centers_meeting ?? 0)} of ${nf(f.lifecenters.centers_total)}` : null,
            reports_in: `${inCount} of ${REPORTS.length}`,
          };
          })(),
        );
      }
      branches = rowsOut;
    }
  }

  const submitted = reports.filter((r) => r.workflow.status !== "DRAFT").length;
  return {
    period: periodPayload(sel),
    period_options: periodOptions(sel.range.type, now),
    branch: { id: sel.branchId, name: branch },
    viewer: { is_leadership: viewer.reportsAdmin },
    empty: reports.every((r) => r.body.empty),
    cards: reports.map((r) => ({
      key: r.def.key,
      area: r.def.area,
      health: r.body.health,
      headline: headlineOf(r.body),
      status: r.workflow.status,
      status_label: r.workflow.status_label,
      overdue: r.workflow.overdue,
      prepared_by: r.workflow.prepared_by?.name || r.def.hod_role,
      failed: r.failed,
    })),
    top: top.slice(0, 5).map((t) => ({ report_key: t.key, area: t.area, ...t.flag })),
    tracker: {
      submitted,
      total: REPORTS.length,
      due_date: isoDate(dueDate(sel.range)),
      items: reports
        .map((r) => ({
          report_key: r.def.key,
          area: r.def.area,
          prepared_by: r.workflow.prepared_by?.name || r.def.hod_role,
          status: r.workflow.status,
          status_label: r.workflow.status_label,
          overdue: r.workflow.overdue,
          submitted_at: r.workflow.submitted_at,
          returned_at: r.workflow.returned_at,
          approved_at: r.workflow.approved_at,
        }))
        .sort((a, b) => trackOrder(a) - trackOrder(b)),
    },
    requests,
    pipeline,
    branches,
    totals: { flags: sum(reports.map((r) => r.body.flags.length)) },
  };
};
