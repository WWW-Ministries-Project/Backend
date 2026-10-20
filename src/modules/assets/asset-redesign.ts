import { Prisma, RequestApprovalStatus, asset_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { triggerRequisitionNotificationEventProcessing } from "../requisitions/requisition-approval-workflow";
import { createRequisitionTx } from "../requisitions/requisition-service";

/**
 * Assets redesign: the register overview, per-asset history, status changes
 * (single and bulk, with undo), lost confirmation and repair requisitions.
 *
 * The legacy create/list/get/update/delete endpoints keep their shapes.
 * Shapes are documented in docs/ASSETS_REDESIGN_FRONTEND_GUIDE.md.
 */

export type AssetAccess = {
  canViewAll: boolean;
  canManage: boolean;
  canAdmin: boolean;
  departmentIds: number[];
};

export type HistoryTone = "neutral" | "info" | "success" | "warning" | "danger";
type RequisitionStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";

export const ASSET_CATEGORIES: { key: string; label: string }[] = [
  { key: "sound", label: "Sound" },
  { key: "music", label: "Musical instruments" },
  { key: "media", label: "Media and IT" },
  { key: "furniture", label: "Furniture" },
  { key: "appliance", label: "Appliances" },
  { key: "vehicle", label: "Vehicles" },
  { key: "other", label: "Other" },
];
const CATEGORY_KEYS = new Set(ASSET_CATEGORIES.map((category) => category.key));

export const STATUS_LABEL: Record<asset_status, string> = {
  ASSIGNED: "Assigned",
  UNASSIGNED: "In store",
  NEEDS_REPAIR: "Needs repair",
  OUT_OF_REPAIRS: "Under repair",
  NOT_FIXABLE: "Beyond repair",
  LOST_OR_STOLEN: "Lost or stolen",
};
export const STATUS_TONE: Record<asset_status, HistoryTone> = {
  ASSIGNED: "success",
  UNASSIGNED: "neutral",
  NEEDS_REPAIR: "warning",
  OUT_OF_REPAIRS: "info",
  NOT_FIXABLE: "danger",
  LOST_OR_STOLEN: "danger",
};
/** Statuses that keep the last holder and carry a note. */
export const OUT_OF_USE: asset_status[] = [
  asset_status.NEEDS_REPAIR,
  asset_status.OUT_OF_REPAIRS,
  asset_status.NOT_FIXABLE,
  asset_status.LOST_OR_STOLEN,
];
/** A repair requisition link only means something while it's being repaired. */
const KEEPS_REPAIR_LINK: asset_status[] = [asset_status.NEEDS_REPAIR, asset_status.OUT_OF_REPAIRS];
const NOTE_REQUIRED: asset_status[] = [
  asset_status.NEEDS_REPAIR,
  asset_status.NOT_FIXABLE,
  asset_status.LOST_OR_STOLEN,
];

/** Repairs longer than this are flagged under "Needs your attention". */
const REPAIR_STALE_DAYS = 30;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export const money = (value: number) =>
  `GHS ${(Number(value) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toIdList = (value: unknown): number[] => {
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map(toPositiveInt).filter((id): id is number => id !== null)));
};

const parseDate = (value: unknown, label: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00.000Z` : String(value));
  if (Number.isNaN(date.getTime())) throw new InputValidationError(`${label} isn't a valid date.`);
  return date;
};

const parseStatus = (value: unknown): asset_status => {
  const status = String(value || "").trim().toUpperCase() as asset_status;
  if (!Object.values(asset_status).includes(status)) {
    throw new InputValidationError("Choose a valid status.");
  }
  return status;
};

const toRequisitionStatus = (raw: RequestApprovalStatus): RequisitionStatus =>
  raw === RequestApprovalStatus.Draft
    ? "DRAFT"
    : raw === RequestApprovalStatus.APPROVED
      ? "APPROVED"
      : raw === RequestApprovalStatus.REJECTED
        ? "REJECTED"
        : "PENDING";

export const accessOf = (req: any): AssetAccess => {
  const access = req?.assetAccess;
  return {
    canViewAll: Boolean(access?.canViewAll),
    canManage: Boolean(access?.canManage),
    canAdmin: Boolean(access?.canAdmin),
    departmentIds: Array.isArray(access?.departmentIds) ? access.departmentIds : [],
  };
};

