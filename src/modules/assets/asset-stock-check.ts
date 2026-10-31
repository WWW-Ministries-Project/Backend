import { Prisma, asset_status, asset_stock_check_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import {
  assertBranchAccessible,
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";
import {
  ASSET_CATEGORIES,
  type AssetAccess,
  accessOf,
  actorOf,
  assetCodeFor,
  historyData,
} from "./asset-redesign";

/**
 * Asset reconciliation (stock checks).
 *
 * An administrator (Asset manage) starts a check; every asset in scope gets an
 * item with the department the register expects it with (key 0 = the store).
 * Department members/heads count their own items and submit; the administrator
 * decides what happens to each difference and closes the check, which applies
 * the decisions to the register and keeps the check as a report.
 *
 * Shapes: docs/ASSETS_REDESIGN_FRONTEND_GUIDE.md.
 */

type Result = "found" | "elsewhere" | "damaged" | "missing" | "atrepair" | "back";
const RESULTS: Result[] = ["found", "elsewhere", "damaged", "missing", "atrepair", "back"];
/** Decisions the administrator can make, per kind of difference. */
const FIXES: Record<string, string[]> = {
  elsewhere: ["move", "return"],
  damaged: ["needs", "beyond", "keep", "repair"],
  back: ["working", "needs", "keep"],
  missing: ["lost", "keep"],
  extra: ["add", "ignore"],
};
const FIX_TEXT: Record<string, string> = {
  move: "Register updated to where it was found",
  return: "Sent back; register unchanged",
  repair: "Marked under repair",
  needs: "Marked needs repair",
  working: "Marked back in use",
  beyond: "Marked beyond repair",
  keep: "No change",
  lost: "Marked lost or stolen",
  add: "Added to the register",
  ignore: "Ignored",
};
const CATEGORY_KEYS = new Set(ASSET_CATEGORIES.map((category) => category.key));
const STORE = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Counters get an automatic reminder this many days before the due date. */
const AUTO_REMIND_DAYS_BEFORE = 3;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
/** 0 = the store, a positive id = a department, anything else = null. */
const toKey = (value: unknown): number | null => {
  if (value === STORE || value === "0" || value === "store" || value === "_store") return STORE;
  return toPositiveInt(value);
};
const parseDate = (value: unknown, label: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00.000Z` : String(value));
  if (Number.isNaN(date.getTime())) throw new InputValidationError(`${label} isn't a valid date.`);
  return date;
};

const CHECK_INCLUDE = {
  items: {
    include: {
      asset: {
        select: {
          id: true,
          asset_id: true,
          name: true,
          category: true,
          status: true,
          status_since: true,
          status_note: true,
          price: true,
          department_assigned: true,
        },
      },
    },
    orderBy: { id: "asc" },
  },
  extras: { orderBy: { id: "asc" } },
  departments: true,
} satisfies Prisma.asset_stock_checkInclude;

type CheckRecord = Prisma.asset_stock_checkGetPayload<{ include: typeof CHECK_INCLUDE }>;
type ItemRecord = CheckRecord["items"][number];

const keyOfItem = (item: { expected_department_id: number | null }) => item.expected_department_id ?? STORE;
const foundKeyOf = (row: { found_department_id: number | null; found_in_store: boolean }) =>
  row.found_in_store ? STORE : row.found_department_id;
const isDone = (item: { result: string | null; found_department_id: number | null; found_in_store: boolean }) =>
  Boolean(item.result) && !(item.result === "elsewhere" && foundKeyOf(item) === null);

const departmentMap = async (ids: number[]) => {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  if (!unique.length) return new Map<number, { name: string; head: { id: number; name: string } | null }>();
  const rows = await prisma.department.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, department_head_info: { select: { id: true, name: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, head: row.department_head_info ? { id: row.department_head_info.id, name: row.department_head_info.name } : null },
    ]),
  );
};

const keyName = (key: number | null, depts: Map<number, { name: string }>) =>
  key === STORE || key === null ? "Store (not assigned)" : depts.get(key)?.name || `Department #${key}`;

const scopeLabel = (check: CheckRecord, depts: Map<number, { name: string }>) => {
  const where = check.scope_store_only
    ? "Store only"
    : check.scope_department_id
      ? keyName(check.scope_department_id, depts)
      : "All departments";
  const category = check.scope_category
    ? ASSET_CATEGORIES.find((item) => item.key === check.scope_category)?.label || check.scope_category
    : "all categories";
  return `${where}, ${category}`;
};

const userNames = async (ids: (number | null | undefined)[]) => {
  const unique = Array.from(new Set(ids.filter((id): id is number => Boolean(id))));
  if (!unique.length) return new Map<number, string>();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
};

