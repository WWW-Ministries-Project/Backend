import JWT from "jsonwebtoken";
import { Request } from "express";
import { prisma } from "../../Models/context";
import {
  getRequestAccess,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { actionAllowed } from "../../permissions/access";
import {
  BranchAccessError,
  getBranchScopedWhere,
} from "../branches/branchService";
import { getBranchScope, isBranchAllowed, readActiveBranchId } from "../branches/branchScope";

/**
 * Marketplace access helpers shared by the market, product and order
 * modules: action checks on the caller's live permissions, branch scoping
 * for orders (orders carry no branch of their own; they belong to the
 * branches of the markets their items were bought from), the staff check on
 * public catalogue reads, and the payment return-URL allowlist.
 */

export const MARKETPLACE = "Marketplace";

/** Whether the caller (after a permission guard ran) holds `Marketplace.<action>`. */
export const marketplaceActionAllowed = (req: Request, action: string): boolean =>
  actionAllowed(getRequestAccess(req)?.permissions, MARKETPLACE, action);

/**
 * Order filter for the caller's branches (the requested or active branch,
 * clamped to the branches they hold a role in). Undefined: no filter.
 */
export const orderBranchWhere = (branchId?: unknown) => {
  const where = getBranchScopedWhere(branchId);
  if (!where) return undefined;
  return { items: { some: { market: { is: { branch_id: where.branch_id } } } } };
};

/** Whether every branch an order's markets belong to is outside the caller's branches. */
const orderOutsideBranches = (branchIds: (number | null | undefined)[]) => {
  const scope = getBranchScope();
  if (!scope?.allowedBranchIds) return false;
  const owned = branchIds.filter((id): id is number => typeof id === "number");
  // An order whose markets carry no branch predates branches; leave it reachable.
  if (!owned.length) return false;
  return !owned.some((id) => isBranchAllowed(scope, id));
};

/** Throws BranchAccessError when the order belongs to none of the caller's branches. */
export const assertOrderBranchAccessible = async (orderId: number) => {
  const items = await prisma.order_items.findMany({
    where: { order_id: orderId },
    select: { market: { select: { branch_id: true } } },
  });
  if (orderOutsideBranches(items.map((item) => item.market?.branch_id))) {
    throw new BranchAccessError();
  }
};

/** The subset of `orderIds` inside the caller's branches. */
export const filterOrdersInBranches = async (orderIds: number[]) => {
  const scope = getBranchScope();
  if (!scope?.allowedBranchIds) return { allowed: orderIds, denied: [] as number[] };
  const items = await prisma.order_items.findMany({
    where: { order_id: { in: orderIds } },
    select: { order_id: true, market: { select: { branch_id: true } } },
  });
  const branchesByOrder = new Map<number, (number | null | undefined)[]>();
  for (const item of items) {
    const list = branchesByOrder.get(item.order_id) ?? [];
    list.push(item.market?.branch_id);
    branchesByOrder.set(item.order_id, list);
  }
  const allowed: number[] = [];
  const denied: number[] = [];
  for (const id of orderIds) {
    (orderOutsideBranches(branchesByOrder.get(id) ?? []) ? denied : allowed).push(id);
  }
  return { allowed, denied };
};

/** Throws BranchAccessError when the market is in a branch the caller holds no role in. */
export const assertMarketBranchAccessible = async (marketId: number | null | undefined) => {
  if (!marketId) return;
  const market = await prisma.markets.findUnique({
    where: { id: marketId },
    select: { branch_id: true },
  });
  if (market?.branch_id && !isBranchAllowed(getBranchScope(), market.branch_id)) {
    throw new BranchAccessError();
  }
};

/**
 * Whether a public catalogue read comes from staff who may see drafts and
 * deleted items (a valid token with Marketplace view). Guests and members
 * only ever see live, published items.
 */
export const isCatalogueStaff = async (req: Request): Promise<boolean> => {
  const token = String(req.headers?.authorization ?? "").split(" ")[1];
  if (!token) return false;
  try {
    const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
    const userId = Number(decoded?.id);
    if (!Number.isInteger(userId) || userId <= 0) return false;
    return await userHasBranchDomainPermission(
      userId,
      MARKETPLACE,
      "view",
      readActiveBranchId(req),
    );
  } catch {
    return false;
  }
};

/** Where products a guest or member may see live: published (or legacy unset), not deleted, in a live market. */
export const publicProductWhere = () => ({
  deleted: false,
  OR: [{ status: null }, { status: "published" }],
  market: { deleted: false },
});