export const actorOf = async (user: any): Promise<{ id: number; name: string }> => {
  const id = toPositiveInt(user?.id);
  if (!id) throw new UnauthorizedError("Authenticated user not found");
  const row = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return { id, name: row?.name?.trim() || String(user?.name || "Someone") };
};

/** Writes carry the active branch in the body (client branch scoping). */
export const writeBranch = (req: any) => req?.body?.branch_id ?? req?.query?.branch_id;

const requireManage = (access: AssetAccess) => {
  if (!access.canManage) throw new UnauthorizedError("You can't change assets.");
};

/** Where clause for what this viewer may see in the active branch. */
export const assetScopeWhere = (access: AssetAccess, branchId: unknown): Prisma.assetsWhereInput => ({
  ...(getBranchScopedWhere(branchId) || {}),
  ...(access.canViewAll ? {} : { department_assigned: { in: access.departmentIds } }),
});

const ASSET_SELECT = {
  id: true,
  asset_id: true,
  name: true,
  category: true,
  status: true,
  department_assigned: true,
  date_assigned: true,
  date_purchased: true,
  supplier: true,
  price: true,
  description: true,
  photo: true,
  status_since: true,
  status_note: true,
  lost_confirmed_at: true,
  last_counted_at: true,
  created_at: true,
  branch_id: true,
  repair_request_id: true,
  assigned_to: { select: { id: true, name: true } },
  repair_request: { select: { id: true, request_id: true, request_approval_status: true } },
} satisfies Prisma.assetsSelect;

type AssetRecord = Prisma.assetsGetPayload<{ select: typeof ASSET_SELECT }>;

export type AssetRow = {
  id: number;
  code: string;
  name: string;
  category: string;
  status: asset_status;
  department: { id: number; name: string } | null;
  date_assigned: string | null;
  date_purchased: string | null;
  supplier: string | null;
  price: number;
  description: string | null;
  photo: string | null;
  status_since: string | null;
  status_note: string | null;
  lost_confirmed_at: string | null;
  last_counted_at: string | null;
  created_at: string;
  branch_id: number | null;
  repair_requisition: { id: number; generated_id: string; status: RequisitionStatus } | null;
};

export const toAssetRow = (asset: AssetRecord): AssetRow => ({
  id: asset.id,
  code: asset.asset_id || `#${asset.id}`,
  name: asset.name,
  category: asset.category && CATEGORY_KEYS.has(asset.category) ? asset.category : "other",
  status: asset.status || asset_status.UNASSIGNED,
  department: asset.assigned_to ? { id: asset.assigned_to.id, name: asset.assigned_to.name } : null,
  date_assigned: iso(asset.date_assigned),
  date_purchased: iso(asset.date_purchased),
  supplier: asset.supplier || null,
  price: Number(asset.price) || 0,
  description: asset.description || null,
  photo: asset.photo || null,
  status_since: iso(asset.status_since ?? asset.date_assigned ?? asset.date_purchased ?? asset.created_at),
  status_note: asset.status_note || null,
  lost_confirmed_at: iso(asset.lost_confirmed_at),
  last_counted_at: iso(asset.last_counted_at),
  created_at: asset.created_at.toISOString(),
  branch_id: asset.branch_id ?? null,
  repair_requisition: asset.repair_request
    ? {
        id: asset.repair_request.id,
        generated_id: asset.repair_request.request_id,
        status: toRequisitionStatus(asset.repair_request.request_approval_status),
      }
    : null,
});

const loadRows = async (ids: number[]) => {
  const rows = await prisma.assets.findMany({ where: { id: { in: ids } }, select: ASSET_SELECT });
  return rows.map(toAssetRow);
};

type HistoryInput = {
  assetId: number;
  at: Date;
  text: string;
  tone: HistoryTone;
  status?: asset_status | null;
  userId?: number | null;
};

export const historyData = (entry: HistoryInput): Prisma.asset_historyCreateManyInput => ({
  asset_id: entry.assetId,
  title: entry.text.slice(0, 191),
  description: entry.text.length > 191 ? entry.text : null,
  status_update: entry.status ?? null,
  update_date: entry.at,
  userId: entry.userId ?? null,
  tone: entry.tone,
});

const departmentName = async (id: number | null) => {
  if (!id) return null;
  const row = await prisma.department.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new InputValidationError("That department doesn't exist.");
  return row.name;
};