/** The person who counts a department: its head; the store is counted by whoever started the check. */
const counterOf = (
  key: number,
  check: { created_by: number | null },
  depts: Map<number, { head: { id: number; name: string } | null }>,
  names: Map<number, string>,
): { id: number; name: string } | null => {
  if (key === STORE) return check.created_by ? { id: check.created_by, name: names.get(check.created_by) || "" } : null;
  return depts.get(key)?.head || null;
};

const toCheckDto = async (check: CheckRecord, access: AssetAccess) => {
  const keys = Array.from(new Set(check.items.map(keyOfItem)));
  const deptIds = [
    ...keys,
    ...check.items.map((item) => item.found_department_id ?? 0),
    ...check.extras.map((extra) => extra.found_department_id ?? 0),
    check.scope_department_id ?? 0,
  ];
  const depts = await departmentMap(deptIds);
  const names = await userNames([check.created_by, check.closed_by]);
  const visible = (key: number) => access.canManage || (key > 0 && access.departmentIds.includes(key));

  const items = check.items.filter((item) => visible(keyOfItem(item)));
  return {
    id: check.id,
    name: check.name,
    scope_label: scopeLabel(check, depts),
    status: check.status === asset_stock_check_status.OPEN ? "open" : "closed",
    started_at: check.started_at.toISOString(),
    due_date: check.due_date.toISOString(),
    closed_at: iso(check.closed_at),
    created_by: check.created_by ? { id: check.created_by, name: names.get(check.created_by) || "" } : null,
    closed_by: check.closed_by ? { id: check.closed_by, name: names.get(check.closed_by) || "" } : null,
    departments: keys
      .filter(visible)
      .map((key) => {
        const row = check.departments.find((item) => item.department_key === key);
        return {
          key,
          name: keyName(key, depts),
          counter: counterOf(key, check, depts, names),
          submitted_at: iso(row?.submitted_at),
          submitted_by_name: row?.submitted_by_name || null,
          reminded_at: iso(row?.reminded_at),
        };
      }),
    items: items.map((item) => ({
      asset_id: item.asset_id,
      asset: {
        code: item.asset.asset_id || `#${item.asset.id}`,
        name: item.asset.name,
        category: item.asset.category && CATEGORY_KEYS.has(item.asset.category) ? item.asset.category : "other",
        status: item.asset.status || asset_status.UNASSIGNED,
        status_since: iso(item.asset.status_since),
        status_note: item.asset.status_note || null,
        price: Number(item.asset.price) || 0,
      },
      expected_key: keyOfItem(item),
      expected_name: keyName(keyOfItem(item), depts),
      result: item.result,
      found_key: foundKeyOf(item),
      found_name: foundKeyOf(item) === null ? null : keyName(foundKeyOf(item), depts),
      fix: item.fix,
      counted_at: iso(item.counted_at),
      counted_by_name: item.counted_by_name,
    })),
    extras: check.extras
      .filter((extra) => visible(foundKeyOf(extra) ?? -1))
      .map((extra) => ({
        id: extra.id,
        name: extra.name,
        category: extra.category && CATEGORY_KEYS.has(extra.category) ? extra.category : "other",
        found_key: foundKeyOf(extra),
        found_name: keyName(foundKeyOf(extra), depts),
        note: extra.note,
        fix: extra.fix,
        recorded_at: extra.recorded_at.toISOString(),
        recorded_by: extra.recorded_by,
        recorded_by_name: extra.recorded_by_name,
        created_asset_id: extra.created_asset_id,
      })),
  };
};

const loadCheck = async (checkId: unknown, branchId?: unknown) => {
  const id = toPositiveInt(checkId);
  if (!id) throw new InputValidationError("A stock check id is required.");
  const check = await prisma.asset_stock_check.findUnique({ where: { id }, include: CHECK_INCLUDE });
  const branch = toPositiveInt(branchId);
  if (!check || (branch && check.branch_id && check.branch_id !== branch)) throw new NotFoundError("Stock check not found");
  assertBranchAccessible(check.branch_id);
  return check;
};
/** The open check named in the body, in the active branch. */
const loadOpenCheck = async (req: any) => {
  const check = await loadCheck(req?.body?.check_id, req?.body?.branch_id ?? req?.query?.branch_id);
  if (check.status !== asset_stock_check_status.OPEN) throw new InputValidationError("This stock check is closed.");
  return check;
};
/** Branch-wide asset managers run stock checks; each step is its own action. */
const requireAdmin = (access: AssetAccess, action: string) => {
  if (!access.canManage || !access.can(action)) {
    throw new UnauthorizedError("Only the assets administrator can do this.");
  }
};
/**
 * Department members count their own department's assets with no Asset role
 * (a relationship rule); a role's reach beyond that needs `Asset.count`.
 */
const canCount = (access: AssetAccess, key: number) =>
  (access.canManage && access.can("count")) || (key > 0 && access.departmentIds.includes(key));
const isSubmitted = (check: CheckRecord, key: number) =>
  Boolean(check.departments.find((row) => row.department_key === key)?.submitted_at);

const respond = async (checkId: number, access: AssetAccess) =>
  ({ check: await toCheckDto(await loadCheck(checkId), access) });

const notify = async (
  inputs: { userId: number; type: string; title: string; body: string; checkId: number; actorId: number; key: string }[],
) => {
  const list = inputs.filter((input) => input.userId && input.userId !== input.actorId);
  if (!list.length) return 0;
  await notificationService
    .createManyInAppNotifications(
      list.map((input) => ({
        type: input.type,
        title: input.title,
        body: input.body,
        recipientUserId: input.userId,
        actorUserId: input.actorId,
        entityType: "ASSET_STOCK_CHECK",
        entityId: String(input.checkId),
        actionUrl: `/home/assets/count?check=${input.checkId}`,
        priority: "MEDIUM",
        dedupeKey: `asset-stock-check:${input.checkId}:${input.type}:${input.userId}:${input.key}`,
        emailSubject: input.title,
        sendEmail: true,
      })),
    )
    .then(() => list.length)
    .catch((error: any) => {
      console.error("[ERROR] Stock check notification failed", error?.message || String(error));
      return 0;
    });
};

/* -------------------------------------------------------------------------- */
/*                                    Reads                                   */
/* -------------------------------------------------------------------------- */

/** GET /assets/stock-checks — admins see every check; counters see open checks with their items. */
const PAST_PAGE_DEFAULT = 10;
const PAST_PAGE_MAX = 50;

/** Checks visible in a branch: its own, plus checks that span all branches. */
const branchChecksWhere = (branchId: unknown): Prisma.asset_stock_checkWhereInput => {
  const filter = getBranchScopedWhere(branchId);
  return filter ? { OR: [{ branch_id: filter.branch_id }, { branch_id: null }] } : {};
};

/** Headline numbers for a closed check, without shipping every item. */
const pastSummaryOf = (check: CheckRecord, depts: Map<number, { name: string }>, names: Map<number, string>) => {
  const done = check.items.filter(isDone);
  const found = done.filter((item) => item.result === "found" || item.result === "atrepair").length;
  const missing = done.filter((item) => item.result === "missing");
  return {
    id: check.id,
    name: check.name,
    scope_label: scopeLabel(check, depts),
    started_at: check.started_at.toISOString(),
    closed_at: iso(check.closed_at),
    created_by: check.created_by ? { id: check.created_by, name: names.get(check.created_by) || "" } : null,
    closed_by: check.closed_by ? { id: check.closed_by, name: names.get(check.closed_by) || "" } : null,
    stats: {
      expected: check.items.length,
      counted: done.length,
      matched: found,
      differences: done.length - found + check.extras.length,
      not_found_value: missing.reduce((total, item) => total + (Number(item.asset.price) || 0), 0),
    },
  };
};

/**
 * GET /assets/stock-checks?past_offset=&past_limit=
 * Open checks come in full (counters see only their items). Closed checks are
 * administrator-only and come as paged summaries; open one with stock-checks/detail.
 */