/** Same format as the legacy create endpoint: PREFIX-YYYY0001. */
export const assetCodeFor = (id: number, at = new Date()) =>
  `${process.env.ID_PREFIX || "WWM-HC-ASSET"}-${at.getFullYear()}${String(id).padStart(4, "0")}`;

/* -------------------------------------------------------------------------- */
/*                                   Reads                                    */
/* -------------------------------------------------------------------------- */

/** GET /assets/overview — the whole register the viewer can see, plus departments. */
export const getAssetOverview = async (req: any) => {
  const access = accessOf(req);
  const branchId = req.query?.branch_id;
  const [assets, departments] = await Promise.all([
    prisma.assets.findMany({
      where: assetScopeWhere(access, branchId),
      select: ASSET_SELECT,
      orderBy: [{ date_purchased: "desc" }, { id: "desc" }],
    }),
    prisma.department.findMany({
      where: getBranchScopedWhere(branchId) || {},
      select: { id: true, name: true, department_head_info: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    viewer: {
      user_id: toPositiveInt(req.user?.id),
      can_view_all: access.canViewAll,
      can_manage: access.canManage,
      can_delete: access.canAdmin,
      department_ids: access.departmentIds,
    },
    repair_stale_days: REPAIR_STALE_DAYS,
    categories: ASSET_CATEGORIES,
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      head: department.department_head_info
        ? { id: department.department_head_info.id, name: department.department_head_info.name }
        : null,
    })),
    assets: assets.map(toAssetRow),
  };
};

/** GET /assets/history?id= — newest last. Legacy assets get entries rebuilt from their fields. */
export const getAssetHistory = async (req: any) => {
  const access = accessOf(req);
  const id = toPositiveInt(req.query?.id);
  if (!id) throw new InputValidationError("An asset id is required.");
  const asset = await prisma.assets.findFirst({
    where: { id, ...assetScopeWhere(access, req.query?.branch_id) },
    select: ASSET_SELECT,
  });
  if (!asset) throw new NotFoundError("Asset not found");

  const rows = await prisma.asset_history.findMany({
    where: { asset_id: id },
    orderBy: [{ update_date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      update_date: true,
      tone: true,
      related_user: { select: { id: true, name: true } },
    },
  });

  const history = rows.map((row) => ({
    id: row.id,
    at: row.update_date.toISOString(),
    text: row.description || row.title,
    tone: (row.tone as HistoryTone) || "neutral",
    by: row.related_user ? { id: row.related_user.id, name: row.related_user.name } : null,
  }));

  if (!history.some((entry) => entry.text.startsWith("Added to the register"))) {
    const row = toAssetRow(asset);
    const rebuilt: typeof history = [];
    if (asset.date_purchased) {
      rebuilt.push({
        id: -1,
        at: asset.date_purchased.toISOString(),
        text: `Bought${asset.supplier ? ` from ${asset.supplier}` : ""} for ${money(row.price)}`,
        tone: "info",
        by: null,
      });
    }
    rebuilt.push({
      id: -2,
      at: asset.created_at.toISOString(),
      text: `Added to the register as ${row.code}`,
      tone: "neutral",
      by: null,
    });
    if (asset.assigned_to && asset.date_assigned && !history.length) {
      rebuilt.push({
        id: -3,
        at: asset.date_assigned.toISOString(),
        text: `Assigned to ${asset.assigned_to.name}`,
        tone: "success",
        by: null,
      });
    }
    history.unshift(...rebuilt);
  }

  return { asset_id: id, history };
};

/* -------------------------------------------------------------------------- */
/*                              Create and edit                               */
/* -------------------------------------------------------------------------- */

/** POST /assets/save-asset — create (no id) or edit, with history. */
export const saveAsset = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const body = req.body || {};
  const id = toPositiveInt(body.id);

  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const supplier = String(body.supplier || "").trim();
  const price = Number(body.price);
  const status = parseStatus(body.status || asset_status.UNASSIGNED);
  const purchased = parseDate(body.date_purchased, "Date bought");
  const errors: string[] = [];
  if (!name) errors.push("Give the asset a name.");
  if (!CATEGORY_KEYS.has(category)) errors.push("Choose a category.");
  if (!purchased) errors.push("Add the date it was bought.");
  if (!(price > 0)) errors.push("Enter what it cost.");
  if (!description) errors.push("Add a short description so others can recognise it.");

  const keepsDept = status === asset_status.ASSIGNED || OUT_OF_USE.includes(status);
  const departmentId = keepsDept ? toPositiveInt(body.department_id ?? body.department_assigned) : null;
  if (status === asset_status.ASSIGNED && !departmentId) errors.push("Choose the department it's assigned to.");
  const assigned =
    status === asset_status.ASSIGNED ? parseDate(body.date_assigned, "Date of assignment") || new Date() : null;
  if (purchased && assigned && assigned < purchased) errors.push("An asset can't be assigned before it was bought.");
  if (errors.length) throw new InputValidationError(errors.join(" "));
  const deptName = await departmentName(departmentId);
  const note = String(body.status_note || "").trim() || null;
  const photo = body.photo ? String(body.photo) : null;
  const now = new Date();

  if (!id) {
    const created = await prisma.$transaction(async (tx) => {
      const asset = await tx.assets.create({
        data: {
          name,
          category,
          description,
          supplier: supplier || null,
          price,
          status,
          date_purchased: purchased,
          date_assigned: assigned,
          department_assigned: departmentId,
          status_since: assigned || now,
          status_note: OUT_OF_USE.includes(status) ? note : null,
          photo,
          created_by: actor.id,
          branch_id: await resolveBranchIdOrDefault(body.branch_id ?? req.query?.branch_id),
        },
        select: { id: true },
      });
      const code = assetCodeFor(asset.id, now);
      await tx.assets.update({ where: { id: asset.id }, data: { asset_id: code } });
      const entries: HistoryInput[] = [
        {
          assetId: asset.id,
          at: purchased || now,
          text: `Bought${supplier ? ` from ${supplier}` : ""} for ${money(price)}`,
          tone: "info",
        },
        { assetId: asset.id, at: now, text: `Added to the register as ${code} by ${actor.name}`, tone: "neutral", userId: actor.id },
      ];
      if (status === asset_status.ASSIGNED && deptName) {
        entries.push({ assetId: asset.id, at: assigned || now, text: `Assigned to ${deptName}`, tone: "success", status });
      } else if (OUT_OF_USE.includes(status)) {
        entries.push({
          assetId: asset.id,
          at: now,
          text: `Marked ${STATUS_LABEL[status].toLowerCase()}${note ? `: ${note}` : ""}`,
          tone: STATUS_TONE[status],
          status,
        });
      }
      await tx.asset_history.createMany({ data: entries.map(historyData) });
      return asset.id;
    });
    return (await loadRows([created]))[0];
  }

  const existing = await prisma.assets.findFirst({
    where: { id, ...assetScopeWhere(access, writeBranch(req)) },
    select: ASSET_SELECT,
  });
  if (!existing) throw new NotFoundError("Asset not found");
  const changed =
    (existing.status || asset_status.UNASSIGNED) !== status || (existing.department_assigned ?? null) !== departmentId;

  await prisma.$transaction(async (tx) => {
    await tx.assets.update({
      where: { id },
      data: {
        name,
        category,
        description,
        supplier: supplier || null,
        price,
        status,
        date_purchased: purchased,
        date_assigned: status === asset_status.ASSIGNED ? assigned : existing.date_assigned,
        department_assigned: departmentId,
        status_since: changed ? now : existing.status_since,
        status_note: OUT_OF_USE.includes(status) ? (note ?? (changed ? null : existing.status_note)) : null,
        lost_confirmed_at: changed ? null : existing.lost_confirmed_at,
        repair_request_id: KEEPS_REPAIR_LINK.includes(status) ? existing.repair_request_id : null,
        ...(body.photo !== undefined ? { photo } : {}),
        ...(body.branch_id !== undefined
          ? { branch_id: await resolveBranchIdOrDefault(body.branch_id) }
          : {}),
        updated_by: actor.id,
        updated_at: now,
      },
    });
    const entries: HistoryInput[] = [
      { assetId: id, at: now, text: `Details edited by ${actor.name}`, tone: "neutral", userId: actor.id },
    ];
    if (changed) {
      entries.push({
        assetId: id,
        at: now,
        text:
          status === asset_status.ASSIGNED
            ? `Assigned to ${deptName}`
            : status === asset_status.UNASSIGNED
              ? "Returned to the store"
              : `Marked ${STATUS_LABEL[status].toLowerCase()}${note ? `: ${note}` : ""}`,
        tone: STATUS_TONE[status],
        status,
        userId: actor.id,
      });
    }
    await tx.asset_history.createMany({ data: entries.map(historyData) });
  });
  return (await loadRows([id]))[0];
};

/* -------------------------------------------------------------------------- */
/*                               Status changes                               */
/* -------------------------------------------------------------------------- */

type Snapshot = {
  id: number;
  status: asset_status;
  department_id: number | null;
  date_assigned: string | null;
  status_since: string | null;
  status_note: string | null;
  lost_confirmed_at: string | null;
  repair_request_id: number | null;
};

const snapshotOf = (asset: AssetRecord): Snapshot => ({
  id: asset.id,
  status: asset.status || asset_status.UNASSIGNED,
  department_id: asset.department_assigned ?? null,
  date_assigned: iso(asset.date_assigned),
  status_since: iso(asset.status_since),
  status_note: asset.status_note ?? null,
  lost_confirmed_at: iso(asset.lost_confirmed_at),
  repair_request_id: asset.repair_request_id ?? null,
});

/**
 * POST /assets/update-status { ids, status, department_id?, date?, note? }
 * Returns the updated rows and a snapshot of each asset before the change, for undo.
 */
export const updateAssetStatus = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const body = req.body || {};
  const ids = toIdList(body.ids ?? body.id);
  if (!ids.length) throw new InputValidationError("Choose at least one asset.");
  const status = parseStatus(body.status);
  const departmentId = toPositiveInt(body.department_id);
  const note = String(body.note || "").trim();
  const date = parseDate(body.date, "Effective date") || new Date();
  if (status === asset_status.ASSIGNED && !departmentId) throw new InputValidationError("Choose the department.");
  if (NOTE_REQUIRED.includes(status) && !note) {
    throw new InputValidationError("Add a note on what happened. It stays in the history.");
  }
  const deptName = await departmentName(status === asset_status.ASSIGNED ? departmentId : null);

  const assets = await prisma.assets.findMany({
    where: { id: { in: ids }, ...assetScopeWhere(access, writeBranch(req)) },
    select: ASSET_SELECT,
  });
  if (assets.length !== ids.length) throw new NotFoundError("Some of these assets weren't found.");

  const text =
    status === asset_status.ASSIGNED
      ? `Assigned to ${deptName}`
      : status === asset_status.UNASSIGNED
        ? "Returned to the store"
        : `Marked ${STATUS_LABEL[status].toLowerCase()}`;

  await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      await tx.assets.update({
        where: { id: asset.id },
        data: {
          status,
          status_since: date,
          department_assigned:
            status === asset_status.UNASSIGNED
              ? null
              : status === asset_status.ASSIGNED
                ? departmentId
                : asset.department_assigned,
          date_assigned: status === asset_status.ASSIGNED ? date : asset.date_assigned,
          status_note: OUT_OF_USE.includes(status) ? note || null : null,
          lost_confirmed_at: null,
          repair_request_id: KEEPS_REPAIR_LINK.includes(status) ? asset.repair_request_id : null,
          updated_by: actor.id,
          updated_at: new Date(),
        },
      });
    }
    await tx.asset_history.createMany({
      data: assets.map((asset) =>
        historyData({
          assetId: asset.id,
          at: date,
          text: `${text}${note ? `: ${note}` : ""} (by ${actor.name})`,
          tone: STATUS_TONE[status],
          status,
          userId: actor.id,
        }),
      ),
    });
  });

  return { assets: await loadRows(ids), previous: assets.map(snapshotOf) };
};