export const listStockChecks = async (req: any) => {
  const access = accessOf(req);
  const scope = branchChecksWhere(req.query?.branch_id);
  const open = await prisma.asset_stock_check.findMany({
    where: { ...scope, status: asset_stock_check_status.OPEN },
    include: CHECK_INCLUDE,
    orderBy: [{ started_at: "desc" }, { id: "desc" }],
  });
  const checks = [];
  for (const check of open) {
    const dto = await toCheckDto(check, access);
    if (access.canManage || dto.items.length) checks.push(dto);
  }

  let past: ReturnType<typeof pastSummaryOf>[] = [];
  let pastTotal = 0;
  const offset = Math.max(0, Number.parseInt(String(req.query?.past_offset ?? "0"), 10) || 0);
  const limit = Math.min(PAST_PAGE_MAX, Math.max(1, Number.parseInt(String(req.query?.past_limit ?? PAST_PAGE_DEFAULT), 10) || PAST_PAGE_DEFAULT));
  if (access.canManage) {
    const closedWhere = { ...scope, status: asset_stock_check_status.CLOSED };
    const [total, rows] = await Promise.all([
      prisma.asset_stock_check.count({ where: closedWhere }),
      prisma.asset_stock_check.findMany({
        where: closedWhere,
        include: CHECK_INCLUDE,
        orderBy: [{ closed_at: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    pastTotal = total;
    const depts = await departmentMap(rows.map((row) => row.scope_department_id ?? 0));
    const names = await userNames(rows.flatMap((row) => [row.created_by, row.closed_by]));
    past = rows.map((row) => pastSummaryOf(row, depts, names));
  }

  return {
    viewer: {
      user_id: toPositiveInt(req.user?.id),
      is_admin: access.canManage,
      department_keys: access.canManage ? [] : access.departmentIds,
    },
    checks,
    past,
    past_total: pastTotal,
    past_offset: offset,
    past_limit: limit,
  };
};

/** GET /assets/stock-checks/detail?id= — one check in full (closed reports are administrator-only). */
export const getStockCheckDetail = async (req: any) => {
  const access = accessOf(req);
  const check = await loadCheck(req.query?.id, req.query?.branch_id);
  if (!access.canManage && check.status !== asset_stock_check_status.OPEN) throw new NotFoundError("Stock check not found");
  const dto = await toCheckDto(check, access);
  if (!access.canManage && !dto.items.length) throw new NotFoundError("Stock check not found");
  return { check: dto };
};

/* -------------------------------------------------------------------------- */
/*                              Start and cancel                              */
/* -------------------------------------------------------------------------- */

/** POST /assets/stock-checks/start { name, department_key?, category?, due_date, branch_id? } */
export const startStockCheck = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "stock_check");
  const actor = await actorOf(req.user);
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const due = parseDate(body.due_date, "Count by");
  const errors = [!name && "Give the check a name.", !due && "Set a due date."].filter(Boolean) as string[];
  if (errors.length) throw new InputValidationError(errors.join(" "));
  const key = toKey(body.department_key);
  const category = body.category ? String(body.category) : null;
  if (category && !CATEGORY_KEYS.has(category)) throw new InputValidationError("Choose a valid category.");
  const branchFilter = getBranchScopedWhere(body.branch_id ?? req.query?.branch_id);

  const branchId = branchFilter ? await resolveBranchIdOrDefault(body.branch_id ?? req.query?.branch_id) : null;

  const { created, assets } = await prisma.$transaction(
    async (tx) => {
      // Serialize starts: lock the branch row (or every branch for an all-branches
      // check) so two admins starting at once can't both find "nothing open".
      // Overlapping scopes (one branch vs. all branches) share at least one row.
      if (branchId) {
        await tx.$queryRaw`SELECT id FROM branch WHERE id = ${branchId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM branch FOR UPDATE`;
      }

      const open = await tx.asset_stock_check.findFirst({
        where: {
          status: asset_stock_check_status.OPEN,
          // A branch check is blocked by an open check in that branch or across all branches.
          ...(branchId ? { OR: [{ branch_id: branchId }, { branch_id: null }] } : {}),
        },
        select: { name: true },
      });
      if (open) throw new InputValidationError(`${open.name} is still in progress. Close or cancel it first.`);

      const inScope = await tx.assets.findMany({
        where: {
          ...(branchId ? { branch_id: branchId } : {}),
          OR: [{ status: null }, { status: { not: asset_status.LOST_OR_STOLEN } }],
          ...(key === STORE ? { department_assigned: null } : key ? { department_assigned: key } : {}),
          ...(category ? { category } : {}),
        },
        select: { id: true, department_assigned: true },
      });
      if (!inScope.length) throw new InputValidationError("No assets match this scope.");

      const check = await tx.asset_stock_check.create({
        data: {
          name,
          scope_department_id: key && key > 0 ? key : null,
          scope_store_only: key === STORE,
          scope_category: category,
          due_date: due as Date,
          created_by: actor.id,
          branch_id: branchId,
        },
      });
      await tx.asset_stock_check_item.createMany({
        data: inScope.map((asset) => ({
          check_id: check.id,
          asset_id: asset.id,
          expected_department_id: asset.department_assigned ?? null,
        })),
      });
      return { created: check, assets: inScope };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const depts = await departmentMap(assets.map((asset) => asset.department_assigned ?? 0));
  const counts = new Map<number, number>();
  assets.forEach((asset) => {
    if (asset.department_assigned) counts.set(asset.department_assigned, (counts.get(asset.department_assigned) || 0) + 1);
  });
  const notified = await notify(
    Array.from(counts.entries()).flatMap(([deptId, n]) => {
      const head = depts.get(deptId)?.head;
      return head
        ? [
            {
              userId: head.id,
              type: "assets.stock_check_started",
              title: `${name}: count ${depts.get(deptId)?.name}`,
              body: `${actor.name} asked you to count the ${n} ${n === 1 ? "asset" : "assets"} ${depts.get(deptId)?.name} holds by ${(due as Date).toISOString().slice(0, 10)}.`,
              checkId: created.id,
              actorId: actor.id,
              key: "start",
            },
          ]
        : [];
    }),
  );

  return { ...(await respond(created.id, access)), counted: assets.length, notified };
};

/** POST /assets/stock-checks/cancel { check_id } — discards counts; the register is untouched. */
export const cancelStockCheck = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "stock_check");
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const depts = await departmentMap(check.items.map(keyOfItem));
  const removed = await prisma.asset_stock_check.deleteMany({
    where: { id: check.id, status: asset_stock_check_status.OPEN },
  });
  if (!removed.count) throw new InputValidationError("This stock check was closed in the meantime.");
  const heads = new Map<number, string>();
  check.items.forEach((item) => {
    const head = depts.get(keyOfItem(item))?.head;
    if (head) heads.set(head.id, head.name);
  });
  await notify(
    Array.from(heads.keys()).map((userId) => ({
      userId,
      type: "assets.stock_check_cancelled",
      title: `${check.name} was cancelled`,
      body: `${actor.name} cancelled the stock check. There's nothing left for you to count.`,
      checkId: check.id,
      actorId: actor.id,
      key: "cancel",
    })),
  );
  return { id: check.id };
};

/* -------------------------------------------------------------------------- */
/*                                  Counting                                  */
/* -------------------------------------------------------------------------- */

const defaultFix = (result: Result, status: asset_status | null) =>
  result === "elsewhere"
    ? "move"
    : result === "damaged"
      ? status === asset_status.NEEDS_REPAIR
        ? "keep"
        : "needs"
      : result === "back"
        ? "working"
        : result === "missing"
          ? "lost"
          : null;

/**
 * POST /assets/stock-checks/mark { check_id, marks: [{ asset_id, result, found_key? }] }
 * result null clears the item. found_key (0 = store) says where an "elsewhere" item is.
 */
export const markStockCheckItems = async (req: any) => {
  const access = accessOf(req);
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const marks: any[] = Array.isArray(req.body?.marks) ? req.body.marks : [];
  if (!marks.length) throw new InputValidationError("Nothing to record.");
  const now = new Date();

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const mark of marks) {
    const assetId = toPositiveInt(mark?.asset_id);
    const item = check.items.find((row) => row.asset_id === assetId);
    if (!item) throw new NotFoundError("That asset isn't part of this stock check.");
    const key = keyOfItem(item);
    if (!canCount(access, key)) throw new UnauthorizedError("You can only count your own department's assets.");
    if (!access.canManage && isSubmitted(check, key)) {
      throw new InputValidationError("You've submitted this count. Reopen it to make changes.");
    }
    const result = mark?.result ? (String(mark.result) as Result) : null;
    if (result && !RESULTS.includes(result)) throw new InputValidationError("That isn't a valid count result.");
    const foundKey = result === "elsewhere" ? toKey(mark?.found_key) : null;
    if (result === "elsewhere" && foundKey === key) {
      throw new InputValidationError("Choose a different place from where it should be.");
    }
    updates.push(
      prisma.asset_stock_check_item.update({
        where: { id: item.id },
        data: result
          ? {
              result,
              found_department_id: foundKey && foundKey > 0 ? foundKey : null,
              found_in_store: foundKey === STORE,
              fix: defaultFix(result, item.asset.status),
              counted_at: now,
              counted_by: actor.id,
              counted_by_name: actor.name,
            }
          : {
              result: null,
              found_department_id: null,
              found_in_store: false,
              fix: null,
              counted_at: null,
              counted_by: null,
              counted_by_name: null,
            },
      }),
    );
  }
  await prisma.$transaction(updates);
  return respond(check.id, access);
};

/** POST /assets/stock-checks/set-fix { check_id, asset_id | extra_id, fix } — administrator's decision. */
export const setStockCheckFix = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "reconcile");
  const check = await loadOpenCheck(req);
  const fix = String(req.body?.fix || "");
  const extraId = toPositiveInt(req.body?.extra_id);
  if (extraId) {
    const extra = check.extras.find((row) => row.id === extraId);
    if (!extra) throw new NotFoundError("Item not found");
    if (!FIXES.extra.includes(fix)) throw new InputValidationError("Choose add or ignore.");
    await prisma.asset_stock_check_extra.update({ where: { id: extraId }, data: { fix } });
    return respond(check.id, access);
  }
  const item = check.items.find((row) => row.asset_id === toPositiveInt(req.body?.asset_id));
  if (!item || !item.result) throw new NotFoundError("That asset hasn't been counted.");
  if (!(FIXES[item.result] || []).includes(fix)) throw new InputValidationError("That choice doesn't apply to this difference.");
  await prisma.asset_stock_check_item.update({ where: { id: item.id }, data: { fix } });
  return respond(check.id, access);
};

/** POST /assets/stock-checks/add-extra { check_id, name, category?, found_key, note? } */
export const addStockCheckExtra = async (req: any) => {
  const access = accessOf(req);
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const name = String(req.body?.name || "").trim();
  const foundKey = toKey(req.body?.found_key);
  const errors = [!name && "Say what the item is.", foundKey === null && "Choose where it was found."].filter(Boolean) as string[];
  if (errors.length) throw new InputValidationError(errors.join(" "));
  if (!canCount(access, foundKey as number)) throw new UnauthorizedError("You can only record items found in your department.");
  const category = CATEGORY_KEYS.has(String(req.body?.category)) ? String(req.body.category) : "other";
  await prisma.asset_stock_check_extra.create({
    data: {
      check_id: check.id,
      name,
      category,
      found_department_id: foundKey && foundKey > 0 ? foundKey : null,
      found_in_store: foundKey === STORE,
      note: String(req.body?.note || "").trim() || null,
      recorded_by: actor.id,
      recorded_by_name: actor.name,
    },
  });
  return respond(check.id, access);
};

/** POST /assets/stock-checks/remove-extra { check_id, extra_id } */
export const removeStockCheckExtra = async (req: any) => {
  const access = accessOf(req);
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const extra = check.extras.find((row) => row.id === toPositiveInt(req.body?.extra_id));
  if (!extra) throw new NotFoundError("Item not found");
  if (!access.canManage && extra.recorded_by !== actor.id) throw new UnauthorizedError("You can only remove items you recorded.");
  await prisma.asset_stock_check_extra.delete({ where: { id: extra.id } });
  return respond(check.id, access);
};

/* -------------------------------------------------------------------------- */
/*                         Department sign-off and chasing                    */
/* -------------------------------------------------------------------------- */

const upsertDepartment = (checkId: number, key: number, data: Prisma.asset_stock_check_departmentUpdateInput) =>
  prisma.asset_stock_check_department.upsert({
    where: { check_id_department_key: { check_id: checkId, department_key: key } },
    create: { check_id: checkId, department_key: key, ...(data as any) },
    update: data,
  });

/** POST /assets/stock-checks/submit { check_id, department_key } */
export const submitStockCheckDepartment = async (req: any) => {
  const access = accessOf(req);
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const key = toKey(req.body?.department_key);
  if (key === null) throw new InputValidationError("Choose the department you're submitting.");
  if (!canCount(access, key)) throw new UnauthorizedError("You can only submit your own department's count.");
  const items = check.items.filter((item) => keyOfItem(item) === key);
  if (!items.length) throw new InputValidationError("Nothing to count for this department.");
  const left = items.filter((item) => !isDone(item)).length;
  if (left) throw new InputValidationError(`${left} ${left === 1 ? "item is" : "items are"} still to count.`);
  await upsertDepartment(check.id, key, { submitted_at: new Date(), submitted_by: actor.id, submitted_by_name: actor.name });

  const depts = await departmentMap([key]);
  const diffs = items.filter((item) => item.result !== "found" && item.result !== "atrepair").length;
  if (check.created_by) {
    await notify([
      {
        userId: check.created_by,
        type: "assets.stock_check_submitted",
        title: `Count submitted for ${keyName(key, depts)}`,
        body: `${actor.name} counted ${items.length} ${items.length === 1 ? "item" : "items"} for ${check.name}, ${diffs} with differences to review.`,
        checkId: check.id,
        actorId: actor.id,
        key: `submit-${key}-${Date.now()}`,
      },
    ]);
  }
  return respond(check.id, access);
};

/** POST /assets/stock-checks/reopen { check_id, department_key } */
export const reopenStockCheckDepartment = async (req: any) => {
  const access = accessOf(req);
  const check = await loadOpenCheck(req);
  const key = toKey(req.body?.department_key);
  if (key === null) throw new InputValidationError("Choose the department to reopen.");
  if (!canCount(access, key)) throw new UnauthorizedError("You can only reopen your own department's count.");
  await upsertDepartment(check.id, key, { submitted_at: null, submitted_by: null, submitted_by_name: null });
  return respond(check.id, access);
};

const remindKeys = async (check: CheckRecord, keys: number[], actor: { id: number; name: string }, automatic: boolean) => {
  const depts = await departmentMap(keys);
  const names = await userNames([check.created_by]);
  const now = new Date();
  let sent = 0;
  for (const key of keys) {
    if (isSubmitted(check, key)) continue;
    const counter = counterOf(key, check, depts, names);
    if (!counter || counter.id === actor.id) continue;
    const items = check.items.filter((item) => keyOfItem(item) === key);
    const left = items.filter((item) => !isDone(item)).length;
    const delivered = await notify([
      {
        userId: counter.id,
        type: "assets.stock_check_reminder",
        title: `Reminder: count ${keyName(key, depts)} for ${check.name}`,
        body: `${left} of ${items.length} items still to count. Due ${check.due_date.toISOString().slice(0, 10)}.`,
        checkId: check.id,
        actorId: automatic ? 0 : actor.id,
        key: `remind-${key}-${now.toISOString().slice(0, 13)}`,
      },
    ]);
    if (!delivered) continue;
    sent += delivered;
    await upsertDepartment(check.id, key, { reminded_at: now });
  }
  return sent;
};

/** POST /assets/stock-checks/remind { check_id, department_keys? } — all unsubmitted when omitted. */
export const remindStockCheckCounters = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "stock_check");
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const all = Array.from(new Set(check.items.map(keyOfItem)));
  const requested = Array.isArray(req.body?.department_keys)
    ? req.body.department_keys.map(toKey).filter((key: number | null): key is number => key !== null)
    : all;
  const sent = await remindKeys(check, requested.filter((key: number) => all.includes(key)), actor, false);
  return { ...(await respond(check.id, access)), sent };
};