/** POST /assets/restore { snapshots } — undo of update-status / confirm-lost. */
export const restoreAssets = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const snapshots: Snapshot[] = Array.isArray(req.body?.snapshots) ? req.body.snapshots : [];
  const ids = toIdList(snapshots.map((snapshot) => snapshot?.id));
  if (!ids.length) throw new InputValidationError("Nothing to undo.");
  const allowed = await prisma.assets.findMany({
    where: { id: { in: ids }, ...assetScopeWhere(access, writeBranch(req)) },
    select: { id: true },
  });
  if (allowed.length !== ids.length) throw new NotFoundError("Some of these assets weren't found.");
  const requestIds = toIdList(snapshots.map((snapshot) => snapshot?.repair_request_id));
  const liveRequests = new Set(
    requestIds.length
      ? (await prisma.request.findMany({ where: { id: { in: requestIds } }, select: { id: true } })).map((row) => row.id)
      : [],
  );
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const snapshot of snapshots) {
      const id = toPositiveInt(snapshot?.id);
      if (!id) continue;
      await tx.assets.update({
        where: { id },
        data: {
          status: parseStatus(snapshot.status),
          department_assigned: toPositiveInt(snapshot.department_id),
          date_assigned: parseDate(snapshot.date_assigned, "Date assigned"),
          status_since: parseDate(snapshot.status_since, "Status date"),
          status_note: snapshot.status_note ? String(snapshot.status_note) : null,
          lost_confirmed_at: parseDate(snapshot.lost_confirmed_at, "Lost date"),
          repair_request_id: liveRequests.has(Number(snapshot.repair_request_id)) ? Number(snapshot.repair_request_id) : null,
          updated_by: actor.id,
          updated_at: now,
        },
      });
    }
    await tx.asset_history.createMany({
      data: ids.map((id) =>
        historyData({ assetId: id, at: now, text: `Last change undone by ${actor.name}`, tone: "neutral", userId: actor.id }),
      ),
    });
  });
  return { assets: await loadRows(ids) };
};