/** POST /assets/stock-checks/recount { check_id, asset_id } — back on the counter's list, their count reopened. */
export const requestStockCheckRecount = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "request_recount");
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const item = check.items.find((row) => row.asset_id === toPositiveInt(req.body?.asset_id));
  if (!item) throw new NotFoundError("That asset isn't part of this stock check.");
  const key = keyOfItem(item);
  await prisma.$transaction([
    prisma.asset_stock_check_item.update({
      where: { id: item.id },
      data: { result: null, found_department_id: null, found_in_store: false, fix: null, counted_at: null, counted_by: null, counted_by_name: null },
    }),
    upsertDepartment(check.id, key, { submitted_at: null, submitted_by: null, submitted_by_name: null }),
  ]);
  const depts = await departmentMap([key]);
  const names = await userNames([check.created_by]);
  const counter = counterOf(key, check, depts, names);
  if (counter) {
    await notify([
      {
        userId: counter.id,
        type: "assets.stock_check_reminder",
        title: `Look again for ${item.asset.name}`,
        body: `${actor.name} asked for a recount of ${item.asset.name} (${item.asset.asset_id || ""}) in ${check.name}. Your count is reopened.`,
        checkId: check.id,
        actorId: actor.id,
        key: `recount-${item.asset_id}-${Date.now()}`,
      },
    ]);
  }
  return { ...(await respond(check.id, access)), counter_name: counter?.name || null };
};