/** POST /assets/confirm-lost { id } — closes the search; stays on the register as lost. */
export const confirmAssetLost = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const id = toPositiveInt(req.body?.id);
  if (!id) throw new InputValidationError("An asset id is required.");
  const asset = await prisma.assets.findFirst({
    where: { id, ...assetScopeWhere(access, writeBranch(req)) },
    select: ASSET_SELECT,
  });
  if (!asset) throw new NotFoundError("Asset not found");
  if (asset.status !== asset_status.LOST_OR_STOLEN) {
    throw new InputValidationError("Only assets marked lost or stolen can be confirmed as lost.");
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.assets.update({ where: { id }, data: { lost_confirmed_at: now, updated_by: actor.id, updated_at: now } }),
    prisma.asset_history.create({
      data: historyData({
        assetId: id,
        at: now,
        text: `Confirmed as lost and written off by ${actor.name}. Search closed.`,
        tone: "danger",
        userId: actor.id,
      }) as Prisma.asset_historyUncheckedCreateInput,
    }),
  ]);
  return { asset: (await loadRows([id]))[0], previous: snapshotOf(asset) };
};

/* -------------------------------------------------------------------------- */
/*                              Repair requisitions                           */
/* -------------------------------------------------------------------------- */

/**
 * POST /assets/repair-requisition
 * { asset_ids, estimates: { [assetId]: amount }, needed_by, purpose, user_sign,
 *   fallback_department_id?, branch_id? }
 *
 * One requisition per department, each submitted into the usual approval chain.
 * Only assets marked NEEDS_REPAIR without a linked requisition are included.
 */
export const raiseRepairRequisitions = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const body = req.body || {};
  const ids = toIdList(body.asset_ids);
  if (!ids.length) throw new InputValidationError("Select assets that need repair.");
  const assets = await prisma.assets.findMany({
    where: { id: { in: ids }, ...assetScopeWhere(access, writeBranch(req)) },
    select: ASSET_SELECT,
  });
  const ok = assets.filter((asset) => asset.status === asset_status.NEEDS_REPAIR && !asset.repair_request_id);
  const skipped = assets.filter((asset) => !ok.includes(asset)).map((asset) => asset.name);
  if (!ok.length) {
    throw new InputValidationError(
      "Only assets marked “Needs repair” without an open repair requisition can be included.",
    );
  }

  const estimates = (body.estimates && typeof body.estimates === "object" ? body.estimates : {}) as Record<string, unknown>;
  const purpose = String(body.purpose || "").trim();
  const sign = String(body.user_sign || "").trim();
  const neededBy = parseDate(body.needed_by, "Needed by");
  const fallbackDept = toPositiveInt(body.fallback_department_id);
  const errors: string[] = [];
  if (ok.some((asset) => !(Number(estimates[asset.id]) > 0))) errors.push("Enter an estimated repair cost for every asset.");
  if (!purpose) errors.push("Say why the repair is needed.");
  if (!neededBy) errors.push("Add the date it's needed by.");
  if (!sign) errors.push("Type your full name to sign.");
  if (ok.some((asset) => !asset.department_assigned) && !fallbackDept) {
    errors.push("Choose which department raises the repair for items in the store.");
  }
  if (errors.length) throw new InputValidationError(errors.join(" "));

  const groups = new Map<number, AssetRecord[]>();
  ok.forEach((asset) => {
    const dept = asset.department_assigned || (fallbackDept as number);
    groups.set(dept, [...(groups.get(dept) || []), asset]);
  });

  const today = new Date().toISOString().slice(0, 10);

  // One transaction for every department: either all requisitions are created,
  // submitted and linked to their assets, or none are.
  const { made, submitted } = await prisma.$transaction(
    async (tx) => {
      const out: { id: number; generated_id: string; department_id: number; asset_ids: number[] }[] = [];
      let anySubmitted = false;
      const now = new Date();
      for (const [departmentId, list] of groups) {
        const created = await createRequisitionTx(
          tx,
          {
            request_date: today,
            department_id: departmentId,
            currency: "GHS",
            needed_by: body.needed_by,
            purpose,
            user_sign: sign,
            submit_for_approval: true,
            branch_id: list[0].branch_id ?? body.branch_id,
            products: list.map((asset) => ({
              name: `Repair: ${asset.name} (${asset.asset_id || `#${asset.id}`})`,
              quantity: 1,
              unitPrice: Number(estimates[asset.id]),
            })),
            attachmentLists: [],
          } as any,
          req.user,
        );
        anySubmitted = anySubmitted || created.submitted;
        // Re-check inside the transaction so a parallel request can't link the same asset twice.
        const linked = await tx.assets.updateMany({
          where: { id: { in: list.map((asset) => asset.id) }, repair_request_id: null, status: asset_status.NEEDS_REPAIR },
          data: { repair_request_id: created.id },
        });
        if (linked.count !== list.length) {
          throw new InputValidationError("Some of these assets changed while you were raising the requisition. Refresh and try again.");
        }
        await tx.asset_history.createMany({
          data: list.map((asset) =>
            historyData({
              assetId: asset.id,
              at: now,
              text: `Repair requisition ${created.requestId} raised by ${actor.name} (est. ${money(Number(estimates[asset.id]))})`,
              tone: "info",
              userId: actor.id,
            }),
          ),
        });
        out.push({ id: created.id, generated_id: created.requestId, department_id: departmentId, asset_ids: list.map((asset) => asset.id) });
      }
      return { made: out, submitted: anySubmitted };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  if (submitted) triggerRequisitionNotificationEventProcessing();

  const departments = await prisma.department.findMany({
    where: { id: { in: made.map((item) => item.department_id) } },
    select: { id: true, name: true, department_head_info: { select: { name: true } } },
  });
  return {
    requisitions: made.map((item) => {
      const dept = departments.find((department) => department.id === item.department_id);
      return {
        id: item.id,
        generated_id: item.generated_id,
        department: { id: item.department_id, name: dept?.name || "" },
        head_name: dept?.department_head_info?.name || null,
        asset_ids: item.asset_ids,
      };
    }),
    skipped,
    assets: await loadRows(ok.map((asset) => asset.id)),
  };
};

/** POST /assets/clear-repair-requisition { id } — after a rejection, so a new one can be raised. */
export const clearRepairRequisition = async (req: any) => {
  const access = accessOf(req);
  requireManage(access);
  const actor = await actorOf(req.user);
  const id = toPositiveInt(req.body?.id);
  if (!id) throw new InputValidationError("An asset id is required.");
  const asset = await prisma.assets.findFirst({
    where: { id, ...assetScopeWhere(access, writeBranch(req)) },
    select: ASSET_SELECT,
  });
  if (!asset) throw new NotFoundError("Asset not found");
  if (!asset.repair_request) return { asset: toAssetRow(asset) };
  if (asset.repair_request.request_approval_status !== RequestApprovalStatus.REJECTED) {
    throw new InputValidationError(
      `${asset.repair_request.request_id} is still in approval. It can only be cleared after it's rejected.`,
    );
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.assets.update({ where: { id }, data: { repair_request_id: null } }),
    prisma.asset_history.create({
      data: historyData({
        assetId: id,
        at: now,
        text: `Repair requisition ${asset.repair_request.request_id} cleared by ${actor.name} to raise a new one`,
        tone: "neutral",
        userId: actor.id,
      }) as Prisma.asset_historyUncheckedCreateInput,
    }),
  ]);
  return { asset: (await loadRows([id]))[0] };
};