/** POST /assets/stock-checks/mark-rest-missing { check_id } — uncounted → not found, "check again next time". */
export const markRestMissing = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "reconcile");
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const ids = check.items.filter((item) => !isDone(item)).map((item) => item.id);
  if (ids.length) {
    await prisma.asset_stock_check_item.updateMany({
      where: { id: { in: ids } },
      data: {
        result: "missing",
        found_department_id: null,
        found_in_store: false,
        fix: "keep",
        counted_at: new Date(),
        counted_by: actor.id,
        counted_by_name: `${actor.name} (not counted)`,
      },
    });
  }
  return respond(check.id, access);
};

/* -------------------------------------------------------------------------- */
/*                                    Close                                   */
/* -------------------------------------------------------------------------- */

/** POST /assets/stock-checks/close { check_id } — applies every decision to the register. */
export const closeStockCheck = async (req: any) => {
  const access = accessOf(req);
  requireAdmin(access, "stock_check");
  const actor = await actorOf(req.user);
  const check = await loadOpenCheck(req);
  const left = check.items.filter((item) => !isDone(item)).length;
  if (left) {
    throw new InputValidationError(
      `${left} ${left === 1 ? "asset hasn't" : "assets haven't"} been counted. Count them or record them as not found.`,
    );
  }
  const depts = await departmentMap([
    ...check.items.map((item) => item.found_department_id ?? 0),
    ...check.extras.map((extra) => extra.found_department_id ?? 0),
  ]);
  const nm = check.name;
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      const history: Prisma.asset_historyCreateManyInput[] = [];
      const log = (item: ItemRecord, text: string, tone: "success" | "info" | "warning" | "danger", status?: asset_status) =>
        history.push(historyData({ assetId: item.asset_id, at: now, text, tone, status: status ?? null, userId: actor.id }));
      const verified: number[] = [];
      // Claim the close first so a second request (double click, retry) can't apply it twice.
      const claimed = await tx.asset_stock_check.updateMany({
        where: { id: check.id, status: asset_stock_check_status.OPEN },
        data: { status: asset_stock_check_status.CLOSED, closed_at: now, closed_by: actor.id },
      });
      if (!claimed.count) throw new InputValidationError("This stock check is already closed.");

      for (const item of check.items) {
        const asset = item.asset;
        let patch: Prisma.assetsUncheckedUpdateInput | null = null;
        const foundKey = foundKeyOf(item);
        const where = foundKey === STORE ? "the store" : keyName(foundKey, depts);
        const expected = item.expected_department_id ? keyName(item.expected_department_id, depts) : "the store";

        if (item.result === "found") {
          verified.push(item.asset_id);
          log(item, `Counted and verified in ${nm}`, "success");
        } else if (item.result === "atrepair") {
          verified.push(item.asset_id);
          log(item, `Confirmed with the repairer in ${nm}`, "success");
        } else if (item.result === "elsewhere") {
          verified.push(item.asset_id);
          if (item.fix === "move") {
            patch =
              foundKey === STORE
                ? { department_assigned: null, status: asset_status.UNASSIGNED, status_since: now, status_note: null, repair_request_id: null, lost_confirmed_at: null }
                : { department_assigned: foundKey, status: asset_status.ASSIGNED, date_assigned: now, status_since: now, status_note: null, repair_request_id: null, lost_confirmed_at: null };
            log(item, `Found with ${where} in ${nm}. Register updated by ${actor.name}`, "info", patch.status as asset_status);
          } else {
            log(item, `Found with ${where} in ${nm}. Sent back to ${expected}`, "info");
          }
        } else if (item.result === "damaged") {
          verified.push(item.asset_id);
          if (item.fix === "needs") {
            patch = {
              status: asset_status.NEEDS_REPAIR,
              status_since: now,
              status_note: `Found damaged in ${nm}.`,
              // Under repair already: keep the requisition paying for it.
              ...(asset.status === asset_status.OUT_OF_REPAIRS ? {} : { repair_request_id: null }),
            };
          }
          if (item.fix === "beyond") patch = { status: asset_status.NOT_FIXABLE, status_since: now, status_note: `Found damaged beyond repair in ${nm}.`, repair_request_id: null };
          if (item.fix === "repair") patch = { status: asset_status.OUT_OF_REPAIRS, status_since: now, status_note: `Found damaged in ${nm}.` };
          log(item, `Found damaged in ${nm}. ${FIX_TEXT[item.fix || "keep"]}`, "warning", patch?.status as asset_status | undefined);
        } else if (item.result === "back") {
          verified.push(item.asset_id);
          if (item.fix === "working") {
            patch = {
              status: asset.department_assigned ? asset_status.ASSIGNED : asset_status.UNASSIGNED,
              status_since: now,
              status_note: null,
              repair_request_id: null,
            };
          }
          if (item.fix === "needs") patch = { status: asset_status.NEEDS_REPAIR, status_since: now, status_note: `Back from the repairer but still faulty (${nm}).` };
          log(item, `Found back from repair in ${nm}. ${FIX_TEXT[item.fix || "keep"]}`, "info", patch?.status as asset_status | undefined);
        } else if (item.result === "missing") {
          if (item.fix === "lost") {
            patch = { status: asset_status.LOST_OR_STOLEN, status_since: now, status_note: `Not found in ${nm}.`, lost_confirmed_at: null, repair_request_id: null };
          }
          log(item, `Not found in ${nm}. ${item.fix === "lost" ? "Marked lost or stolen" : "To be checked again next time"}`, "danger", patch?.status as asset_status | undefined);
        }
        if (patch) {
          await tx.assets.update({ where: { id: item.asset_id }, data: { ...patch, updated_by: actor.id, updated_at: now } });
        }
      }

      if (verified.length) {
        await tx.assets.updateMany({ where: { id: { in: verified } }, data: { last_counted_at: now } });
      }

      for (const extra of check.extras.filter((row) => row.fix === "add")) {
        const foundKey = foundKeyOf(extra);
        const inStore = foundKey === STORE || foundKey === null;
        const created = await tx.assets.create({
          data: {
            name: extra.name,
            category: extra.category || "other",
            status: inStore ? asset_status.UNASSIGNED : asset_status.ASSIGNED,
            department_assigned: inStore ? null : foundKey,
            date_assigned: inStore ? null : now,
            status_since: now,
            price: 0,
            description: `${extra.note || extra.name} Purchase details to be confirmed.`,
            created_by: actor.id,
            branch_id: check.branch_id ?? (await resolveBranchIdOrDefault(undefined)),
            last_counted_at: now,
          },
          select: { id: true },
        });
        const code = assetCodeFor(created.id, now);
        await tx.assets.update({ where: { id: created.id }, data: { asset_id: code } });
        await tx.asset_stock_check_extra.update({ where: { id: extra.id }, data: { created_asset_id: created.id } });
        history.push(
          historyData({
            assetId: created.id,
            at: now,
            text: `Found during ${nm} and added to the register as ${code} by ${actor.name}`,
            tone: "info",
            userId: actor.id,
          }),
        );
      }

      if (history.length) await tx.asset_history.createMany({ data: history });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return respond(check.id, access);
};

/* -------------------------------------------------------------------------- */
/*                               Automatic reminder                           */
/* -------------------------------------------------------------------------- */

/** Daily: counters who haven't submitted get one reminder in the last days before the due date. */
export const runStockCheckAutoReminders = async () => {
  const now = new Date();
  const checks = await prisma.asset_stock_check.findMany({
    where: { status: asset_stock_check_status.OPEN, due_date: { lte: new Date(now.getTime() + AUTO_REMIND_DAYS_BEFORE * DAY_MS) } },
    include: CHECK_INCLUDE,
  });
  let sent = 0;
  for (const check of checks) {
    const keys = Array.from(new Set(check.items.map(keyOfItem))).filter((key) => {
      const row = check.departments.find((item) => item.department_key === key);
      return !row?.submitted_at && (!row?.reminded_at || now.getTime() - row.reminded_at.getTime() > DAY_MS);
    });
    sent += await remindKeys(check, keys, { id: 0, name: "" }, true);
  }
  return { sent };
};
